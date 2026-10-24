// Owns one chat run: sends the message, reads the SSE stream, relays every
// event to the webview, and drives the host-side reactions (status bar,
// diff-on-approval, notifications).
//
// The backend keeps the POST /chat/stream connection open across approval
// pauses (approval_required is forwarded but the stream lives on until the run
// reaches a terminal state), so a single opened stream covers the whole
// logical run including approve/deny continuations. If the connection drops
// mid-run we reattach through the resumable GET stream from the last event id.

import * as vscode from 'vscode'
import type { BackendClient } from '../backend/client'
import { ApiError } from '../backend/client'
import { readSseStream, parseEventData } from '../backend/sse'
import type {
  ContextUsage,
  RunCompletedEvent,
  RunFailedEvent,
  StreamEvent,
} from '../shared/types'
import { buildProposedWrite, showProposedDiff } from '../workspace/diff'

export type RunState = 'idle' | 'running' | 'awaiting_approval' | 'error'

export interface ChatControllerEvents {
  onEvent?: (ev: StreamEvent) => void
  onState?: (state: RunState) => void
}

const MAX_REATTACH_ATTEMPTS = 5

export class ChatController {
  private sessionId: string | null = null
  private runId: string | null = null
  private lastEventId: string | undefined
  private costUsd = 0
  private contextPct = 0
  private streaming = false
  private abort: AbortController | null = null
  private listeners: ChatControllerEvents

  constructor(
    private client: BackendClient,
    private workspaceRoot: string,
    private approvalMode: string,
    events: ChatControllerEvents = {},
  ) {
    this.listeners = events
  }

  get isStreaming(): boolean {
    return this.streaming
  }

  get cost(): number {
    return this.costUsd
  }

  get contextPercent(): number {
    return this.contextPct
  }

  get currentSessionId(): string | null {
    return this.sessionId
  }

  get currentRunId(): string | null {
    return this.runId
  }

  setSessionId(id: string | null): void {
    this.sessionId = id
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root
  }

  setApprovalMode(mode: string): void {
    this.approvalMode = mode
  }

  /** Send a message and stream the run. Resolves when the run reaches a terminal state. */
  async send(message: string, files?: string[], approvalMode?: string): Promise<void> {
    if (this.streaming) {
      throw new Error('A run is already in progress. Stop it first.')
    }
    if (approvalMode) this.approvalMode = approvalMode
    this.streaming = true
    this.emitState('running')
    this.lastEventId = undefined
    const body: Record<string, unknown> = {
      session_id: this.sessionId,
      message,
      approval_mode: this.approvalMode,
    }
    if (files && files.length) body.files = files

    try {
      const res = await this.client.raw('POST', '/chat/stream', body)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new ApiError(
          res.status,
          `http_${res.status}`,
          `Chat stream failed to open (${res.status}): ${text}`,
          res.status >= 500,
        )
      }
      await this.consume(res)
    } catch (err) {
      // The stream dropped before a terminal event. Try to reattach.
      await this.reattach(0)
    }
  }

  /** Stop the current run. */
  async stop(): Promise<void> {
    const runId = this.runId
    this.abort?.abort()
    this.abort = null
    if (runId) {
      try {
        await this.client.post(`/chat/runs/${runId}/cancel`)
      } catch {
        // Already finished or not found — nothing more to do.
      }
    }
    this.streaming = false
    this.runId = null
    this.emitState('idle')
  }

  /** Start a fresh session (next send creates a new session). */
  newSession(): void {
    this.sessionId = null
    this.runId = null
    this.costUsd = 0
    this.contextPct = 0
  }

  /**
   * Attach to a run that is already in flight — one this host did not start (or
   * started before a reload). Resumes the SSE stream from the last event id we
   * saw, or from the beginning when we have none.
   *
   * Throws if the run cannot be resumed; the caller is responsible for telling
   * the webview the run is not actually running.
   */
  async resumeRun(runId: string, lastSeq?: number): Promise<void> {
    if (this.streaming) {
      throw new Error('A run is already in progress. Stop it first.')
    }
    this.runId = runId
    if (typeof lastSeq === 'number' && lastSeq >= 0) {
      this.lastEventId = String(lastSeq)
    }
    this.streaming = true
    this.emitState('running')
    try {
      const qs = this.lastEventId
        ? `?last_event_id=${encodeURIComponent(this.lastEventId)}`
        : ''
      const res = await this.client.raw(
        'GET',
        `/chat/runs/${runId}/stream${qs}`,
      )
      if (!res.ok) {
        throw new Error(`resume failed: ${res.status}`)
      }
      await this.consume(res)
    } catch (err) {
      // Do not leave the UI stuck on "Stop" for a run we are not watching.
      this.streaming = false
      this.runId = null
      this.emitState('idle')
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  private async consume(res: Response): Promise<void> {
    await readSseStream(res, (frame) => {
      const ev: StreamEvent = {
        event: frame.event as StreamEvent['event'],
        data: parseEventData(frame.data),
        id: frame.id,
      }
      if (frame.id) this.lastEventId = frame.id
      this.handleEvent(ev)
    })
    // Stream ended cleanly.
    if (this.streaming) {
      this.streaming = false
      this.emitState('idle')
      this.listeners.onEvent &&
        this.listeners.onEvent({ event: 'run_completed', data: {} })
    }
  }

  private handleEvent(ev: StreamEvent): void {
    switch (ev.event) {
      case 'run_started': {
        const d = ev.data as { run_id?: string; session_id?: string }
        if (d?.run_id) this.runId = d.run_id
        if (d?.session_id) this.sessionId = d.session_id
        this.emitState('running')
        break
      }
      case 'approval_required': {
        this.emitState('awaiting_approval')
        void this.onApprovalRequired(ev)
        break
      }
      case 'context_usage': {
        const d = ev.data as ContextUsage
        if (d && typeof d.percent_used === 'number') {
          this.contextPct = d.percent_used
        }
        break
      }
      case 'run_completed': {
        const d = ev.data as RunCompletedEvent
        if (d?.usage?.cost_usd != null) this.costUsd = d.usage.cost_usd
        this.streaming = false
        this.runId = null
        this.emitState('idle')
        this.notify('info', 'Run completed')
        break
      }
      case 'run_failed': {
        const d = ev.data as RunFailedEvent
        this.streaming = false
        this.runId = null
        this.emitState('error')
        const msg = d?.error?.message ?? 'Run failed'
        this.notify('error', `Run failed: ${msg}`)
        break
      }
      default:
        break
    }
    this.listeners.onEvent?.(ev)
  }

  /**
   * Diff-on-approval: when the gated tool is a file write/edit, open a diff of
   * current vs proposed so the user reviews before approving.
   */
  private async onApprovalRequired(ev: StreamEvent): Promise<void> {
    const d = ev.data as {
      approval_id?: string
      tool?: string
      arguments?: string
    }
    if (!d?.tool) return
    if (d.tool !== 'write_file' && d.tool !== 'edit_file') return
    const proposed = buildProposedWrite(d.tool, d.arguments ?? '{}', this.workspaceRoot)
    if (!proposed) return
    try {
      await showProposedDiff(proposed.path, proposed.content)
    } catch {
      // Diff view failed to open; the approval card in the chat still works.
    }
  }

  private async reattach(attempt: number): Promise<void> {
    if (!this.runId) {
      this.streaming = false
      this.emitState('error')
      this.notify('error', 'Connection lost before the run started.')
      return
    }
    if (attempt >= MAX_REATTACH_ATTEMPTS) {
      this.streaming = false
      this.emitState('error')
      this.notify('error', 'Connection lost — could not reconnect to the run.')
      return
    }
    const delay = Math.min(1000 * 2 ** attempt, 16000)
    await new Promise((r) => setTimeout(r, delay))
    try {
      const qs = this.lastEventId
        ? `?last_event_id=${encodeURIComponent(this.lastEventId)}`
        : ''
      const res = await this.client.raw(
        'GET',
        `/chat/runs/${this.runId}/stream${qs}`,
      )
      if (!res.ok) throw new Error(`resume failed: ${res.status}`)
      await this.consume(res)
    } catch {
      await this.reattach(attempt + 1)
    }
  }

  private emitState(state: RunState): void {
    this.listeners.onState?.(state)
  }

  private notify(kind: 'info' | 'error', message: string): void {
    if (kind === 'error') void vscode.window.showErrorMessage(`Claudio: ${message}`)
    else void vscode.window.showInformationMessage(`Claudio: ${message}`)
  }
}
