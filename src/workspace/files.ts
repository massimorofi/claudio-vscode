// File operations driven by the agent's tool calls: open a written file,
// reveal it in the explorer.

import * as vscode from 'vscode'

/** Open a file in the editor (non-preview so it sticks). */
export async function openFile(fsPath: string): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath))
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true })
  } catch {
    // File may have been deleted between the event and now; not worth a toast.
  }
}

/** Reveal a file in the file explorer. */
export async function revealInExplorer(fsPath: string): Promise<void> {
  try {
    await vscode.commands.executeCommand('revealFileInFS', vscode.Uri.file(fsPath))
  } catch {
    // Explorer may not be visible; ignore.
  }
}
