// Host-side bridge: owns the webview message channel, routes incoming
// webview→host messages to registered handlers, and sends the `response`
// envelope back for every request.

import * as vscode from 'vscode'
import type { HostToWebview, WebviewToHost } from './protocol'

export type Handler = (msg: WebviewToHost) => unknown | Promise<unknown>

export class Bridge {
  private webview: vscode.Webview | null = null
  private handlers = new Map<string, Handler>()

  /** Attach the bridge to a live webview (view or panel). */
  attach(webview: vscode.Webview): void {
    this.webview = webview
    webview.onDidReceiveMessage((msg: WebviewToHost) => {
      void this.dispatch(msg)
    })
  }

  detach(): void {
    this.webview = null
  }

  /** Register a handler for one message type. Returns an unsubscribe fn. */
  on(type: string, handler: Handler): () => void {
    this.handlers.set(type, handler)
    return () => {
      if (this.handlers.get(type) === handler) this.handlers.delete(type)
    }
  }

  /** Fire-and-forget a host→webview message. */
  post(msg: HostToWebview): void {
    this.webview?.postMessage(msg)
  }

  private async dispatch(msg: WebviewToHost): Promise<void> {
    const handler = this.handlers.get(msg.type)
    if (!handler) return
    const requestId = (msg as { requestId?: string }).requestId
    try {
      const data = await handler(msg)
      if (requestId) {
        this.post({ type: 'response', requestId, ok: true, data: data ?? null })
      }
    } catch (err) {
      if (requestId) {
        this.post({
          type: 'response',
          requestId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}
