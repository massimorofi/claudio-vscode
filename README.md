# Claudio for VS Code

Chat with the **Claudio** coding agent inside VS Code. The extension puts Claudio's
chat and configuration in a side panel, binds the agent to the folder you have
open, shows every proposed file change as a diff before it happens, and keeps
destructive actions behind an explicit approval.

The extension is a **thin client over the existing Claudio backend**
(HTTP + SSE at `http://127.0.0.1:8100/api/v1`). The backend is not modified —
this is a third surface alongside the web SPA, not a fork of it.

---

## Features

- **Streaming chat** — tokens, reasoning, tool calls and tool results render live.
- **Diff-on-approval** — when the agent proposes `write_file` / `edit_file`, a
  side-by-side diff of current vs. proposed content opens before you decide.
- **Workspace binding** — the folder opened in VS Code becomes the agent's
  `workspace_dir`, so its file operations target your project.
- **Approval gate** — the run pauses until you approve or deny; nothing destructive
  slips through.
- **Add selection as context** — send the current editor selection into the chat.
- **Session control** — new / clear / compact sessions, cancel a running run.
- **Config tab** — edit LLM, Agent, MCP and Self-Improvement settings with
  validation, LLM connectivity test, history and one-click restore.
- **Status bar** — run state, running cost and context usage at a glance.
- **Slash commands** — `/stop`, `/approve`, `/deny`, `/compact`, `/clear`,
  `/new`, `/config`.

## Requirements

- **VS Code 1.90+**
- **Node 20+** (the host uses native `fetch`, `FormData`, `Blob`)
- A working **Claudio backend** — the repo containing `backend-start.sh`

## Install

From this folder:

```bash
npm install
npm run build
npm run package                                   # -> claudio-vscode-0.1.0.vsix
code --install-extension claudio-vscode-0.1.0.vsix
```

Or press **F5** in VS Code (Run Extension) for a development host.
---

## Configure

Open **Settings → Claudio** (`Ctrl+,`, search "Claudio"):

| Setting | Default | Purpose |
| --- | --- | --- |
| `claudio.backend.url` | `http://127.0.0.1:8100` | Base URL of the backend HTTP API. |
| `claudio.backend.token` | `""` | Bearer token. **Prefer the command below** so it lands in secret storage, not `settings.json`. |
| `claudio.backend.path` | `""` | Absolute path to the Claudio repo root (the folder with `backend-start.sh`). Required for auto-start. |
| `claudio.backend.autoStart` | `true` | Start the backend daemon automatically when it is not reachable. |
| `claudio.workspace.bind` | `true` | Bind the agent's workspace to the folder opened in VS Code. |

### Backend token

Run **Claudio: Set Backend Token** (`Ctrl+Shift+P`). The token is stored in VS
Code's secret storage (`context.secrets`), never in `settings.json`. The
`claudio.backend.token` setting is only a fallback for headless / scripted
setups.

### Auto-start

With `claudio.backend.autoStart` on and `claudio.backend.path` set, the extension
runs `backend-start.sh` if the backend isn't reachable, then polls `/healthz` for
up to 30s. You can also drive it manually with **Claudio: Start Backend** and
**Claudio: Stop Backend**. The extension deliberately shells out to the repo's
own scripts so there is exactly one way to start and stop the daemon, whether
from a terminal or from VS Code.

---

## Using the extension

Open the **Claudio** view in the Secondary Sidebar (or `Ctrl+Alt+C`).

| Action | How |
| --- | --- |
| Send a message | Type and press `Enter` (`Shift+Enter` = newline) |
| Attach a file | Pick from the workspace; sent as context |
| Add current selection | **Claudio: Add Selection to Chat** (`Ctrl+Alt+S`) or the editor right-click menu |
| Approve / deny | Click the approval card in the chat, or `/approve` / `/deny` |
| Stop the run | **Claudio: Stop Current Run** (`Ctrl+Alt+X`) or `/stop` |
| New session | **Claudio: New Session** or `/new` |
| Compact context | `/compact` |
| Clear session | `/clear` |
| Open config | **Claudio: Open Configuration** or `/config` |

**Status bar** (left side, click to jump into chat):

- `$(sync~spin) Claudio · running · $0.012 · 34%` — run in progress, cost, context
- `$(debug-pause) Claudio · awaiting approval` (amber) — a destructive action is waiting
- `$(error) Claudio · error` (red) — the last run failed
---

## Architecture

**The extension host owns the connection; the webview renders.**

The host (Node) opens the SSE stream, relays every event to the webview, and
drives the VS Code side of things — status bar, diff-on-approval, native
notifications. The webview is a renderer plus an input surface. One backend event
drives both the chat and the editor.

```
VS Code window
├── Extension host (Node)                        Claudio webview (React)
│   extension.ts ── activation, commands          App.tsx  ── Chat | Config tabs
│   backend/client.ts ── typed HTTP (fetch)       chat/ChatView.tsx  ── composer, list
│   backend/sse.ts ── SSE frame parser           chat/chatState.ts  ── event reducer
│   backend/supervisor.ts ── health/auto-start    chat/ToolCard, ApprovalCard, ...
│   chat/ChatController.ts ── run lifecycle      config/ConfigView.tsx
│   config/ConfigController.ts ── config ops     bridge/client.ts ── request/response
│   workspace/* ── binding, diff, selection
│   bridge/Bridge.ts ── message routing ────────► bridge/protocol.ts (shared types)
│   settings.ts ── settings + secret storage
│   shared/types.ts ── backend API/event contract mirror
```

**Run lifecycle.** `POST /chat/stream` stays open across approval pauses, so one
stream covers a whole logical run including approve/deny continuations. If the
connection drops mid-run, the controller reattaches with
`GET /chat/runs/{id}/stream?last_event_id=…`, retrying up to 5 times with
exponential backoff (1s → 16s).

**Workspace binding.** A `PUT /config { agent: { workspace_dir } }` with the
absolute path of the opened folder. `workspace_dir` is not a restart key: the
backend resolves it per run, so no restart is needed. The binding is re-asserted
on activation, on workspace folder changes, after a token is set, and after every
config save (a save could have overwritten it).

**Diff-on-approval.** `buildProposedWrite()` reconstructs the full post-write
content from the tool arguments — whole-file for `write_file` (honouring
`append`), string replacement for `edit_file` (honouring `replace_all`) — then
`showProposedDiff()` opens a native `vscode.diff` with the current file on the
left and the proposal on the right (an empty left pane for a brand-new file).

**Run state survives a pane switch.** The Stop/Send button is driven by
`streaming` in the webview, but `streaming` is only flipped by `run_started`,
which is the first frame of a run and is never replayed on a resume. So a
webview that is re-created mid-run (pane switch, window reload) would revert to
**Send** while the agent keeps working. Three layers prevent this:

1. `retainContextWhenHidden: true` keeps the webview — and its state — alive
   across pane switches.
2. On every `ready`, the host reports the real run state in `init`. It trusts
   its own `ChatController` first, and falls back to
   `GET /sessions/{id}/active_run` for runs it is not watching (started before
   a reload, or from another surface), resuming the stream via
   `ChatController.resumeRun()`.
3. The webview hydrates from `init` through `actionsFromInit()`
   (`webview/src/bridge/hydrate.ts`), which also restores the approval card if
   the run is paused on one. A "not running" answer is only trusted when the
   backend was actually reachable — an unreachable backend is not evidence that
   the run ended.
---

## Backend API surface

All calls go to `{claudio.backend.url}/api/v1` with `Authorization: Bearer <token>`,
except the liveness probe which is unauthenticated.

| Method | Path | Used for |
| --- | --- | --- |
| `GET` | `/healthz` (no `/api/v1` prefix) | Liveness probe, auto-start wait |
| `GET` | `/config` | Read effective config |
| `PUT` | `/config` | Merge-patch config (also how the workspace is bound) |
| `POST` | `/config/validate` | Validate a candidate config without saving |
| `POST` | `/config/llm/test` | LLM connectivity test |
| `GET` | `/config/history` | Config change history |
| `POST` | `/config/restore` | Restore a history entry |
| `POST` | `/chat/stream` | Start a run (SSE response) |
| `GET` | `/chat/runs/{id}/stream?last_event_id=` | Resume a dropped stream |
| `POST` | `/chat/runs/{id}/cancel` | Stop the current run |
| `POST` | `/approvals/{id}` | Resolve an approval (`approve` / `deny`) |
| `GET` | `/approvals/pending` | List pending approvals |
| `GET` | `/sessions` | List sessions |
| `GET` | `/sessions/{id}` | Session metadata |
| `GET` | `/sessions/{id}/messages` | Session transcript |
| `POST` | `/sessions/{id}/clear` | Clear a session |
| `POST` | `/sessions/{id}/compact` | Compact a session |

**SSE events consumed:** `run_started`, `run_completed`, `run_failed`,
`run_restarting`, `run_compacted`, `token`, `reasoning`, `tool_call`,
`tool_result`, `handoff`, `approval_required`, `context_usage`, `heartbeat`.

The mirror of this contract lives in `src/shared/types.ts` and is imported by both
the host and the webview. **Keep it in sync with `claudio_core/events.py` and the
SPA's `api/types.ts`.**

## Bridge protocol

Host ↔ webview messages are typed unions in `src/bridge/protocol.ts`. Requests
carry a `requestId`; the host always answers with a `response` envelope
(`ok`, `data`, `error`). Host-pushed events have no `requestId`.

**webview → host:** `ready`, `chat.send`, `chat.stop`, `approval.decide`,
`session.list`, `session.load`, `session.clear`, `session.compact`,
`config.get`, `config.put`, `config.validate`, `config.llmTest`,
`config.history`, `config.restore`, `file.open`, `file.pick`, `selection.get`

**host → webview:** `init`, `chat.event`, `chat.started`, `chat.done`,
`response`, `workspace.changed`, `selection.changed`, `open.tab`,
`session.cleared`, `status`

`init` is the webview's hydration payload and carries the live run state:
`running`, `runId`, `sessionId`, `pendingApproval` (plus `workspace`,
`approvalMode`, `connected`). The webview is destroyed whenever its pane is
hidden, so on every re-mount it must be told what is actually in flight —
see **Run state survives a pane switch** below.
---

## Project structure

```
.
├── src/                        Extension host (TypeScript, bundled by esbuild)
│   ├── extension.ts            Activation, command registration, wiring
│   ├── settings.ts             Settings reader + secret storage for the token
│   ├── backend/
│   │   ├── client.ts           Typed HTTP client (fetch, Bearer, error envelope)
│   │   ├── sse.ts              Incremental SSE parser (pure, unit-tested)
│   │   ├── sse.test.ts
│   │   └── supervisor.ts       Health probe, auto-start / stop of the daemon
│   ├── bridge/
│   │   ├── Bridge.ts           Host-side message router
│   │   └── protocol.ts         Bridge message type definitions
│   ├── chat/
│   │   ├── ChatController.ts   Run lifecycle, SSE consumption, reattach
│   │   └── approvals.ts        Approve / deny round-trip
│   ├── config/
│   │   └── ConfigController.ts get/put/validate/test/history/restore + rebind
│   ├── workspace/
│   │   ├── binding.ts          PUT /config { agent.workspace_dir }
│   │   ├── diff.ts             Proposed-content builder + diff view
│   │   ├── diff.test.ts
│   │   ├── files.ts            Open a file in the editor
│   │   └── selection.ts        Read the active editor selection
│   └── shared/
│       └── types.ts            Backend API + event contract mirror
├── webview/                    Webview UI (React 18 + Tailwind 4, built by Vite)
│   ├── index.html
│   └── src/
│       ├── main.tsx            React entry
│       ├── App.tsx             Two-tab shell (Chat / Config)
│       ├── index.css           Tailwind + theme variables
│       ├── bridge/
│       │   ├── client.ts       postMessage wrapper with request/response
│       │   └── useBridgeChat.ts
│       ├── chat/
│       │   ├── ChatView.tsx    Composer, transcript, slash commands
│       │   ├── chatState.ts    Reducer over the event stream
│       │   ├── chatState.test.ts
│       │   ├── workflow.ts     Grouping items into turns / steps
│       │   ├── ApprovalCard.tsx
│       │   ├── ToolCard.tsx
│       │   ├── CompletionStatus.tsx
│       │   ├── ContextGauge.tsx
│       │   └── PlanTracker.tsx
│       └── config/
│           └── ConfigView.tsx  Full config editor
├── media/icon.svg              View container icon
├── scripts/render-test.mjs     Headless-Chrome render smoke test
├── esbuild.js                  Host bundle build
├── vite.webview.config.mts     Webview bundle build
├── tsconfig.json               Strict TS config (noEmit; builds use bundlers)
└── vscode-extension-plan.md    The original phased implementation plan
```

## Development

```bash
npm install
npm run watch       # rebuild host + webview on change
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

Individual builds: `npm run build:host` (esbuild → `dist/extension.js`) and
`npm run build:webview` (Vite → `dist/webview/`).

**Render smoke test.** `node scripts/render-test.mjs` serves `dist/webview` over
HTTP with `acquireVsCodeApi` stubbed, loads it in headless Chrome, and confirms
React actually mounted (i.e. the bundle runs without a runtime crash). It
deliberately omits CSP so "does the app render" stays separate from "does the
policy allow it".

**Packaging.** `npm run package` runs `vsce package`. `.vscodeignore` keeps
`src/`, `webview/`, tests, source maps and build configs out of the `.vsix`.
---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Cannot reach backend at http://…` | Backend is down or the URL is wrong. Check `claudio.backend.url`, or start it with **Claudio: Start Backend**. |
| `backend-start.sh not found` | Set `claudio.backend.path` to the Claudio repo root (the folder that literally contains `backend-start.sh`). |
| `Claudio backend did not become healthy within 30s` | The daemon failed to boot. Read `claudio-backend/data/logs/backend.log` in the backend repo. |
| 401 / auth errors | Token missing or stale. Re-run **Claudio: Set Backend Token**. |
| Blank webview panel | The webview bundle is missing or was blocked by CSP. Run `npm run build`. The host injects a `<base>` plus a CSP that allows the webview's **origin** (`webview.cspSource`), not a path — a path-scoped `script-src` blocks `…/assets/*.js` and leaves the page blank. |
| Agent edits the wrong project | Multi-window binding — see below. |
| Composer shows **Send** while Claudio is still working | The webview lost its run state. Fixed by the `init` hydration described above — make sure you are on a build that includes it. If it persists, the backend may not be reporting the run: check `GET /api/v1/sessions/{id}/active_run`. |
| `Claudio webview not built.` | Run `npm run build`. |

## Multi-window caveat

The backend has **one global `workspace_dir`**. If several VS Code windows have
binding enabled, **the last one to bind wins** — the agent operates on whichever
folder bound most recently, not necessarily the window you are typing in. Use one
window per task, or turn off `claudio.workspace.bind` and set the workspace
explicitly in the Config tab.

## Security notes

- The backend token lives in VS Code **secret storage**, not plain settings.
- The approval gate is never bypassed — destructive tool calls always wait for an
  explicit approve/deny.
- The agent is confined to the bound workspace folder.
- **Self-Improvement → Auto-promote** writes model-generated content into the live
  skill catalog **without review**. Only enable this on a trusted host.
- The default backend URL is localhost-only. Pointing it at a remote host sends
  your prompts and file contents over the network.

## Repo notes

- This folder is **not under git version control** (no `.git`). A `.gitignore` is
  present and correct (`node_modules/`, `dist/`, `*.vsix`, `*.log`), but nothing
  is tracked yet — worth initialising before further work.
- `.claudio/adk-*.db` is local runtime state and should not be shipped; add it to
  `.gitignore` / `.vscodeignore` if it reappears.
- `.vscodeignore` lists `vitest.config.ts`, which does not exist in this repo
  (vitest runs on defaults). Harmless, but stale.

## Version

`0.1.0` — packaged as `claudio-vscode-0.1.0.vsix`.
