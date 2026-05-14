/**
 * MODULE: Agent ReAct 引擎。
 * 职责: 构建 Agent 消息、调用 LLM + tools、循环推理-执行。
 * 边界: 不使用 chat.js 的 system prompt 构建逻辑；不写 conversation.js。
 * 状态: 无模块级状态（每次 run() 新建循环局部变量）。
 */
const { requestChatCompletions } = require('../api')
const { loadConfig } = require('../runtime-config')
const { getToolDefinitions, executeTool } = require('./tools/registry')
const { estimateTokens, externalizeToolResult, compactMessages } = require('./context')
const { recordCall } = require('./stats')
const safety = require('./safety')
const pending = require('./pending')
const { isChannelEnabled, getEnabledSkills } = require('./config')
const { buildAgentSkillSummary } = require('./skills')
const { buildAgentMessages } = require('./messages')
const { recordAgentSession } = require('./sessions')
const { MAX_TOOL_ROUNDS } = require('../constants')

const MAX_ROUNDS = MAX_TOOL_ROUNDS
const MAX_TOOLS_PER_ROUND = 3

/**
 * @param {object} opts
 * @param {string} opts.userMessage - 用户输入文本
 * @param {string} opts.userName - 用户名称
 * @param {string} opts.userId - 用户 ID（用于 pending 隔离）
 * @param {string} opts.channelKey - 频道 key（用于 pending 隔离）
 * @param {string} [opts.channel='qq'] - 渠道: 'qq' | 'dashboard'
 * @param {object} [opts.systemExtra=[]] - 额外 system 消息
 * @param {Array} [opts.history=[]] - 额外对话历史
 * @param {object} [opts.onProgress] - 每轮回调
 * @returns {{ reply: string, toolCalls: number, pendingId: string|null }}
 */
async function runAgent({ userMessage, userName, userId, channelKey, channel = 'qq', systemExtra = [], history = [], onProgress }) {
  if (!isChannelEnabled(channel)) return { reply: '(Agent 已关闭)', toolCalls: 0, pendingId: null }
  const tools = getToolDefinitions(channel)
  const allowedToolNames = new Set(tools.map(item => item.function && item.function.name).filter(Boolean))
  const config = await loadConfig()
  const skillSummary = buildAgentSkillSummary(getEnabledSkills())
  const messages = buildAgentMessages({ userMessage, userName, tools, systemExtra: skillSummary ? [...systemExtra, { role: 'system', content: skillSummary }] : systemExtra, history })
  let reply = ''
  let toolCount = 0
  let pendingId = null

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let response
    try {
      response = await requestChatCompletions(messages, config, {}, tools)
    } catch (error) {
      reply = `Agent 调用模型失败：${error.message || error}`
      break
    }

    if (typeof response === 'string') { reply = response; break }

    const { tool_calls, message: assistantMsg } = response
    if (!tool_calls || tool_calls.length === 0) {
      reply = assistantMsg?.content || ''
      break
    }

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

      let result
      if (!allowedToolNames.has(tc.function.name)) {
        result = `工具 '${tc.function.name}' 当前渠道未启用，拒绝执行。`
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
        continue
      }

      const safeResult = safety.check(tc.function.name)

      if (!safeResult.allowed) {
        if (safeResult.action === 'confirm' && userId && channelKey) {
          pendingId = pending.setPendingTool(channelKey, userId, { toolName: tc.function.name, args, channel })
          result = `工具 '${tc.function.name}' 需要确认（ID: ${pendingId}）。请回复"确认工具"来执行。`
        } else {
          result = safeResult.error
        }
      } else {
        try {
          const execResult = await executeTool(tc.function.name, args)
          result = execResult.text
          if (execResult.ok) {
            recordCall(tc.function.name, channel)
            toolCount++
          }
        } catch (error) {
          result = `工具 '${tc.function.name}' 执行失败: ${error.message || error}`
        }
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: externalizeToolResult(result, tc.function.name) })
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

  recordAgentSession({ channel, channelKey, userId, userName, userMessage, reply, toolCalls: toolCount, pendingId })
  return { reply, toolCalls: toolCount, pendingId }
}

module.exports = { run: runAgent }
