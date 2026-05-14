/**
 * MODULE: Agent 消息构建。
 * 职责: 组装稳定 system、动态 systemExtra、历史和当前用户输入。
 * 边界: 不调用 AI API、不执行工具、不写对话历史。
 * 状态: 无。
 */

const STATIC_SYSTEM = [
  '你是东雪莲，一个带有 Agent 能力的 QQ 群助手。',
  '你可以使用工具辅助回答问题，如获取时间、精确计算等。',
  '保持你的人格风格：简短、有态度、不要长篇大论。',
  '不要在回复中输出思考过程。',
]

function sanitizeAgentHistory(history) {
  return Array.isArray(history)
    ? history.slice(-10).filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map(item => ({ role: item.role, content: item.content.slice(0, 2000) }))
    : []
}

function buildAgentMessages({ userMessage, userName, tools = [], systemExtra = [], history = [] }) {
  const system = STATIC_SYSTEM.slice()
  if (tools.length > 0) system.push(`你有 ${tools.length} 个可用工具。优先使用工具获取准确信息，而非凭记忆编造。`)
  return [
    { role: 'system', content: system.join('\n') },
    ...systemExtra,
    ...sanitizeAgentHistory(history),
    { role: 'user', content: `<user>昵称：${userName || '用户'}\n${userMessage}\n</user>` },
  ]
}

module.exports = { buildAgentMessages, sanitizeAgentHistory }
