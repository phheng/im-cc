import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Bridge } from '../bridge.js'
import { SessionManager } from '../session.js'
import type { Adapter, MessageHandler } from '../adapters/base.js'
import type { Config } from '../config.js'
import fs from 'fs'

// Minimal adapter stub
function makeAdapter(name: string): Adapter & { fire: (userId: string, text: string) => Promise<string> } {
  let handler: MessageHandler | undefined
  return {
    name,
    onMessage(h) { handler = h },
    async sendMessage() {},
    async start() {},
    async stop() {},
    fire(userId, text) {
      if (!handler) throw new Error('no handler')
      return handler(userId, text)
    },
  }
}

const BASE_CONFIG: Config = {
  platforms: {},
  claude: { command: 'claude', skipPermissions: false },
  defaultCwd: process.cwd(),
}

describe('Bridge — commands', () => {
  let adapter: ReturnType<typeof makeAdapter>
  let sessions: SessionManager
  let bridge: Bridge

  beforeEach(() => {
    adapter = makeAdapter('telegram')
    sessions = new SessionManager(process.cwd())
    bridge = new Bridge([adapter], sessions, BASE_CONFIG)
    bridge.start()
  })

  it('/help returns help text', async () => {
    const reply = await adapter.fire('telegram:1', '/help')
    expect(reply).toContain('/new')
    expect(reply).toContain('/cwd')
  })

  it('/new resets the session', async () => {
    const session = sessions.getOrCreate('telegram:1', 'telegram')
    sessions.updateClaudeSession('telegram:1', 'sess-123')
    const reply = await adapter.fire('telegram:1', '/new')
    expect(reply).toContain('new conversation')
    expect(session.claudeSessionId).toBeUndefined()
  })

  it('/cwd with no arg returns current directory', async () => {
    const reply = await adapter.fire('telegram:1', '/cwd')
    expect(reply).toContain(process.cwd())
  })

  it('/cwd with valid path changes directory and resets session', async () => {
    const tmpDir = fs.mkdtempSync('/tmp/bridge-test-')
    sessions.getOrCreate('telegram:1', 'telegram')
    sessions.updateClaudeSession('telegram:1', 'sess-old')
    const reply = await adapter.fire('telegram:1', `/cwd ${tmpDir}`)
    expect(reply).toContain(tmpDir)
    expect(sessions.get('telegram:1')?.cwd).toBe(tmpDir)
    expect(sessions.get('telegram:1')?.claudeSessionId).toBeUndefined()
    fs.rmdirSync(tmpDir)
  })

  it('/cwd rejects non-existent path', async () => {
    const reply = await adapter.fire('telegram:1', '/cwd /path/does/not/exist/abc123')
    expect(reply).toContain('not found')
  })

  it('unknown command returns error with help', async () => {
    const reply = await adapter.fire('telegram:1', '/bogus')
    expect(reply).toContain('Unknown command')
    expect(reply).toContain('/help')
  })

  it('/info shows session details', async () => {
    await adapter.fire('telegram:1', '/help') // create session
    const reply = await adapter.fire('telegram:1', '/info')
    expect(reply).toContain('telegram:1')
  })
})

describe('Bridge — allowedUsers', () => {
  it('rejects unlisted users when allowedUsers is set', async () => {
    const adapter = makeAdapter('telegram')
    const sessions = new SessionManager(process.cwd())
    const config: Config = { ...BASE_CONFIG, allowedUsers: ['telegram:99'] }
    const bridge = new Bridge([adapter], sessions, config)
    bridge.start()
    const reply = await adapter.fire('telegram:1', '/help')
    expect(reply).toContain('not authorized')
  })

  it('allows listed users', async () => {
    const adapter = makeAdapter('telegram')
    const sessions = new SessionManager(process.cwd())
    const config: Config = { ...BASE_CONFIG, allowedUsers: ['telegram:1'] }
    const bridge = new Bridge([adapter], sessions, config)
    bridge.start()
    const reply = await adapter.fire('telegram:1', '/help')
    expect(reply).toContain('/new')
  })

  it('allows all users when allowedUsers is empty', async () => {
    const adapter = makeAdapter('telegram')
    const sessions = new SessionManager(process.cwd())
    const bridge = new Bridge([adapter], sessions, { ...BASE_CONFIG, allowedUsers: [] })
    bridge.start()
    const reply = await adapter.fire('telegram:99', '/help')
    expect(reply).toContain('/new')
  })
})

describe('Bridge — per-user queue', () => {
  it('serializes concurrent messages for the same user', async () => {
    const order: number[] = []
    let callCount = 0

    const adapter = makeAdapter('telegram')
    const sessions = new SessionManager(process.cwd())

    // Patch runClaude via the bridge's runClaude call path isn't easy to intercept,
    // so we test via /cwd commands which are synchronous — the queue must still
    // serialize them correctly.
    const bridge = new Bridge([adapter], sessions, BASE_CONFIG)
    bridge.start()

    // Fire 3 /new commands concurrently — they must be processed in order
    const tmpDir1 = fs.mkdtempSync('/tmp/bridge-q1-')
    const tmpDir2 = fs.mkdtempSync('/tmp/bridge-q2-')
    const tmpDir3 = fs.mkdtempSync('/tmp/bridge-q3-')

    try {
      const [r1, r2, r3] = await Promise.all([
        adapter.fire('telegram:1', `/cwd ${tmpDir1}`),
        adapter.fire('telegram:1', `/cwd ${tmpDir2}`),
        adapter.fire('telegram:1', `/cwd ${tmpDir3}`),
      ])
      // All should succeed
      expect(r1).toContain(tmpDir1)
      expect(r2).toContain(tmpDir2)
      expect(r3).toContain(tmpDir3)
      // Final cwd should be the last one processed
      expect(sessions.get('telegram:1')?.cwd).toBe(tmpDir3)
    } finally {
      fs.rmdirSync(tmpDir1)
      fs.rmdirSync(tmpDir2)
      fs.rmdirSync(tmpDir3)
    }
  })
})
