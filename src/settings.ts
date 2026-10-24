// Extension settings + secret storage.
//
// The backend token lives in VS Code's secret storage, never in plain
// settings.json. The `claudio.backend.token` setting is a fallback for
// headless / scripted setups.

import * as vscode from 'vscode'

export interface ClaudioSettings {
  url: string
  repoPath: string
  autoStart: boolean
  bindWorkspace: boolean
}

const SECRET_TOKEN_KEY = 'claudio.backend.token'

export function readSettings(): ClaudioSettings {
  const cfg = vscode.workspace.getConfiguration('claudio')
  return {
    url: cfg.get<string>('backend.url', 'http://127.0.0.1:8100'),
    repoPath: cfg.get<string>('backend.path', ''),
    autoStart: cfg.get<boolean>('backend.autoStart', true),
    bindWorkspace: cfg.get<boolean>('workspace.bind', true),
  }
}

export async function getToken(context: vscode.ExtensionContext): Promise<string> {
  const secret = await context.secrets.get(SECRET_TOKEN_KEY)
  if (secret) return secret
  return vscode.workspace.getConfiguration('claudio').get<string>('backend.token', '')
}

export async function setToken(
  context: vscode.ExtensionContext,
  token: string,
): Promise<void> {
  if (token) {
    await context.secrets.store(SECRET_TOKEN_KEY, token)
  } else {
    await context.secrets.delete(SECRET_TOKEN_KEY)
  }
}
