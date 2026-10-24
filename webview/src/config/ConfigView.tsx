import { useEffect, useState } from 'react'
import { Save, Play, AlertTriangle, History } from 'lucide-react'
import { bridge } from '../bridge/client'
import type {
  AppConfig,
  ConfigHistoryEntry,
  LlmTestResult,
} from '../../../src/shared/types'

type SetField = <K extends keyof AppConfig>(k: K, v: AppConfig[K]) => void
type Tab = 'llm' | 'agent' | 'mcp' | 'memory'

// The MCP ``command`` is an argv list on the wire but a single editable string in
// the form. Normalize at both boundaries: join the list into a string on load,
// split the string back into a list on save.
const commandToString = (cmd: unknown): string =>
  Array.isArray(cmd) ? cmd.join(' ') : ((cmd as string | undefined) ?? '')

const stringToCommand = (s: string): string[] => s.split(/\s+/).filter(Boolean)

/**
 * Configuration panel driven through the host bridge. The webview holds a local
 * draft; saving sends a merge-patch to the backend via the host, which also
 * re-asserts the VS Code workspace binding.
 */
export default function ConfigView() {
  const [tab, setTab] = useState<Tab>('llm')
  const [draft, setDraft] = useState<AppConfig | null>(null)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [history, setHistory] = useState<ConfigHistoryEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null)

  const loadConfig = async () => {
    try {
      const res = await bridge.request<{ config: AppConfig }>('config.get')
      const cfg = res.config
      setDraft({
        ...cfg,
        mcp: {
          ...cfg.mcp,
          servers: (cfg.mcp.servers ?? []).map((s) => ({
            ...s,
            command: commandToString(s.command),
          })),
        },
      })
    } catch (e) {
      setMessage({ kind: 'err', text: (e as Error).message })
    }
  }

  const loadHistory = async () => {
    try {
      const res = await bridge.request<{ history: ConfigHistoryEntry[] }>('config.history')
      setHistory(res?.history ?? [])
    } catch {
      /* history is best-effort */
    }
  }

  useEffect(() => {
    void loadConfig()
    void loadHistory()
  }, [])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setMessage(null)
    try {
      const payload = {
        ...draft,
        mcp: {
          ...draft.mcp,
          servers: (draft.mcp.servers ?? []).map((s) => ({
            ...s,
            command: stringToCommand(s.command ?? ''),
          })),
        },
      }
      const res = await bridge.request<{
        restart_required: string[]
        changed_keys: string[]
      }>('config.put', payload)
      const needs = (res.restart_required ?? []).length > 0
      setRestartNeeded(needs)
      setMessage({
        kind: 'ok',
        text: needs
          ? `Saved. Restart required for: ${(res.restart_required ?? []).join(', ')}`
          : 'Saved.',
      })
      void loadHistory()
    } catch (e) {
      setMessage({ kind: 'err', text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const testLlm = async () => {
    if (!draft) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await bridge.request<LlmTestResult>('config.llmTest', {
        llm: draft.llm as unknown as Record<string, unknown>,
      })
      setTestResult(res)
    } catch (e) {
      setMessage({ kind: 'err', text: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const restore = async (id: number) => {
    try {
      const res = await bridge.request<{ restart_required: string[] }>('config.restore', {
        id,
      })
      setDraft(null)
      setRestartNeeded((res.restart_required ?? []).length > 0)
      setMessage({ kind: 'ok', text: 'Config restored.' })
      await loadConfig()
      await loadHistory()
    } catch (e) {
      setMessage({ kind: 'err', text: (e as Error).message })
    }
  }

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Loading configuration…
      </div>
    )
  }

  const set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d))

  return (
    <div className="flex h-full flex-col">
      <div className="border-soft-b surface-alt px-2 py-2">
        <div className="flex gap-1 overflow-x-auto">
          {(['llm', 'agent', 'mcp', 'memory'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize whitespace-nowrap ${
                tab === t ? 'text-white' : 'text-muted hoverable'
              }`}
              style={tab === t ? { background: 'var(--color-brand)' } : undefined}
            >
              {t === 'mcp' ? 'MCP Servers' : t === 'memory' ? 'Self-Improvement' : t}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div
          className="px-3 py-2 text-sm"
          style={{
            background:
              message.kind === 'ok'
                ? 'color-mix(in srgb, var(--ok) 10%, var(--bg))'
                : 'color-mix(in srgb, var(--err) 10%, var(--bg))',
            color: message.kind === 'ok' ? 'var(--ok)' : 'var(--err)',
          }}
        >
          {message.text}
        </div>
      )}
      {restartNeeded && (
        <div
          className="flex items-center gap-3 px-3 py-2 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--warn) 12%, var(--bg))',
            color: 'var(--warn)',
          }}
        >
          <AlertTriangle size={16} />
          Changes require an agent restart.
        </div>
      )}

      <div className="scroll-thin flex-1 overflow-y-auto p-3">
        {tab === 'llm' && <LlmSection draft={draft} setDraft={set} />}
        {tab === 'agent' && <AgentSection draft={draft} setDraft={set} />}
        {tab === 'mcp' && <McpSection draft={draft} setDraft={set} />}
        {tab === 'memory' && <SelfImprovementSection draft={draft} setDraft={set} />}
        {tab === 'llm' && (
          <div className="mt-3">
            <button
              onClick={testLlm}
              disabled={testing}
              className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: 'var(--color-brand)', color: 'var(--color-brand)' }}
            >
              <Play size={16} /> Test connection
            </button>
            {testResult && (
              <div
                className="mt-2 text-sm"
                style={{ color: testResult.ok ? 'var(--ok)' : 'var(--err)' }}
              >
                {testResult.ok
                  ? `OK — ${testResult.latency_ms} ms`
                  : `Failed: ${testResult.error}`}
              </div>
            )}
          </div>
        )}
        {tab === 'memory' && (
          <HistorySection history={history} onRestore={restore} />
        )}
      </div>

      <div className="border-soft-t surface p-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--color-brand)' }}
        >
          <Save size={16} /> Save configuration
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <label className="block mb-3">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-faint">{hint}</span>}
    </label>
  )
}

function LlmSection({
  draft,
  setDraft,
}: {
  draft: AppConfig
  setDraft: SetField
}) {
  const llm = draft.llm
  const upd = (patch: Partial<AppConfig['llm']>) => setDraft('llm', { ...llm, ...patch })

  return (
    <div className="grid grid-cols-1 gap-x-3">
      <Field label="Model">
        <input className="input" value={llm.model} onChange={(e) => upd({ model: e.target.value })} />
      </Field>
      <Field label="Base URL">
        <input
          className="input"
          value={llm.base_url}
          onChange={(e) => upd({ base_url: e.target.value })}
        />
      </Field>
      <Field label="API key" hint="Stored locally; never returned by the API.">
        <input
          className="input"
          type="password"
          value={llm.api_key}
          onChange={(e) => upd({ api_key: e.target.value })}
        />
      </Field>
      <Field label="Fallback model">
        <input
          className="input"
          value={llm.fallback_model ?? ''}
          onChange={(e) => upd({ fallback_model: e.target.value || null })}
        />
      </Field>
      <Field label="Temperature">
        <input
          className="input"
          type="number"
          step="0.1"
          value={llm.temperature}
          onChange={(e) => upd({ temperature: Number(e.target.value) })}
        />
      </Field>
      <Field label="Max tokens">
        <input
          className="input"
          type="number"
          value={llm.max_tokens}
          onChange={(e) => upd({ max_tokens: Number(e.target.value) })}
        />
      </Field>
      <Field label="Timeout (s)">
        <input
          className="input"
          type="number"
          value={llm.timeout_seconds}
          onChange={(e) => upd({ timeout_seconds: Number(e.target.value) })}
        />
      </Field>
      <Field label="Retry attempts">
        <input
          className="input"
          type="number"
          value={llm.retry_attempts}
          onChange={(e) => upd({ retry_attempts: Number(e.target.value) })}
        />
      </Field>
      <Field label="Price input / Mtok (USD)">
        <input
          className="input"
          type="number"
          step="0.01"
          value={llm.price_input_per_mtok}
          onChange={(e) => upd({ price_input_per_mtok: Number(e.target.value) })}
        />
      </Field>
      <Field label="Price output / Mtok (USD)">
        <input
          className="input"
          type="number"
          step="0.01"
          value={llm.price_output_per_mtok}
          onChange={(e) => upd({ price_output_per_mtok: Number(e.target.value) })}
        />
      </Field>
    </div>
  )
}

function AgentSection({
  draft,
  setDraft,
}: {
  draft: AppConfig
  setDraft: SetField
}) {
  const agent = draft.agent
  const upd = (patch: Partial<AppConfig['agent']>) => setDraft('agent', { ...agent, ...patch })
  const allTools = [
    'read_file',
    'write_file',
    'edit_file',
    'list_dir',
    'run_command',
    'web_fetch',
    'web_search',
    'todo_write',
    'rewind_files',
    'spawn_subagent',
  ]

  const toggleTool = (name: string) => {
    const enabled = agent.tools.enabled.includes(name)
      ? agent.tools.enabled.filter((t) => t !== name)
      : [...agent.tools.enabled, name]
    upd({ tools: { ...agent.tools, enabled } })
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-x-3">
        <Field label="Agent name">
          <input className="input" value={agent.name} onChange={(e) => upd({ name: e.target.value })} />
        </Field>
        <Field label="Approval mode">
          <select
            className="input"
            value={agent.approval_mode}
            onChange={(e) =>
              upd({ approval_mode: e.target.value as AppConfig['agent']['approval_mode'] })
            }
          >
            <option value="on_request">On request</option>
            <option value="always">Always ask</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <Field label="Max turns">
          <input
            className="input"
            type="number"
            value={agent.max_turns}
            onChange={(e) => upd({ max_turns: Number(e.target.value) })}
          />
        </Field>
        <Field label="Max budget (USD)">
          <input
            className="input"
            type="number"
            step="0.5"
            value={agent.max_budget_usd}
            onChange={(e) => upd({ max_budget_usd: Number(e.target.value) })}
          />
        </Field>
        <Field label="Context window">
          <input
            className="input"
            type="number"
            value={agent.context_window}
            onChange={(e) => upd({ context_window: Number(e.target.value) })}
          />
        </Field>
        <Field label="Compaction reserve">
          <input
            className="input"
            type="number"
            value={agent.compaction_reserve}
            onChange={(e) => upd({ compaction_reserve: Number(e.target.value) })}
          />
        </Field>
        <Field label="Max output chars">
          <input
            className="input"
            type="number"
            value={agent.max_output_chars}
            onChange={(e) => upd({ max_output_chars: Number(e.target.value) })}
          />
        </Field>
        <Field
          label="Workspace dir"
          hint="Set automatically from the open VS Code folder when binding is on."
        >
          <input
            className="input"
            value={agent.workspace_dir}
            onChange={(e) => upd({ workspace_dir: e.target.value })}
          />
        </Field>
        <Field
          label="Skills dir"
          hint="Folder of Agent Skills (each a directory with a SKILL.md)."
        >
          <input
            className="input"
            value={agent.skills_dir}
            onChange={(e) => upd({ skills_dir: e.target.value })}
          />
        </Field>
      </div>

      <label className="mt-1 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={agent.skills_enabled}
          onChange={(e) => upd({ skills_enabled: e.target.checked })}
        />
        <span>Enable Agent Skills (adds list_skills / load_skill / read_skill_resource)</span>
      </label>

      <div className="mt-2">
        <div className="mb-1 text-xs font-medium text-muted">Enabled tools</div>
        <div className="grid grid-cols-2 gap-1">
          {allTools.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={agent.tools.enabled.includes(t)}
                onChange={() => toggleTool(t)}
              />
              <span className="font-mono text-xs">{t}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

function McpSection({
  draft,
  setDraft,
}: {
  draft: AppConfig
  setDraft: SetField
}) {
  const servers = draft.mcp.servers
  const upd = (list: AppConfig['mcp']['servers']) => setDraft('mcp', { servers: list })

  const add = () =>
    upd([
      ...servers,
      { id: `server-${servers.length + 1}`, transport: 'stdio', command: '', enabled: false },
    ])

  const patch = (i: number, p: Partial<AppConfig['mcp']['servers'][number]>) =>
    upd(servers.map((s, idx) => (idx === i ? { ...s, ...p } : s)))

  const remove = (i: number) => upd(servers.filter((_, idx) => idx !== i))

  return (
    <div>
      {servers.length === 0 && (
        <div className="mb-3 text-sm text-muted">No MCP servers configured.</div>
      )}
      {servers.map((s, i) => (
        <div key={i} className="mb-3 rounded-lg border-soft p-3">
          <div className="grid grid-cols-1 gap-x-3">
            <Field label="ID">
              <input
                className="input"
                value={s.id}
                onChange={(e) => patch(i, { id: e.target.value })}
              />
            </Field>
            <Field label="Transport">
              <select
                className="input"
                value={s.transport}
                onChange={(e) =>
                  patch(i, {
                    transport: e.target.value as AppConfig['mcp']['servers'][number]['transport'],
                  })
                }
              >
                <option value="stdio">stdio</option>
                <option value="sse">sse</option>
                <option value="streamable_http">streamable_http</option>
              </select>
            </Field>
            {s.transport === 'stdio' ? (
              <Field label="Command">
                <input
                  className="input"
                  value={s.command ?? ''}
                  onChange={(e) => patch(i, { command: e.target.value })}
                />
              </Field>
            ) : (
              <Field label="URL">
                <input
                  className="input"
                  value={s.url ?? ''}
                  onChange={(e) => patch(i, { url: e.target.value })}
                />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) => patch(i, { enabled: e.target.checked })}
              />
              Enabled
            </label>
          </div>
          <button
            onClick={() => remove(i)}
            className="mt-2 text-xs hover:underline"
            style={{ color: 'var(--err)' }}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="rounded-lg border px-4 py-2 text-sm font-semibold"
        style={{ borderColor: 'var(--color-brand)', color: 'var(--color-brand)' }}
      >
        Add MCP server
      </button>
    </div>
  )
}

function SelfImprovementSection({
  draft,
  setDraft,
}: {
  draft: AppConfig
  setDraft: SetField
}) {
  const si = draft.self_improvement
  const upd = (patch: Partial<AppConfig['self_improvement']>) =>
    setDraft('self_improvement', { ...si, ...patch })

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Claudio can learn from its own runs: capture a lesson after each session,
        then periodically distill recurring lessons into skills. Off by default.
      </p>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={si.enabled}
          onChange={(e) => upd({ enabled: e.target.checked })}
        />
        <span>Enable self-improvement (master switch)</span>
      </label>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={si.capture_enabled}
          onChange={(e) => upd({ capture_enabled: e.target.checked })}
        />
        <span>Capture learnings after each run</span>
      </label>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={si.auto_promote}
          onChange={(e) => upd({ auto_promote: e.target.checked })}
        />
        <span>Auto-promote distilled skills without approval</span>
      </label>
      {si.auto_promote && (
        <div
          className="mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)',
            background: 'color-mix(in srgb, var(--warn) 8%, var(--bg))',
            color: 'var(--warn)',
          }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Auto-promote writes model-generated content into the live skill catalog
          without review. Only enable this on a trusted host.
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-3">
        <Field label="Consolidation schedule" hint="cron, evaluated in UTC">
          <input
            className="input"
            value={si.consolidation_schedule}
            onChange={(e) => upd({ consolidation_schedule: e.target.value })}
          />
        </Field>
        <Field label="Promotion threshold" hint="recurrence count needed to promote">
          <input
            className="input"
            type="number"
            min={1}
            value={si.promotion_threshold}
            onChange={(e) => upd({ promotion_threshold: Number(e.target.value) })}
          />
        </Field>
        <Field label="Max learnings" hint="episodic store cap (prune oldest)">
          <input
            className="input"
            type="number"
            min={1}
            value={si.max_learnings}
            onChange={(e) => upd({ max_learnings: Number(e.target.value) })}
          />
        </Field>
        <Field label="Retention days" hint="prune raw learnings older than this">
          <input
            className="input"
            type="number"
            min={1}
            value={si.retention_days}
            onChange={(e) => upd({ retention_days: Number(e.target.value) })}
          />
        </Field>
        <Field label="Max auto-generated skills" hint="bloat guard for the skill catalog">
          <input
            className="input"
            type="number"
            min={0}
            value={si.max_auto_skills}
            onChange={(e) => upd({ max_auto_skills: Number(e.target.value) })}
          />
        </Field>
      </div>
    </div>
  )
}

function HistorySection({
  history,
  onRestore,
}: {
  history: ConfigHistoryEntry[]
  onRestore: (id: number) => void
}) {
  if (!history || history.length === 0) {
    return (
      <div className="mt-4 flex items-center gap-2 text-xs text-muted">
        <History size={14} /> No configuration history yet.
      </div>
    )
  }
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <History size={14} /> History
      </div>
      <ul className="space-y-1">
        {history.map((h) => (
          <li
            key={h.id}
            className="flex items-center gap-2 rounded-lg border-soft px-3 py-1.5 text-xs"
          >
            <span className="flex-1 truncate text-muted">
              {h.saved_at ?? `#${h.id}`}
              {h.changed_keys?.length ? ` — ${h.changed_keys.join(', ')}` : ''}
            </span>
            <button
              onClick={() => onRestore(h.id)}
              className="rounded-md border px-2 py-1 font-medium"
              style={{ borderColor: 'var(--border)' }}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
