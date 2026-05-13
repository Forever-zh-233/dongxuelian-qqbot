/**
 * MODULE: Agent ReAct 引擎。
 * 职责: 构建 Agent 消息、调用 LLM + tools、循环推理-执行。
 * 边界: 不使用 chat.js 的 system prompt 构建逻辑；不写 conversation.js。
 * 状态: 无模块级状态（每次 run() 新建循环局部变量）。
 */
const { requestChatCompletions } = require('../api')
const { loadConfig } = require('../runtime-config')
const { getToolDefinitions, executeTool } = require('./tools/registry')
const { estimateTokens, truncateToolResult, compactMessages } = require('./context')
const { recordCall } = require('./stats')
const safety = require('./safety')
const pending = require('./pending')
const { isChannelEnabled } = require('./config')

const MAX_ROUNDS = 5
const MAX_TOOLS_PER_ROUND = 3

/**
 * @param {object} opts
 * @param {string} opts.userMessage - 用户输入文本
 * @param {string} opts.userName - 用户名称
 * @param {string} opts.userId - 用户 ID（用于 pending 隔离）
 * @param {string} opts.channelKey - 频道 key（用于 pending 隔离）
 * @param {string} [opts.channel='qq'] - 渠道: 'qq' | 'dashboard'
 * @param {object} [opts.systemExtra=[]] - 额外 system 消息
 * @param {object} [opts.onProgress] - 每轮回调
 * @returns {{ reply: string, toolCalls: number, pendingId: string|null }}
 */
async function runAgent({ userMessage, userName, userId, channelKey, channel = 'qq', systemExtra = [], onProgress }) {
  if (!isChannelEnabled(channel)) return { reply: '(Agent 已关闭)', toolCalls: 0, pendingId: null }
  const tools = getToolDefinitions(channel)
  const config = await loadConfig()
  const messages = buildMessages({ userMessage, userName, tools, systemExtra })
  let reply = ''
  let toolCount = 0
  let pendingId = null

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await requestChatCompletions(messages, config, {}, tools)

    if (typeof response === 'string') { reply = response; break }

    const { tool_calls, message: assistantMsg } = response
    if (!tool_calls || tool_calls.length === 0) break

    messages.push({
      role: 'assistant',
      content: assistantMsg?.content || null,
      tool_calls: tool_calls.slice(0, MAX_TOOLS_PER_ROUND).map(tc => ({
        id: tc.id, type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    })

    for (const tc of tool_calls.slice(0, MAX_TOOLS_PER_ROUND)) {
      let args = {}
      try { args = JSON.parse(tc.function.arguments || '{}') } catch {}

      const safeResult = safety.check(tc.function.name)
      let result

      if (!safeResult.allowed) {
        if (safety.getMode() === 'confirm' && userId && channelKey) {
          pendingId = pending.setPendingTool(channelKey, userId, { toolName: tc.function.name, args })
          result = `工具 '${tc.function.name}' 需要确认（ID: ${pendingId}）。请回复"确认工具"来执行。`
        } else {
          result = safeResult.error
        }
      } else {
        result = await executeTool(tc.function.name, args)
        recordCall(tc.function.name, channel)
        toolCount++
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: truncateToolResult(result) })
    }

    let estimated = estimateTokens(messages)
    if (estimated > 60000) {
      messages.splice(0, messages.length, ...compactMessages(messages, 24))
      estimated = estimateTokens(messages)
    }
    if (estimated > 80000) { reply = '(上下文过大，Agent 已中止)'; break }
    if (onProgress) onProgress({ type: 'round', round, toolCount, estimatedTokens: estimated }, round)
  }

  if (!reply) reply = '(Agent 未获取到有效回复)'

  return { reply, toolCalls: toolCount, pendingId }
}

function buildMessages({ userMessage, userName, tools, systemExtra }) {
  const system = [
    '你是东雪莲，一个带有 Agent 能力的 QQ 群助手。',
    '你可以使用工具辅助回答问题，如获取时间、精确计算等。',
    '保持你的人格风格：简短、有态度、不要长篇大论。',
    '不要在回复中输出思考过程。',
  ]
  if (tools.length > 0) {
    system.push(`你有 ${tools.length} 个可用工具。优先使用工具获取准确信息，而非凭记忆编造。`)
  }

  return [
    { role: 'system', content: system.join('\n') },
    ...systemExtra,
    { role: 'user', content: `<user>昵称：${userName || '用户'}\n${userMessage}\n</user>` },
  ]
}

module.exports = { run: runAgent }
