// Token normalization, precedence and the filtered secret-change
// subscription. The vscode module is mocked with a plain settings map and a
// fake secret store.

import { describe, it, expect, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
}))

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: (section: string) => ({
      get: (key: string, def?: unknown) => {
        const full = `${section}.${key}`
        return full in state.settings ? state.settings[full] : def
      },
    }),
  },
}))

import { getToken, setToken, onDidChangeToken } from './settings'

const TOKEN_KEY = 'claudio.backend.token'

function makeContext(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial }
  const listeners: ((e: { key: string }) => void)[] = []
  return {
    secrets: {
      async get(key: string) {
        return store[key]
      },
      async store(key: string, value: string) {
        store[key] = value
      },
      async delete(key: string) {
        delete store[key]
      },
      onDidChange(cb: (e: { key: string }) => void) {
        listeners.push(cb)
        return { dispose: () => {} }
      },
    },
    store,
    fire: (key: string) => listeners.forEach((l) => l({ key })),
  }
}

describe('getToken', () => {
  it('prefers a nonempty secret over the settings fallback', async () => {
    state.settings = { [TOKEN_KEY]: 'fallback' }
    const ctx = makeContext({ [TOKEN_KEY]: 'secret' })
    expect(await getToken(ctx as never)).toBe('secret')
  })

  it('trims the secret value', async () => {
    state.settings = {}
    const ctx = makeContext({ [TOKEN_KEY]: '  spaced  ' })
    expect(await getToken(ctx as never)).toBe('spaced')
  })

  it('falls back to the trimmed setting when the secret is absent', async () => {
    state.settings = { [TOKEN_KEY]: '  fallback  ' }
    const ctx = makeContext()
    expect(await getToken(ctx as never)).toBe('fallback')
  })

  it('falls back to the setting when the secret is blank', async () => {
    state.settings = { [TOKEN_KEY]: 'fallback' }
    const ctx = makeContext({ [TOKEN_KEY]: '   ' })
    expect(await getToken(ctx as never)).toBe('fallback')
  })

  it('returns an empty string when nothing is configured', async () => {
    state.settings = {}
    const ctx = makeContext()
    expect(await getToken(ctx as never)).toBe('')
  })
})

describe('setToken', () => {
  it('stores the trimmed token', async () => {
    const ctx = makeContext()
    await setToken(ctx as never, '  tok  ')
    expect(ctx.store[TOKEN_KEY]).toBe('tok')
  })

  it('deletes the secret for blank input', async () => {
    const ctx = makeContext({ [TOKEN_KEY]: 'old' })
    await setToken(ctx as never, '')
    expect(TOKEN_KEY in ctx.store).toBe(false)
  })

  it('clears a whitespace-only token and restores the fallback', async () => {
    state.settings = { [TOKEN_KEY]: 'fallback' }
    const ctx = makeContext({ [TOKEN_KEY]: 'old' })
    await setToken(ctx as never, '   ')
    expect(TOKEN_KEY in ctx.store).toBe(false)
    expect(await getToken(ctx as never)).toBe('fallback')
  })
})

describe('onDidChangeToken', () => {
  it('ignores unrelated secrets and fires only for the claudio token key', () => {
    const ctx = makeContext()
    const calls: number[] = []
    onDidChangeToken(ctx as never, () => calls.push(1))
    ctx.fire('some.other.secret')
    expect(calls).toHaveLength(0)
    ctx.fire(TOKEN_KEY)
    expect(calls).toHaveLength(1)
  })
})
