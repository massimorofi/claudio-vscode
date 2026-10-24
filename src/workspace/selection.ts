// Capture the active editor's selection and format it for chat context.

import * as vscode from 'vscode'

export interface SelectionInfo {
  text: string
  file: string
  range: string
}

/** Snapshot the current editor selection, or null if there is none. */
export function getActiveSelection(): SelectionInfo | null {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.selection.isEmpty) return null
  const doc = editor.document
  const sel = editor.selection
  const text = doc.getText(sel)
  const file = vscode.workspace.asRelativePath(doc.uri)
  const startLine = sel.start.line + 1
  const endLine = sel.end.line + 1
  const range = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`
  return { text, file, range }
}

/**
 * Format a selection as a fenced code block with a `file:lines` header, so the
 * model sees exactly where the snippet came from.
 */
export function formatSelectionForChat(info: SelectionInfo, languageId?: string): string {
  const fence = languageId && languageId !== 'plaintext' ? languageId : ''
  return '```' + fence + ` ${info.file}:${info.range}\n${info.text}\n\`\`\``
}
