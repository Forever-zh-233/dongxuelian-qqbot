/**
 * MODULE: Agent 轻量 HTTP 搜索。
 * 职责: 用普通 HTTP 拉取搜索结果 HTML，并抽取候选结果供排序过滤。
 * 边界: 不启动浏览器、不调用 AI API、不读写文件。
 * 状态: 无。
 */
const { rankSearchCandidates, formatSearchResults, buildSearchFailureText } = require('./search-results')

const HTTP_SEARCH_ENDPOINTS = [
  { name: 'DuckDuckGo Lite', url: query => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}` },
  { name: 'DuckDuckGo HTML', url: query => `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}` },
  { name: 'Bing HTTP', url: query => `https://www.bing.com/search?q=${encodeURIComponent(query)}` },
]
const HTTP_SEARCH_DEFAULT_TIMEOUT_MS = 5000
const HTTP_SEARCH_DEFAULT_TOTAL_TIMEOUT_MS = 12000
const HTTP_SEARCH_DEFAULT_MAX_BYTES = 512 * 1024
const HTTP_SEARCH_DEFAULT_QUERY_LIMIT = 2
const HTTP_SEARCH_MAX_CANDIDATES = 100
const HTTP_SEARCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function parseHttpSearchPositiveInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function getHttpSearchLimits(options = {}) {
  return {
    timeoutMs: parseHttpSearchPositiveInt(options.timeoutMs || process.env.DONGXUELIAN_HTTP_SEARCH_TIMEOUT_MS, HTTP_SEARCH_DEFAULT_TIMEOUT_MS, 1000, 15000),
    totalTimeoutMs: parseHttpSearchPositiveInt(options.totalTimeoutMs || process.env.DONGXUELIAN_HTTP_SEARCH_TOTAL_TIMEOUT_MS, HTTP_SEARCH_DEFAULT_TOTAL_TIMEOUT_MS, 2000, 30000),
    maxBytes: parseHttpSearchPositiveInt(options.maxBytes || process.env.DONGXUELIAN_HTTP_SEARCH_MAX_BYTES, HTTP_SEARCH_DEFAULT_MAX_BYTES, 64 * 1024, 2 * 1024 * 1024),
    queryLimit: parseHttpSearchPositiveInt(options.queryLimit || process.env.DONGXUELIAN_HTTP_SEARCH_QUERY_LIMIT, HTTP_SEARCH_DEFAULT_QUERY_LIMIT, 1, 4),
  }
}

function decodeHttpSearchEntities(value = '') {
  return String(value || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const key = String(entity || '').toLowerCase()
    if (key === 'amp') return '&'
    if (key === 'lt') return '<'
    if (key === 'gt') return '>'
    if (key === 'quot') return '"'
    if (key === 'apos') return "'"
    if (key === 'nbsp') return ' '
    if (key.startsWith('#x')) {
      const code = parseInt(key.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (key.startsWith('#')) {
      const code = parseInt(key.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return match
  })
}

function stripHttpSearchTags(html = '') {
  return decodeHttpSearchEntities(String(html || '')
    .replace(/<script\b[^>]{0,500}>[\s\S]{0,20000}<\/script>/gi, ' ')
    .replace(/<style\b[^>]{0,500}>[\s\S]{0,20000}<\/style>/gi, ' ')
    .replace(/<[^>]{0,500}>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function pickHttpSearchAttr(attrs = '', name = '') {
  const source = String(attrs || '')
  const doubleQuoted = new RegExp(`\\b${name}\\s*=\\s*"([^"]{0,2000})"`, 'i').exec(source)
  if (doubleQuoted) return doubleQuoted[1]
  const singleQuoted = new RegExp(`\\b${name}\\s*=\\s*'([^']{0,2000})'`, 'i').exec(source)
  if (singleQuoted) return singleQuoted[1]
  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]{1,2000})`, 'i').exec(source)
  return unquoted ? unquoted[1] : ''
}

function resolveHttpSearchUrl(rawUrl = '', baseUrl = 'https://duckduckgo.com/') {
  const decoded = decodeHttpSearchEntities(rawUrl).trim()
  if (!decoded || decoded.startsWith('#') || /^javascript:/i.test(decoded)) return ''
  try {
    const parsed = new URL(decoded, baseUrl)
    if (parsed.hostname.endsWith('duckduckgo.com')) {
      const redirected = parsed.searchParams.get('uddg')
      if (redirected) return resolveHttpSearchUrl(redirected, baseUrl)
    }
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function extractHttpSearchCandidates(html = '', baseUrl = 'https://duckduckgo.com/') {
  const source = String(html || '')
  const candidates = []
  const anchorRe = /<a\b([^>]{0,2000})>([\s\S]{0,4000}?)<\/a>/gi
  let match = null
  while ((match = anchorRe.exec(source)) && candidates.length < HTTP_SEARCH_MAX_CANDIDATES) {
    const attrs = match[1] || ''
    const title = stripHttpSearchTags(match[2] || '')
    if (!title || title.length < 2) continue
    const url = resolveHttpSearchUrl(pickHttpSearchAttr(attrs, 'href'), baseUrl)
    if (!url) continue
    const start = Math.max(0, match.index - 800)
    const end = Math.min(source.length, match.index + match[0].length + 1600)
    const nearbyText = stripHttpSearchTags(source.slice(start, end))
    const snippet = nearbyText.replace(title, '').replace(/\s+/g, ' ').trim().slice(0, 420)
    candidates.push({
      title: title.slice(0, 180),
      url,
      snippet,
      text: nearbyText.slice(0, 500),
    })
  }
  return candidates
}

async function readHttpSearchResponseText(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text()
    return String(text || '').slice(0, maxBytes)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let output = ''
  let total = 0
  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = value instanceof Uint8Array ? value : Buffer.from(value)
    const remaining = maxBytes - total
    const part = chunk.length > remaining ? chunk.slice(0, remaining) : chunk
    total += part.length
    output += decoder.decode(part, { stream: total < maxBytes })
    if (chunk.length > remaining) {
      try { await reader.cancel() } catch {}
      break
    }
  }
  output += decoder.decode()
  return output
}

async function fetchHttpSearchEndpoint(endpoint, query, limits, remainingMs) {
  if (typeof fetch !== 'function') throw new Error('当前 Node.js 不支持 fetch，无法执行轻量 HTTP 搜索')
  const controller = new AbortController()
  const timeoutMs = Math.max(500, Math.min(limits.timeoutMs, remainingMs))
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(endpoint.url(query), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': HTTP_SEARCH_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return readHttpSearchResponseText(response, limits.maxBytes)
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`超时（${timeoutMs}ms）`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function runHttpSearch(queries = [], options = {}) {
  const limits = getHttpSearchLimits(options)
  const queryList = (Array.isArray(queries) ? queries : [queries])
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limits.queryLimit)
  const firstQuery = queryList[0] || ''
  const failures = []
  if (!firstQuery) return { ok: false, text: buildSearchFailureText('', ['query 为空']), failures }

  const startedAt = Date.now()
  for (const query of queryList) {
    for (const endpoint of HTTP_SEARCH_ENDPOINTS) {
      const remainingMs = limits.totalTimeoutMs - (Date.now() - startedAt)
      if (remainingMs < 500) {
        failures.push('轻量 HTTP 搜索总超时')
        return { ok: false, text: buildSearchFailureText(query, failures), failures }
      }
      try {
        const html = await fetchHttpSearchEndpoint(endpoint, query, limits, remainingMs)
        const candidates = extractHttpSearchCandidates(html, endpoint.url(query))
        const ranked = rankSearchCandidates(candidates, query)
        const text = formatSearchResults(query, ranked)
        if (text) return { ok: true, text, query, engine: endpoint.name, failures }
        failures.push(`${endpoint.name}: 未提取到有效搜索结果`)
      } catch (error) {
        failures.push(`${endpoint.name}: ${error.message || String(error)}`)
      }
    }
  }
  return { ok: false, text: buildSearchFailureText(firstQuery, failures), failures }
}

module.exports = {
  HTTP_SEARCH_ENDPOINTS,
  decodeHttpSearchEntities,
  stripHttpSearchTags,
  resolveHttpSearchUrl,
  extractHttpSearchCandidates,
  runHttpSearch,
}
