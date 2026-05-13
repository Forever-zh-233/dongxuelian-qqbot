/**
 * MODULE: Agent Skill 只读索引。
 * 职责: 列出可作为 Agent 参考的技能文件元数据。
 * 边界: 不执行技能、不修改技能文件。
 * 状态: 无。
 */
const fs = require('fs')
const path = require('path')
const { SKILLS_CORE_DIR, SKILLS_MODES_DIR, SKILLS_PERSONAS_DIR, SKILLS_LORE_DIR } = require('../constants')

const SKILL_DIRS = [
  { kind: 'core', dir: SKILLS_CORE_DIR },
  { kind: 'mode', dir: SKILLS_MODES_DIR },
  { kind: 'persona', dir: SKILLS_PERSONAS_DIR },
  { kind: 'lore', dir: SKILLS_LORE_DIR },
]

function parseFrontmatter(text) {
  const match = String(text || '').match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) meta[key] = value
  }
  return meta
}

function listAgentSkills() {
  const skills = []
  for (const group of SKILL_DIRS) {
    let entries = []
    try { entries = fs.readdirSync(group.dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isFile() || !/^SKILL\..+\.md$/i.test(entry.name)) continue
      const file = path.join(group.dir, entry.name)
      let content = ''
      try { content = fs.readFileSync(file, 'utf8') } catch {}
      const meta = parseFrontmatter(content)
      skills.push({
        kind: group.kind,
        file,
        name: meta.name || entry.name.replace(/^SKILL\.|\.md$/gi, ''),
        description: meta.description || '',
        enabled: meta.enabled !== 'false',
      })
    }
  }
  return skills
}

module.exports = { listAgentSkills, parseFrontmatter }
