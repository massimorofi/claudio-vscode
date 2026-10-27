// Authentication wiring tests: fresh-install prompting, token reload on
// setting / secret changes, and the set-token command behavior. VS Code,
// the supervisor, the bridge and the dependent extension components are
// mocked; the BackendClient and ConfigController stay real so token
// behavior is exercised end-to-end against a local HTTP server.

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import * as http from 'http'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  secretsThrow: false,
  commands: {} as Record<string, (...args: any[]) => any>,
  configListeners: [] as any[],
  bridges: [] as any[],
  info: [] as string[],
  warn: [] as string[],
  error: [] as string[],
  inputQueue: [] as (string | undefined)[],
  warnQueue: [] as (string | undefined)[],
  sessionCalls: 0,
}))

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: (section: string) => ({
      get: (key: string, def?: unknown) => {
        const full = `${section}.${key}`
        return full in h.settings ? h.settings[full] : def
      },
    }),
    onDidChangeConfiguration: (cb: any) => {
      h.configListeners.push(cb)
      return { dispose: () => {} }
    },
    onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
    findFiles: async () => [],
    asRelativePath: (p: string) => p,
  },
  window: {
    showInputBox: async () => h.inputQueue.shift(),
    showInformationMessage: async (msg: string) => {
      h.info.push(msg)
      return undefined
    },
    showWarningMessage: async (msg: string) => {
      h.warn.push(msg)
      return h.warnQueue.shift()
    },
    showErrorMessage: async (msg: string) => {
      h.error.push(msg)
    },
    registerWebviewViewProvider: () => ({ dispose: () => {} }),
  },
  commands: {
    registerCommand: (id: string, cb: any) => {
      h.commands[id] = cb
      return { dispose: () => {} }
    },
    executeCommand: async () => undefined,
  },
  Uri: {
    file: (p: string) => ({ fsPath: p }),
    joinPath: (...parts: any[]) => ({
      fsPath: parts.map((p) => (typeof p === 'string' ? p : p.fsPath)).join('/'),
    }),
  },
}))

vi.mock('./backend/supervisor', () => ({
  BackendSupervisor: class {
    ensureRunning = vi.fn(async () => {})
    health = vi.fn(async () => ({ ok: true }))
    stop = vi.fn(async () => {})
  },
}))

vi.mock('./bridge/Bridge', () => ({
  Bridge: class {
    handlers = new Map<string, (msg: any) => Promise<any>>()
    posted: any[] = []
    constructor() {
      h.bridges.push(this)
    }
    on(type: string, handler: (msg: any) => Promise<any>) {
      this.handlers.set(type, handler)
    }
    post(msg: any) {
      this.posted.push(msg)
    }
    attach() {}
    detach() {}
  },
}))

vi.mock('./chat/ChatController', () => ({
  ChatController: class {
    isStreaming = false
    currentSessionId: string | null = null
    currentRunId: string | null = null
    cost = 0
    contextPercent = 0
    setWorkspaceRoot = vi.fn()
    newSession = vi.fn()
    setSessionId = vi.fn()
    send = vi.fn(async () => {})
    stop = vi.fn(async () => {})
    resumeRun = vi.fn(async () => {})
    setApprovalMode = vi.fn()
  },
}))

vi.mock('./chat/approvals', () => ({
  decideApproval: vi.fn(async () => ({ ok: true })),
  listPendingApprovals: vi.fn(async () => []),
}))

vi.mock('./chat/initState', () => ({
  computeInitState: vi.fn(async () => ({
    workspace: '/tmp/ws',
    approvalMode: 'on_request',
    connected: true,
    running: false,
    runId: null,
    sessionId: null,
    pendingApproval: null,
    shouldResume: false,
  })),
}))

vi.mock('./status/StatusBar', () => ({
  StatusBar: class {
    update = vi.fn()
    dispose = vi.fn()
  },
}))

vi.mock('./workspace/binding', () => ({
  createSessionForWorkspace: vi.fn(async () => {
    h.sessionCalls += 1
    return { id: 'sess-1' }
  }),
  primaryWorkspaceFolder: vi.fn(() => ({ uri: { fsPath: '/tmp/ws' } })),
}))

vi.mock('./workspace/selection', () => ({
  getActiveSelection: vi.fn(() => null),
}))

vi.mock('./workspace/files', () => ({
  openFile: vi.fn(async () => {}),
}))

import { activate } from './extension'
import { ApiError } from './backend/client'

const TOKEN_KEY = 'claudio.backend.token'

const recorded: { auth: string }[] = []

let server: http.Server
let baseUrl = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      const auth = (req.headers['authorization'] as string) ?? ''
      recorded.push({ auth })
      const token = auth.startsWith('Bearer ') ? auth.slice(6).trim() : auth.trim()
      if (!token) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            error: { code: 'unauthorized', message: 'Authentication required', retryable: false },
          }),
        )
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ config: { ok: true } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  )
})

function makeContext() {
  const store: Record<string, string> = {}
  const secretListeners: ((e: { key: string }) => void)[] = []
  return {
    extensionUri: { fsPath: '/tmp/ext' },
    subscriptions: [] as any[],
    secrets: {
      async get(key: string) {
        if (h.secretsThrow) throw new Error('keychain unavailable')
        return store[key]
      },
      async store(key: string, value: string) {
        store[key] = value
      },
      async delete(key: string) {
        delete store[key]
      },
      onDidChange(cb: (e: { key: string }) => void) {
        secretListeners.push(cb)
        return { dispose: () => {} }
      },
    },
    store,
    fire: (key: string) => secretListeners.forEach((l) => l({ key })),
  }
}

beforeEach(() => {
  h.settings = {}
  h.secretsThrow = false
  h.commands = {}
  h.configListeners = []
  h.bridges = []
  h.info = []
  h.warn = []
  h.error = []
  h.inputQueue = []
  h.warnQueue = []
  h.sessionCalls = 0
  recorded.length = 0
})

describe('fresh install token prompt', () => {
  it('prompts for a token and does not start a session when declined', async () => {
    h.warnQueue = [undefined]
    const ctx = makeContext()
    await activate(ctx as never)
    await vi.waitFor(() => expect(h.warn).toHaveLength(1))
    expect(h.warn[0]).toContain('no backend token')
    expect(h.sessionCalls).toBe(0)
  })

  it('config requests without a token fail locally', async () => {
    const ctx = makeContext()
    await activate(ctx as never)
    const bridge = h.bridges[0]
    const err = await bridge.handlers.get('config.get')().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('missing_token')
    expect(recorded).toHaveLength(0)
  })
})

describe('token reload without activation', () => {
  it('reloads the backend url and token on claudio config changes', async () => {
    const ctx = makeContext()
    await activate(ctx as never)
    h.settings['claudio.backend.url'] = baseUrl
    h.settings[TOKEN_KEY] = 'fallback-1'
    h.configListeners.forEach((l) => l({ affectsConfiguration: () => true }))
    const bridge = h.bridges[0]
    await vi.waitFor(async () => {
      await bridge.handlers.get('config.get')()
      expect(recorded[recorded.length - 1].auth).toBe('Bearer fallback-1')
    })
  })

  it('reloads the token when the matching secret changes', async () => {
    h.settings['claudio.backend.url'] = baseUrl
    const ctx = makeContext()
    await activate(ctx as never)
    ctx.store[TOKEN_KEY] = 'secret-1'
    ctx.fire(TOKEN_KEY)
    const bridge = h.bridges[0]
    await vi.waitFor(async () => {
      await bridge.handlers.get('config.get')()
      expect(recorded[recorded.length - 1].auth).toBe('Bearer secret-1')
    })
  })

  it('uses the settings fallback immediately when the secret is cleared', async () => {
    h.settings['claudio.backend.url'] = baseUrl
    h.settings[TOKEN_KEY] = 'fb'
    const ctx = makeContext()
    ctx.store[TOKEN_KEY] = 'secret-1'
    await activate(ctx as never)
    delete ctx.store[TOKEN_KEY]
    ctx.fire(TOKEN_KEY)
    const bridge = h.bridges[0]
    await vi.waitFor(async () => {
      await bridge.handlers.get('config.get')()
      expect(recorded[recorded.length - 1].auth).toBe('Bearer fb')
    })
  })

  it('ignores unrelated secret-change events', async () => {
    const ctx = makeContext()
    await activate(ctx as never)
    ctx.fire('some.other.secret')
    const bridge = h.bridges[0]
    const err = await bridge.handlers.get('config.get')().catch((e: unknown) => e)
    expect((err as ApiError).code).toBe('missing_token')
  })

  it('shows an error when the secret storage read fails', async () => {
    const ctx = makeContext()
    await activate(ctx as never)
    h.secretsThrow = true
    ctx.fire(TOKEN_KEY)
    await vi.waitFor(() => expect(h.error.length).toBeGreaterThan(0))
    expect(h.error[0]).toContain('token')
  })
})

describe('set token command', () => {
  it('saves the token, updates the client and ensures a session', async () => {
    h.settings['claudio.backend.url'] = baseUrl
    const ctx = makeContext()
    await activate(ctx as never)
    h.inputQueue = ['tok-9']
    await h.commands['claudio.setToken']()
    expect(h.info).toContain('Claudio: backend token saved.')
    const bridge = h.bridges[0]
    await bridge.handlers.get('config.get')()
    expect(recorded[recorded.length - 1].auth).toBe('Bearer tok-9')
    expect(h.sessionCalls).toBeGreaterThan(0)
  })

  it('cancelling token entry leaves requests blocked', async () => {
    const ctx = makeContext()
    await activate(ctx as never)
    h.inputQueue = [undefined]
    await h.commands['claudio.setToken']()
    const bridge = h.bridges[0]
    const err = await bridge.handlers.get('config.get')().catch((e: unknown) => e)
    expect((err as ApiError).code).toBe('missing_token')
  })

  it('blank input clears the secret and uses the configured fallback', async () => {
    h.settings['claudio.backend.url'] = baseUrl
    h.settings[TOKEN_KEY] = 'fb'
    const ctx = makeContext()
    ctx.store[TOKEN_KEY] = 'old'
    await activate(ctx as never)
    h.inputQueue = ['']
    await h.commands['claudio.setToken']()
    expect(ctx.store[TOKEN_KEY]).toBeUndefined()
    const bridge = h.bridges[0]
    await bridge.handlers.get('config.get')()
    expect(recorded[recorded.length - 1].auth).toBe('Bearer fb')
  })
})
