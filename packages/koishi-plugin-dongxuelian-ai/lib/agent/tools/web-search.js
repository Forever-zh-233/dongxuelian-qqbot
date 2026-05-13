/**
 * MODULE: 联网搜索工具。
 * 优先使用 LLM API 内置搜索，不可用时提示使用 browser 工具。
 */
const { requestChatCompletions } = require('../../api')
const { loadConfig } = require('../../runtime-config')
const { getSearchCapability } = require('../../utils')

module.exports = {
  definition: {
    name: 'web_search',
    description: '联网搜索最新信息。用户问实时新闻、天气、游戏更新、最新资讯时使用。如果 API 搜索不可用，改用 browser 工具打开搜索引擎。',
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
      return `API 联网搜索不可用（${capability.label}）。请改用 browser 工具自行搜索。`
    }

    try {
      const result = await requestChatCompletions(
        [{ role: 'user', content: `搜索当前最新信息，不要凭训练数据编造：${query}` }],
        config,
        { enable_search: true, search_options: { forced_search: true }, max_tokens: 800, _fallbackSet: 'chat' },
      )
      if (result && typeof result === 'string' && result.length > 30) return result
    } catch {}

    return `API 搜索请求失败。请改用 browser 工具自行搜索。`
  },
  dangerous: false,
  defaultChannels: ['dashboard', 'qq'],
}
