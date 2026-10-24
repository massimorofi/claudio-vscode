// Webview-side bridge client: postMessage wrappers + request/response
// correlation. The host owns the backend; every backend call from the webview
// goes through a request/response pair here.

import type { HostToWebview, WebviewToHost } from '../../../src/bridge/protocol'
import { newRequestId } from '../../../src/bridge/protocol'

interface VscodeApi {
  postMessage(message: unknown): void
  getState<T = unknown>(): T | undefined
  setState<T = unknown>(state: T): void
}

declare function acquireVsCodeApi(): VscodeApi

const vscode: VscodeApi = acquireVsCodeApi()

type Listener = (msg: HostToWebview) => void

const listeners = new Set<Listener>()
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>()

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as HostToWebview
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'response') {
    const p = pending.get(msg.requestId)
    if (p) {
      pending.delete(msg.requestId)
      if (msg.ok) p.resolve(msg.data)
      else p.reject(new Error(msg.error ?? 'Request failed'))
    }
    return
  }
  for (const fn of listeners) {
    try {
      fn(msg)
    } catch {
      /* a listener throwing must not break the others */
    }
  }
})

export const bridge = {
  /** Fire-and-forget host-bound message. */
  post(msg: WebviewToHost): void {
    vscode.postMessage(msg)
  },

  /** Subscribe to host→webview messages. Returns an unsubscribe fn. */
  on(fn: Listener): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },

  /** Send a request and await the correlated response. */
  request<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
    const requestId = newRequestId()
    return new Promise<T>((resolve, reject) => {
      pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject })
      vscode.postMessage({ type, requestId, ...(payload ?? {}) })
    })
  },
}
