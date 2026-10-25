// Session binding: create a backend session bound to the folder opened in VS
// Code, so this window owns its own conversation and workspace instead of
// writing a global setting that every other window would fight over.
//
// Why a session and not PUT /config: the workspace is a property of a
// session, fixed at creation (see doc/workspace-per-session-plan.md). Writing
// it to the shared config made the last window to save win, and left a
// transcript whose file paths pointed at one tree while the tools ran on
// another. Creating a session per window removes both failure modes.
//
// The backend validates and registers the workspace on creation, exactly as
// it does for a new chat session, so the binding is identical — we just make
// it up front instead of on the first message. We pass an ABSOLUTE path: the
// backend uses absolute paths as-is, sidestepping any cwd-dependence.

import * as vscode from 'vscode'
import type { BackendClient } from '../backend/client'

export interface CreatedSession {
  id: string
  workspace_dir: string
  workspace_origin: string
}

/** Create a backend session bound to ``folder`` and return it. */
export async function createSessionForWorkspace(
  client: BackendClient,
  folder: vscode.WorkspaceFolder,
): Promise<CreatedSession> {
  const res = await client.post<{ session: CreatedSession }>('/sessions', {
    workspace_dir: folder.uri.fsPath,
    origin: 'vscode',
  })
  return res.session
}

/** The folder the extension considers the workspace (first root, v1). */
export function primaryWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0]
}
