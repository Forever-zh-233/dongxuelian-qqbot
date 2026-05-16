/**
 * MODULE: MCP Client — 服务端 WebSocket 端点。
 * 职责: 接受本地 PC 的 MCP Server 连接，管理工具注册，暴露 callTool()。
 * 边界: 不执行搜索、不调用 AI API。
 * 状态: 单例连接状态。
 */
const { WebSocketServer } = require('ws')
const { URL } = require('url')

const MCP_PORT = parseInt(process.env.DONGXUELIAN_MCP_PORT || '9877', 10)
const MCP_TOKEN = process.env.DONGXUELIAN_MCP_TOKEN || ''
const TOOL_TIMEOUT_MS = parseInt(process.env.DONGXUELIAN_MCP_TOOL_TIMEOUT_MS || '15000', 10)

let wss = null
let activeConnection = null
let availableTools = []
let requestId = 0
const pendingRequests = new Map()

function start(logger) {
  if (wss) return
  wss = new WebSocketServer({ port: MCP_PORT })
  if (logger) logger.info(`[MCP] WebSocket server listening on port ${MCP_PORT}`)

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://localhost:${MCP_PORT}`)
    const token = url.searchParams.get('token') || ''
    if (MCP_TOKEN && token !== MCP_TOKEN) {
      if (logger) logger.warn('[MCP] 认证失败，拒绝连接')
      ws.close(4001, 'Unauthorized')
      return
    }
    if (activeConnection) {
      activeConnection.close(4002, 'Replaced by new connection')
    }
    activeConnection = ws
    availableTools = []
    if (logger) logger.info('[MCP] MCP Server 已连接')

    ws.on('message', (data) => {
      let msg
      try { msg = JSON.parse(String(data)) } catch { return }
      if (msg.method === 'initialize') {
        if (logger) logger.info(`[MCP] Server: ${msg.params?.serverInfo?.name || 'unknown'}`)
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: ++requestId }))
      } else if (msg.result?.tools) {
        availableTools = msg.result.tools || []
        if (logger) logger.info(`[MCP] 注册工具: ${availableTools.map(t => t.name).join(', ')}`)
      } else if (msg.id && pendingRequests.has(msg.id)) {
        const { resolve } = pendingRequests.get(msg.id)
        pendingRequests.delete(msg.id)
        if (msg.error) resolve({ ok: false, error: msg.error.message || 'MCP error' })
        else resolve({ ok: true, content: msg.result?.content || [] })
      }
    })

    ws.on('close', () => {
      if (activeConnection === ws) { activeConnection = null; availableTools = [] }
      if (logger) logger.info('[MCP] MCP Server 断开')
    })

    ws.on('error', () => {
      if (activeConnection === ws) { activeConnection = null; availableTools = [] }
    })
  })
}
function isAvailable() {
  return !!(activeConnection && activeConnection.readyState === 1 && availableTools.length > 0)
}

function getTools() {
  return availableTools.slice()
}

function callTool(name, args = {}) {
  return new Promise((resolve, reject) => {
    if (!isAvailable()) return reject(new Error('MCP Server 不可用'))
    const id = ++requestId
    const timer = setTimeout(() => {
      pendingRequests.delete(id)
      reject(new Error('MCP 工具调用超时'))
    }, TOOL_TIMEOUT_MS)
    pendingRequests.set(id, {
      resolve: (result) => { clearTimeout(timer); resolve(result) },
    })
    activeConnection.send(JSON.stringify({
      jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id,
    }))
  })
}

function stop() {
  if (activeConnection) activeConnection.close()
  if (wss) { wss.close(); wss = null }
  activeConnection = null
  availableTools = []
}

module.exports = { start, stop, isAvailable, getTools, callTool }
