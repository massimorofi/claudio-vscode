import { ShieldAlert, Check, X } from 'lucide-react'
import type { Item } from './chatState'

type ApprovalItem = Extract<Item, { kind: 'approval' }>

export default function ApprovalCard({
  item,
  onApprove,
  onDeny,
  busy,
}: {
  item: ApprovalItem
  onApprove: (id: string) => void
  onDeny: (id: string) => void
  busy: boolean
}) {
  const resolved = item.resolved

  return (
    <div
      className="my-2 rounded-xl border p-3"
      style={
        resolved
          ? { borderColor: 'var(--border)', background: 'var(--bg-alt)' }
          : {
              borderColor: 'color-mix(in srgb, var(--warn) 45%, transparent)',
              background: 'color-mix(in srgb, var(--warn) 10%, var(--bg))',
            }
      }
    >
      <div
        className="flex items-center gap-2 text-sm font-semibold"
        style={{ color: resolved ? 'var(--fg)' : 'var(--warn)' }}
      >
        <ShieldAlert size={16} />
        Approval required
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--fg)' }}>
        Tool <span className="font-mono font-semibold">{item.toolName}</span>
        {item.reason ? ` — ${item.reason}` : ''}
      </div>
      <pre className="scroll-thin mt-2 max-h-40 overflow-auto rounded border-soft p-2 font-mono text-[11px] whitespace-pre-wrap break-all surface-alt">
        {pretty(item.args)}
      </pre>
      {resolved ? (
        <div className="mt-2 text-xs font-medium text-muted">
          {resolved === 'approved' ? 'Approved' : 'Denied'}
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            disabled={busy}
            onClick={() => onApprove(item.approvalId)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--ok)' }}
          >
            <Check size={16} /> Approve
          </button>
          <button
            disabled={busy}
            onClick={() => onDeny(item.approvalId)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--err)' }}
          >
            <X size={16} /> Deny
          </button>
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
