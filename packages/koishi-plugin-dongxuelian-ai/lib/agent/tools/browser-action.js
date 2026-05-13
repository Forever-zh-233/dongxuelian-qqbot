/**
 * MODULE: 受控浏览器工具。
 * 职责: 提供最小浏览器动作 open/title/text/close，默认关闭且按危险工具策略确认。
 * 边界: 不点击、不输入、不下载、不截图落盘。
 * 状态: browser/page/currentUrl (module-level)。
 */
const fs = require('fs')

let browser = null
let page = null
let currentUrl = ''

function findBrowser() {
  const envPath = process.env.DONGXUELIAN_BROWSER_PATH || process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH
  const candidates = [
    envPath,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/snap/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean)
  for (const item of candidates) {
    try { if (fs.existsSync(item)) return item } catch {}
  }
  return null
}

function validateUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) throw new Error('url 不能为空')
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只允许 http/https URL')
  return parsed.toString()
}

async function ensurePage() {
  if (page && !page.isClosed()) return page
  const puppeteer = require('puppeteer-core')
  const executablePath = findBrowser()
  if (!executablePath) throw new Error('未找到 Chrome/Edge/Chromium，请设置 DONGXUELIAN_BROWSER_PATH')
  browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })
  page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  page.setDefaultTimeout(12000)
  page.setDefaultNavigationTimeout(20000)
  return page
}

async function closeBrowser() {
  if (page) { try { await page.close() } catch {} }
  if (browser) { try { await browser.close() } catch {} }
  page = null
  browser = null
  currentUrl = ''
}

async function openUrl(url) {
  const targetUrl = validateUrl(url)
  const p = await ensurePage()
  await p.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
  currentUrl = p.url()
  const title = await p.title().catch(() => '')
  return `已打开：${currentUrl}\n标题：${title || '(无标题)'}`
}

async function getTitle() {
  const p = await ensurePage()
  const title = await p.title().catch(() => '')
  return `当前页面：${currentUrl || p.url()}\n标题：${title || '(无标题)'}`
}

async function getText() {
  const p = await ensurePage()
  const text = await p.evaluate(() => document.body ? document.body.innerText : '')
  const clean = String(text || '').replace(/\n{3,}/g, '\n\n').trim()
  return `当前页面：${currentUrl || p.url()}\n文本：\n${clean.slice(0, 6000)}${clean.length > 6000 ? '\n...(截断)' : ''}`
}

module.exports = {
  definition: {
    name: 'browser_action',
    description: '受控浏览器动作。支持 open/title/text/close；默认关闭，启用后也按危险工具策略确认。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['open', 'title', 'text', 'close'], description: '动作名称' },
        url: { type: 'string', description: 'open 动作的 http/https URL' },
      },
      required: ['action'],
    },
  },
  async execute(params = {}) {
    const action = String(params.action || '').trim().toLowerCase()
    if (action === 'open') return openUrl(params.url)
    if (action === 'title') return getTitle()
    if (action === 'text') return getText()
    if (action === 'close') { await closeBrowser(); return '浏览器已关闭' }
    throw new Error(`不支持的浏览器动作：${action}`)
  },
  dangerous: true,
  defaultChannels: ['dashboard'],
}
