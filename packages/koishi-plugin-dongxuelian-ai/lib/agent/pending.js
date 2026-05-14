/**
 * MODULE: Agent 待确认管理。
 * 职责: 存储/查询/清理 confirm 模式下的待确认工具请求。
 * 边界: 不执行工具，不做安全检查。
 * 状态: pending (Map)。
 */
const pending = new Map()

/** @returns {{ id, toolName, args, userId, channelKey, channel, expireAt } | null } */
function getPendingTool(channelKey, userId) {
  const key = channelKey + ':' + userId
  const p = pending.get(key)
  if (!p) return null
  if (Date.now() > p.expireAt) { pending.delete(key); return null }
  return p
}

function setPendingTool(channelKey, userId, { toolName, args, channel }) {
  const key = channelKey + ':' + userId
  const id = 'pnd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  pending.set(key, { id, toolName, args, userId, channelKey, channel: channel || 'unknown', expireAt: Date.now() + 60000 })
  return id
}

function clearPendingTool(channelKey, userId) {
  pending.delete(channelKey + ':' + userId)
}

/** 清理过期 */
function trimPendingTools(now = Date.now()) {
  for (const [k, v] of pending) {
    if (now > v.expireAt) pending.delete(k)
  }
}
const cleanupTimer = setInterval(() => trimPendingTools(), 60000)
if (cleanupTimer.unref) cleanupTimer.unref()

function findPendingToolById(id) {
  trimPendingTools()
  const target = String(id || '')
  if (!target) return null
  for (const p of pending.values()) {
    if (p.id === target) return p
  }
  return null
}

function summarizePendingArgs(toolName, args = {}) {
  const src = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  const fields = []
  for (const key of ['path', 'cwd', 'command', 'url', 'selector', 'expression', 'query', 'action']) {
    if (src[key] !== undefined) fields.push(`${key}=${String(src[key]).slice(0, 160)}`)
  }
  if (src.content !== undefined) fields.push(`content=${Buffer.byteLength(String(src.content), 'utf8')} bytes`)
  if (src.text !== undefined) fields.push(`text=${String(src.text).slice(0, 80)}`)
  return fields.length ? fields.join('; ') : `${toolName} 参数 ${JSON.stringify(src).slice(0, 200)}`
}

function listPendingTools() {
  trimPendingTools()
  return Array.from(pending.values()).map(p => ({
    id: p.id,
    toolName: p.toolName,
    userId: p.userId,
    channelKey: p.channelKey,
    channel: p.channel || 'unknown',
    argsSummary: summarizePendingArgs(p.toolName, p.args),
    expireAt: p.expireAt,
  }))
}

async function confirmPendingTool(channelKey, userId, channel = 'unknown', expectedId = '') {
  const p = getPendingTool(channelKey, userId)
  if (!p) return { ok: false, status: 404, message: '没有待确认工具' }
  if (expectedId && p.id !== expectedId) return { ok: false, status: 404, message: '没有匹配的待确认工具' }

  const { isToolEnabled } = require('./config')
  const safety = require('./safety')
  if (!isToolEnabled(channel, p.toolName)) return { ok: false, status: 403, message: `工具 '${p.toolName}' 当前渠道未启用，拒绝执行。` }
  const safeResult = safety.check(p.toolName)
  if (safeResult.action === 'block') return { ok: false, status: 403, message: safeResult.error }
  if (!safeResult.allowed && safeResult.action !== 'confirm') return { ok: false, status: 403, message: safeResult.error || `工具 '${p.toolName}' 未通过安全检查` }

  clearPendingTool(channelKey, userId)
  const registry = require('./tools/registry')
  const { recordCall } = require('./stats')
  const result = await registry.executeTool(p.toolName, p.args || {})
  if (result.ok) recordCall(p.toolName, channel)
  return { ok: result.ok, toolName: p.toolName, result: result.text, error: result.error || '', message: result.ok ? '' : result.text }
}

module.exports = { getPendingTool, findPendingToolById, setPendingTool, clearPendingTool, trimPendingTools, listPendingTools, confirmPendingTool }
