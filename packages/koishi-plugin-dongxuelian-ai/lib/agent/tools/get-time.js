/**
 * MODULE: 获取当前时间工具。
 */
module.exports = {
  definition: {
    name: 'get_current_time',
    description: '获取当前日期和时间。当用户问"现在几点"、"今天几号"、"星期几"时调用。',
    parameters: {
      type: 'object',
      properties: {
        timezone: { type: 'string', description: '时区，默认 Asia/Shanghai' },
      },
    },
  },
  async execute(params = {}) {
    const tz = params.timezone || 'Asia/Shanghai'
    const now = new Date()
    const locale = now.toLocaleString('zh-CN', { timeZone: tz })
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
    return `当前时间：${locale} 周${weekday} (${tz})\nISO: ${now.toISOString()}`
  },
  dangerous: false,
  defaultChannels: ['dashboard', 'qq'],
}
