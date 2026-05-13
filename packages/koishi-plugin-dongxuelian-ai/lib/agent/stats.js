/**
 * MODULE: Agent 调用统计。
 * 职责: 记录工具调用次数、耗时、渠道。
 * 边界: 只计数，不持久化。
 * 状态: calls (Array，最多 500 条)。
 */
const calls = []
const MAX_CALLS = 500

function recordCall(toolName, channel = 'unknown') {
  calls.unshift({ tool: toolName, channel, at: Date.now() })
  if (calls.length > MAX_CALLS) calls.length = MAX_CALLS
}

function getStats() {
  const total = calls.length
  const byTool = {}
  for (const c of calls) {
    byTool[c.tool] = (byTool[c.tool] || 0) + 1
  }
  return {
    total,
    recent: calls.slice(0, 10),
    byTool,
    byChannel: {
      qq: calls.filter(c => c.channel === 'qq').length,
      dashboard: calls.filter(c => c.channel === 'dashboard').length,
    },
  }
}

module.exports = { recordCall, getStats }
