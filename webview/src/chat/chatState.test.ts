import { describe, it, expect } from 'vitest'
import { chatReducer, initialChatState, type ChatState } from './chatState'

function sse(state: ChatState, event: string, data: unknown): ChatState {
  return chatReducer(state, { type: 'SSE', ev: { event, data } as never })
}

describe('chatReducer', () => {
  it('SEND_USER appends a user item and starts streaming', () => {
    const s = chatReducer(initialChatState, { type: 'SEND_USER', text: 'hi' })
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ kind: 'user', text: 'hi' })
    expect(s.streaming).toBe(true)
    expect(s.lastUserText).toBe('hi')
  })

  it('token merges into the trailing assistant item', () => {
    let s = sse(initialChatState, 'token', { text: 'Hel' })
    s = sse(s, 'token', { text: 'lo' })
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ kind: 'assistant', text: 'Hello' })
  })

  it('token after a non-assistant item starts a new assistant item', () => {
    let s = chatReducer(initialChatState, { type: 'SEND_USER', text: 'q' })
    s = sse(s, 'token', { text: 'a' })
    s = sse(s, 'tool_call', { call_id: 'c1', name: 'x', arguments: '{}' })
    s = sse(s, 'token', { text: 'b' })
    expect(s.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })

  it('tool_call adds a pending tool item', () => {
    const s = sse(initialChatState, 'tool_call', {
      call_id: 'c1',
      name: 'read_file',
      arguments: '{"path":"a"}',
    })
    expect(s.items[0]).toMatchObject({
      kind: 'tool',
      callId: 'c1',
      name: 'read_file',
      pending: true,
    })
  })

  it('tool_result closes the matching tool item', () => {
    let s = sse(initialChatState, 'tool_call', {
      call_id: 'c1',
      name: 'read_file',
      arguments: '{}',
    })
    s = sse(s, 'tool_result', {
      call_id: 'c1',
      name: 'read_file',
      output: 'contents',
      is_error: false,
    })
    expect(s.items[0]).toMatchObject({ pending: false, ok: true, output: 'contents' })
  })

  it('todo_write sets the plan from the call arguments', () => {
    const s = sse(initialChatState, 'tool_call', {
      call_id: 'c1',
      name: 'todo_write',
      arguments: JSON.stringify({
        items: [
          { content: 'step one', status: 'in_progress' },
          { content: 'step two', status: 'pending' },
        ],
      }),
    })
    expect(s.plan).toEqual([
      { content: 'step one', status: 'in_progress' },
      { content: 'step two', status: 'pending' },
    ])
  })

  it('approval_required adds an approval item and sets pendingApproval', () => {
    const s = sse(initialChatState, 'approval_required', {
      approval_id: 'ap1',
      run_id: 'r1',
      tool: 'write_file',
      arguments: '{}',
      reason: 'destructive',
    })
    expect(s.pendingApproval).toMatchObject({ approval_id: 'ap1', tool: 'write_file' })
    expect(s.items[0]).toMatchObject({ kind: 'approval', approvalId: 'ap1' })
    expect(s.streaming).toBe(true)
  })

  it('RESOLVE_APPROVAL marks the approval resolved and clears pending', () => {
    let s = sse(initialChatState, 'approval_required', {
      approval_id: 'ap1',
      run_id: 'r1',
      tool: 'write_file',
      arguments: '{}',
      reason: 'x',
    })
    s = chatReducer(s, { type: 'RESOLVE_APPROVAL', approvalId: 'ap1', decision: 'approved' })
    expect(s.pendingApproval).toBeNull()
    expect(s.items[0]).toMatchObject({ resolved: 'approved' })
  })

  it('run_completed adds a completed turn_status and stops streaming', () => {
    const s = sse(initialChatState, 'run_completed', {
      run_id: 'r1',
      final_output: 'done',
      usage: { input_tokens: 10, output_tokens: 5, cost_usd: 0.01 },
      summary: {
        files_written: ['a.txt'],
        commands_run: 2,
        duration_seconds: 3,
        outstanding_todos: [],
        deliverable_written: true,
        deliverable_ok: true,
        deliverable_bytes: 10,
        deliverable: [],
        task_complete: true,
      },
    })
    expect(s.streaming).toBe(false)
    const last = s.items[s.items.length - 1]
    expect(last).toMatchObject({ kind: 'turn_status', status: 'completed', commandsRun: 2 })
  })

  it('run_failed marks interrupted for a cancelled code', () => {
    const s = sse(initialChatState, 'run_failed', {
      run_id: 'r1',
      error: { code: 'cancelled', message: 'stopped', retryable: false },
    })
    expect(s.streaming).toBe(false)
    const last = s.items[s.items.length - 1]
    expect(last).toMatchObject({ kind: 'turn_status', status: 'interrupted' })
  })

  it('run_restarting truncates back to the last user message', () => {
    let s = chatReducer(initialChatState, { type: 'SEND_USER', text: 'q' })
    s = sse(s, 'token', { text: 'partial' })
    s = sse(s, 'run_restarting', { reason: 'retry', attempt: 1 })
    expect(s.items).toHaveLength(1)
    expect(s.items[0].kind).toBe('user')
    expect(s.streaming).toBe(true)
  })

  it('run_compacted bumps compactedCount', () => {
    const s = sse(initialChatState, 'run_compacted', {})
    expect(s.compactedCount).toBe(1)
  })

  it('CLEAR resets to the initial state', () => {
    let s = chatReducer(initialChatState, { type: 'SEND_USER', text: 'q' })
    s = chatReducer(s, { type: 'CLEAR' })
    expect(s).toEqual(initialChatState)
  })
})
