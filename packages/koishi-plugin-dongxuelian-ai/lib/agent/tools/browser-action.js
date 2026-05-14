// 受控浏览器工具：提供最小浏览器动作，默认关闭且按危险工具策略确认。
const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('../../constants')

let browser = null
let page = null
let currentUrl = ''
let cleanupRegistered = false
let idleTimer = null
let launchPromise = null
let closePromise = null
let actionQueue = Promise.resolve()
let screenshotCounter = 0
const IDLE_CLOSE_MS = 5 * 60 * 1000

function registerCleanup() {
  if (cleanupRegistered) return
  cleanupRegistered = true
  process.once('beforeExit', () => { closeBrowser().catch(() => {}) })
  process.once('exit', () => {
    page = null
    browser = null
    currentUrl = ''
  })
}

function refreshIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  if (!browser) return
  idleTimer = setTimeout(() => { closeBrowser().catch(() => {}) }, IDLE_CLOSE_MS)
  if (idleTimer.unref) idleTimer.unref()
}

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

async function launchPage() {
  const puppeteer = require('puppeteer-core')
  const executablePath = findBrowser()
  if (!executablePath) throw new Error('未找到 Chrome/Edge/Chromium，请设置 DONGXUELIAN_BROWSER_PATH')
  browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  })
  registerCleanup()
  page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  page.setDefaultTimeout(12000)
  page.setDefaultNavigationTimeout(20000)
  currentUrl = page.url()
  refreshIdleTimer()
  return page
}

async function ensurePage() {
  if (closePromise) await closePromise
  if (page && !page.isClosed()) {
    refreshIdleTimer()
    return page
  }
  if (!launchPromise) {
    launchPromise = launchPage().finally(() => { launchPromise = null })
  }
  return launchPromise
}

async function closeBrowser() {
  if (closePromise) return closePromise
  closePromise = (async () => {
    if (launchPromise) {
      try { await launchPromise } catch {}
    }
    const closingPage = page
    const closingBrowser = browser
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    page = null
    browser = null
    currentUrl = ''
    try {
      if (closingPage) { try { await closingPage.close() } catch {} }
      if (closingBrowser) { try { await closingBrowser.close() } catch {} }
    } finally {
      closePromise = null
    }
  })()
  return closePromise
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

async function getSnapshot() {
  const p = await ensurePage()
  const snapshot = await p.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 40).map((a, index) => ({ index, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 120), href: a.href }))
    const buttons = Array.from(document.querySelectorAll('button,input[type="button"],input[type="submit"]')).slice(0, 40).map((el, index) => ({ index, text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 120) }))
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 30).map(el => ({ level: el.tagName.toLowerCase(), text: (el.innerText || '').trim().slice(0, 160) }))
    return { title: document.title || '', url: location.href, headings, links, buttons }
  })
  return JSON.stringify(snapshot, null, 2)
}

function requireSelector(selector) {
  const value = String(selector || '').trim()
  if (!value || value.length > 300) throw new Error('selector 不能为空或过长')
  return value
}

async function clickSelector(selector) {
  const p = await ensurePage()
  const value = requireSelector(selector)
  await p.click(value, { delay: 20 })
  currentUrl = p.url()
  return `已点击：${value}\n当前页面：${currentUrl}`
}

async function typeSelector(selector, text) {
  const p = await ensurePage()
  const value = requireSelector(selector)
  const input = String(text || '')
  if (input.length > 1000) throw new Error('输入文本过长')
  await p.click(value, { delay: 20 })
  await p.keyboard.type(input, { delay: 5 })
  return `已输入到：${value}`
}

async function waitForTarget(selector, timeoutMs) {
  const p = await ensurePage()
  const value = requireSelector(selector)
  const timeout = Math.min(30000, Math.max(1000, parseInt(timeoutMs, 10) || 12000))
  await p.waitForSelector(value, { timeout })
  currentUrl = p.url()
  return `已等待到：${value}`
}

async function takeScreenshot() {
  const p = await ensurePage()
  const dir = path.join(DATA_DIR, 'agent-browser')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `screenshot-${Date.now()}-${++screenshotCounter}.png`)
  await p.screenshot({ path: file, fullPage: false, type: 'png' })
  return `截图已保存：${file}`
}

function runQueued(action) {
  const next = actionQueue.then(action, action)
  actionQueue = next.catch(() => {})
  return next
}

module.exports = {
  definition: {
    name: 'browser_action',
    description: '受控浏览器动作。支持 start/stop/navigate/snapshot/click/type/screenshot/wait_for，并兼容 open/title/text/close；默认关闭，启用后也按危险工具策略确认。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop', 'navigate', 'snapshot', 'click', 'type', 'screenshot', 'wait_for', 'open', 'title', 'text', 'close'], description: '动作名称' },
        url: { type: 'string', description: 'navigate/open 动作的 http/https URL' },
        selector: { type: 'string', description: 'click/type/wait_for 动作的 CSS 选择器' },
        text: { type: 'string', description: 'type 动作输入文本' },
        timeoutMs: { type: 'number', description: 'wait_for 动作等待毫秒数，默认 12000，最大 30000' },
      },
      required: ['action'],
    },
  },
  async execute(params = {}) {
    return runQueued(async () => {
      const action = String(params.action || '').trim().toLowerCase()
      if (action === 'start') { await ensurePage(); return '浏览器已启动' }
      if (action === 'navigate' || action === 'open') return openUrl(params.url)
      if (action === 'title') return getTitle()
      if (action === 'text') return getText()
      if (action === 'snapshot') return getSnapshot()
      if (action === 'click') return clickSelector(params.selector)
      if (action === 'type') return typeSelector(params.selector, params.text)
      if (action === 'wait_for') return waitForTarget(params.selector, params.timeoutMs)
      if (action === 'screenshot') return takeScreenshot()
      if (action === 'stop' || action === 'close') { await closeBrowser(); return '浏览器已关闭' }
      throw new Error(`不支持的浏览器动作：${action}`)
    })
  },
  dangerous: true,
  defaultChannels: ['dashboard'],
}
