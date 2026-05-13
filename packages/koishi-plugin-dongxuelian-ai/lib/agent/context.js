/**
 * MODULE: Agent 上下文管理。
 * 职责: Token 估算、工具结果截断、临时压缩（Phase 2）。
 * 边界: 不写 conversation.js，不修改传入的 messages。
 * 状态: 无全局变量。
 */

/** 粗略 token 估算：中文 ~0.5 token/char，英文 ~0.25 */
function estimateTokens(messages = []) {
  let total = 0
  for (const m of messages) {
    if (typeof m.content === 'string') {
      // 中文字符约 0.5 token，英文字符约 0.25
      const hasChinese = /[\u4e00-\u9fff]/.test(m.content)
      total += Math.ceil(m.content.length * (hasChinese ? 0.5 : 0.25))
    }
    if (m.tool_calls) {
      total += Math.ceil(JSON.stringify(m.tool_calls).length * 0.25)
    }
  }
  return total
}

/** 工具结果截断，默认 8000 字符 */
function truncateToolResult(text = '', maxChars = 8000) {
  const s = String(text)
  if (s.length <= maxChars) return s
  return s.slice(0, maxChars) + `\n...(结果截断，共 ${s.length} 字符)`
}

/** 构建上下文摘要报告 */
function buildContextReport(messages = []) {
  return {
    messageCount: messages.length,
    estimatedTokens: estimateTokens(messages),
    roles: messages.reduce((acc, m) => { acc[m.role] = (acc[m.role] || 0) + 1; return acc }, {}),
  }
}

function compactMessages(messages = [], maxMessages = 24) {
  if (!Array.isArray(messages) || messages.length <= maxMessages) return messages.slice()
  const kept = messages.slice(-maxMessages)
  const omitted = messages.slice(0, -maxMessages)
  const summary = {
    role: 'system',
    content: `前文已压缩：省略 ${omitted.length} 条 Agent 中间消息，保留最近 ${kept.length} 条。工具结果和用户目标以最近消息为准。`,
  }
  return [messages[0], summary, ...kept].filter(Boolean)
}

module.exports = { estimateTokens, truncateToolResult, buildContextReport, compactMessages }
