export interface PendingApproval {
  /** The original user message that triggered the permission wall */
  originalMessage: string
}

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
  /** Set when Claude hits a permission wall; cleared after /allow or /deny */
  pendingApproval?: PendingApproval
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

  setPendingApproval(userId: string, originalMessage: string): void {
    const s = this.sessions.get(userId)
    if (s) s.pendingApproval = { originalMessage }
  }

  clearPendingApproval(userId: string): void {
    const s = this.sessions.get(userId)
    if (s) s.pendingApproval = undefined
  }

  getPendingApproval(userId: string): PendingApproval | undefined {
    return this.sessions.get(userId)?.pendingApproval
  }

  /** Reset conversation (keep cwd and modelOverride, clear Claude session ID and pending approval) */
  reset(userId: string): void {
    const s = this.sessions.get(userId)
    if (s) {
      s.claudeSessionId = undefined
      s.pendingApproval = undefined
      s.lastActivity = new Date()
    }
  }

  list(): Session[] {
    return Array.from(this.sessions.values())
  }
}
