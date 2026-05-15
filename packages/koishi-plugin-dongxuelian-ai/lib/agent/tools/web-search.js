/**
 * MODULE: 联网搜索工具。
 * 优先使用 LLM API 内置搜索，不可用时内部降级到受控浏览器搜索。
 */
const { requestChatCompletions } = require('../../api')
const { loadConfig } = require('../../runtime-config')
const { getSearchCapability } = require('../../utils')
const { buildSearchQueries, isLowQualitySearchResult, getSearchHostname } = require('../search-query')

function hasSearchSourceSignal(text = '') {
  const value = String(text || '')
  if (/https?:\/\/[^\s)）]+/i.test(value)) return true
  if (/(?:来源|参考|出处|链接)[:：\s]|(?:kurogames|wutheringwaves|bilibili|weibo|TapTap|GameKee)|(?:库洛|鸣潮官网)|官方(?:公告|新闻|资讯|微博|B站|bilibili)/i.test(value)) return true
  return false
}

function apiSearchLooksUnreliable(text = '') {
  const value = String(text || '').trim()
  if (value.length < 30) return true
  if (!hasSearchSourceSignal(value)) return true
  if (/未搜索到|没有找到|无法确认|无可靠结果|不能确定|搜索失败|素材|模板|图片下载|免费下载|图库|设计素材/.test(value)) return true
  const urls = value.match(/https?:\/\/[^\s)）]+/gi) || []
  if (urls.length > 0 && urls.every(url => isLowQualitySearchResult({ url, title: getSearchHostname(url) }))) return true
  return false
}

function normalizeQueryList(params = {}) {
  const raw = Array.isArray(params.queries) ? params.queries : []
  const query = String(params.query || '').trim()
  const planned = raw.length ? raw : buildSearchQueries(query)
  const seen = new Set()
  return planned.concat(query ? [query] : []).map(item => String(item || '').trim()).filter(item => {
    if (!item || item.length > 220) return false
    const key = item.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 4)
}

async function browserSearch(queries, reason) {
  const browserAction = require('./browser-action')
  const results = []
  for (const query of queries) {
    const result = await browserAction.execute({ action: 'search_and_read', query })
    results.push(result)
    if (!/未提取到有效搜索结果|搜索结果质量较低|素材|模板/.test(String(result || ''))) break
  }
  return `${reason}\n${results.join('\n\n---\n')}`
}

module.exports = {
  definition: {
    name: 'web_search',
    description: '联网搜索最新信息。用户问实时新闻、天气、游戏更新、最新资讯时使用；API 搜索不可用时内部降级到受控浏览器搜索。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，如 "鸣潮 2026 新角色"' },
        queries: { type: 'array', description: '可选，多组搜索关键词；工具会按顺序尝试并去重。' },
      },
      required: ['query'],
    },
  },
  async execute(params = {}) {
    const query = String(params.query || '').trim()
    if (!query) throw new Error('query 不能为空')
    const queries = normalizeQueryList(params)

    const config = await loadConfig()
    const capability = getSearchCapability(config)

    if (!config.searchEnabled || !capability.supported) {
      return browserSearch(queries, `API 联网搜索不可用（${capability.label}），已改用受控浏览器搜索。`)
    }

    try {
      const result = await requestChatCompletions(
        [{ role: 'user', content: `搜索当前最新信息，不要凭训练数据编造。优先官方或高可信来源，忽略素材/模板/图片下载站。查询：${queries.join('；')}` }],
        config,
        { enable_search: true, search_options: { forced_search: true }, max_tokens: 800, _fallbackSet: 'chat' },
      )
      if (result && typeof result === 'string' && !apiSearchLooksUnreliable(result)) return result
      return browserSearch(queries, 'API 搜索没有返回可靠来源，已改用受控浏览器搜索。')
    } catch (e) {
      return browserSearch(queries, `API 搜索请求失败：${e.message || '未知错误'}。已改用受控浏览器搜索。`)
    }

    return browserSearch(queries, 'API 搜索没有返回可用结果，已改用受控浏览器搜索。')
  },
  dangerous: false,
  defaultChannels: ['dashboard', 'qq'],
}
