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

describe('ChatController session renaming', () => {
  // A stream that immediately completes the run.
  const completedStream = () =>
    new Response(
      'id: 1\nevent: run_completed\ndata: {"usage":{"cost_usd":0}}\n\n',
      { status: 200 },
    )

  function makeClient() {
    const patches: Array<{ path: string; body: unknown }> = []
    const client = {
      raw: async () => completedStream(),
      post: async () => ({}),
      patch: async (path: string, body: unknown) => {
        patches.push({ path, body })
        return {}
      },
    }
    return { client, patches }
  }

  it('renames a pre-created (empty) session from the first message', async () => {
    const { client, patches } = makeClient()
    const renamed: Array<[string, string]> = []
    const c = new ChatController(client as never, '/ws', 'on_request', {
      onSessionRenamed: (id, t) => renamed.push([id, t]),
    })
    c.setSessionId('sess-1')
    await c.send('fix the login bug please')
    expect(patches).toHaveLength(1)
    expect(patches[0].path).toBe('/sessions/sess-1')
    expect((patches[0].body as { title: string }).title).toBe('fix the login bug please')
    expect(renamed).toEqual([['sess-1', 'fix the login bug please']])
  })

  it('does not rename a session that already has messages', async () => {
    const { client, patches } = makeClient()
    const c = new ChatController(client as never, '/ws', 'on_request')
    c.setSessionId('sess-1', true)
    await c.send('second message')
    expect(patches).toHaveLength(0)
  })

  it('does not rename again on subsequent messages', async () => {
    const { client, patches } = makeClient()
    const c = new ChatController(client as never, '/ws', 'on_request')
    c.setSessionId('sess-1')
    await c.send('first message')
    await c.send('second message')
    expect(patches).toHaveLength(1)
  })

  it('does not rename when no session is selected (backend names it)', async () => {
    const { client, patches } = makeClient()
    const c = new ChatController(client as never, '/ws', 'on_request')
    c.newSession()
    await c.send('hello')
    expect(patches).toHaveLength(0)
  })

  it('truncates the title to 60 characters', async () => {
    const { client, patches } = makeClient()
    const c = new ChatController(client as never, '/ws', 'on_request')
    c.setSessionId('sess-1')
    await c.send('x'.repeat(100))
    expect((patches[0].body as { title: string }).title).toHaveLength(60)
  })

  it('still sends the chat when the rename fails', async () => {
    const client = {
      raw: async () => completedStream(),
      post: async () => ({}),
      patch: async () => {
        throw new Error('boom')
      },
    }
    const c = new ChatController(client as never, '/ws', 'on_request')
    c.setSessionId('sess-1')
    await c.send('hello')
    expect(c.isStreaming).toBe(false)
  })
})
