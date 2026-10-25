import { describe, it, expect, vi } from 'vitest'

// ChatController touches the vscode API (notifications) at runtime; stub it so
// the controller can be exercised in a plain Node test.
vi.mock('vscode', () => ({
  window: {
    showErrorMessage: () => undefined,
    showInformationMessage: () => undefined,
  },
  Uri: { file: (p: string) => p },
  workspace: {},
  commands: { executeCommand: () => undefined },
}))

import { ChatController } from './ChatController'

describe('ChatController.resumeRun', () => {
  it('throws when a run is already streaming', async () => {
    // A stream that never ends keeps the controller in the streaming state.
    const hanging = {
      raw: () => new Promise<Response>(() => {}),
      post: async () => ({}),
    } as never
    const c = new ChatController(hanging, '/ws', 'on_request')
    void c.resumeRun('run-1')
    await expect(c.resumeRun('run-2')).rejects.toThrow(/already in progress/)
  })

  it('resets streaming and runId and emits idle when the resume fails', async () => {
    const res = { ok: false, status: 404 } as Response
    const client = {
      raw: async () => res,
      post: async () => ({}),
    } as never
    const states: string[] = []
    const c = new ChatController(client, '/ws', 'on_request', {
      onState: (s) => states.push(s),
    })
    await expect(c.resumeRun('run-x')).rejects.toThrow()
    expect(c.isStreaming).toBe(false)
    expect(c.currentRunId).toBe(null)
    expect(states).toContain('idle')
  })
})

describe('ChatController.setSessionId', () => {
  it('updates the current session id', () => {
    const c = new ChatController({} as never, '/ws', 'on_request')
    c.setSessionId('sess-5')
    expect(c.currentSessionId).toBe('sess-5')
    c.setSessionId(null)
    expect(c.currentSessionId).toBe(null)
  })
})
