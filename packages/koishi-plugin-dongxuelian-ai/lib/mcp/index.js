/**
 * MODULE: MCP 模块入口。
 * 职责: 启动/停止 MCP client，导出给 index.js 和 web-search.js 使用。
 */
const mcpClient = require('./client')

function startMcp(logger) {
  if (!process.env.DONGXUELIAN_MCP_TOKEN && !process.env.DONGXUELIAN_MCP_PORT) return
  mcpClient.start(logger)
}

function stopMcp() {
  mcpClient.stop()
}

function getStatus() {
  return {
    enabled: !!(process.env.DONGXUELIAN_MCP_TOKEN || process.env.DONGXUELIAN_MCP_PORT),
    connected: mcpClient.isAvailable(),
    tools: mcpClient.getTools().map(t => t.name),
    port: parseInt(process.env.DONGXUELIAN_MCP_PORT || '9877', 10),
  }
}

module.exports = {
  startMcp,
  stopMcp,
  isAvailable: () => mcpClient.isAvailable(),
  getTools: () => mcpClient.getTools(),
  callTool: (name, args) => mcpClient.callTool(name, args),
  getStatus,
}
