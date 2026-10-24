// Claudio VS Code extension — activation and wiring.
//
// The extension host owns the backend connection (HTTP + SSE) and drives the
// VS Code API from the event stream; the webview renders chat + config and
// sends requests through the bridge.

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { BackendClient } from './backend/client'
import { BackendSupervisor } from './backend/supervisor'
import { ConfigController } from './config/ConfigController'
import { ChatController } from './chat/ChatController'
import { decideApproval, listPendingApprovals } from './chat/approvals'
import { StatusBar } from './status/StatusBar'
import { Bridge } from './bridge/Bridge'
import { readSettings, getToken, setToken } from './settings'
import type { ActiveRunResponse, ApprovalRequest } from './shared/types'
import { bindWorkspaceToBackend, primaryWorkspaceFolder } from './workspace/binding'
import { getActiveSelection } from './workspace/selection'
import { openFile } from './workspace/files'

const VIEW_ID = 'claudio.chat'

let client: BackendClient
let supervisor: BackendSupervisor
let configController: ConfigController
let chatController: ChatController
let bridge: Bridge
let statusBar: StatusBar

function workspaceRoot(): string {
  return primaryWorkspaceFolder()?.uri.fsPath ?? process.cwd()
}

/** Bind the VS Code folder as the backend workspace, if enabled and possible. */
async function bindIfPossible(): Promise<void> {
  const settings = readSettings()
  if (!settings.bindWorkspace) return
  const folder = primaryWorkspaceFolder()
  if (!folder) return
  try {
    await bindWorkspaceToBackend(client, folder)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    void vscode.window.showWarningMessage(
      `Claudio: could not bind workspace to backend — ${msg}`,
    )
  }
}

class ClaudioViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly bridgeRef: Bridge,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    const distDir = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [distDir],
    }
    this.bridgeRef.attach(webviewView.webview)
    webviewView.webview.html = this.getHtml(webviewView.webview, distDir)
  }

  private getHtml(webview: vscode.Webview, distDir: vscode.Uri): string {
    const htmlPath = path.join(distDir.fsPath, 'index.html')
    let html: string
    try {
      html = fs.readFileSync(htmlPath, 'utf-8')
    } catch {
      return `<html><body><p style="font-family:sans-serif">Claudio webview not built. Run <code>npm run build</code>.</p></body></html>`
    }
    // The webview serves bundled assets from a subdirectory of the local
    // resource root (…/dist/webview/assets/…). A CSP source that carries a
    // path matches only that exact path, so `script-src …/dist/webview` would
    // block `…/dist/webview/assets/index.js` and leave the page blank. Use the
    // webview's *origin* (cspSource, no path) so every asset under it is
    // allowed, and a <base> so the relative ./assets/… URLs resolve to it.
    const base = webview.asWebviewUri(distDir).toString().replace(/\/+$/, '')
    const cspSource = webview.cspSource
    const csp = [
      "default-src 'none'",
      `img-src data: ${cspSource}`,
      `style-src ${cspSource} 'unsafe-inline'`,
      `script-src ${cspSource}`,
      `font-src ${cspSource} data:`,
    ].join('; ')
    const injected = `<base href="${base}/">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`
    // Insert after the charset meta so the encoding declaration stays first.
    const charset = html.match(/<meta[^>]*charset[^>]*>/i)
    if (charset && charset.index !== undefined) {
      const at = charset.index + charset[0].length
      html = html.slice(0, at) + '\n' + injected + html.slice(at)
    } else if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n${injected}`)
    } else {
      html = `<head>\n${injected}</head>\n${html}`
    }
    return html
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const settings = readSettings()
  const token = await getToken(context)

  client = new BackendClient(settings.url, token)
  supervisor = new BackendSupervisor({
    baseUrl: settings.url,
    repoPath: settings.repoPath,
    autoStart: settings.autoStart,
  })
  statusBar = new StatusBar()
  bridge = new Bridge()

  const getFolder = () => (readSettings().bindWorkspace ? primaryWorkspaceFolder() : undefined)
  configController = new ConfigController(client, getFolder)

  chatController = new ChatController(client, workspaceRoot(), 'on_request', {
    onEvent: (ev) => {
      bridge.post({ type: 'chat.event', event: ev })
    },
    onState: (state) => {
      statusBar.update(state, chatController.cost, chatController.contextPercent)
      // Keep the webview's own view of the run in sync, not just the status bar.
      bridge.post({
        type: 'status',
        state,
        costUsd: chatController.cost,
        contextPercent: chatController.contextPercent,
      })
    },
  })

  registerBridgeHandlers()
  registerCommands(context)

  // Re-bind the workspace when the opened folder changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      chatController.setWorkspaceRoot(workspaceRoot())
      void bindIfPossible().then(() => {
        bridge.post({ type: 'workspace.changed', workspace: workspaceRoot() })
      })
    }),
  )

  // React to extension setting changes (URL / auto-start / bind toggle).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudio')) {
        const s = readSettings()
        client.baseUrl = s.url.replace(/\/+$/, '')
      }
    }),
  )

  // Initial bind + health check (non-blocking; the UI shows connection state).
  void (async () => {
    try {
      await supervisor.ensureRunning()
      await bindIfPossible()
    } catch {
      // Surfaced on first chat.send / config.get with a concrete error.
    }
  })()

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      VIEW_ID,
      new ClaudioViewProvider(context.extensionUri, bridge),
      {
        webviewOptions: {
          // Without this, hiding the pane destroys the webview and every bit of
          // client-side state (transcript, streaming flag) with it.
          retainContextWhenHidden: true,
        },
      },
    ),
    statusBar,
  )
}

function registerBridgeHandlers(): void {
  bridge.on('ready', async () => {
    let approvalMode = 'on_request'
    let connected = false
    // Seed from the host's own knowledge first: if a health check or the
    // active-run lookup later fails, we must not downgrade a run that is
    // genuinely still going to "Send".
    let running = chatController.isStreaming
    let runId: string | null = chatController.currentRunId
    let sessionId: string | null = chatController.currentSessionId
    let pendingApproval: ApprovalRequest | null = null
    try {
      connected = await supervisor.health()
      if (connected) {
        const cfg = await configController.get()
        approvalMode = cfg.config?.agent?.approval_mode ?? 'on_request'
        if (!running && sessionId) {
          // The host may not be watching this run (webview re-created after a
          // reload, or the run was started from another surface). Ask the
          // backend, which is the authority on what is still in flight.
          const ar = await client.get<ActiveRunResponse>(
            `/sessions/${sessionId}/active_run`,
          )
          if (ar?.active && ar.run_id) {
            const activeRunId: string = ar.run_id
            try {
              await chatController.resumeRun(activeRunId, ar.last_seq)
              running = true
              runId = activeRunId
              if (ar.state === 'awaiting_approval') {
                const pending = await listPendingApprovals(client)
                pendingApproval =
                  pending.find((a) => a.run_id === activeRunId) ?? null
              }
            } catch {
              running = false
              runId = null
            }
          }
        }
      }
    } catch {
      /* leave defaults */
    }
    bridge.post({
      type: 'init',
      workspace: workspaceRoot(),
      approvalMode,
      connected,
      running,
      runId,
      sessionId,
      pendingApproval,
    })
  })

  bridge.on('chat.send', async (msg) => {
    const m = msg as { message: string; files?: string[]; approvalMode?: string }
    await chatController.send(m.message, m.files, m.approvalMode)
    return { ok: true }
  })

  bridge.on('chat.stop', async () => {
    await chatController.stop()
    return { ok: true }
  })

  bridge.on('approval.decide', async (msg) => {
    const m = msg as { approvalId: string; decision: 'approve' | 'deny'; reason?: string }
    const res = await decideApproval(client, m.approvalId, m.decision, m.reason)
    return res
  })

  bridge.on('session.list', async () => {
    return client.get('/sessions')
  })

  bridge.on('session.load', async (msg) => {
    const m = msg as { sessionId: string }
    const messages = await client.get<{ messages: unknown[] }>(
      `/sessions/${m.sessionId}/messages`,
    )
    const session = await client.get<Record<string, unknown>>(`/sessions/${m.sessionId}`)
    return { messages: messages.messages ?? [], session }
  })

  bridge.on('session.clear', async (msg) => {
    const m = msg as { sessionId: string }
    return client.post(`/sessions/${m.sessionId}/clear`)
  })

  bridge.on('session.compact', async (msg) => {
    const m = msg as { sessionId: string }
    return client.post(`/sessions/${m.sessionId}/compact`)
  })

  bridge.on('config.get', async () => configController.get())

  bridge.on('config.put', async (msg) => {
    const m = msg as { patch: Record<string, unknown> }
    const res = await configController.put(m.patch)
    // Keep the chat controller's approval mode in sync with the saved config.
    const mode = res.config?.agent?.approval_mode
    if (mode) chatController.setApprovalMode(mode)
    return res
  })

  bridge.on('config.validate', async (msg) => {
    const m = msg as { candidate: Record<string, unknown> }
    return configController.validate(m.candidate)
  })

  bridge.on('config.llmTest', async (msg) => {
    const m = msg as { llm: Record<string, unknown> }
    return configController.llmTest(m.llm)
  })

  bridge.on('config.history', async () => configController.history())

  bridge.on('config.restore', async (msg) => {
    const m = msg as { id: number }
    return configController.restore(m.id)
  })

  bridge.on('file.open', async (msg) => {
    const m = msg as { path: string }
    const abs = path.isAbsolute(m.path) ? m.path : path.resolve(workspaceRoot(), m.path)
    await openFile(abs)
    return { ok: true }
  })

  bridge.on('file.pick', async () => {
    const files = await vscode.workspace.findFiles(
      '**/*',
      '**/{node_modules,.git,dist,build,__pycache__,.venv}/**',
      5000,
    )
    const picked = await vscode.window.showQuickPick(
      files.map((f) => ({
        label: vscode.workspace.asRelativePath(f),
        description: f.fsPath,
      })),
      { placeHolder: 'Pick a file to attach as context' },
    )
    if (!picked) return { path: null }
    return { path: picked.label }
  })

  bridge.on('selection.get', async () => getActiveSelection())
}

function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('claudio.openChat', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.claudio')
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
    }),

    vscode.commands.registerCommand('claudio.openConfig', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.claudio')
      await vscode.commands.executeCommand(`${VIEW_ID}.focus`)
      bridge.post({ type: 'open.tab', tab: 'config' })
    }),

    vscode.commands.registerCommand('claudio.stopRun', async () => {
      await chatController.stop()
    }),

    vscode.commands.registerCommand('claudio.addSelection', async () => {
      const sel = getActiveSelection()
      if (!sel) {
        void vscode.window.showInformationMessage('Claudio: no selection to add.')
        return
      }
      bridge.post({ type: 'selection.changed', ...sel })
    }),

    vscode.commands.registerCommand('claudio.newSession', async () => {
      chatController.newSession()
      bridge.post({ type: 'session.cleared' })
    }),

    vscode.commands.registerCommand('claudio.setToken', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Claudio backend bearer token',
        password: true,
        ignoreFocusOut: true,
      })
      if (value === undefined) return
      await setToken(context, value)
      client.token = value
      void vscode.window.showInformationMessage('Claudio: backend token saved.')
      await bindIfPossible()
    }),

    vscode.commands.registerCommand('claudio.startBackend', async () => {
      try {
        await supervisor.ensureRunning()
        await bindIfPossible()
        void vscode.window.showInformationMessage('Claudio: backend running.')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        void vscode.window.showErrorMessage(`Claudio: ${msg}`)
      }
    }),

    vscode.commands.registerCommand('claudio.stopBackend', async () => {
      try {
        await supervisor.stop()
        void vscode.window.showInformationMessage('Claudio: backend stopped.')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        void vscode.window.showErrorMessage(`Claudio: ${msg}`)
      }
    }),
  )
}

export function deactivate(): void {
  bridge.detach()
}
