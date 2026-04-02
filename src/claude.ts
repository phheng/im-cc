/**
 * Claude Code integration via `claude -p --output-format stream-json`.
 *
 * Uses the installed `claude` CLI in print mode with structured JSON output.
 * Multi-turn conversation is maintained via `--resume <session_id>`.
 * This avoids the complexity of raw PTY while fully reusing the installed binary.
 */
import { spawn } from 'child_process'
import { createInterface } from 'readline'
import type { ClaudeConfig } from './config.js'
import type { Session } from './session.js'

export interface PermissionDenial {
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
}

export interface RunResult {
  text: string
  sessionId?: string
  permissionDenials?: PermissionDenial[]
}

interface StreamEvent {
  type: string
  session_id?: string
  result?: string
  is_error?: boolean
  permission_denials?: PermissionDenial[]
  message?: {
    content: Array<{ type: string; text: string }>
  }
}

export function runClaude(
  message: string,
  session: Session,
  config: ClaudeConfig,
  overrides?: { skipPermissions?: boolean },
): Promise<RunResult> {
  const args: string[] = [
    '-p', message,
    '--output-format', 'stream-json',
    '--verbose',
  ]

  const model = session.modelOverride ?? config.model
  if (model) args.push('--model', model)
  if (config.systemPrompt) args.push('--append-system-prompt', config.systemPrompt)
  if (overrides?.skipPermissions ?? config.skipPermissions) args.push('--dangerously-skip-permissions')
  if (session.claudeSessionId) args.push('--resume', session.claudeSessionId)
  if (config.extraArgs?.length) args.push(...config.extraArgs)

  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (!settled) { settled = true; fn() }
    }

    const proc = spawn(config.command, args, {
      cwd: session.cwd,
      env: process.env,
    })

    let result = ''
    let newSessionId: string | undefined
    let permissionDenials: PermissionDenial[] | undefined
    const assistantTexts: string[] = []

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!line.trim()) return
      try {
        const event: StreamEvent = JSON.parse(line)
        if (event.session_id) newSessionId = event.session_id

        if (event.type === 'result') {
          if (event.is_error) {
            settle(() => reject(new Error(event.result ?? 'Claude returned an error')))
          } else {
            result = event.result ?? ''
            if (event.permission_denials?.length) {
              permissionDenials = event.permission_denials
            }
          }
        } else if (event.type === 'assistant' && event.message) {
          for (const c of event.message.content) {
            if (c.type === 'text' && c.text) assistantTexts.push(c.text)
          }
        }
      } catch {
        // non-JSON diagnostic lines — ignore
      }
    })

    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      rl.close()
      // Fallback: if result event was empty, join assistant text chunks
      if (!result && assistantTexts.length) result = assistantTexts.join('')
      settle(() => {
        if (!result && code !== 0) {
          reject(new Error(stderr.trim() || `claude exited with code ${code}`))
        } else {
          resolve({ text: result.trim(), sessionId: newSessionId, permissionDenials })
        }
      })
    })

    proc.on('error', (err) => {
      settle(() => reject(new Error(`Failed to start claude: ${err.message}`)))
    })
  })
}
