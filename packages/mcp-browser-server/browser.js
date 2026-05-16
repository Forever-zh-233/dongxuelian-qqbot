/**
 * Puppeteer 封装：搜索、读页面、提取正文。
 * 本地 PC 运行，不部署到服务器。
 */
const puppeteer = require('puppeteer-core')

let browser = null

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH || '',
].filter(Boolean)

async function ensureBrowser() {
  if (browser && browser.isConnected()) return browser
  for (const executablePath of CHROME_PATHS) {
    try {
      browser = await puppeteer.launch({
        executablePath,
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      })
      return browser
    } catch {}
  }
  throw new Error('无法启动 Chrome，请设置 CHROME_PATH 环境变量')
}

async function searchAndRead(query, timeoutMs = 12000) {
  const b = await ensureBrowser()
  const page = await b.newPage()
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    await page.waitForSelector('#b_results', { timeout: 5000 }).catch(() => {})
    const results = await page.evaluate(() => {
      const items = []
      document.querySelectorAll('#b_results .b_algo').forEach(el => {
        const a = el.querySelector('h2 a')
        const snippet = el.querySelector('.b_caption p, .b_lineclamp2')
        if (a) {
          items.push({
            title: a.textContent?.trim() || '',
            url: a.href || '',
            snippet: snippet?.textContent?.trim() || '',
          })
        }
      })
      return items.slice(0, 8)
    })
    // 自动读取前 2 个结果的正文
    for (let i = 0; i < Math.min(2, results.length); i++) {
      try {
        const r = await readPage(results[i].url, 8000)
        if (r.ok && r.text.length > 80) results[i].text = r.text.slice(0, 1500)
      } catch {}
    }
    return { ok: true, results }
  } finally {
    await page.close().catch(() => {})
  }
}

async function readPage(url, timeoutMs = 12000) {
  const b = await ensureBrowser()
  const page = await b.newPage()
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    const text = await page.evaluate(() => {
      const selectors = ['article', 'main', '.content', '.post-content', '#content', '.article-content']
      for (const sel of selectors) {
        const el = document.querySelector(sel)
        if (el && el.textContent.trim().length > 100) return el.textContent.trim().slice(0, 3000)
      }
      const body = document.body?.textContent?.trim() || ''
      return body.slice(0, 3000)
    })
    return { ok: true, text }
  } finally {
    await page.close().catch(() => {})
  }
}

async function closeBrowser() {
  if (browser) { await browser.close().catch(() => {}); browser = null }
}

module.exports = { searchAndRead, readPage, closeBrowser }
