import { describe, it, expect } from 'vitest'
import { actionsFromInit } from './hydrate'
import { chatReducer, initialChatState } from '../chat/chatState'
import type { ApprovalRequest } from '../../../src/shared/types'

const approval: ApprovalRequest = {
  approval_id: 'ap-1',
  run_id: 'run-1',
  session_id: 'sess-1',
  tool: 'write_file',
  arguments: '{"path":"a.txt"}',
  reason: 'destructive',
  requested_at: '2026-10-24T00:00:00Z',
}

describe('actionsFromInit', () => {
  it('resumes a live run so the Stop button survives a pane switch', () => {
    const actions = actionsFromInit({
      running: true,
      runId: 'run-1',
      sessionId: 'sess-1',
      connected: true,
    })
    expect(actions).toEqual([{ type: 'RESUME_RUN', runId: 'run-1' }])
  })

  it('falls back to SET_STREAMING when there is no run id', () => {
    const actions = actionsFromInit({
      running: true,
      runId: null,
      sessionId: 'sess-1',
      connected: true,
    })
    expect(actions).toEqual([{ type: 'SET_STREAMING', value: true }])
  })

  it('restores the approval card when the run is paused on one', () => {
    const actions = actionsFromInit({
      running: true,
      runId: 'run-1',
      sessionId: 'sess-1',
      connected: true,
      pendingApproval: approval,
    })
    expect(actions).toHaveLength(2)
    expect(actions[1]).toEqual({
      type: 'SSE',
      ev: { event: 'approval_required', data: approval },
    })
  })

  it('clears streaming when the backend confirms nothing is running', () => {
    const actions = actionsFromInit({
      running: false,
      runId: null,
      sessionId: 'sess-1',
      connected: true,
    })
    expect(actions).toEqual([{ type: 'STOPPED' }])
  })

  it('does not clear streaming when the backend is unreachable', () => {
    const actions = actionsFromInit({
      running: false,
      runId: null,
      sessionId: 'sess-1',
      connected: false,
    })
    expect(actions).toEqual([])
  })
})

describe('hydration applied to the reducer', () => {
  it('leaves the chat streaming after a mid-run remount', () => {
    let state = initialChatState
    expect(state.streaming).toBe(false)
    for (const action of actionsFromInit({
      running: true,
      runId: 'run-9',
      sessionId: 'sess-9',
      connected: true,
    })) {
      state = chatReducer(state, action)
    }
    expect(state.streaming).toBe(true)
    expect(state.runId).toBe('run-9')
  })

  it('surfaces a pending approval and keeps streaming', () => {
    let state = initialChatState
    for (const action of actionsFromInit({
      running: true,
      runId: 'run-9',
      sessionId: 'sess-9',
      connected: true,
      pendingApproval: approval,
    })) {
      state = chatReducer(state, action)
    }
    expect(state.streaming).toBe(true)
    expect(state.pendingApproval?.approval_id).toBe('ap-1')
    expect(state.items.some((it) => it.kind === 'approval')).toBe(true)
  })
})
