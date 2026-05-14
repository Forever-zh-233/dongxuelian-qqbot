/**
 * MODULE: 运行日志查询工具。
 * 安全：只读 runtime/logs 与数据目录下常见日志，输出脱敏和限长。
 */
const fs = require('fs/promises')
const path = require('path')
const { DATA_DIR } = require('../../constants')

const LOG_DIRS = [path.resolve(process.cwd(), 'runtime', 'logs'), path.join(DATA_DIR, 'logs')]
const MAX_FILE_BYTES = 1024 * 1024
const SECRET_RE = /(?:api[_-]?key|token|authorization|password|secret)[=:：\s]+[^\s,;]+/ig

function redact(text = '') {
  return String(text).replace(SECRET_RE, m => m.replace(/([=:：\s]+).+$/, '$1[REDACTED]'))
}

async function collectLogFiles() {
  const files = []
  for (const dir of LOG_DIRS) {
    let entries = []
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (entry.isFile() && /\.(?:log|txt)$/i.test(entry.name)) files.push(path.join(dir, entry.name))
    }
  }
  return files
}

function parseSince(value = '') {
  const raw = String(value || '').trim()
  if (!raw || raw === 'today') {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime()
  }
  const hours = raw.match(/^(\d+)h$/i)
  if (hours) return Date.now() - Number(hours[1]) * 3600000
  const ts = Date.parse(raw)
  return Number.isFinite(ts) ? ts : 0
}

module.exports = {
  definition: {
    name: 'query_logs',
    description: '查询近期服务器/Koishi 日志中的错误、retcode 或指定关键词。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词或正则，例如 retcode、ERROR' },
        level: { type: 'string', description: '日志级别过滤，例如 error、warn，可选' },
        since: { type: 'string', description: '时间范围，默认 today；也支持 6h 或 ISO 时间' },
        limit: { type: 'number', description: '最大返回行数，默认 80，最大 200' },
      },
    },
  },
  async execute(params = {}) {
    const query = String(params.query || params.level || 'error|warn|retcode').trim()
    const limit = Math.max(1, Math.min(200, parseInt(params.limit, 10) || 80))
    const since = parseSince(params.since || 'today')
    let regex
    try { regex = new RegExp(query, 'i') } catch { regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    const level = String(params.level || '').trim().toLowerCase()
    const files = await collectLogFiles()
    const matches = []
    for (const file of files) {
      const stat = await fs.stat(file).catch(() => null)
      if (!stat || stat.size > MAX_FILE_BYTES || (since && stat.mtimeMs < since)) continue
      const text = await fs.readFile(file, 'utf8').catch(() => '')
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (level && !line.toLowerCase().includes(level)) continue
        if (regex.test(line)) {
          matches.push(`${path.basename(file)}:${i + 1}: ${redact(line).slice(0, 260)}`)
          if (matches.length >= limit) return `找到 ${matches.length} 条日志（已达上限）：\n${matches.join('\n')}`
        }
        regex.lastIndex = 0
      }
    }
    return matches.length ? `找到 ${matches.length} 条日志：\n${matches.join('\n')}` : '未找到匹配日志。'
  },
  dangerous: false,
  defaultChannels: ['dashboard'],
}
