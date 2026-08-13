import "server-only"

import { getDb } from "@/lib/db"
import type { PriceList } from "@/components/analytics/price-lists-data"

type Row = {
  id: number
  name: string
  currency: string
  linked_list: string
  calc_method: string
  created_at: string
}

function rowToPriceList(row: Row): PriceList {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    linkedList: row.linked_list,
    calcMethod: row.calc_method,
    createdDate: new Date(row.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }),
  }
}

export type PriceListInput = { name: string; currency: string; linkedList: string; calcMethod: string }

export function parsePriceListInput(body: unknown): PriceListInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const currency = typeof value.currency === "string" && value.currency.trim() ? value.currency.trim() : "SUM"
  const linkedList = typeof value.linkedList === "string" && value.linkedList.trim() ? value.linkedList.trim() : "Не указано"
  const calcMethod = typeof value.calcMethod === "string" && value.calcMethod.trim() ? value.calcMethod.trim() : "Не указано"
  return { name, currency, linkedList, calcMethod }
}

export function listPriceLists(): PriceList[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM price_lists ORDER BY id DESC").all() as Row[]
  return rows.map(rowToPriceList)
}

export function getPriceList(id: number): PriceList | null {
  const db = getDb()
  const row = db.prepare("SELECT * FROM price_lists WHERE id = ?").get(id) as Row | undefined
  return row ? rowToPriceList(row) : null
}

export function createPriceList(input: PriceListInput): PriceList {
  const db = getDb()
  const result = db
    .prepare("INSERT INTO price_lists (name, currency, linked_list, calc_method) VALUES (@name, @currency, @linkedList, @calcMethod)")
    .run(input)
  return getPriceList(Number(result.lastInsertRowid))!
}

export function updatePriceList(id: number, input: PriceListInput): PriceList | null {
  if (!getPriceList(id)) return null
  const db = getDb()
  db.prepare(
    `UPDATE price_lists SET name = @name, currency = @currency, linked_list = @linkedList,
       calc_method = @calcMethod, updated_at = datetime('now') WHERE id = @id`,
  ).run({ ...input, id })
  return getPriceList(id)
}

export function deletePriceList(id: number): boolean {
  const db = getDb()
  const result = db.prepare("DELETE FROM price_lists WHERE id = ?").run(id)
  return result.changes > 0
}
