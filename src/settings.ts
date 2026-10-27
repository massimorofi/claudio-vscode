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

/**
 * Effective backend token: the trimmed secret wins when it is nonempty;
 * otherwise the trimmed `claudio.backend.token` setting is used as the
 * fallback. Whitespace-only values never count as a configured token.
 */
export async function getToken(context: vscode.ExtensionContext): Promise<string> {
  const secret = (await context.secrets.get(SECRET_TOKEN_KEY)) ?? ''
  const trimmed = secret.trim()
  if (trimmed) return trimmed
  const fallback = vscode.workspace
    .getConfiguration('claudio')
    .get<string>('backend.token', '')
  return (fallback ?? '').trim()
}

/**
 * Store a trimmed token. Blank (or whitespace-only) input deletes the secret,
 * which restores the `claudio.backend.token` settings fallback.
 */
export async function setToken(
  context: vscode.ExtensionContext,
  token: string,
): Promise<void> {
  const trimmed = (token ?? '').trim()
  if (trimmed) {
    await context.secrets.store(SECRET_TOKEN_KEY, trimmed)
  } else {
    await context.secrets.delete(SECRET_TOKEN_KEY)
  }
}

/**
 * Subscribe to changes of the Claudio backend token secret only. Changes to
 * other secrets are ignored, so listeners can assume the token changed.
 */
export function onDidChangeToken(
  context: vscode.ExtensionContext,
  listener: () => void,
): vscode.Disposable {
  return context.secrets.onDidChange((e) => {
    if (e.key === SECRET_TOKEN_KEY) listener()
  })
}
