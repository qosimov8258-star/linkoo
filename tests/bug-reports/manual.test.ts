import assert from "node:assert/strict"
import { test } from "node:test"

import { manualForQuestion } from "../../lib/bug-reports/manual"

// The helper gets only the part of the manual a question needs (lib/bug-reports/manual.ts).

const filler = (word: string) => `${word} `.repeat(400)
const MANUAL = [
  "<!-- owner note -->",
  "# Qo'llanma",
  "## 1. Umumiy qoidalar",
  `### Filial tanlovi\n${filler("filial")}`,
  "## 2. Menyu xaritasi\nМеню: Продажи, Клиенты, Склад.",
  "## 3. Modullar",
  `### «Продажи» → «Заказы»\nЗаказ создаётся кнопкой «Добавить». ${filler("buyurtma")}`,
  `### «Клиенты»\nКлиент добавляется кнопкой «Добавить клиента». ${filler("mijoz")}`,
  `### «Склад» → «Приход от поставщиков»\nПриход принимается на склад. ${filler("kirim")}`,
  "## 4. Tez-tez uchraydigan holatlar\nMa'lumot ko'rinmayapti → filialni tekshiring.",
].join("\n\n")

test("a manual within the budget is sent whole", () => {
  assert.equal(manualForQuestion("## 2. Menyu\nqisqa", "nimadir", "/clients"), "## 2. Menyu\nqisqa")
})

test("keeps the menu map, the symptom list and the sections of the question, within the budget", () => {
  const picked = manualForQuestion(MANUAL, "Клиент qo'shib bo'lmayapti", "/clients", 5_000)
  assert.ok(picked.length <= 5_000, `too long: ${picked.length}`)
  assert.match(picked, /## 2\. Menyu xaritasi/)
  assert.match(picked, /## 4\. Tez-tez/)
  assert.match(picked, /### «Клиенты»/)
  assert.doesNotMatch(picked, /owner note/)
})

test("the page address points to its module even when the comment names none", () => {
  const picked = manualForQuestion(MANUAL, "tugma ishlamayapti", "/analytics/supplier-incomings/29", 5_000)
  assert.match(picked, /Приход от поставщиков/)
  assert.doesNotMatch(picked, /### «Клиенты»/)
})

test("the helper is told the customer's own language, not the language of quoted menu labels", async () => {
  const { commentLanguage } = await import("../../lib/bug-reports/ai")
  assert.equal(commentLanguage("«Филиалы» sahifasida tugmani topa olmayapman"), "o'zbek (lotin)")
  assert.equal(commentLanguage("Не могу найти кнопку в «Филиалы»"), "rus")
  assert.equal(commentLanguage("Тугмани топа олмаяпман, қаерда?"), "o'zbek (kirill)")
})
