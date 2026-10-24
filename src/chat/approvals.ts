// Approval round-trip: resolve a pending approval (approve/deny) and list
// pending approvals. The diff-on-approval reaction lives in ChatController;
// this module is the plain API surface the bridge calls.

import type { BackendClient } from '../backend/client'
import type { ApprovalRequest } from '../shared/types'

export async function decideApproval(
  client: BackendClient,
  approvalId: string,
  decision: 'approve' | 'deny',
  reason?: string,
): Promise<{ resolved: boolean; decision: string; run_id: string }> {
  return client.post(`/approvals/${approvalId}`, {
    decision,
    reason: reason ?? '',
  })
}

export async function listPendingApprovals(
  client: BackendClient,
): Promise<ApprovalRequest[]> {
  const res = await client.get<{ approvals: ApprovalRequest[] }>(
    '/approvals/pending',
  )
  return res.approvals ?? []
}
