import "server-only"

import { getDb } from "@/lib/db"
import type { OrderExcelCode, OrderExcelSetting } from "@/components/analytics/order-excel-data"

type Row = { id: number; name: string; key: string; codes: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS order_excel_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      key TEXT NOT NULL DEFAULT '',
      codes TEXT NOT NULL DEFAULT '[]'
    );
  `)
}

function toItem(row: Row): OrderExcelSetting {
  let codes: OrderExcelCode[] = []
  try {
    codes = JSON.parse(row.codes) as OrderExcelCode[]
  } catch {
    codes = []
  }
  return { id: row.id, name: row.name, key: row.key, codes }
}

export async function listOrderExcelSettings(search: string): Promise<OrderExcelSetting[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db.prepare("SELECT id, name, key, codes FROM order_excel_settings WHERE (@search = '' OR name ILIKE '%' || @search || '%') ORDER BY id ASC").all({ search: search.trim() })) as Row[]
  return rows.map(toItem)
}

export async function getOrderExcelSetting(id: number): Promise<OrderExcelSetting | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT id, name, key, codes FROM order_excel_settings WHERE id = ?").get(id)) as Row | undefined
  return row ? toItem(row) : null
}

/** `activeCodes` = the switched-on column numbers; every other column of the layout is switched off. */
export async function updateOrderExcelCodes(id: number, activeCodes: string[]): Promise<OrderExcelSetting | null> {
  const current = await getOrderExcelSetting(id)
  if (!current) return null
  const active = new Set(activeCodes)
  const codes = current.codes.map((entry) => ({ code: entry.code, isActive: active.has(entry.code) }))
  const db = getDb()
  await db.prepare("UPDATE order_excel_settings SET codes = @codes WHERE id = @id").run({ id, codes: JSON.stringify(codes) })
  return { ...current, codes }
}
