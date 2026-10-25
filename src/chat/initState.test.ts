import { describe, it, expect, vi } from 'vitest'
import { computeInitState, type InitDeps } from './initState'
import type { ActiveRunResponse, ApprovalRequest } from '../shared/types'

const approval: ApprovalRequest = {
  approval_id: 'ap-1',
  run_id: 'run-1',
  session_id: 'sess-1',
  tool: 'write_file',
  arguments: '{"path":"a.txt"}',
  reason: 'destructive',
  requested_at: '2026-10-24T00:00:00Z',
}

function makeDeps(overrides: Partial<InitDeps> = {}): InitDeps {
  return {
    isStreaming: false,
    currentRunId: null,
    currentSessionId: null,
    health: vi.fn(async () => true),
    getApprovalMode: vi.fn(async () => 'on_request'),
    getActiveRun: vi.fn(async (): Promise<ActiveRunResponse> => ({ active: false })),
    listPendingApprovals: vi.fn(async () => [] as ApprovalRequest[]),
    workspace: '/tmp/ws',
    ...overrides,
  }
}

describe('computeInitState', () => {
  it('reports running and no resume needed when the host is already streaming', async () => {
    const deps = makeDeps({
      isStreaming: true,
      currentRunId: 'run-9',
      currentSessionId: 'sess-9',
    })
    const p = await computeInitState(deps)
    expect(p.running).toBe(true)
    expect(p.runId).toBe('run-9')
    expect(p.shouldResume).toBe(false)
    // Already streaming: no need to ask the backend what is active.
    expect(deps.getActiveRun).not.toHaveBeenCalled()
  })

  it('discovers an active run and asks the caller to resume it', async () => {
    const deps = makeDeps({
      currentSessionId: 'sess-1',
      getActiveRun: vi.fn(async () => ({
        active: true,
        run_id: 'run-1',
        state: 'running',
        last_seq: 42,
      })),
    })
    const p = await computeInitState(deps)
    expect(p.running).toBe(true)
    expect(p.runId).toBe('run-1')
    expect(p.lastSeq).toBe(42)
    expect(p.shouldResume).toBe(true)
  })

  it('surfaces the pending approval when the run is awaiting approval', async () => {
    const deps = makeDeps({
      currentSessionId: 'sess-1',
      getActiveRun: vi.fn(async () => ({
        active: true,
        run_id: 'run-1',
        state: 'awaiting_approval',
        last_seq: 7,
      })),
      listPendingApprovals: vi.fn(async () => [approval]),
    })
    const p = await computeInitState(deps)
    expect(p.running).toBe(true)
    expect(p.shouldResume).toBe(true)
    expect(p.pendingApproval?.approval_id).toBe('ap-1')
  })

  it('reports disconnected and skips the active-run query when health fails', async () => {
    const deps = makeDeps({
      currentSessionId: 'sess-1',
      health: vi.fn(async () => false),
    })
    const p = await computeInitState(deps)
    expect(p.connected).toBe(false)
    expect(deps.getActiveRun).not.toHaveBeenCalled()
  })

  it('does not query active_run when there is no session', async () => {
    const deps = makeDeps({ currentSessionId: null })
    const p = await computeInitState(deps)
    expect(p.running).toBe(false)
    expect(p.shouldResume).toBe(false)
    expect(deps.getActiveRun).not.toHaveBeenCalled()
  })

  it('falls back to not-running when the active_run query throws', async () => {
    const deps = makeDeps({
      currentSessionId: 'sess-1',
      getActiveRun: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const p = await computeInitState(deps)
    expect(p.running).toBe(false)
    expect(p.runId).toBe(null)
    expect(p.shouldResume).toBe(false)
  })

  it('keeps host defaults when the whole health check throws', async () => {
    const deps = makeDeps({
      isStreaming: true,
      currentRunId: 'run-9',
      currentSessionId: 'sess-9',
      health: vi.fn(async () => {
        throw new Error('down')
      }),
    })
    const p = await computeInitState(deps)
    // Host was streaming: a failed health check must not downgrade it.
    expect(p.running).toBe(true)
    expect(p.connected).toBe(false)
  })
})
