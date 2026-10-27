// Typed HTTP client for the claudio-backend API (Node 20 native fetch).
// Mirrors the SPA's api/client.ts: Bearer auth + error-envelope unwrapping.

import type { ErrorEnvelope } from '../shared/types'

export class ApiError extends Error {
  status: number
  code: string
  retryable: boolean
  details?: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    message: string,
    retryable = false,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

const API_PREFIX = '/api/v1'

/**
 * Build the Authorization header from the current token. A missing or
 * whitespace-only token is rejected here, before any request leaves the
 * extension, with an actionable error instead of a confusing 401 from the
 * backend. Nonempty-but-invalid tokens are NOT checked here: they reach the
 * backend and surface as ordinary unauthorized API errors.
 */
function authHeader(token: string): { Authorization: string } {
  const trimmed = (token ?? '').trim()
  if (!trimmed) {
    throw new ApiError(
      401,
      'missing_token',
      'No backend token configured. Run "Claudio: Set Backend Token" and enter the token configured on the backend.',
      false,
    )
  }
  return { Authorization: `Bearer ${trimmed}` }
}

export class BackendClient {
  baseUrl: string
  token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.token = token
  }

  private url(path: string): string {
    return `${this.baseUrl}${API_PREFIX}${path}`
  }

  /** Low-level request that returns the raw Response (for SSE streaming). */
  async raw(
    method: string,
    path: string,
    body?: unknown,
    opts: { signal?: AbortSignal; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    // Auth header is built AFTER caller-provided headers so a supplied
    // header can never replace the configured backend credential.
    const headers: Record<string, string> = {
      ...opts.headers,
      ...authHeader(this.token),
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    let res: Response
    try {
      res = await fetch(this.url(path), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: opts.signal,
      })
    } catch (e) {
      throw new ApiError(
        0,
        'network_error',
        `Cannot reach backend at ${this.baseUrl}: ${(e as Error).message}`,
        true,
      )
    }
    return res
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const res = await this.raw(method, path, body, opts)
    const text = await res.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }
    if (!res.ok) {
      const env = parsed as ErrorEnvelope | null
      const err = env?.error
      throw new ApiError(
        res.status,
        err?.code ?? `http_${res.status}`,
        err?.message ?? res.statusText ?? 'Request failed',
        err?.retryable ?? res.status >= 500,
        err?.details,
      )
    }
    return parsed as T
  }

  get<T>(path: string, opts?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>('GET', path, undefined, opts)
  }

  post<T>(path: string, body?: unknown, opts?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>('POST', path, body ?? {}, opts)
  }

  put<T>(path: string, body?: unknown, opts?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>('PUT', path, body ?? {}, opts)
  }

  delete<T>(path: string, opts?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>('DELETE', path, undefined, opts)
  }

  /** Multipart file upload (chat attachments). */
  async upload<T>(path: string, data: Uint8Array, filename: string): Promise<T> {
    // Built outside the try so a missing-token error is not swallowed and
    // misreported as a network failure.
    const auth = authHeader(this.token)
    const form = new FormData()
    const blob = new Blob([data as unknown as BlobPart])
    form.append('file', blob, filename)
    let res: Response
    try {
      res = await fetch(this.url(path), {
        method: 'POST',
        headers: auth,
        body: form,
      })
    } catch (e) {
      throw new ApiError(
        0,
        'network_error',
        `Cannot reach backend at ${this.baseUrl}: ${(e as Error).message}`,
        true,
      )
    }
    const text = await res.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }
    if (!res.ok) {
      const env = parsed as ErrorEnvelope | null
      const err = env?.error
      throw new ApiError(
        res.status,
        err?.code ?? `http_${res.status}`,
        err?.message ?? 'Upload failed',
        err?.retryable ?? res.status >= 500,
        err?.details,
      )
    }
    return parsed as T
  }
}
