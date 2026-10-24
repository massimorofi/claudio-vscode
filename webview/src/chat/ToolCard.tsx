import { useState } from 'react'
import { ChevronDown, ChevronRight, CircleCheck, CircleX, Loader2 } from 'lucide-react'
import type { Item } from './chatState'

type ToolItem = Extract<Item, { kind: 'tool' }>

export default function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)

  const statusIcon = item.pending ? (
    <Loader2 size={14} className="animate-spin text-[var(--color-brand)]" />
  ) : item.ok ? (
    <CircleCheck size={14} style={{ color: 'var(--ok)' }} />
  ) : (
    <CircleX size={14} style={{ color: 'var(--err)' }} />
  )

  return (
    <div className="my-1.5 rounded-lg border-soft surface overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="hoverable flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
        style={{ color: 'var(--fg)' }}
      >
        {statusIcon}
        <span className="font-mono text-[var(--color-brand)]">{item.name}</span>
        {item.pending && (
          <span className="text-muted">running…</span>
        )}
        <span className="ml-auto text-faint">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <div className="border-soft-t px-3 py-2 space-y-2 text-xs">
          <div>
            <div className="text-muted mb-0.5">Arguments</div>
            <pre className="scroll-thin overflow-x-auto rounded p-2 font-mono text-[11px] whitespace-pre-wrap break-all surface-alt">
              {pretty(item.args)}
            </pre>
          </div>
          {item.output !== undefined && (
            <div>
              <div className="text-muted mb-0.5">Result</div>
              <pre
                className="scroll-thin overflow-x-auto rounded p-2 font-mono text-[11px] whitespace-pre-wrap break-all surface-alt"
                style={item.ok ? undefined : { color: 'var(--err)' }}
              >
                {pretty(item.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function pretty(raw: unknown): string {
  if (raw == null || raw === '') return ''
  if (typeof raw !== 'string') {
    try {
      return JSON.stringify(raw, null, 2)
    } catch {
      return String(raw)
    }
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
