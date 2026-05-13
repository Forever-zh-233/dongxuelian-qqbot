/**
 * MODULE: Agent 待确认管理。
 * 职责: 存储/查询/清理 confirm 模式下的待确认工具请求。
 * 边界: 不执行工具，不做安全检查。
 * 状态: pending (Map)。
 */
const pending = new Map()

/** @returns {{ id, toolName, args, userId, channelKey, expireAt } | null } */
function getPendingTool(channelKey, userId) {
  const key = channelKey + ':' + userId
  const p = pending.get(key)
  if (!p) return null
  if (Date.now() > p.expireAt) { pending.delete(key); return null }
  return p
}

function setPendingTool(channelKey, userId, { toolName, args }) {
  const key = channelKey + ':' + userId
  const id = 'pnd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  pending.set(key, { id, toolName, args, userId, channelKey, expireAt: Date.now() + 60000 })
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

module.exports = { getPendingTool, setPendingTool, clearPendingTool, trimPendingTools }
