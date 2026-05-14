/**
 * MODULE: 联网搜索工具。
 * 优先使用 LLM API 内置搜索，不可用时内部降级到受控浏览器搜索。
 */
const { requestChatCompletions } = require('../../api')
const { loadConfig } = require('../../runtime-config')
const { getSearchCapability } = require('../../utils')

async function browserSearch(query, reason) {
  const browserAction = require('./browser-action')
  const result = await browserAction.execute({ action: 'search_and_read', query })
  return `${reason}\n${result}`
}

module.exports = {
  definition: {
    name: 'web_search',
    description: '联网搜索最新信息。用户问实时新闻、天气、游戏更新、最新资讯时使用；API 搜索不可用时内部降级到受控浏览器搜索。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，如 "鸣潮 2026 新角色"' },
      },
      required: ['query'],
    },
  },
  async execute(params = {}) {
    const query = String(params.query || '').trim()
    if (!query) throw new Error('query 不能为空')

    const config = await loadConfig()
    const capability = getSearchCapability(config)

    if (!config.searchEnabled || !capability.supported) {
      return browserSearch(query, `API 联网搜索不可用（${capability.label}），已改用受控浏览器搜索。`)
    }

    try {
      const result = await requestChatCompletions(
        [{ role: 'user', content: `搜索当前最新信息，不要凭训练数据编造：${query}` }],
        config,
        { enable_search: true, search_options: { forced_search: true }, max_tokens: 800, _fallbackSet: 'chat' },
      )
      if (result && typeof result === 'string' && result.length > 30) return result
    } catch (e) {
      return browserSearch(query, `API 搜索请求失败：${e.message || '未知错误'}。已改用受控浏览器搜索。`)
    }

    return browserSearch(query, 'API 搜索没有返回可用结果，已改用受控浏览器搜索。')
  },
  dangerous: false,
  defaultChannels: ['dashboard', 'qq'],
}
