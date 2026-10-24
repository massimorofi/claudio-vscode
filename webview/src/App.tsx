import { useEffect, useState } from 'react'
import { bridge } from './bridge/client'
import ChatView from './chat/ChatView'
import ConfigView from './config/ConfigView'

type Tab = 'chat' | 'config'

interface InitState {
  workspace: string
  approvalMode: string
  connected: boolean
}

/**
 * Top-level shell. A two-tab surface (Chat / Config) inside the VS Code panel.
 * The host pushes `init` once the webview reports ready, and `open.tab` when a
 * command (e.g. claudio.openConfig) wants a specific tab.
 */
export default function App() {
  const [tab, setTab] = useState<Tab>('chat')
  const [init, setInit] = useState<InitState | null>(null)

  useEffect(() => {
    return bridge.on((msg) => {
      if (msg.type === 'init') {
        setInit({
          workspace: msg.workspace,
          approvalMode: msg.approvalMode,
          connected: msg.connected,
        })
      } else if (msg.type === 'open.tab') {
        setTab(msg.tab)
      }
    })
  }, [])

  // Tell the host we are ready so it can send the init payload.
  useEffect(() => {
    bridge.post({ type: 'ready' })
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="border-soft-b surface-alt flex shrink-0 items-center gap-1 px-2 py-1">
        {(['chat', 'config'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
              tab === t ? 'text-white' : 'text-muted hoverable'
            }`}
            style={tab === t ? { background: 'var(--color-brand)' } : undefined}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto truncate px-1 text-[11px] text-faint" title={init?.workspace}>
          {init?.connected ? '● connected' : '○ offline'}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'chat' ? (
          <ChatView
            initialApprovalMode={init?.approvalMode ?? 'on_request'}
            onOpenConfig={() => setTab('config')}
          />
        ) : (
          <ConfigView />
        )}
      </div>
    </div>
  )
}
