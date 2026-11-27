import "server-only"

import { readFile } from "node:fs/promises"
import path from "node:path"

// The system manual the helper answers from (docs/ai-qollanma.md, appended to its system prompt). Read
// from disk and kept for 60 s: an edited manual applies within a minute without a restart, and a burst
// of reports reads the file once. The Docker image copies docs/ next to the server (Dockerfile). A
// missing or unreadable file is "": the helper then has nothing to answer from and, by its prompt,
// says "xato" — the report simply goes to the developer.

const MANUAL_TTL_MS = 60_000
/** A bound on what goes into one prompt (the provider's token budget). */
const MANUAL_MAX_CHARS = 100_000

declare global {
  var __mezonBugManual: { text: string; readAt: number } | undefined
}

export function manualPath(): string {
  return path.join(process.cwd(), "docs", "ai-qollanma.md")
}

/** The manual's text ("" when there is none). */
export async function readManual(): Promise<string> {
  const cached = globalThis.__mezonBugManual
  if (cached && Date.now() - cached.readAt < MANUAL_TTL_MS) return cached.text
  let text = ""
  try {
    text = (await readFile(manualPath(), "utf8")).trim()
  } catch {
    text = ""
  }
  if (text.length > MANUAL_MAX_CHARS) text = text.slice(0, MANUAL_MAX_CHARS)
  globalThis.__mezonBugManual = { text, readAt: Date.now() }
  return text
}

// --- The part of the manual one question needs -----------------------------------------------------
// The whole manual (~30k characters, ~8k tokens) does not fit the provider's per-minute token budget
// (Groq's on-demand tier refuses a request over 8000 tokens per minute), so the helper gets the menu
// map, the symptom list and the sections that share the most words with the customer's comment and
// the page they were on. Pure: tested in tests/bug-reports/manual.test.ts.

/** What one helper call may carry of the manual (characters). */
export const HELPER_MANUAL_MAX_CHARS = 9_000

/** Words of a page address that name a module of the manual (the URL itself is English). */
const PAGE_HINTS: Array<[RegExp, string]> = [
  [/order|sales|draft-order/, "заказ"],
  [/return/, "возврат"],
  [/client|shop|territory/, "клиент"],
  [/supplier-incoming|supply/, "приход поставщик"],
  [/stock|warehouse|balance-stock/, "остаток склад"],
  [/transfer/, "передач"],
  [/write-off|inventor/, "списание инвентаризация"],
  [/price-list|repricing|product/, "продукт прайс переоценка"],
  [/cash|finance|payment|debt|balances/, "касса оплат баланс"],
  [/employee|staff|attendance|kpi/, "сотрудник персонал"],
  [/access-right|users|permission/, "права доступа"],
  [/time-restriction|order-time/, "ограничение времени"],
  [/product-restriction/, "ограничение продуктов"],
  [/settings|currency|profile/, "настройки"],
  [/analytics|report/, "аналитика отчет"],
]

/** Lower-case word stems (the first 5 letters of words of 4+ letters, Latin and Cyrillic). */
function stems(text: string): Set<string> {
  const out = new Set<string>()
  for (const word of text.toLowerCase().match(/[\p{L}']{4,}/gu) ?? []) out.add(word.replace(/'/g, "").slice(0, 5))
  return out
}

type ManualSection = { heading: string; text: string; index: number }

function splitSections(manual: string): ManualSection[] {
  const body = manual.replace(/<!--[\s\S]*?-->/g, "").trim()
  return body
    .split(/(?=^#{2,3} )/m)
    .map((text, index) => ({ heading: text.split("\n", 1)[0], text: text.trim(), index }))
    .filter((section) => section.text.length > 0)
}

/** The sections of `manual` for a question (the comment plus the page address), at most `maxChars`. */
export function manualForQuestion(manual: string, comment: string, pageUrl: string, maxChars = HELPER_MANUAL_MAX_CHARS): string {
  if (manual.length <= maxChars) return manual
  const sections = splitSections(manual)
  const hints = PAGE_HINTS.filter(([pattern]) => pattern.test(pageUrl.toLowerCase())).map(([, words]) => words).join(" ")
  const query = stems(`${comment} ${hints}`)
  const hintStems = stems(hints)
  const always = sections.filter((section) => /^## (2|4)\./.test(section.heading))
  const scored = sections
    .filter((section) => section.heading.startsWith("### "))
    .map((section) => {
      const words = stems(section.text)
      let score = 0
      for (const stem of query) if (words.has(stem)) score += 1
      for (const stem of hintStems) if (stems(section.heading).has(stem)) score += 3
      return { section, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.section.index - b.section.index)
  const chosen: ManualSection[] = []
  let used = 0
  for (const section of always) {
    if (used + section.text.length > maxChars) continue
    chosen.push(section)
    used += section.text.length
  }
  for (const { section } of scored) {
    if (used + section.text.length > maxChars) continue
    chosen.push(section)
    used += section.text.length
  }
  return chosen
    .sort((a, b) => a.index - b.index)
    .map((section) => section.text)
    .join("\n\n")
}
