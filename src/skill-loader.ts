/**
 * Skill loader — finds and reads Claude Code skill files.
 *
 * Lookup order (first match wins):
 *   1. <cwd>/.claude/skills/<name>/SKILL.md  (project-local)
 *   2. <cwd>/.claude/skills/<name>.md
 *   3. ~/.claude/skills/<name>/SKILL.md       (user global)
 *   4. ~/.claude/skills/<name>.md
 */
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface SkillFile {
  name: string
  content: string
  filePath: string
}

export function findSkill(name: string, cwd: string): SkillFile | null {
  const home = os.homedir()
  const candidates = [
    path.join(cwd,  '.claude', 'skills', name, 'SKILL.md'),
    path.join(cwd,  '.claude', 'skills', `${name}.md`),
    path.join(home, '.claude', 'skills', name, 'SKILL.md'),
    path.join(home, '.claude', 'skills', `${name}.md`),
  ]

  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      return { name, content, filePath }
    } catch {
      // not found at this path — try next
    }
  }
  return null
}

/**
 * List available skill names from ~/.claude/skills/ and <cwd>/.claude/skills/.
 * Returns unique names, project-local first.
 */
export function listSkills(cwd: string): string[] {
  const home = os.homedir()
  const dirs = [
    path.join(cwd,  '.claude', 'skills'),
    path.join(home, '.claude', 'skills'),
  ]

  const seen = new Set<string>()
  const names: string[] = []

  for (const dir of dirs) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'gstack') continue  // skip gstack meta-dir
        const skillName = entry.isDirectory()
          ? (fs.existsSync(path.join(dir, entry.name, 'SKILL.md')) ? entry.name : null)
          : (entry.name.endsWith('.md') ? entry.name.slice(0, -3) : null)
        if (skillName && !seen.has(skillName)) {
          seen.add(skillName)
          names.push(skillName)
        }
      }
    } catch {
      // directory doesn't exist — skip
    }
  }

  return names.sort()
}
