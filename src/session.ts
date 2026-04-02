export interface Session {
  /** Unique user key, e.g. "telegram:123456789" */
  userId: string
  /** Platform name: "telegram" | "feishu" | "wechat" */
  platform: string
  /** Working directory for this session */
  cwd: string
  /** Claude Code session ID for --resume (multi-turn) */
  claudeSessionId?: string
  /** Per-session model override — takes precedence over config.claude.model */
  modelOverride?: string
  lastActivity: Date
}

export class SessionManager {
  private sessions = new Map<string, Session>()

  constructor(private defaultCwd: string) {}

  get(userId: string): Session | undefined {
    return this.sessions.get(userId)
  }

  getOrCreate(userId: string, platform: string): Session {
    let s = this.sessions.get(userId)
    if (!s) {
      s = {
        userId,
        platform,
        cwd: this.defaultCwd,
        lastActivity: new Date(),
      }
      this.sessions.set(userId, s)
    }
    return s
  }

  updateClaudeSession(userId: string, claudeSessionId: string): void {
    const s = this.sessions.get(userId)
    if (s) s.claudeSessionId = claudeSessionId
  }

  updateCwd(userId: string, cwd: string): void {
    const s = this.sessions.get(userId)
    if (s) s.cwd = cwd
  }

  setModelOverride(userId: string, model: string | undefined): void {
    const s = this.sessions.get(userId)
    if (s) s.modelOverride = model
  }

  /** Reset conversation (keep cwd and modelOverride, clear Claude session ID) */
  reset(userId: string): void {
    const s = this.sessions.get(userId)
    if (s) {
      s.claudeSessionId = undefined
      s.lastActivity = new Date()
    }
  }

  list(): Session[] {
    return Array.from(this.sessions.values())
  }
}
