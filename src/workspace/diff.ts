// Diff-on-approval: turn a proposed write_file / edit_file into the full
// proposed file content, and show it against the current file before the
// user approves.
//
// The pure builder (buildProposedWrite) is unit-testable without VS Code.

import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

export interface ProposedWrite {
  /** Absolute path of the file the agent wants to change. */
  path: string
  /** The full content the file would have after the write. */
  content: string
}

/**
 * Build the proposed post-write content from a destructive file tool's
 * arguments. Returns null if the tool/args aren't a recognised file write.
 *
 * - write_file: content is the whole file (append=true appends to current).
 * - edit_file: old_string → new_string replacement over the current file.
 */
export function buildProposedWrite(
  tool: string,
  argsJson: string,
  workspaceRoot: string,
): ProposedWrite | null {
  let args: Record<string, unknown>
  try {
    const parsed = JSON.parse(argsJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    args = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const rawPath = args.path
  if (typeof rawPath !== 'string' || !rawPath) return null
  const abs = path.isAbsolute(rawPath)
    ? path.normalize(rawPath)
    : path.resolve(workspaceRoot, rawPath)

  if (tool === 'write_file') {
    if (typeof args.content !== 'string') return null
    if (args.append === true) {
      const current = readCurrent(abs)
      return { path: abs, content: current + args.content }
    }
    return { path: abs, content: args.content }
  }

  if (tool === 'edit_file') {
    if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') {
      return null
    }
    const current = readCurrent(abs)
    if (current === null) return null
    const content =
      args.replace_all === true
        ? current.split(args.old_string).join(args.new_string)
        : current.replace(args.old_string, args.new_string)
    return { path: abs, content }
  }

  return null
}

function readCurrent(abs: string): string | null {
  try {
    return fs.readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
}

function languageFor(fsPath: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.py': 'python',
    '.json': 'json',
    '.md': 'markdown',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.html': 'html',
    '.css': 'css',
    '.sh': 'shellscript',
  }
  return map[path.extname(fsPath).toLowerCase()] ?? 'plaintext'
}

/**
 * Open a side-by-side diff: current file on the left, proposed content on the
 * right. For a brand-new file the left side is an empty document so the whole
 * content reads as an addition.
 */
export async function showProposedDiff(
  currentPath: string,
  proposed: string,
  titleSuffix?: string,
): Promise<void> {
  const language = languageFor(currentPath)
  const rightDoc = await vscode.workspace.openTextDocument({
    content: proposed,
    language,
  })
  const exists = fs.existsSync(currentPath)
  const leftUri = exists
    ? vscode.Uri.file(currentPath)
    : (await vscode.workspace.openTextDocument({ content: '', language })).uri
  const name = path.basename(currentPath)
  const title = titleSuffix ?? `Proposed: ${name}`
  await vscode.commands.executeCommand('vscode.diff', leftUri, rightDoc.uri, title)
}
