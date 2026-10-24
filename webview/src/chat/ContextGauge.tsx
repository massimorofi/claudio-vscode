import { useState } from 'react'
import type { ContextUsage } from '../../../src/shared/types'

interface ContextGaugeProps {
  usage: ContextUsage | null
  disabled: boolean
  onCompact: () => void
}

const SIZE = 36
const R = 14
const C = 2 * Math.PI * R

function bandColor(pct: number): string {
  if (pct < 60) return 'var(--ok)'
  if (pct <= 85) return 'var(--warn)'
  return 'var(--err)'
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/**
 * Context usage donut (Phase 4): arc = used share of the usable window, with the
 * reserve drawn as a distinct band and a tick at the auto-compact point. Clicking
 * opens a confirm popover that triggers manual compaction.
 */
export default function ContextGauge({ usage, disabled, onCompact }: ContextGaugeProps) {
  const [open, setOpen] = useState(false)

  const pct = usage?.percent_used ?? 0
  const window = usage?.context_window ?? 1
  const usable = usage?.usable_tokens ?? 1
  const usedFrac = usage ? Math.min(1, usage.used_tokens / window) : 0
  const usableFrac = Math.min(1, usable / window)
  const color = bandColor(pct)

  const handleClick = () => {
    if (disabled) return
    setOpen((o) => !o)
  }

  const confirm = () => {
    setOpen(false)
    onCompact()
  }

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={disabled}
        title={
          disabled
            ? 'Finish the current run first'
            : 'Context usage — click to compact'
        }
        className={`rounded-full p-0.5 transition-colors ${
          disabled ? 'cursor-not-allowed opacity-50' : 'hoverable'
        }`}
        aria-label={`Context ${pct}% used`}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {/* Full-window track */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--border)"
            strokeWidth="4"
          />
          {/* Reserve band: the held-back portion, drawn distinctly */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="color-mix(in srgb, var(--warn) 22%, transparent)"
            strokeWidth="4"
            strokeDasharray={`${(1 - usableFrac) * C} ${C}`}
            strokeDashoffset={-usableFrac * C}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
          {/* Used arc */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeDasharray={`${usedFrac * C} ${C}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
          {/* Auto-compact threshold tick */}
          <line
            x1={SIZE / 2}
            y1={SIZE / 2 - R - 3}
            x2={SIZE / 2}
            y2={SIZE / 2 - R + 3}
            stroke="var(--border)"
            strokeWidth="1.5"
            transform={`rotate(${usableFrac * 360} ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>
        <span
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-semibold"
          style={{ color }}
        >
          {formatTokens(usage?.free_tokens ?? 0)}
        </span>
      </button>

      {usage?.auto_disabled && (
        <span
          className="absolute -top-1 -right-1 rounded px-1 text-[8px] font-semibold"
          style={{ background: 'color-mix(in srgb, var(--warn) 20%, transparent)', color: 'var(--warn)' }}
        >
          auto off
        </span>
      )}

      {open && !disabled && (
        <div className="surface-raised absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border-soft p-3 shadow-lg">
          <div className="text-xs" style={{ color: 'var(--fg)' }}>
            Context <span className="font-semibold">{pct}%</span> used ·{' '}
            <span className="font-semibold">
              {formatTokens(usage?.free_tokens ?? 0)}
            </span>{' '}
            tokens free
          </div>
          <div className="mt-2 flex gap-2">
            <button
              onClick={confirm}
              className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
              style={{ background: 'var(--color-brand)' }}
            >
              Compact now
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex-1 rounded-lg border-soft px-3 py-1.5 text-xs font-medium text-muted hoverable"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
