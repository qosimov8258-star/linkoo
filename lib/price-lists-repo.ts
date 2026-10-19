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

export async function listPriceLists(): Promise<PriceList[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM price_lists ORDER BY id ASC").all()) as Row[]
  return rows.map(rowToPriceList)
}

export async function getPriceList(id: number): Promise<PriceList | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM price_lists WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToPriceList(row) : null
}

export async function createPriceList(input: PriceListInput): Promise<PriceList> {
  const db = getDb()
  const result = (await db
      .prepare("INSERT INTO price_lists (name, currency, linked_list, calc_method) VALUES (@name, @currency, @linkedList, @calcMethod)")
      .run(input))
  return (await getPriceList(Number(result.lastInsertRowid)))!
}

export async function updatePriceList(id: number, input: PriceListInput): Promise<PriceList | null> {
  if (!(await getPriceList(id))) return null
  const db = getDb()
  await db.prepare(
        `UPDATE price_lists SET name = @name, currency = @currency, linked_list = @linkedList,
       calc_method = @calcMethod, updated_at = datetime('now') WHERE id = @id`,
      ).run({ ...input, id })
  return (await getPriceList(id))
}

export async function deletePriceList(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM price_lists WHERE id = ?").run(id))
  return result.changes > 0
}
