/**
 * MODULE: Agent 工具注册器。
 * 职责: 聚合工具定义、按渠道过滤、executeTool 分发、结果截断。
 * 边界: 不调 AI API、不读配置、不存用户状态。
 * 状态: toolRegistry (module-level const)、lastReadCache (Map)。
 */
const getTimeTool = require('./get-time')
const calculatorTool = require('./calculator')
const webSearchTool = require('./web-search')
const readFileTool = require('./read-file')
const findFilesTool = require('./find-files')
const shellTool = require('./shell')
const browserActionTool = require('./browser-action')
const { isToolEnabled } = require('../config')

const tools = [getTimeTool, calculatorTool, webSearchTool, readFileTool, findFilesTool, shellTool, browserActionTool]

const toolRegistry = {}
for (const tool of tools) {
  toolRegistry[tool.definition.name] = tool
}

/** 按渠道过滤，返回 OpenAI 标准格式的工具定义 */
function getToolDefinitions(channel = 'qq') {
  return tools
    .filter(t => {
      const name = t.definition.name
      const channels = t.defaultChannels || ['dashboard', 'qq']
      return channels.includes(channel) && isToolEnabled(channel, name)
    })
    .map(t => ({ type: 'function', function: t.definition }))
}

/** 安全执行工具：超时 + 截断 + 错误包裹 */
async function executeTool(toolName, params = {}) {
  const tool = toolRegistry[toolName]
  if (!tool) return `未知工具：${toolName}`

  try {
    const result = await Promise.race([
      tool.execute(params),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('执行超时')), 30000)
      ),
    ])

    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    if (text.length > 4000) return text.slice(0, 4000) + '\n...(截断)'
    return text
  } catch (err) {
    return `工具 '${toolName}' 执行失败: ${err.message}`
  }
}

function getToolCount() { return tools.length }

module.exports = { getToolDefinitions, executeTool, toolRegistry, getToolCount }
