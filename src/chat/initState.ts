// Compute the `init` payload the host sends to the webview on mount and on
// every pane re-show.
//
// The webview can be destroyed and re-created (pane switch, window reload)
// while the agent keeps working, so every time it comes back it needs the real
// run state. This module makes that decision explicit and testable: it only
// READS host + backend state and reports what the webview should believe --
// actually resuming the stream is the caller's job (see `shouldResume`).

import type { ActiveRunResponse, ApprovalRequest } from '../shared/types'

export interface InitDeps {
  isStreaming: boolean
  currentRunId: string | null
  currentSessionId: string | null
  health: () => Promise<boolean>
  getApprovalMode: () => Promise<string>
  getActiveRun: (sessionId: string) => Promise<ActiveRunResponse | null>
  listPendingApprovals: () => Promise<ApprovalRequest[]>
  workspace: string
}

export interface InitPayload {
  workspace: string
  approvalMode: string
  connected: boolean
  running: boolean
  runId: string | null
  sessionId: string | null
  pendingApproval: ApprovalRequest | null
  /**
   * A run is live but this host is not watching it: the caller must resume
   * the SSE stream (`ChatController.resumeRun(runId, lastSeq)`).
   */
  shouldResume: boolean
  /** Backend event cursor for the live run, for resuming without replay. */
  lastSeq?: number
}

/**
 * Decide the init payload. Never throws: on any backend failure it returns
 * safe defaults seeded from the host's own knowledge, so a flaky health check
 * can never downgrade a genuinely-running run to "Send".
 */
export async function computeInitState(deps: InitDeps): Promise<InitPayload> {
  const base: InitPayload = {
    workspace: deps.workspace,
    approvalMode: 'on_request',
    connected: false,
    running: deps.isStreaming,
    runId: deps.currentRunId,
    sessionId: deps.currentSessionId,
    pendingApproval: null,
    shouldResume: false,
  }
  try {
    const connected = await deps.health()
    if (!connected) return base
    let approvalMode = 'on_request'
    try {
      approvalMode = await deps.getApprovalMode()
    } catch {
      /* keep the default; the chat still works without it */
    }
    let running = base.running
    let runId = base.runId
    let lastSeq: number | undefined
    let pendingApproval: ApprovalRequest | null = null
    if (!running && deps.currentSessionId) {
      // The host may not be watching this run (webview re-created after a
      // reload, or the run was started from another surface). Ask the
      // backend, which is the authority on what is still in flight.
      try {
        const ar = await deps.getActiveRun(deps.currentSessionId)
        if (ar?.active && ar.run_id) {
          running = true
          runId = ar.run_id
          lastSeq = ar.last_seq
          if (ar.state === 'awaiting_approval') {
            const pending = await deps.listPendingApprovals()
            pendingApproval = pending.find((a) => a.run_id === ar.run_id) ?? null
          }
        }
      } catch {
        running = false
        runId = null
      }
    }
    return {
      ...base,
      approvalMode,
      connected: true,
      running,
      runId,
      lastSeq,
      pendingApproval,
      shouldResume: running && !deps.isStreaming,
    }
  } catch {
    return base
  }
}
