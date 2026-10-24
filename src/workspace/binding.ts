// Workspace binding: tell the backend that the folder opened in VS Code *is*
// the agent's workspace.
//
// Verified facts that make this work (see plan §4):
// - agent.workspace_dir is not a restart key — changing it needs no restart.
// - PUT /config is a merge-patch and calls supervisor.reload_config() live.
// - The workspace is resolved per run, so the next run picks it up.
//
// We set an ABSOLUTE path: resolve_workspace_dir() uses absolute paths as-is,
// sidestepping any cwd-dependence in the backend.

import * as vscode from 'vscode'
import type { BackendClient } from '../backend/client'

export async function bindWorkspaceToBackend(
  client: BackendClient,
  folder: vscode.WorkspaceFolder,
): Promise<void> {
  await client.put('/config', {
    agent: { workspace_dir: folder.uri.fsPath },
  })
}

/** The folder the extension considers the workspace (first root, v1). */
export function primaryWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0]
}
