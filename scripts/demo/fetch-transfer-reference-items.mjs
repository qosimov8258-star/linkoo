// Reads the reference's stock transfers (GET only, with the reference page's own session) and saves their product lines
// into scripts/demo/data/transfer-reference-items.json. Nothing is written to the reference.
import { chromium } from 'playwright-core'
import fs from 'fs'
import os from 'os'
import path from 'path'

const exeRoot = path.join(os.homedir(), 'Library/Caches/ms-playwright')
const dirs = fs.readdirSync(exeRoot).filter((d) => d.startsWith('chromium-')).sort()
const exe = path.join(exeRoot, dirs[dirs.length - 1], 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
let headers = null
page.on('request', (request) => {
  if (!headers && request.url().includes('/api/v1/stock/stock_transfer/')) headers = request.headers()
})
await page.goto('https://app.linko.uz/#/stock_transfers?pageSize=25')
await page.waitForSelector('input[name=server]')
await page.fill('input[name=server]', 'time3')
await page.fill('input[name=username]', 'admin')
await page.fill('input[name=password]', '123')
await page.keyboard.press('Enter')
await page.waitForTimeout(9000)
await page.goto('https://app.linko.uz/#/stock_transfers?pageSize=25')
await page.waitForTimeout(6000)
if (!headers) throw new Error('no session headers captured')
const auth = { authorization: headers.authorization, 'accept-language': headers['accept-language'] ?? 'ru' }
const get = async (url) => {
  const response = await fetch(url, { headers: auth })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.json()
}
const list = await get('https://time3.linko.uz/ru/api/v1/stock/stock_transfer/?page_size=200')
const out = {}
for (const row of list.results) {
  const detail = await get(`https://time3.linko.uz/ru/api/v1/stock/stock_transfer/${row.id}/`)
  out[row.id] = (detail.products ?? []).map((line) => ({
    product: line.product?.name ?? '',
    unit: line.product?.measurement?.name ?? '',
    quantity: Number(line.amount) || 0,
    weight: Number(line.total_weight) || 0,
    price: Number(line.price) || 0,
    series: line.series ?? '',
    article: line.product?.vendor_code ?? '',
  }))
}
fs.mkdirSync(new URL('./data', import.meta.url).pathname, { recursive: true })
fs.writeFileSync(new URL('./data/transfer-reference-items.json', import.meta.url), JSON.stringify(out))
console.log('transfers', Object.keys(out).length, 'lines', Object.values(out).reduce((s, l) => s + l.length, 0))
await browser.close()
