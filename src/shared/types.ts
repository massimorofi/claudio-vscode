// Types mirroring the Claudio backend HTTP API and SSE event protocol.
//
// This is the contract mirror for BOTH the extension host and the webview.
// Keep it in sync with claudio_core/events.py and the SPA's api/types.ts.

export type AgentState = 'stopped' | 'starting' | 'running' | 'stopping'

export interface ErrorEnvelope {
  error: {
    code: string
    message: string
    retryable?: boolean
    details?: Record<string, unknown>
  }
}

export interface HealthResponse {
  status: string
  time: string
}

export interface VersionResponse {
  backend: string
  openai_agents: string
  protocol: number
}

export interface AgentStatus {
  state: AgentState
  started_at: string | null
  active_runs: number
  uptime_seconds: number
  config_generation: number
}

export interface ToolInfo {
  name: string
  is_read_only: boolean
  is_destructive: boolean
}

// ---- Config ----

export interface ServerCfg {
  host: string
  port: number
  auth_token: string
  cors_origins: string[]
  expose_raw_config: boolean
}

export interface LlmCfg {
  provider: string
  model: string
  api_key: string
  base_url: string
  temperature: number
  max_tokens: number
  fallback_model: string | null
  timeout_seconds: number
  retry_attempts: number
  price_input_per_mtok: number
  price_output_per_mtok: number
}

export interface AgentCfg {
  name: string
  instructions_file: string
  max_turns: number
  max_budget_usd: number
  approval_mode: 'off' | 'always' | 'on_request'
  workspace_dir: string
  context_window: number
  compaction_reserve: number
  max_output_chars: number
  strict_tools: boolean
  skills_enabled: boolean
  skills_dir: string
  tools: { enabled: string[]; disabled: string[] }
  subagents: Record<string, SubagentCfg>
}

export interface SubagentCfg {
  description: string
  instructions_file?: string
  instructions?: string
  tools?: string[]
  max_turns?: number
}

export interface McpServerEntry {
  id: string
  transport: 'stdio' | 'sse' | 'streamable_http'
  command?: string
  url?: string
  enabled: boolean
}

export interface MonitoringCfg {
  log_level: string
  log_retention_days: number
  metrics_snapshot_interval_seconds: number
}

export interface NotificationCfg {
  enabled: boolean
}

export interface AutonomousCfg {
  enabled: boolean
  report_only: boolean
}

export interface SelfImprovementCfg {
  enabled: boolean
  capture_enabled: boolean
  consolidation_schedule: string
  promotion_threshold: number
  auto_promote: boolean
  max_learnings: number
  retention_days: number
  max_auto_skills: number
}

export interface AppConfig {
  server: ServerCfg
  llm: LlmCfg
  agent: AgentCfg
  mcp: { servers: McpServerEntry[] }
  monitoring: MonitoringCfg
  autonomous: AutonomousCfg
  self_improvement: SelfImprovementCfg
}

export interface ConfigResponse {
  config: AppConfig
  generation: number
}

export interface ConfigHistoryEntry {
  id: number
  saved_at: string
  changed_keys: string[]
}

export interface LlmTestResult {
  ok: boolean
  latency_ms?: number
  model?: string
  error?: string
}

// ---- Chat / runs ----

export interface SessionSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  total_cost_usd: number
}

export interface UsageInfo {
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export interface ApprovalRequest {
  approval_id: string
  run_id: string
  session_id: string
  tool: string
  arguments: string
  reason: string
  requested_at: string
}

export interface ActiveRunResponse {
  active: boolean
  run_id?: string
  state?: string
  last_seq?: number
}

// ---- SSE events ----

/**
 * Every SSE event name on the wire. Mirrors ``claudio_core.events.EventName``.
 */
export type EventName =
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'run_restarting'
  | 'run_compacted'
  | 'token'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'handoff'
  | 'approval_required'
  | 'context_usage'
  | 'heartbeat'

export interface StreamEvent {
  event: EventName
  data: unknown
  id?: string
}

export interface TokenEvent {
  text: string
}
export interface ReasoningEvent {
  text: string
}
export interface ToolCallEvent {
  call_id: string
  name: string
  arguments: string
}
export interface ToolResultEvent {
  call_id: string
  name: string
  output: string
  is_error: boolean
}
export interface ApprovalRequiredEvent {
  approval_id: string
  run_id: string
  tool: string
  arguments: string
  reason: string
}
export interface RunCompletedEvent {
  run_id: string
  final_output: string
  usage: UsageInfo
  summary?: TurnSummary
}
export interface RunFailedEvent {
  run_id: string
  error: {
    code: string
    message: string
    retryable: boolean
  }
}
export interface RunRestartingEvent {
  reason: string
  attempt: number
}

// ---- Context usage ----

export interface ContextUsage {
  used_tokens: number
  context_window: number
  usable_tokens: number
  free_tokens: number
  percent_used: number
  compact_threshold: number
  source: 'model' | 'estimate' | 'stored'
  auto_disabled: boolean
}

// ---- Completion status ----

export interface DeliverableItem {
  path: string
  bytes: number
  status: 'ok' | 'missing' | 'stub'
}

export interface TurnSummary {
  files_written: string[]
  commands_run: number
  duration_seconds: number
  outstanding_todos: string[]
  deliverable_written: boolean
  deliverable_ok: boolean
  deliverable_bytes: number
  deliverable: DeliverableItem[]
  task_complete: boolean
}

// ---- File upload (chat attachments) ----

export interface FileUploadResponse {
  ok: boolean
  path: string
  name: string
  size: number
  kind: string
  chars: number
  extracted: boolean
  note: string
}
