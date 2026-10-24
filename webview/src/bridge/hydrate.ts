// Hydration: turn the host's `init` payload into the chat actions the webview
// must apply on mount.
//
// Why this exists: the webview can be destroyed and re-created (pane switch,
// window reload) while the agent keeps working. The reducer only flips
// `streaming` to true on `run_started`, and that event is the first frame of a
// run -- it is never replayed on a resume. So a freshly mounted webview would
// show "Send" in the middle of a live run unless the host tells it, explicitly,
// what is in flight.

import type { ApprovalRequest } from '../../../src/shared/types'
import type { ChatAction } from '../chat/chatState'

export interface InitRunState {
  running: boolean
  runId: string | null
  sessionId: string | null
  connected: boolean
  pendingApproval?: ApprovalRequest | null
}

/**
 * Map an `init` payload to the chat actions to apply.
 *
 * Rules:
 * - Running  -> RESUME_RUN (sets streaming + runId), plus the pending approval
 *   card if the run is paused on one.
 * - Not running and the backend was reachable -> explicit STOPPED, so a stale
 *   "Stop" button can never survive.
 * - Not running and the backend was unreachable -> no action. An unreachable
 *   backend is not evidence that the run ended, and clearing here would be a
 *   guess.
 */
export function actionsFromInit(msg: InitRunState): ChatAction[] {
  if (msg.running) {
    const actions: ChatAction[] = [
      msg.runId
        ? { type: 'RESUME_RUN', runId: msg.runId }
        : { type: 'SET_STREAMING', value: true },
    ]
    if (msg.pendingApproval) {
      actions.push({
        type: 'SSE',
        ev: { event: 'approval_required', data: msg.pendingApproval },
      })
    }
    return actions
  }
  if (msg.connected) {
    return [{ type: 'STOPPED' }]
  }
  return []
}
