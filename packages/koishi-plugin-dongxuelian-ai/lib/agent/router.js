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
const { cleanExplicitSearchQuery, buildSearchQueries } = require('./search-query')

const SEARCH_PREFIX_RE = /(?:调用\s*(?:搜索工具|web_search)|web_search|上网查(?:一下|查)?|联网查(?:一下|查)?|联网搜索(?:一下)?|网上查(?:一下|查)?|搜一下|搜索一下|帮我查(?:一下|查)?|查一下)/gi
const EXPLICIT_AGENT_RE = /(?:调用\s*(?:搜索工具|web_search)|web_search|上网查|联网查|联网搜索|网上查|搜一下|搜索一下|帮我查|查一下).{0,80}(?:最新|现在|当前|版本|角色|新闻|资料|是谁|是什么)|(?:最新角色|当前版本|现在是什么版本)/i
const EXPLICIT_SEARCH_RE = /(?:调用\s*(?:搜索工具|web_search)|web_search|上网查|联网查|联网搜索|网上查|搜一下|搜索一下|帮我查|查一下|最新角色|当前版本|现在是什么版本)/i
const STRONG_TOOL_RE = /(?:现在几点|今天几号|星期几|计算|算一下|等于多少|多少(?:\s*[+\-*/×÷]|\s*乘以|\s*除以)|最新|搜索|查一下|帮我查|读取文件|读文件|打开网页|浏览器)/i
const WEAK_TOOL_RE = /(?:能不能|可以吗|帮我|怎么|如何|为什么|查|看一下|分析)/i
const CASUAL_RE = /^(?:你好|嗨|hi|hello|在吗|早|晚上好|莲莲|东雪莲|谢谢|草|乐|6|？|\?|好|好的)$/i

function heuristicRoute(userText = '', channel = 'qq') {
  const text = String(userText || '').trim()
  if (!text) return { useAgent: false, reason: 'empty' }
  if (EXPLICIT_AGENT_RE.test(text)) return { useAgent: true, reason: 'explicit-tool-request' }
  if (!isAutoRouteEnabled(channel)) return { useAgent: false, reason: 'disabled' }
  if (CASUAL_RE.test(text)) return { useAgent: false, reason: 'casual' }
  if (STRONG_TOOL_RE.test(text)) return { useAgent: true, reason: 'heuristic' }
  if (WEAK_TOOL_RE.test(text)) return { useAgent: false, reason: 'needs-llm' }
  return { useAgent: false, reason: 'no-tool-signal' }
}

async function llmRoute(userText = '', channel = 'qq') {
  const heuristic = heuristicRoute(userText, channel)
  if (heuristic.useAgent || heuristic.reason === 'casual') return heuristic
  if (!isAutoRouteEnabled(channel)) return heuristic
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

function buildExplicitSearchRunOptions(userText = '') {
  if (!EXPLICIT_SEARCH_RE.test(String(userText || ''))) return {}
  const query = cleanExplicitSearchQuery(userText) || String(userText || '').trim()
  const queries = buildSearchQueries(query)
  const primaryQuery = queries[0] || query
  return {
    systemExtra: [{ role: 'system', content: '用户明确要求联网搜索。必须先调用 web_search 获取最新信息；如 Skill 索引列出了 web_search_strategy，先读取该 Skill 的搜索策略。只能根据工具结果回答，不要凭记忆回答。候选页足够可信时，要以工具打开到的候选网页正文为主要依据；只有标题/摘要时必须降低确信度。若工具结果为空、明显不相关、或主要是素材/模板/图片/下载站，必须说“这次搜索没有拿到可靠结果”，并简要说明搜索链路问题，不要编造答案。用户追问“你怎么知道/是搜索到的吗”时，要诚实说明依据来自本轮工具结果。' }],
    forceTools: ['web_search'],
    preExecuteTools: [{ name: 'web_search', args: { query: primaryQuery, queries } }],
  }
}

module.exports = { heuristicRoute, llmRoute, isExplicitSearchRequest: (text = '') => EXPLICIT_SEARCH_RE.test(String(text || '')), buildExplicitSearchRunOptions }
