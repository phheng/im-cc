/**
 * Core message bridge: routes incoming IM messages to Claude Code,
 * handles /commands, and manages per-user sessions.
 */
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import type { Config } from './config.js'
import type { Session, SessionManager } from './session.js'
import { runClaude } from './claude.js'
import { findSkill, listSkills } from './skill-loader.js'
import type { Adapter } from './adapters/base.js'

const HELP_TEXT = `
📋 *Claude Code via IM*

Send any message to run it in Claude Code.

*Commands:*
\`/new\`              Start a new conversation (clear session)
\`/cwd [path]\`       Show or change working directory
\`/model [name]\`     Show or set the Claude model for this session
\`/doctor\`           Run Claude Code diagnostics
\`/skills\`           List available skills
\`/<skill> [args]\`   Run a Claude Code skill
\`/info\`             Show current session info
\`/help\`             Show this help
`.trim()

export class Bridge {
  /** Per-user queue tail — ensures messages for the same user are processed serially. */
  private queues = new Map<string, Promise<void>>()

  constructor(
    private adapters: Adapter[],
    private sessions: SessionManager,
    private config: Config,
  ) {}

  /** Register message handlers on all adapters. Must be called before adapters are started. */
  start(): void {
    for (const adapter of this.adapters) {
      adapter.onMessage((userId, text) => {
        return this.enqueueForUser(userId, () => this.handleMessage(adapter.name, userId, text))
      })
    }
  }

  /**
   * Serialize tasks per-user: the next task for a given userId starts only after
   * the previous one resolves or rejects. Prevents concurrent Claude processes
   * for the same user from corrupting session IDs.
   */
  private enqueueForUser(userId: string, task: () => Promise<string>): Promise<string> {
    const prev = this.queues.get(userId) ?? Promise.resolve()
    // Run task regardless of whether prev resolved or rejected
    const resultP = prev.then(() => task(), () => task())
    // Store a void tail that never rejects (prevents unhandled-rejection on the queue chain)
    this.queues.set(userId, resultP.then(() => {}, () => {}))
    return resultP
  }

  private async handleMessage(platform: string, userId: string, text: string): Promise<string> {
    // Authorization check
    if (this.config.allowedUsers?.length) {
      if (!this.config.allowedUsers.includes(userId)) {
        return '⛔ You are not authorized to use this bot.'
      }
    }

    const session = this.sessions.getOrCreate(userId, platform)
    session.lastActivity = new Date()

    const trimmed = text.trim()
    if (trimmed.startsWith('/')) {
      return this.handleCommand(session, trimmed, this.config.claude.command)
    }

    return this.runClaude(session, trimmed)
  }

  private async runClaude(session: Session, message: string): Promise<string> {
    try {
      const result = await runClaude(message, session, this.config.claude)
      if (result.sessionId) {
        this.sessions.updateClaudeSession(session.userId, result.sessionId)
      }
      return result.text || '(no response)'
    } catch (err) {
      return `⚠️ ${(err as Error).message}`
    }
  }

  private async handleCommand(session: Session, text: string, claudeCmd: string): Promise<string> {
    const parts = text.split(/\s+/)
    const cmd = parts[0].toLowerCase()

    switch (cmd) {
      case '/new': {
        this.sessions.reset(session.userId)
        return '✓ Started a new conversation. Previous context cleared.'
      }

      case '/cwd': {
        if (parts.length < 2) {
          return `📁 Current directory: \`${session.cwd}\``
        }
        const arg = parts.slice(1).join(' ')
        const resolved = path.isAbsolute(arg)
          ? arg
          : path.resolve(session.cwd, arg)
        if (!fs.existsSync(resolved)) {
          return `⚠️ Directory not found: \`${resolved}\``
        }
        const stat = fs.statSync(resolved)
        if (!stat.isDirectory()) {
          return `⚠️ Not a directory: \`${resolved}\``
        }
        this.sessions.updateCwd(session.userId, resolved)
        // Reset Claude session so next turn starts fresh in new directory
        this.sessions.reset(session.userId)
        return `✓ Working directory changed to:\n\`${resolved}\`\nConversation reset.`
      }

      case '/model': {
        if (parts.length < 2) {
          const current = session.modelOverride ?? this.config.claude.model ?? 'default'
          return `🤖 Current model: \`${current}\`\nUsage: \`/model <name>\`\nExamples: \`claude-opus-4-5\`, \`claude-sonnet-4-5\`, \`claude-haiku-4-5\``
        }
        const model = parts[1].trim()
        this.sessions.setModelOverride(session.userId, model)
        // Reset conversation so the new model takes effect cleanly
        this.sessions.reset(session.userId)
        return `✓ Model set to \`${model}\`. Conversation reset.`
      }

      case '/doctor': {
        return runDoctor(claudeCmd)
      }

      case '/info': {
        const model = session.modelOverride ?? this.config.claude.model ?? 'default'
        const lines = [
          `👤 User:    \`${session.userId}\``,
          `📁 CWD:     \`${session.cwd}\``,
          `🤖 Model:   \`${model}\``,
          `🔗 Session: \`${session.claudeSessionId ?? 'none (new conversation)'}\``,
          `⏰ Active:  ${session.lastActivity.toLocaleString()}`,
        ]
        return lines.join('\n')
      }

      case '/skills': {
        const names = listSkills(session.cwd)
        if (names.length === 0) return '(no skills found in ~/.claude/skills/ or .claude/skills/)'
        return `📦 Available skills:\n${names.map((n) => `  /${n}`).join('\n')}`
      }

      case '/help':
        return HELP_TEXT

      default: {
        // Try to load a Claude Code skill with this name
        const skillName = cmd.slice(1)  // strip leading /
        const skill = findSkill(skillName, session.cwd)
        if (!skill) {
          return `⚠️ Unknown command: \`${cmd}\`\n\nType \`/skills\` to list available skills.\n\n${HELP_TEXT}`
        }
        // Append any arguments the user passed after the skill name
        const args = parts.slice(1).join(' ')
        const prompt = args ? `${skill.content}\n\n${args}` : skill.content
        return this.runClaude(session, prompt)
      }
    }
  }
}

/** Run `claude doctor` and return its output as a string. */
function runDoctor(claudeCmd: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(claudeCmd, ['doctor'], { timeout: 30_000 })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('close', () => {
      const combined = (out + err).trim()
      resolve(combined || '(no output from claude doctor)')
    })
    proc.on('error', (e) => {
      resolve(`⚠️ Failed to run claude doctor: ${e.message}`)
    })
  })
}
