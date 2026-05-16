/**
 * MCP Browser Server — 本地 PC 运行。
 * 主动连接远端 Bot 服务器的 WebSocket 端点，注册浏览器工具。
 * 协议: JSON-RPC 2.0 (MCP 子集)
 *
 * 用法: DONGXUELIAN_MCP_URL=ws://your-server:9877 DONGXUELIAN_MCP_TOKEN=xxx node index.js
 */
const WebSocket = require('ws')
const { searchAndRead, readPage, closeBrowser } = require('./browser')

const MCP_URL = process.env.DONGXUELIAN_MCP_URL || 'ws://localhost:9877'
const MCP_TOKEN = process.env.DONGXUELIAN_MCP_TOKEN || ''
const RECONNECT_INTERVAL_MS = 5000

let ws = null
let reconnectTimer = null

const TOOLS = [
  { name: 'browser_search', description: '用浏览器搜索并返回结果列表', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'browser_read_page', description: '用浏览器打开 URL 并提取正文', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
]

function connect() {
  const url = MCP_TOKEN ? `${MCP_URL}?token=${encodeURIComponent(MCP_TOKEN)}` : MCP_URL
  ws = new WebSocket(url)

  ws.on('open', () => {
    console.log('[MCP Server] 已连接到远端:', MCP_URL)
    send({ jsonrpc: '2.0', method: 'initialize', params: { serverInfo: { name: 'lian-remote-browser', version: '1.0.0' }, capabilities: { tools: true } }, id: 1 })
  })

  ws.on('message', async (data) => {
    let msg
    try { msg = JSON.parse(String(data)) } catch { return }
    if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', result: { tools: TOOLS }, id: msg.id })
    } else if (msg.method === 'tools/call') {
      await handleToolCall(msg)
    }
  })

  ws.on('close', () => {
    console.log('[MCP Server] 连接断开，将在', RECONNECT_INTERVAL_MS / 1000, '秒后重连')
    scheduleReconnect()
  })

  ws.on('error', (err) => {
    console.error('[MCP Server] 连接错误:', err.message)
    ws.close()
  })
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj))
}

async function handleToolCall(msg) {
  const { name, arguments: args } = msg.params || {}
  try {
    let content
    if (name === 'browser_search') {
      const result = await searchAndRead(args.query || '', 12000)
      content = [{ type: 'text', text: JSON.stringify(result.results || [], null, 2) }]
    } else if (name === 'browser_read_page') {
      const result = await readPage(args.url || '', 12000)
      content = [{ type: 'text', text: result.text || '(无法提取正文)' }]
    } else {
      content = [{ type: 'text', text: `未知工具: ${name}` }]
    }
    send({ jsonrpc: '2.0', result: { content }, id: msg.id })
  } catch (err) {
    send({ jsonrpc: '2.0', error: { code: -1, message: err.message || 'tool execution failed' }, id: msg.id })
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, RECONNECT_INTERVAL_MS)
}

process.on('SIGINT', async () => {
  console.log('[MCP Server] 正在关闭...')
  if (ws) ws.close()
  await closeBrowser()
  process.exit(0)
})

module.exports = { name: 'mcp-browser-server', connect, scheduleReconnect }

if (require.main === module) connect()
