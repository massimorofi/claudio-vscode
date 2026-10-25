import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Paperclip,
  Plus,
  Send,
  X,
} from 'lucide-react'
import { bridge } from '../bridge/client'
import { useBridgeChat } from '../bridge/useBridgeChat'
import { groupIntoTurns } from './workflow'
import PlanTracker from './PlanTracker'
import ContextGauge from './ContextGauge'
import CompletionStatus from './CompletionStatus'
import ApprovalCard from './ApprovalCard'
import type { SessionSummary } from '../../../src/shared/types'

interface ChatViewProps {
  /** Approval mode seeded from the backend on init. */
  initialApprovalMode: string
  /** Switch the shell to the Config tab (slash command /config). */
  onOpenConfig: () => void
  /**
   * Whether this view is the visible tab. The view stays mounted while hidden
   * (so chat state survives a tab switch), but `display: none` resets the
   * scroll position — `active` lets the view restore it on re-show.
   */
  active: boolean
}

/**
 * Narrow side-panel chat. Unlike the SPA's wide two-column layout, this fits a
 * VS Code secondary sidebar: a single column with a compact header (session
 * picker, approval mode, context gauge, new-chat) over a scrolling transcript
 * and a composer. Slash commands in the composer drive the session directly.
 */
export default function ChatView({
  initialApprovalMode,
  onOpenConfig,
  active,
}: ChatViewProps) {
  const [input, setInput] = useState('')
  const [approvalMode, setApprovalMode] = useState(initialApprovalMode)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [attached, setAttached] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const lastScrollTop = useRef(0)
  const [showJump, setShowJump] = useState(false)

  const { state, send, stop, approve, deny, clear, loadSession, compactSession } =
    useBridgeChat()

  const turns = useMemo(() => groupIntoTurns(state.items), [state.items])

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 4000)
  }

  const refreshSessions = async () => {
    try {
      const res = await bridge.request<{ sessions: SessionSummary[] }>('session.list')
      setSessions(res?.sessions ?? [])
    } catch {
      /* backend not reachable yet */
    }
  }

  useEffect(() => {
    void refreshSessions()
  }, [])

  const handleCompact = async () => {
    const prev = state.context?.used_tokens ?? 0
    const res = await compactSession()
    if (res.ok && res.requested) {
      showToast('Compaction scheduled — applies at the next step')
    } else if (res.ok) {
      const now = res.used_tokens ?? 0
      showToast(`Compacted ${prev.toLocaleString()} → ${now.toLocaleString()} tokens`)
    } else {
      showToast(res.error ?? 'Compaction failed')
    }
  }

  // Fire a one-shot toast each time a mid-run compaction completes.
  useEffect(() => {
    if (state.compactedCount > 0) showToast('Context compacted')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.compactedCount])

  const handleRetry = () => {
    if (state.streaming) return
    let text = state.lastUserText
    if (!text) {
      for (let i = state.items.length - 1; i >= 0; i--) {
        const it = state.items[i]
        if (it.kind === 'user') {
          text = it.text
          break
        }
      }
    }
    if (!text) return
    stickRef.current = true
    setShowJump(false)
    void send(text, undefined, approvalMode)
  }

  const newChat = () => {
    clear()
    setSessionId(null)
    stickRef.current = true
    setShowJump(false)
  }

  const openSession = async (id: string) => {
    try {
      await loadSession(id)
      setSessionId(id)
      stickRef.current = true
      setShowJump(false)
    } catch {
      showToast('Could not load session')
    }
  }

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    stickRef.current = true
    setShowJump(false)
  }

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const cur = el.scrollTop
    const atBottom = el.scrollHeight - cur - el.clientHeight <= 80
    if (cur < lastScrollTop.current - 1) {
      stickRef.current = false
    } else if (atBottom) {
      stickRef.current = true
    }
    lastScrollTop.current = cur
    setShowJump(!atBottom)
  }

  // Follow new streamed content only while the user is pinned to the bottom.
  useEffect(() => {
    if (stickRef.current) {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [state.items])

  // Re-shown after a tab switch: `display: none` reset the scroll position,
  // so jump back to the bottom when the user was following the stream.
  useEffect(() => {
    if (active && stickRef.current) {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
      setShowJump(false)
    }
  }, [active])

  // An approval needs attention: bring it into view regardless of scroll.
  useEffect(() => {
    if (state.pendingApproval) {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight
      stickRef.current = true
      setShowJump(false)
    }
  }, [state.pendingApproval])

  const doSend = (text: string) => {
    const paths = attached
    setInput('')
    setAttached([])
    stickRef.current = true
    setShowJump(false)
    void send(text, paths.length ? paths : undefined, approvalMode)
  }

  // Slash commands: a leading "/" routes to a session action instead of the
  // backend. Anything else is sent as a normal message.
  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    if (text.startsWith('/')) {
      const cmd = text.slice(1).trim().toLowerCase()
      switch (cmd) {
        case 'stop':
          setInput('')
          void stop()
          return
        case 'approve':
          setInput('')
          if (state.pendingApproval) void approve(state.pendingApproval.approval_id)
          else showToast('Nothing to approve')
          return
        case 'deny':
          setInput('')
          if (state.pendingApproval) void deny(state.pendingApproval.approval_id)
          else showToast('Nothing to deny')
          return
        case 'compact':
          setInput('')
          void handleCompact()
          return
        case 'clear':
          setInput('')
          void (async () => {
            if (sessionId) {
              try {
                await bridge.request('session.clear', { sessionId })
              } catch {
                /* best-effort */
              }
            }
            newChat()
          })()
          return
        case 'new':
          setInput('')
          newChat()
          return
        case 'config':
          setInput('')
          onOpenConfig()
          return
        default:
          showToast(`Unknown command: /${cmd}`)
          return
      }
    }
    doSend(text)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const attachFile = async () => {
    if (state.streaming) return
    try {
      const res = await bridge.request<{ path: string | null }>('file.pick')
      if (res?.path) setAttached((prev) => [...prev, res.path as string])
    } catch {
      showToast('Could not pick file')
    }
  }

  const removeAttachment = (p: string) =>
    setAttached((prev) => prev.filter((x) => x !== p))

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-soft-b surface-alt flex items-center gap-2 px-2 py-1.5">
        <select
          value={sessionId ?? ''}
          onChange={(e) => {
            const id = e.target.value
            if (id) void openSession(id)
            else newChat()
          }}
          className="input min-w-0 flex-1 text-xs"
          title="Open a session"
        >
          <option value="">New conversation</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || 'Untitled'}
            </option>
          ))}
        </select>
        <select
          value={approvalMode}
          onChange={(e) => {
            const mode = e.target.value
            setApprovalMode(mode)
            if (mode === 'off' && state.pendingApproval) {
              void approve(state.pendingApproval.approval_id)
            }
          }}
          className="input select-fixed text-xs"
          title="Approval mode"
        >
          <option value="on_request">On request</option>
          <option value="always">Always ask</option>
          <option value="off">Off</option>
        </select>
        <ContextGauge
          usage={state.context}
          disabled={state.streaming}
          onCompact={handleCompact}
        />
        <button
          onClick={newChat}
          className="hoverable shrink-0 rounded-lg p-1.5 text-muted"
          title="New chat"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Transcript */}
      <div className="relative flex-1 min-h-0">
        {state.reconnecting && (
          <div
            className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium shadow-sm"
            style={{
              background: 'color-mix(in srgb, var(--warn) 18%, var(--bg))',
              color: 'var(--warn)',
            }}
          >
            <span
              className="inline-block h-2 w-2 animate-pulse rounded-full"
              style={{ background: 'var(--warn)' }}
            />
            Reconnecting… the run is still going in the background
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scroll-thin h-full overflow-y-auto px-3 py-3"
        >
          {state.items.length === 0 && (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              Ask Claudio anything.
            </div>
          )}
          {state.plan && state.plan.length > 0 && (
            <PlanTracker items={state.plan} streaming={state.streaming} />
          )}
          {turns.map((turn, ti) => (
            <div key={ti}>
              {turn.user && (
                <div className="mb-3 flex justify-end">
                  <div
                    className="max-w-[90%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm whitespace-pre-wrap text-white"
                    style={{ background: 'var(--color-brand)' }}
                  >
                    {turn.user.text}
                  </div>
                </div>
              )}
              {turn.flow.map((item) => {
                if (item.kind === 'assistant') {
                  return (
                    <div key={item.id} className="mb-3 flex justify-start">
                      <div className="md-body surface border-soft max-w-[95%] rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {item.text}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )
                }
                if (item.kind === 'reasoning') {
                  return <ReasoningBlock key={item.id} text={item.text} />
                }
                return null
              })}
              {turn.turnStatus && (
                <CompletionStatus
                  status={turn.turnStatus.status}
                  filesWritten={turn.turnStatus.filesWritten}
                  commandsRun={turn.turnStatus.commandsRun}
                  durationSeconds={turn.turnStatus.durationSeconds}
                  inputTokens={turn.turnStatus.inputTokens}
                  outputTokens={turn.turnStatus.outputTokens}
                  replyText={turn.flow
                    .filter((f) => f.kind === 'assistant')
                    .map((f) => f.text)
                    .join('\n\n')}
                  error={turn.turnStatus.error}
                  onRetry={
                    turn.turnStatus.status === 'completed' ? undefined : handleRetry
                  }
                />
              )}
            </div>
          ))}
          {state.pendingApproval && (
            <div className="mt-2">
              <ApprovalCard
                item={{
                  kind: 'approval',
                  id: `live-${state.pendingApproval.approval_id}`,
                  approvalId: state.pendingApproval.approval_id,
                  toolName: state.pendingApproval.tool,
                  args: state.pendingApproval.arguments,
                  reason: state.pendingApproval.reason,
                }}
                onApprove={approve}
                onDeny={deny}
                busy={false}
              />
            </div>
          )}
          {state.error && (
            <div
              className="my-2 rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: 'color-mix(in srgb, var(--err) 40%, transparent)',
                background: 'color-mix(in srgb, var(--err) 8%, var(--bg))',
                color: 'var(--err)',
              }}
            >
              {state.error}
            </div>
          )}
        </div>
        {showJump && (
          <button
            onClick={scrollToBottom}
            className="surface-raised absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border-soft px-3 py-1.5 text-xs font-medium shadow-md hoverable"
          >
            <ChevronDown size={14} /> Scroll to bottom
          </button>
        )}
      </div>

      {/* Composer */}
      <div className="border-soft-t surface p-2">
        {attached.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attached.map((p) => (
              <span
                key={p}
                className="surface-alt flex items-center gap-1.5 rounded-full border-soft px-2.5 py-1 text-xs"
              >
                <Paperclip size={12} />
                <span className="max-w-[160px] truncate">{p}</span>
                <button
                  onClick={() => removeAttachment(p)}
                  className="text-faint hover:text-[var(--err)]"
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            onClick={attachFile}
            disabled={state.streaming}
            className="hoverable flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border-soft text-muted disabled:opacity-40"
            title="Attach a workspace file"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Message Claudio…  (/stop /approve /deny /compact /clear /new /config)"
            className="input scroll-thin max-h-32 min-h-[38px] flex-1 resize-none"
          />
          {state.streaming ? (
            <button
              onClick={() => void stop()}
              className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-white"
              style={{ background: 'var(--err)' }}
            >
              <Loader2 size={16} className="animate-spin" /> Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: 'var(--color-brand)' }}
            >
              <Send size={16} /> Send
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg"
          style={{ background: 'rgba(0,0,0,0.82)' }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1.5 rounded-lg border-soft surface-alt overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="hoverable flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted"
      >
        <span className="font-medium italic">Reasoning</span>
        <span className="ml-auto text-faint">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="scroll-thin max-h-60 overflow-auto border-soft-t px-3 py-2 text-xs italic text-muted whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}
