// Config bridge: get/put/validate/test/history/restore against the backend.
//
// The workspace is no longer re-asserted after a config write. It used to be,
// because the workspace lived in the shared config and any save could clobber
// it — but the workspace is now a property of a session, fixed at creation
// (see POST /sessions), so there is nothing here to keep in sync.

import type { BackendClient } from '../backend/client'
import type {
  ConfigHistoryEntry,
  ConfigResponse,
  LlmTestResult,
} from '../shared/types'

export class ConfigController {
  constructor(private client: BackendClient) {}

  async get(): Promise<ConfigResponse> {
    return this.client.get<ConfigResponse>('/config')
  }

  async put(patch: Record<string, unknown>): Promise<ConfigResponse> {
    return this.client.put<ConfigResponse>('/config', patch)
  }

  async validate(candidate: Record<string, unknown>): Promise<{ ok: boolean }> {
    return this.client.post<{ ok: boolean }>('/config/validate', candidate)
  }

  async llmTest(llm: Record<string, unknown>): Promise<LlmTestResult> {
    return this.client.post<LlmTestResult>('/config/llm/test', { llm })
  }

  async history(): Promise<ConfigHistoryEntry[]> {
    const res = await this.client.get<{ history: ConfigHistoryEntry[] }>(
      '/config/history',
    )
    return res.history ?? []
  }

  async restore(id: number): Promise<ConfigResponse> {
    return this.client.post<ConfigResponse>('/config/restore', { id })
  }
}
