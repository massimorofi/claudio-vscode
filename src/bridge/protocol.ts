// The postMessage contract between the extension host and the webview.
//
// Every message has a `type` and a payload. Request/response pairs carry a
// `requestId` so the webview can correlate a `response` with the request that
// produced it. Events the host pushes unprompted (streamed chat events, status
// updates) have no requestId.

import type { ApprovalRequest, StreamEvent } from '../shared/types'

// ---- webview → host ----

export type WebviewToHost =
  | { type: 'ready' }
  | {
      type: 'chat.send'
      requestId: string
      message: string
      files?: string[]
      approvalMode?: string
    }
  | { type: 'chat.stop'; requestId: string }
  | {
      type: 'approval.decide'
      requestId: string
      approvalId: string
      decision: 'approve' | 'deny'
      reason?: string
    }
  | { type: 'session.list'; requestId: string }
  | { type: 'session.load'; requestId: string; sessionId: string }
  | { type: 'session.clear'; requestId: string; sessionId: string }
  | { type: 'session.compact'; requestId: string; sessionId: string }
  | { type: 'config.get'; requestId: string }
  | { type: 'config.put'; requestId: string; patch: Record<string, unknown> }
  | { type: 'config.validate'; requestId: string; candidate: Record<string, unknown> }
  | { type: 'config.llmTest'; requestId: string; llm: Record<string, unknown> }
  | { type: 'config.history'; requestId: string }
  | { type: 'config.restore'; requestId: string; id: number }
  | { type: 'file.open'; path: string }
  | { type: 'file.pick'; requestId: string }
  | { type: 'selection.get'; requestId: string }

// ---- host → webview ----

export type HostToWebview =
  | {
      type: 'init'
      workspace: string
      approvalMode: string
      connected: boolean
      /**
       * Whether a run is still in flight right now. The webview is destroyed when
       * its pane is hidden, so on re-mount it must learn the real run state from
       * the host -- `run_started` (the event that normally flips `streaming`) is
       * never replayed on a resume, which would otherwise leave the composer
       * showing "Send" while the agent is still working.
       */
      running: boolean
      /** Id of the in-flight run, when there is one. */
      runId: string | null
      /** Session the host is currently talking to, if any. */
      sessionId: string | null
      /** Approval the in-flight run is paused on, if any. */
      pendingApproval?: ApprovalRequest | null
    }
  | { type: 'chat.event'; event: StreamEvent }
  | { type: 'chat.started'; runId: string }
  | { type: 'chat.done' }
  | {
      type: 'response'
      requestId: string
      ok: boolean
      data?: unknown
      error?: string
    }
  | { type: 'workspace.changed'; workspace: string }
  | { type: 'selection.changed'; text: string; file: string; range: string }
  | { type: 'open.tab'; tab: 'chat' | 'config' }
  | { type: 'session.cleared' }
  | {
      type: 'status'
      state: 'idle' | 'running' | 'awaiting_approval' | 'error'
      costUsd: number
      contextPercent: number
    }

export type BridgeMessage = WebviewToHost | HostToWebview

/** Types that expect a `response` back (i.e. are requests, not fire-and-forget). */
export const REQUEST_TYPES = new Set<string>([
  'chat.send',
  'chat.stop',
  'approval.decide',
  'session.list',
  'session.load',
  'session.clear',
  'session.compact',
  'config.get',
  'config.put',
  'config.validate',
  'config.llmTest',
  'config.history',
  'config.restore',
  'file.pick',
  'selection.get',
])

let counter = 0
export function newRequestId(): string {
  counter += 1
  return `req-${Date.now()}-${counter}`
}
