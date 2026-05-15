/**
 * MODULE: Agent Skill 只读索引。
 * 职责: 发现可作为 Agent 参考的实用 Skill，并按需读取 Skill 文档。
 * 边界: 不执行技能、不修改技能文件、不读取人格/core/mode。
 * 状态: 无。
 */
const fs = require('fs')
const path = require('path')
const { SKILLS_DIR, SKILLS_LORE_DIR } = require('../constants')

const SKILL_DIRS = [
  { kind: 'lore', dir: SKILLS_LORE_DIR },
  { kind: 'docs', dir: path.join(SKILLS_DIR, 'docs') },
]
const DIRECTORY_SKILL_FILE = 'SKILL.md'
const LEGACY_SKILL_RE = /^SKILL\..+\.md$/i
const TEXT_FILE_RE = /\.(?:md|txt|json|js|ts|tsx|jsx|vue|css|html|yaml|yml|csv)$/i
const MAX_REFERENCE_FILES = 40
const DEFAULT_READ_CHARS = 12000
const MAX_READ_CHARS = 24000
const SKIP_REFERENCE_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'tmp', '.cache'])

function parseFrontmatter(text) {
  const match = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/)
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

function stripFrontmatter(text = '') {
  return String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, '').trim()
}

function skillNormalizeName(name = '') {
  return String(name || '').trim()
}

function skillNameKey(name = '') {
  return skillNormalizeName(name).toLowerCase()
}

function skillPathKey(value = '') {
  const resolved = path.resolve(String(value || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function skillPathInside(target, root) {
  const targetKey = skillPathKey(target)
  const rootKey = skillPathKey(root)
  return targetKey === rootKey || targetKey.startsWith(rootKey + path.sep)
}

function skillReadText(file) {
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}

function skillRelativePath(file) {
  const relative = path.relative(SKILLS_DIR, file).replace(/\\/g, '/')
  return relative && !relative.startsWith('..') ? relative : path.basename(file)
}

function skillListReferences(rootDir, primaryFile) {
  const root = path.resolve(rootDir)
  const primary = path.resolve(primaryFile)
  const references = []
  function walk(dir, depth) {
    if (references.length >= MAX_REFERENCE_FILES || depth > 4) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (references.length >= MAX_REFERENCE_FILES) return
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_REFERENCE_DIRS.has(entry.name)) walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (path.resolve(full) === primary) continue
      if (!TEXT_FILE_RE.test(entry.name)) continue
      references.push(path.relative(root, full).replace(/\\/g, '/'))
    }
  }
  walk(root, 0)
  return references
}

function skillBuildEntry(group, file, options = {}) {
  const content = skillReadText(file)
  const meta = parseFrontmatter(content)
  if (meta.enabled === 'false') return null
  const isDirectorySkill = !!options.isDirectorySkill
  const rootDir = options.rootDir || (isDirectorySkill ? path.dirname(file) : null)
  const name = skillNormalizeName(meta.name || options.name || path.basename(file).replace(/^SKILL\.|\.md$/gi, ''))
  if (!name) return null
  const allowReferences = group.kind === 'docs' && !!rootDir
  const entry = {
    kind: meta.kind || group.kind,
    file,
    name,
    description: meta.description || '',
    dir: rootDir || '',
    path: skillRelativePath(file),
    directorySkill: isDirectorySkill,
    references: allowReferences ? skillListReferences(rootDir, file) : [],
  }
  entry.hasReferences = entry.references.length > 0
  return entry
}

function skillCollectEntry(skills, group, entry, baseDir) {
  const full = path.join(baseDir, entry.name)
  if (entry.isDirectory()) {
    const directorySkill = path.join(full, DIRECTORY_SKILL_FILE)
    if (fs.existsSync(directorySkill)) {
      const skill = skillBuildEntry(group, directorySkill, { rootDir: full, isDirectorySkill: true, name: entry.name })
      if (skill) skills.push(skill)
    }
    let nested = []
    try { nested = fs.readdirSync(full, { withFileTypes: true }) } catch { return }
    for (const item of nested) {
      if (item.name === DIRECTORY_SKILL_FILE) continue
      skillCollectEntry(skills, group, item, full)
    }
    return
  }
  if (!entry.isFile() || !LEGACY_SKILL_RE.test(entry.name)) return
  const rootDir = group.kind === 'docs' ? baseDir : ''
  const skill = skillBuildEntry(group, full, { rootDir, isDirectorySkill: false })
  if (skill) skills.push(skill)
}

function listAgentSkills() {
  const skills = []
  for (const group of SKILL_DIRS) {
    let entries = []
    try { entries = fs.readdirSync(group.dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) skillCollectEntry(skills, group, entry, group.dir)
  }
  return skills.sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`, 'zh-Hans-CN'))
}

function findAgentSkill(name) {
  const target = skillNameKey(name)
  if (!target) return null
  return listAgentSkills().find(skill => skillNameKey(skill.name) === target) || null
}

function skillResolveRequestedFile(skill, requestedFile = '') {
  const value = String(requestedFile || '').trim()
  if (!value) return skill.file
  if (!skill.dir) {
    const ownName = path.basename(skill.file)
    if (value === ownName || value === skill.path) return skill.file
    throw new Error('该 Skill 不允许读取额外参考文件')
  }
  if (path.isAbsolute(value) || value.includes('\0')) throw new Error('Skill 参考文件必须使用相对路径')
  const normalized = path.normalize(value).replace(/^(\.\.[/\\])+/, '../')
  if (normalized === '..' || normalized.startsWith('..' + path.sep) || normalized.startsWith('..' + path.posix.sep)) {
    throw new Error('Skill 参考文件不能越过技能目录')
  }
  if (path.basename(normalized) === DIRECTORY_SKILL_FILE || normalized === skill.path) return skill.file
  if (!TEXT_FILE_RE.test(normalized)) throw new Error('只能读取 Skill 目录内的文本参考文件')
  const root = fs.realpathSync(skill.dir)
  const target = fs.realpathSync(path.resolve(skill.dir, normalized))
  if (!skillPathInside(target, root)) throw new Error('Skill 参考文件超出技能目录')
  return target
}

function readAgentSkill(name, options = {}) {
  const skill = findAgentSkill(name)
  if (!skill) throw new Error(`未知 Agent Skill：${skillNormalizeName(name)}`)
  const file = skillResolveRequestedFile(skill, options.file)
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error(`不是 Skill 文件：${skillRelativePath(file)}`)
  if (stat.size > 1024 * 1024) throw new Error(`Skill 文件过大：${stat.size} bytes`)
  const buffer = fs.readFileSync(file)
  if (buffer.includes(0)) throw new Error('Skill 文件疑似二进制，拒绝读取')
  const maxChars = Math.max(1000, Math.min(MAX_READ_CHARS, parseInt(options.maxChars, 10) || DEFAULT_READ_CHARS))
  const raw = buffer.toString('utf8')
  const content = raw.slice(0, maxChars)
  return {
    name: skill.name,
    kind: skill.kind,
    description: skill.description,
    file: skillRelativePath(file),
    primaryFile: skill.path,
    references: skill.references.slice(),
    content,
    chars: raw.length,
    truncated: raw.length > content.length,
  }
}

function buildAgentSkillSummary(enabledNames = []) {
  const enabled = new Set((enabledNames || []).map(skillNameKey).filter(Boolean))
  if (enabled.size === 0) return ''
  const selected = listAgentSkills().filter(skill => enabled.has(skillNameKey(skill.name))).slice(0, 32)
  if (selected.length === 0) return ''
  const lines = [
    '已启用 Agent Skill 索引（轻量索引，不含正文）：',
    '需要某个 Skill 的完整流程或参考文件时，调用 read_agent_skill({ "name": "<Skill名>" })；不要凭索引猜测细节。',
    '未启用、未读取的 Skill 视为不可用；人格/persona 不属于实用 Skill。',
  ]
  for (const skill of selected) {
    const refs = skill.references.length ? `；参考文件：${skill.references.slice(0, 6).join(', ')}${skill.references.length > 6 ? '...' : ''}` : ''
    lines.push(`- ${skill.name}（${skill.kind}）：${skill.description || '无描述'}；入口：read_agent_skill name="${skill.name}"${refs}`)
  }
  return lines.join('\n')
}

module.exports = {
  listAgentSkills,
  findAgentSkill,
  readAgentSkill,
  parseFrontmatter,
  buildAgentSkillSummary,
  stripFrontmatter,
}
