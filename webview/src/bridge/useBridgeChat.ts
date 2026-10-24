// Bridge-backed chat hook: replaces the SPA's useChat. Instead of opening the
// SSE stream itself, it sends chat.send to the host and feeds the chatState
// reducer from the relayed `chat.event` frames. The host owns the stream,
// reconnection, and the approval round-trip.

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { bridge } from './client'
import { actionsFromInit } from './hydrate'
import {
  chatReducer,
  initialChatState,
  type ChatState,
  type Item,
  type PlanItem,
} from '../chat/chatState'
import type { ContextUsage } from '../../../src/shared/types'

export interface BridgeChatResult {
  state: ChatState
  send: (message: string, files?: string[], approvalMode?: string) => Promise<void>
  stop: () => Promise<void>
  approve: (approvalId: string) => Promise<void>
  deny: (approvalId: string, reason?: string) => Promise<void>
  clear: () => void
  loadSession: (sessionId: string) => Promise<void>
  compactSession: () => Promise<{
    ok: boolean
    requested?: boolean
    used_tokens?: number
    free_tokens?: number
    error?: string
  }>
}

export function useBridgeChat(): BridgeChatResult {
  const [state, dispatch] = useReducer(chatReducer, initialChatState)
  const sessionRef = useRef<string | null>(null)

  // Consume relayed backend events pushed by the host.
  useEffect(() => {
    return bridge.on((msg) => {
      if (msg.type === 'chat.event') {
        const ev = msg.event
        if (ev.event === 'run_started') {
          const d = ev.data as { session_id?: string }
          if (d?.session_id && !sessionRef.current) {
            sessionRef.current = d.session_id
          }
        }
        dispatch({ type: 'SSE', ev })
      } else if (msg.type === 'chat.done') {
        dispatch({ type: 'STOPPED' })
      } else if (msg.type === 'session.cleared') {
        sessionRef.current = null
        dispatch({ type: 'CLEAR' })
      } else if (msg.type === 'init') {
        if (msg.sessionId) {
          sessionRef.current = msg.sessionId
        }
        for (const action of actionsFromInit(msg)) {
          dispatch(action)
        }
      }
    })
  }, [])

  const send = useCallback(
    async (message: string, files?: string[], approvalMode?: string) => {
      if (!message.trim()) return
      dispatch({ type: 'SEND_USER', text: message })
      try {
        const res = await bridge.request<{ session_id?: string }>('chat.send', {
          message,
          files,
          approvalMode,
        })
        if (res?.session_id) sessionRef.current = res.session_id
      } catch (e) {
        dispatch({
          type: 'SSE',
          ev: {
            event: 'run_failed',
            data: {
              code: 'send_error',
              message: (e as Error).message,
              retryable: false,
            },
          },
        })
      }
    },
    [],
  )

  const stop = useCallback(async () => {
    try {
      await bridge.request('chat.stop')
    } catch {
      /* stop is best-effort */
    }
    dispatch({ type: 'STOPPED' })
  }, [])

  const resolveApproval = useCallback(
    async (approvalId: string, decision: 'approved' | 'denied', reason?: string) => {
      try {
        await bridge.request('approval.decide', {
          approvalId,
          decision: decision === 'approved' ? 'approve' : 'deny',
          reason,
        })
        dispatch({ type: 'RESOLVE_APPROVAL', approvalId, decision })
      } catch (e) {
        dispatch({
          type: 'SSE',
          ev: {
            event: 'run_failed',
            data: {
              code: 'approval_error',
              message: (e as Error).message,
              retryable: false,
            },
          },
        })
      }
    },
    [],
  )

  const approve = useCallback(
    (approvalId: string) => resolveApproval(approvalId, 'approved'),
    [resolveApproval],
  )

  const deny = useCallback(
    (approvalId: string, reason?: string) =>
      resolveApproval(approvalId, 'denied', reason),
    [resolveApproval],
  )

  const clear = useCallback(() => {
    sessionRef.current = null
    dispatch({ type: 'CLEAR' })
  }, [])

  const loadSession = useCallback(async (sessionId: string) => {
    const res = await bridge.request<{
      messages: Record<string, unknown>[]
      session: Record<string, unknown>
    }>('session.load', { sessionId })
    const items = buildItemsFromTranscript(res.messages ?? [])
    let plan: PlanItem[] | null = null
    const todosRaw = res.session?.todos
    if (typeof todosRaw === 'string' && todosRaw) {
      try {
        const parsed = JSON.parse(todosRaw)
        if (Array.isArray(parsed) && parsed.length > 0) plan = parsed as PlanItem[]
      } catch {
        /* malformed todos */
      }
    }
    const context = (res.session?.context_usage as ContextUsage) ?? null
    sessionRef.current = sessionId
    dispatch({ type: 'LOAD_HISTORY', items, plan, context })
  }, [])

  const compactSession = useCallback(async () => {
    const sid = sessionRef.current
    if (!sid) return { ok: false, error: 'No active session' }
    try {
      const res = await bridge.request<{
        ok: boolean
        requested?: boolean
        used_tokens?: number
        free_tokens?: number
        error?: string
        context_usage?: ContextUsage
      }>('session.compact', { sessionId: sid })
      if (res.ok && res.context_usage) {
        dispatch({ type: 'SSE', ev: { event: 'context_usage', data: res.context_usage } })
      }
      return {
        ok: res.ok,
        requested: res.requested,
        used_tokens: res.used_tokens,
        free_tokens: res.free_tokens,
        error: res.error,
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }, [])

  return { state, send, stop, approve, deny, clear, loadSession, compactSession }
}

/**
 * Transform the persisted transcript entries into chat Items, mirroring the
 * SPA's loadSession: tool_call/tool_result pairs are merged, consecutive
 * reasoning entries are merged, turn_status entries become completion cards.
 */
export function buildItemsFromTranscript(
  messages: Record<string, unknown>[],
): Item[] {
  const items: Item[] = []
  const toolIndex: Record<string, number> = {}
  messages.forEach((r, i) => {
    const t = (r.type as string) ?? (r.role as string)
    if (t === 'turn_status') {
      items.push({
        kind: 'turn_status',
        id: `ts-${i}`,
        status:
          (r.status as 'completed' | 'failed' | 'interrupted') ?? 'completed',
        filesWritten: (r.files_written as string[]) ?? [],
        commandsRun: (r.commands_run as number) ?? 0,
        durationSeconds: (r.duration_seconds as number) ?? 0,
        inputTokens: (r.input_tokens as number) ?? 0,
        outputTokens: (r.output_tokens as number) ?? 0,
        error: (r.error_message as string) ?? undefined,
      })
      return
    }
    if (t === 'tool_call') {
      const callId = (r.call_id as string) ?? `c-${i}`
      toolIndex[callId] = items.length
      items.push({
        kind: 'tool',
        id: `tc-${i}`,
        callId,
        name: (r.name as string) ?? 'tool',
        args: (r.arguments as string) ?? '',
        pending: true,
      })
      return
    }
    if (t === 'tool_result') {
      const callId = (r.call_id as string) ?? ''
      const idx = toolIndex[callId]
      if (idx != null) {
        const it = items[idx]
        if (it.kind === 'tool') {
          items[idx] = {
            ...it,
            ok: !(r.is_error as boolean),
            output: (r.output as string) ?? '',
            pending: false,
          }
        }
      }
      return
    }
    if (t === 'reasoning') {
      const text = (r.content as string) ?? ''
      if (!text) return
      const last = items[items.length - 1]
      if (last && last.kind === 'reasoning') {
        items[items.length - 1] = { ...last, text: last.text + text }
      } else {
        items.push({ kind: 'reasoning', id: `r-${i}`, text })
      }
      return
    }
    const isUser = t === 'user'
    items.push({
      kind: isUser ? 'user' : 'assistant',
      id: `h-${i}`,
      text:
        typeof r.content === 'string'
          ? r.content
          : JSON.stringify(r.content ?? ''),
    })
  })
  return items
}
