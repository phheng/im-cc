import { describe, it, expect, beforeEach } from 'vitest'
import { SessionManager } from '../session.js'

describe('SessionManager', () => {
  let mgr: SessionManager

  beforeEach(() => {
    mgr = new SessionManager('/default/cwd')
  })

  it('creates a new session with defaults', () => {
    const s = mgr.getOrCreate('telegram:1', 'telegram')
    expect(s.userId).toBe('telegram:1')
    expect(s.platform).toBe('telegram')
    expect(s.cwd).toBe('/default/cwd')
    expect(s.claudeSessionId).toBeUndefined()
  })

  it('returns the same session on repeated getOrCreate', () => {
    const a = mgr.getOrCreate('telegram:1', 'telegram')
    const b = mgr.getOrCreate('telegram:1', 'telegram')
    expect(a).toBe(b)
  })

  it('updateClaudeSession sets the session ID', () => {
    mgr.getOrCreate('telegram:1', 'telegram')
    mgr.updateClaudeSession('telegram:1', 'sess-abc')
    expect(mgr.get('telegram:1')?.claudeSessionId).toBe('sess-abc')
  })

  it('updateCwd changes the working directory', () => {
    mgr.getOrCreate('telegram:1', 'telegram')
    mgr.updateCwd('telegram:1', '/new/path')
    expect(mgr.get('telegram:1')?.cwd).toBe('/new/path')
  })

  it('reset clears claudeSessionId but keeps cwd', () => {
    mgr.getOrCreate('telegram:1', 'telegram')
    mgr.updateCwd('telegram:1', '/some/path')
    mgr.updateClaudeSession('telegram:1', 'sess-abc')
    mgr.reset('telegram:1')
    expect(mgr.get('telegram:1')?.claudeSessionId).toBeUndefined()
    expect(mgr.get('telegram:1')?.cwd).toBe('/some/path')
  })

  it('list returns all sessions', () => {
    mgr.getOrCreate('telegram:1', 'telegram')
    mgr.getOrCreate('wechat:2', 'wechat')
    expect(mgr.list()).toHaveLength(2)
  })

  it('noops silently on unknown userId', () => {
    expect(() => {
      mgr.updateClaudeSession('unknown', 'x')
      mgr.updateCwd('unknown', '/x')
      mgr.reset('unknown')
    }).not.toThrow()
  })
})
