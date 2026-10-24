import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { PlanItem } from './chatState'

interface PlanTrackerProps {
  items: PlanItem[]
  streaming: boolean
}

const GLYPH: Record<PlanItem['status'], string> = {
  pending: '☐',
  in_progress: '◐',
  done: '☑',
}

/**
 * Pinned checklist of the agent's live todo list (Phase 2). Renders nothing when
 * the agent never called ``todo_write``.
 */
export default function PlanTracker({ items, streaming }: PlanTrackerProps) {
  const [open, setOpen] = useState(true)
  if (!items || items.length === 0) return null

  const done = items.filter((i) => i.status === 'done').length

  return (
    <div className="my-1.5 rounded-lg border-soft surface overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="hoverable flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted"
      >
        <span className="font-medium">📋 Plan · {done}/{items.length} done</span>
        {streaming && (
          <span
            className="ml-1 inline-block h-1.5 w-1.5 rounded-full motion-safe:animate-pulse"
            style={{ background: 'var(--ok)' }}
          />
        )}
        <span className="ml-auto text-faint">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open && (
        <ul className="border-soft-t px-3 py-2 space-y-1">
          {items.map((item, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-sm"
              style={{
                color: item.status === 'done' ? 'var(--fg-faint)' : 'var(--fg)',
                textDecoration: item.status === 'done' ? 'line-through' : 'none',
              }}
            >
              <span
                className="mt-0.5 shrink-0"
                style={{
                  color:
                    item.status === 'done'
                      ? 'var(--ok)'
                      : item.status === 'in_progress'
                        ? 'var(--color-brand)'
                        : 'var(--fg-faint)',
                }}
              >
                {GLYPH[item.status]}
              </span>
              <span>{item.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
