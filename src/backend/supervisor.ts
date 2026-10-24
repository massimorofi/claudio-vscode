// Backend daemon supervision: health checks, auto-start, stop.
//
// The daemon itself is managed by the repo's backend-start.sh / backend-stop.sh
// (uvicorn + pid file + health polling). The extension shells out to those so
// there is exactly one way to start/stop the backend, whether from a terminal
// or from VS Code.

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export interface SupervisorOptions {
  baseUrl: string
  repoPath: string
  autoStart: boolean
}

export class BackendSupervisor {
  private baseUrl: string
  private repoPath: string
  private autoStart: boolean
  private startingPromise: Promise<void> | null = null

  constructor(opts: SupervisorOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.repoPath = opts.repoPath
    this.autoStart = opts.autoStart
  }

  /** Liveness probe against the root /healthz (no auth required). */
  async health(timeoutMs = 2000): Promise<boolean> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}/healthz`, { signal: ctrl.signal })
      return res.ok
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Ensure the backend is up. If it is down and autoStart is enabled, spawn
   * the daemon and wait for it to become healthy. Safe to call concurrently —
   * a single start is shared.
   */
  async ensureRunning(): Promise<void> {
    if (await this.health()) return
    if (!this.autoStart) {
      throw new Error(
        'Claudio backend is not running. Start it with backend-start.sh, or enable claudio.backend.autoStart.',
      )
    }
    if (this.startingPromise) return this.startingPromise
    this.startingPromise = this.startDaemon().finally(() => {
      this.startingPromise = null
    })
    return this.startingPromise
  }

  private async startDaemon(): Promise<void> {
    const script = path.join(this.repoPath, 'backend-start.sh')
    if (!this.repoPath || !fs.existsSync(script)) {
      throw new Error(
        `backend-start.sh not found. Set "claudio.backend.path" to the claudio repo root (the folder containing backend-start.sh).`,
      )
    }
    const child = spawn('bash', [script], {
      cwd: this.repoPath,
      stdio: 'ignore',
      detached: true,
    })
    child.on('error', () => {
      /* surfaced via the readiness wait below */
    })
    child.unref()
    await this.waitForReady(30000)
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await this.health(1500)) return
      await new Promise((r) => setTimeout(r, 500))
    }
    throw new Error(
      `Claudio backend did not become healthy within ${Math.round(timeoutMs / 1000)}s. Check ${path.join(
        this.repoPath,
        'claudio-backend/data/logs/backend.log',
      )}.`,
    )
  }

  async stop(): Promise<void> {
    const script = path.join(this.repoPath, 'backend-stop.sh')
    if (!this.repoPath || !fs.existsSync(script)) {
      throw new Error(
        'backend-stop.sh not found. Set "claudio.backend.path" to the claudio repo root.',
      )
    }
    const child = spawn('bash', [script], {
      cwd: this.repoPath,
      stdio: 'ignore',
      detached: true,
    })
    child.unref()
  }
}
