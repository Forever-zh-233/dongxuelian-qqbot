/**
 * MODULE: Agent 自动路由判定。
 * 职责: 在普通聊天前保守判断是否需要进入 Agent 工具链。
 * 边界: 不执行工具、不发送消息、不写对话历史。
 * 状态: 无。
 */
const { requestChatCompletions } = require('../api')
const { loadConfig } = require('../runtime-config')
const { isAutoRouteEnabled } = require('./config')
const { getToolDefinitions } = require('./tools/registry')

const STRONG_TOOL_RE = /(?:现在几点|今天几号|星期几|计算|算一下|等于多少|多少(?:\s*[+\-*/×÷]|\s*乘以|\s*除以)|最新|搜索|查一下|帮我查|读取文件|读文件|打开网页|浏览器)/i
const WEAK_TOOL_RE = /(?:能不能|可以吗|帮我|怎么|如何|为什么|查|看一下|分析)/i
const CASUAL_RE = /^(?:你好|嗨|hi|hello|在吗|早|晚上好|莲莲|东雪莲|谢谢|草|乐|6|？|\?|好|好的)$/i

function heuristicRoute(userText = '', channel = 'qq') {
  const text = String(userText || '').trim()
  if (!text || !isAutoRouteEnabled(channel)) return { useAgent: false, reason: 'disabled' }
  if (CASUAL_RE.test(text)) return { useAgent: false, reason: 'casual' }
  if (STRONG_TOOL_RE.test(text)) return { useAgent: true, reason: 'heuristic' }
  if (WEAK_TOOL_RE.test(text)) return { useAgent: false, reason: 'needs-llm' }
  return { useAgent: false, reason: 'no-tool-signal' }
}

async function llmRoute(userText = '', channel = 'qq') {
  const heuristic = heuristicRoute(userText, channel)
  if (!isAutoRouteEnabled(channel)) return heuristic
  if (heuristic.useAgent || heuristic.reason === 'casual') return heuristic
  if (heuristic.reason !== 'needs-llm') return heuristic
  const tools = getToolDefinitions(channel).map(item => item.function.name)
  if (tools.length === 0) return { useAgent: false, reason: 'no-tools' }
  const config = await loadConfig()
  const prompt = [
    { role: 'system', content: '判断这条消息是否必须使用工具/Agent 才能正确回答。只输出 YES 或 NO。需要实时信息、精确计算、本地文件/浏览器/工具能力才 YES；普通闲聊、观点、角色扮演、问候都 NO。' },
    { role: 'user', content: `可用工具：${tools.join(', ')}\n消息：${String(userText).slice(0, 500)}` },
  ]
  try {
    const result = await requestChatCompletions(prompt, config, { max_tokens: 5, _fallbackSet: 'lightweight' })
    return /^YES/i.test(String(result || '').trim())
      ? { useAgent: true, reason: 'llm' }
      : { useAgent: false, reason: 'llm' }
  } catch {
    return { useAgent: false, reason: 'llm-error' }
  }
}

module.exports = { heuristicRoute, llmRoute }
