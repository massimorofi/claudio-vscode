// Status bar: glanceable run state, cost, and context usage.
// Clicking it jumps into the chat.

import * as vscode from 'vscode'
import type { RunState } from '../chat/ChatController'

export class StatusBar {
  private item: vscode.StatusBarItem

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1000,
    )
    this.item.command = 'claudio.openChat'
    this.render('idle', 0, 0)
    this.item.show()
  }

  update(state: RunState, costUsd: number, contextPercent: number): void {
    this.render(state, costUsd, contextPercent)
  }

  private render(state: RunState, costUsd: number, contextPercent: number): void {
    const cost = `$${(costUsd ?? 0).toFixed(3)}`
    const ctx = `${Math.round(contextPercent ?? 0)}%`
    switch (state) {
      case 'running':
        this.item.text = `$(sync~spin) Claudio · running · ${cost} · ${ctx}`
        this.item.backgroundColor = undefined
        this.item.tooltip = `Claudio — run in progress · cost ${cost} · context ${ctx}`
        break
      case 'awaiting_approval':
        this.item.text = `$(debug-pause) Claudio · awaiting approval`
        this.item.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.warningBackground',
        )
        this.item.tooltip = 'Claudio — a destructive action is waiting for your approval'
        break
      case 'error':
        this.item.text = `$(error) Claudio · error`
        this.item.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground',
        )
        this.item.tooltip = 'Claudio — the last run failed'
        break
      default:
        this.item.text = `$(comment-discussion) Claudio · ${cost}`
        this.item.backgroundColor = undefined
        this.item.tooltip = `Claudio — idle · cost ${cost}`
        break
    }
  }

  dispose(): void {
    this.item.dispose()
  }
}
