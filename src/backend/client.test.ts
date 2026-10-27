// Auth preflight tests for the backend HTTP client. A local HTTP server
// mimics the backend's auth dependency (empty bearer -> 401) and records
// the headers each request actually carried, so we can prove the client's
// missing-token guard fires BEFORE anything hits the wire.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as http from 'http'
import { ApiError, BackendClient } from './client'

interface RecordedRequest {
  method: string
  url: string
  auth: string
  contentType: string
}

const recorded: RecordedRequest[] = []

let server: http.Server
let baseUrl = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      const auth = (req.headers['authorization'] as string) ?? ''
      recorded.push({
        method: req.method ?? '',
        url: req.url ?? '',
        auth,
        contentType: (req.headers['content-type'] as string) ?? '',
      })
      // Mimic the backend's auth dependency: an empty bearer value is a
      // missing credential, not a valid one.
      const token = auth.startsWith('Bearer ') ? auth.slice(6).trim() : auth.trim()
      if (!token) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            error: {
              code: 'unauthorized',
              message: 'Authentication required',
              retryable: false,
            },
          }),
        )
        return
      }
      if (token !== 'valid-token') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            error: { code: 'unauthorized', message: 'Invalid token', retryable: false },
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

beforeEach(() => {
  recorded.length = 0
})

describe('backend mimics the auth dependency', () => {
  it('rejects an empty bearer value with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/config`, {
      headers: { Authorization: 'Bearer ' },
    })
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('unauthorized')
  })
})

describe('missing token preflight', () => {
  const blanks: [string, string][] = [
    ['empty', ''],
    ['whitespace-only', '   '],
    ['newline-only', '\n'],
  ]

  for (const [label, blank] of blanks) {
    it(`rejects a ${label} token before fetch for JSON requests`, async () => {
      const client = new BackendClient(baseUrl, blank)
      const err = await client.get('/config').catch((e) => e as ApiError)
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('missing_token')
      expect((err as ApiError).status).toBe(401)
      expect((err as ApiError).retryable).toBe(false)
      expect((err as ApiError).message).toContain('Claudio: Set Backend Token')
      expect(recorded).toHaveLength(0)
    })

    it(`rejects a ${label} token before fetch for streaming requests`, async () => {
      const client = new BackendClient(baseUrl, blank)
      const err = await client
        .raw('POST', '/chat/stream', { message: 'hi' })
        .catch((e) => e as ApiError)
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('missing_token')
      expect((err as ApiError).retryable).toBe(false)
      expect(recorded).toHaveLength(0)
    })

    it(`rejects a ${label} token before fetch for multipart uploads`, async () => {
      const client = new BackendClient(baseUrl, blank)
      const err = await client
        .upload('/files', new Uint8Array([1, 2, 3]), 'a.txt')
        .catch((e) => e as ApiError)
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('missing_token')
      expect((err as ApiError).retryable).toBe(false)
      expect(recorded).toHaveLength(0)
    })
  }
})

describe('token is sent on the wire', () => {
  it('sends the trimmed configured token for config loads', async () => {
    const client = new BackendClient(baseUrl, '  valid-token  ')
    await client.get('/config')
    expect(recorded).toHaveLength(1)
    expect(recorded[0].auth).toBe('Bearer valid-token')
  })

  it('uses updated credentials for JSON, streaming and multipart requests', async () => {
    const client = new BackendClient(baseUrl, '')
    client.token = 'valid-token'
    await client.get('/config')
    await client.raw('POST', '/chat/stream', { x: 1 })
    await client.upload('/files', new Uint8Array([1, 2]), 'f.txt')
    expect(recorded.map((r) => r.auth)).toEqual([
      'Bearer valid-token',
      'Bearer valid-token',
      'Bearer valid-token',
    ])
    expect(recorded[1].contentType).toBe('application/json')
    expect(recorded[2].contentType).toContain('multipart/form-data')
  })

  it('surfaces an invalid nonempty token as an unauthorized ApiError', async () => {
    const client = new BackendClient(baseUrl, 'wrong-token')
    const err = await client.get('/config').catch((e) => e as ApiError)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect((err as ApiError).code).toBe('unauthorized')
  })
})
