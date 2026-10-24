// Config bridge: get/put/validate/test/history/restore against the backend,
// with the workspace binding re-asserted after any save that could have
// changed the agent's workspace_dir.

import * as vscode from 'vscode'
import type { BackendClient } from '../backend/client'
import type {
  ConfigHistoryEntry,
  ConfigResponse,
  LlmTestResult,
} from '../shared/types'
import { bindWorkspaceToBackend } from '../workspace/binding'

export class ConfigController {
  constructor(
    private client: BackendClient,
    private getWorkspaceFolder: () => vscode.WorkspaceFolder | undefined,
  ) {}

  async get(): Promise<ConfigResponse> {
    return this.client.get<ConfigResponse>('/config')
  }

  async put(patch: Record<string, unknown>): Promise<ConfigResponse> {
    const res = await this.client.put<ConfigResponse>('/config', patch)
    await this.rebindWorkspace()
    return res
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
    const res = await this.client.post<ConfigResponse>('/config/restore', { id })
    await this.rebindWorkspace()
    return res
  }

  /** Re-assert the VS Code folder as the backend workspace after a config write. */
  private async rebindWorkspace(): Promise<void> {
    const folder = this.getWorkspaceFolder()
    if (!folder) return
    try {
      await bindWorkspaceToBackend(this.client, folder)
    } catch {
      // Non-fatal: the next bind (on folder change / reconnect) will fix it.
    }
  }
}
