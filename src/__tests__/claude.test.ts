/**
 * Tests for the stream-json parser in claude.ts.
 *
 * We test the parsing logic by simulating what the claude CLI emits over stdout,
 * using a child_process mock so no real subprocess is spawned.
 */
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

// We test the output parsing by importing runClaude and providing a mock spawn.
// Since runClaude uses `spawn` internally, we mock the child_process module.
vi.mock('child_process', () => {
  const { EventEmitter } = require('events')
  const { Readable } = require('stream')

  function makeProc(lines: string[], exitCode = 0) {
    const stdout = Readable.from(lines.map((l) => l + '\n'))
    const stderr = Readable.from([])
    const proc = new EventEmitter() as any
    proc.stdout = stdout
    proc.stderr = stderr
    // Emit close asynchronously after lines
    setImmediate(() => proc.emit('close', exitCode))
    return proc
  }

  return {
    spawn: vi.fn((cmd: string, args: string[]) => {
      // Controlled via __setLines helper
      return (globalThis as any).__mockSpawnLines?.() ?? makeProc([])
    }),
  }
})

import { runClaude } from '../claude.js'
import type { Session } from '../session.js'

const BASE_SESSION: Session = {
  userId: 'test:1',
  platform: 'test',
  cwd: process.cwd(),
  lastActivity: new Date(),
}

const BASE_CONFIG = { command: 'claude', skipPermissions: false }

function setMockLines(factory: () => ReturnType<typeof makeProc>) {
  ;(globalThis as any).__mockSpawnLines = factory
}

function makeProc(lines: string[], exitCode = 0) {
  const stdout = Readable.from(lines.map((l) => l + '\n'))
  const stderr = Readable.from([])
  const proc = new EventEmitter() as any
  proc.stdout = stdout
  proc.stderr = stderr
  setImmediate(() => proc.emit('close', exitCode))
  return proc
}

describe('runClaude stream-json parser', () => {
  it('extracts text from result event', async () => {
    setMockLines(() => makeProc([
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-001' }),
      JSON.stringify({ type: 'result', result: 'Hello from Claude', session_id: 'sess-001' }),
    ]))
    const result = await runClaude('hi', BASE_SESSION, BASE_CONFIG)
    expect(result.text).toBe('Hello from Claude')
    expect(result.sessionId).toBe('sess-001')
  })

  it('falls back to assistant text chunks when result is empty', async () => {
    setMockLines(() => makeProc([
      JSON.stringify({
        type: 'assistant',
        session_id: 'sess-002',
        message: { content: [{ type: 'text', text: 'Chunk 1 ' }, { type: 'text', text: 'Chunk 2' }] },
      }),
      JSON.stringify({ type: 'result', result: '', session_id: 'sess-002' }),
    ]))
    const result = await runClaude('hi', BASE_SESSION, BASE_CONFIG)
    expect(result.text).toBe('Chunk 1 Chunk 2')
  })

  it('rejects on error result event', async () => {
    setMockLines(() => makeProc([
      JSON.stringify({ type: 'result', is_error: true, result: 'Something went wrong' }),
    ]))
    await expect(runClaude('hi', BASE_SESSION, BASE_CONFIG)).rejects.toThrow('Something went wrong')
  })

  it('rejects on non-zero exit with no result', async () => {
    setMockLines(() => {
      const proc = new EventEmitter() as any
      proc.stdout = Readable.from([])
      const stderr = new EventEmitter() as any
      proc.stderr = stderr
      setImmediate(() => {
        stderr.emit('data', Buffer.from('Permission denied'))
        proc.emit('close', 1)
      })
      return proc
    })
    await expect(runClaude('hi', BASE_SESSION, BASE_CONFIG)).rejects.toThrow('Permission denied')
  })

  it('skips non-JSON diagnostic lines without throwing', async () => {
    setMockLines(() => makeProc([
      'Claude Code v1.0.0',
      '',
      JSON.stringify({ type: 'result', result: 'OK', session_id: 'sess-003' }),
    ]))
    const result = await runClaude('hi', BASE_SESSION, BASE_CONFIG)
    expect(result.text).toBe('OK')
  })

  it('uses --resume flag when session has claudeSessionId', async () => {
    const { spawn } = await import('child_process')
    setMockLines(() => makeProc([
      JSON.stringify({ type: 'result', result: 'Resumed', session_id: 'sess-existing' }),
    ]))
    const session: Session = { ...BASE_SESSION, claudeSessionId: 'sess-existing' }
    await runClaude('hi', session, BASE_CONFIG)
    const spawnArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as string[]
    expect(spawnArgs).toContain('--resume')
    expect(spawnArgs).toContain('sess-existing')
  })

  it('populates permissionDenials when result event contains permission_denials', async () => {
    const denials = [
      { tool_name: 'Write', tool_use_id: 'tu-1', tool_input: { file_path: '/tmp/test.ts' } },
      { tool_name: 'Bash', tool_use_id: 'tu-2', tool_input: { command: 'npm install' } },
    ]
    setMockLines(() => makeProc([
      JSON.stringify({ type: 'result', result: '', session_id: 'sess-p', permission_denials: denials }),
    ]))
    const result = await runClaude('hi', BASE_SESSION, BASE_CONFIG)
    expect(result.permissionDenials).toHaveLength(2)
    expect(result.permissionDenials?.[0].tool_name).toBe('Write')
    expect(result.permissionDenials?.[1].tool_name).toBe('Bash')
  })

  it('permissionDenials is undefined when no denials', async () => {
    setMockLines(() => makeProc([
      JSON.stringify({ type: 'result', result: 'OK', session_id: 'sess-ok' }),
    ]))
    const result = await runClaude('hi', BASE_SESSION, BASE_CONFIG)
    expect(result.permissionDenials).toBeUndefined()
  })

  it('overrides.skipPermissions: true adds --dangerously-skip-permissions even when config is false', async () => {
    const { spawn } = await import('child_process')
    setMockLines(() => makeProc([
      JSON.stringify({ type: 'result', result: 'OK' }),
    ]))
    await runClaude('hi', BASE_SESSION, { command: 'claude', skipPermissions: false }, { skipPermissions: true })
    const spawnArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as string[]
    expect(spawnArgs).toContain('--dangerously-skip-permissions')
  })

  it('overrides.skipPermissions: false suppresses flag even when config is true', async () => {
    const { spawn } = await import('child_process')
    setMockLines(() => makeProc([
      JSON.stringify({ type: 'result', result: 'OK' }),
    ]))
    await runClaude('hi', BASE_SESSION, { command: 'claude', skipPermissions: true }, { skipPermissions: false })
    const spawnArgs = (spawn as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as string[]
    expect(spawnArgs).not.toContain('--dangerously-skip-permissions')
  })
})
