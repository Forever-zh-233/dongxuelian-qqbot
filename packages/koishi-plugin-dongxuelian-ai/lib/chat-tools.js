/**
 * MODULE: Chat 轻量工具调用。
 * 职责: 定义 Chat 模式可用的轻量工具、执行逻辑、轻/重分流。
 * 边界: 不调用 AI API、不发送消息、不写对话历史。
 * 状态: 无。
 */
const { getMemorySummary } = require('./conversation')

const CHAT_TOOL_TIMEOUT_MS = 3000
const CHAT_TOOLS_TOTAL_DEADLINE_MS = 5000

const LIGHTWEIGHT_TOOLS = new Set(['get_current_time', 'calculate', 'search_memory', 'read_image_history'])

const HEAVY_TOOLS = new Set(['web_search', 'browser_action', 'execute_shell', 'file_write'])

function getChatToolDefinitions() {
  return [
    {
      type: 'function',
      function: {
        name: 'get_current_time',
        description: '获取当前日期和时间',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'calculate',
        description: '计算数学表达式，支持加减乘除、幂运算、括号',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string', description: '数学表达式，如 123*456 或 (2+3)*5' } },
          required: ['expression'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_memory',
        description: '搜索对当前用户的记忆',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索最新信息（耗时较长，适合需要实时数据的问题）',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: '搜索关键词' } },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_image_history',
        description: '查看群聊最近出现的图片记录（URL + 时间戳 + 是否已分析）',
        parameters: {
          type: 'object',
          properties: { limit: { type: 'number', description: '返回最近几张，默认 5' } },
          required: [],
        },
      },
    },
  ]
}
function isLightweightTool(name) {
  return LIGHTWEIGHT_TOOLS.has(name)
}

function isHeavyTool(name) {
  return HEAVY_TOOLS.has(name) || !LIGHTWEIGHT_TOOLS.has(name)
}

function executeGetCurrentTime() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${weekdays[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function executeCalculate(args = {}) {
  const expr = String(args.expression || '').trim()
  if (!expr) return '请提供数学表达式'
  if (expr.length > 200) return '表达式过长'
  if (/[^0-9+\-*/().%^, \t]/.test(expr)) return '表达式包含不支持的字符'
  try {
    const sanitized = expr.replace(/\^/g, '**')
    const result = Function('"use strict"; return (' + sanitized + ')')()
    if (!Number.isFinite(result)) return '计算结果无效（可能除以零或溢出）'
    return String(result)
  } catch (e) {
    return '计算失败：' + (e.message || '表达式格式错误')
  }
}

async function executeSearchMemory(context = {}) {
  const { userId, channelKey } = context
  if (!userId || !channelKey) return '无法获取用户信息'
  const summary = await getMemorySummary(userId, channelKey)
  return summary || '没有找到相关记忆'
}

async function executeChatTool(toolCall, context = {}) {
  const name = toolCall?.function?.name || ''
  let args = {}
  try {
    args = JSON.parse(toolCall?.function?.arguments || '{}')
  } catch {}

  switch (name) {
    case 'get_current_time':
      return executeGetCurrentTime()
    case 'calculate':
      return executeCalculate(args)
    case 'search_memory':
      return executeSearchMemory(context)
    case 'read_image_history': {
      const { getRecentImages } = require('./image-store')
      const ck = context.channelKey || ''
      if (!ck) return '无法获取频道信息'
      const limit = Math.min(Math.max(parseInt(args.limit) || 5, 1), 10)
      const images = getRecentImages(ck, limit)
      if (!images.length) return '最近没有图片记录。'
      return images.map((img, i) => {
        const time = new Date(img.ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        const status = img.analyzed ? `已分析: ${(img.analysis || '').slice(0, 80)}` : '未分析'
        return `${i + 1}. [${time}] ${status}\n   URL: ${img.url}`
      }).join('\n')
    }
    default:
      return null
  }
}

async function handleChatToolCalls(toolCalls, context = {}) {
  if (!Array.isArray(toolCalls) || !toolCalls.length) return { results: [], heavyTools: [] }

  const results = []
  const heavyTools = []
  const deadline = Date.now() + CHAT_TOOLS_TOTAL_DEADLINE_MS

  for (const tc of toolCalls) {
    const name = tc?.function?.name || ''
    if (isHeavyTool(name)) {
      heavyTools.push(tc)
      continue
    }
    if (Date.now() >= deadline) break
    try {
      const resultPromise = executeChatTool(tc, context)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('tool timeout')), CHAT_TOOL_TIMEOUT_MS)
      )
      const result = await Promise.race([resultPromise, timeoutPromise])
      results.push({ tool_call_id: tc.id, role: 'tool', content: String(result || '') })
    } catch {
      results.push({ tool_call_id: tc.id, role: 'tool', content: '工具执行失败' })
    }
  }

  return { results, heavyTools }
}

function getChatToolSystemHint() {
  return '你有辅助工具可用。只在确实需要时自主调用，不要告诉用户你使用了工具，把结果自然融入回复。大多数聊天不需要工具，直接回复即可。'
}

module.exports = {
  getChatToolDefinitions,
  isLightweightTool,
  isHeavyTool,
  executeChatTool,
  handleChatToolCalls,
  getChatToolSystemHint,
  CHAT_TOOLS_TOTAL_DEADLINE_MS,
}
