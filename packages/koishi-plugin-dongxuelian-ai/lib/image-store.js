/**
 * MODULE: 图片历史存储。
 * 职责: 存储群聊图片 URL、去重、占位符替换、2h 过期清理。
 * 边界: 不调用 AI API、不发送消息。
 * 状态: 磁盘 JSON 文件 (data/image-history/{channelKey}.json)。
 */
const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('./constants')

const IMAGE_HISTORY_DIR = path.join(DATA_DIR, 'image-history')
const IMAGE_EXPIRE_MS = 2 * 60 * 60 * 1000
const MAX_IMAGES_PER_CHANNEL = 10
const MAX_FILE_BYTES = 128 * 1024

function getSafeKey(channelKey) {
  return String(channelKey || '').replace(/[^a-zA-Z0-9.:_-]/g, '_')
}

function getFilePath(channelKey) {
  return path.join(IMAGE_HISTORY_DIR, getSafeKey(channelKey) + '.json')
}

function readImageHistory(channelKey) {
  try {
    fs.mkdirSync(IMAGE_HISTORY_DIR, { recursive: true })
    const file = getFilePath(channelKey)
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return { images: {} }
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { images: {} }
  }
}

function writeImageHistory(channelKey, data) {
  try {
    fs.mkdirSync(IMAGE_HISTORY_DIR, { recursive: true })
    fs.writeFileSync(getFilePath(channelKey), JSON.stringify(data), 'utf8')
  } catch {}
}

function cleanExpired(data) {
  const now = Date.now()
  const images = data.images || {}
  for (const id of Object.keys(images)) {
    if (now - (images[id].ts || 0) > IMAGE_EXPIRE_MS) delete images[id]
  }
  const keys = Object.keys(images)
  if (keys.length > MAX_IMAGES_PER_CHANNEL) {
    keys.sort((a, b) => (images[a].ts || 0) - (images[b].ts || 0))
    for (let i = 0; i < keys.length - MAX_IMAGES_PER_CHANNEL; i++) delete images[keys[i]]
  }
  return data
}
function storeImageUrl(channelKey, messageId, url) {
  if (!channelKey || !messageId || !url) return
  const data = cleanExpired(readImageHistory(channelKey))
  if (data.images[messageId]) return
  data.images[messageId] = { url: String(url), ts: Date.now(), analyzed: false, analysis: null }
  writeImageHistory(channelKey, data)
}

function getImageEntry(channelKey, messageId) {
  const data = readImageHistory(channelKey)
  return data.images[messageId] || null
}

function getRecentImages(channelKey, limit = 5) {
  const data = cleanExpired(readImageHistory(channelKey))
  writeImageHistory(channelKey, data)
  const entries = Object.entries(data.images || {})
    .map(([id, entry]) => ({ messageId: id, ...entry }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, limit)
  return entries
}

function markAnalyzed(channelKey, messageId, analysis) {
  const data = readImageHistory(channelKey)
  if (!data.images[messageId]) return false
  data.images[messageId].analyzed = true
  data.images[messageId].analysis = String(analysis || '').slice(0, 500)
  writeImageHistory(channelKey, data)
  return true
}

function isAlreadyAnalyzed(channelKey, messageId) {
  const entry = getImageEntry(channelKey, messageId)
  return !!(entry && entry.analyzed)
}

function getCachedAnalysis(channelKey, messageId) {
  const entry = getImageEntry(channelKey, messageId)
  return entry && entry.analyzed ? entry.analysis : null
}

function replaceImagePlaceholder(channelKey, messageId, analysis) {
  const { readConversationDisk, writeConversationDisk } = require('./conversation')
  const convKey = channelKey
  const diskData = readConversationDisk(convKey)
  if (!diskData || !Array.isArray(diskData.messages)) return false
  let replaced = false
  for (let i = diskData.messages.length - 1; i >= 0; i--) {
    const msg = diskData.messages[i]
    if (msg.role === 'user' && msg.content && msg.content.includes('[图片]') && !msg.content.includes('[图片]:')) {
      msg.content = msg.content.replace('[图片]', `[图片]: ${String(analysis).slice(0, 200)}`)
      replaced = true
      break
    }
  }
  if (replaced) writeConversationDisk(convKey, diskData)
  return replaced
}

module.exports = {
  storeImageUrl,
  getImageEntry,
  getRecentImages,
  markAnalyzed,
  isAlreadyAnalyzed,
  getCachedAnalysis,
  replaceImagePlaceholder,
  IMAGE_HISTORY_DIR,
}
