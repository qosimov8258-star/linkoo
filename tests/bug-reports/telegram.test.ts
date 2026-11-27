import assert from "node:assert/strict"
import { test } from "node:test"

import { analysisText, projectName, projectTag } from "../../lib/bug-reports/telegram"
import type { BugAnalysis } from "../../lib/bug-reports/types"

// The developer's Telegram texts (lib/bug-reports/telegram.ts): one bot for several projects.

const analysis: BugAnalysis = {
  qisqa: "Saqlash tugmasi 500 qaytaradi",
  skrinshotda_korinadi: "«Ошибка сервера» xabari",
  mijoz_nima_demoqchi: "Buyurtmani saqlamoqchi",
  qayerda: "Продажи → Заказы → Сохранить → POST /api/orders",
  texnik_sabab: "POST /api/orders 500 <html>",
  yechim: "Server logini tekshirish",
  turi: "bug",
  jiddiylik: "yuqori",
  ishonch: "taxmin",
  dalillar: ["POST /api/orders 500"],
}

test("the project name and its hashtag come from BUG_REPORT_PROJECT_NAME (Mezon by default)", () => {
  const saved = process.env.BUG_REPORT_PROJECT_NAME
  delete process.env.BUG_REPORT_PROJECT_NAME
  assert.equal(projectName(), "Mezon")
  assert.equal(projectTag(), "#Mezon")
  process.env.BUG_REPORT_PROJECT_NAME = "Demo CRM 2"
  assert.equal(projectTag(), "#Demo_CRM_2")
  if (saved === undefined) delete process.env.BUG_REPORT_PROJECT_NAME
  else process.env.BUG_REPORT_PROJECT_NAME = saved
})

test("the analysis message names the project, quotes the customer and escapes HTML", () => {
  const text = analysisText(7, analysis, "Saqlab bo'lmayapti <b>yordam</b>")
  assert.match(text, /#Mezon/)
  assert.match(text, /xato #7/)
  assert.match(text, /<blockquote>Saqlab bo'lmayapti &lt;b&gt;yordam&lt;\/b&gt;<\/blockquote>/)
  assert.match(text, /&lt;html&gt;/)
  assert.match(text, /Taxmin, tekshirib ko'ring/)
})

test("long fields keep the whole message within Telegram's 4096 characters", () => {
  const long = "x".repeat(5000)
  const text = analysisText(8, { ...analysis, qisqa: long, mijoz_nima_demoqchi: long, skrinshotda_korinadi: long, qayerda: long, texnik_sabab: long, yechim: long }, long)
  assert.ok(text.length < 4096, `too long: ${text.length}`)
})
