import "server-only"

import { getDb, withTransaction } from "@/lib/db"
import { nameKey } from "@/lib/finance/entities"
import { nowLocalIso, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { InventoryError } from "@/lib/inventory-items-api"
import { actorName, insertLog, type Actor } from "@/lib/inventory-items-repo"
import { ensureInventorySchema } from "@/lib/inventory-items-schema"
import { INVENTORY_CONDITIONS, type InventoryImportRow } from "@/lib/inventory-items-types"

// "Импорт с Excel" (demo main/gear/import_excel/): the template lists the
// clients of the chosen agents / zones (ID клиента | Клиент | Зона | Агент) and
// the gear columns to fill (Тип инвентаря | Серийный номер | Инвентарный номер |
// Склад | Состояние | Дата | Комментарий). Every filled line becomes an item
// attached to that client (or in the warehouse when the client is empty), with
// its "create" log. All lines are checked first; nothing is saved on an error.

type Prepared = {
  line: number
  productId: number
  productName: string
  clientId: number | null
  client: string
  serialNumber: string
  stockNumber: string
  warehouse: string
  condition: string
  date: string
  comment: string
}

export type InventoryImportResult = { created: number }

/** YYYY-MM-DD of a date cell: any stored date text, or an Excel serial day number. */
function cellDay(value: string): string | null {
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    const serial = Math.floor(Number(value))
    if (serial < 20000 || serial > 80000) return null
    return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10)
  }
  return parseAnyDay(value)
}

export async function importInventoryItems(rows: InventoryImportRow[], user: Actor): Promise<InventoryImportResult> {
  await ensureInventorySchema()
  const db = getDb()
  const by = actorName(user)
  const [products, warehouses, existing] = await Promise.all([
    db.prepare("SELECT id, name FROM products WHERE is_inventory = 1 AND deleted = 0").all() as Promise<Array<{ id: number; name: string }>>,
    db.prepare("SELECT name FROM warehouses ORDER BY id").all() as Promise<Array<{ name: string }>>,
    db.prepare("SELECT inventory_code FROM inventory_items WHERE deleted = 0 AND btrim(inventory_code) <> ''").all() as Promise<Array<{ inventory_code: string }>>,
  ])
  const productByKey = new Map<string, { id: number; name: string }>()
  for (const row of products) if (!productByKey.has(nameKey(row.name))) productByKey.set(nameKey(row.name), { id: Number(row.id), name: row.name })
  const warehouseByKey = new Map<string, string>()
  for (const row of warehouses) if (!warehouseByKey.has(nameKey(row.name))) warehouseByKey.set(nameKey(row.name), row.name.trim())
  const usedNumbers = new Set(existing.map((row) => nameKey(row.inventory_code)))

  const filled = rows.filter((row) => [row.product, row.serialNumber, row.stockNumber, row.warehouse].some((value) => String(value ?? "").trim()))
  if (!filled.length) throw new InventoryError("В файле нет заполненных строк")

  const clientIds = [...new Set(filled.map((row) => Number(String(row.clientId ?? "").trim())).filter((id) => Number.isInteger(id) && id > 0))]
  const clientNames = [...new Set(filled.filter((row) => !String(row.clientId ?? "").trim() && String(row.client ?? "").trim()).map((row) => nameKey(row.client)))]
  const clientRows = (await db
    .prepare("SELECT id, name FROM clients WHERE id = ANY(?::int[]) OR fin_key(name) = ANY(?::text[])")
    .all(clientIds, clientNames)) as Array<{ id: number; name: string }>
  const clientById = new Map(clientRows.map((row) => [Number(row.id), row.name]))
  const clientsByKey = new Map<string, Array<{ id: number; name: string }>>()
  for (const row of clientRows) clientsByKey.set(nameKey(row.name), [...(clientsByKey.get(nameKey(row.name)) ?? []), { id: Number(row.id), name: row.name }])

  const errors: Array<{ line: number; error: string }> = []
  const prepared: Prepared[] = []
  for (const row of filled) {
    const fail = (error: string) => errors.push({ line: row.line, error })
    const product = productByKey.get(nameKey(row.product))
    if (!product) {
      fail("Продукт не найден или не отмечен как инвентарь")
      continue
    }
    const warehouse = warehouseByKey.get(nameKey(row.warehouse))
    if (!warehouse) {
      fail("Склад не найден")
      continue
    }
    let clientId: number | null = null
    let client = ""
    const rawId = String(row.clientId ?? "").trim()
    if (rawId) {
      const id = Number(rawId)
      if (!clientById.has(id)) {
        fail("Клиент не найден")
        continue
      }
      clientId = id
      client = clientById.get(id)!
    } else if (String(row.client ?? "").trim()) {
      const matches = clientsByKey.get(nameKey(row.client)) ?? []
      if (matches.length !== 1) {
        fail(matches.length ? "Найдено несколько клиентов с таким названием" : "Клиент не найден")
        continue
      }
      clientId = matches[0].id
      client = matches[0].name
    }
    const condition = String(row.condition ?? "").trim() || "Новый"
    const knownCondition = INVENTORY_CONDITIONS.find((value) => nameKey(value) === nameKey(condition))
    if (!knownCondition) {
      fail("Неизвестное состояние")
      continue
    }
    const rawDate = String(row.date ?? "").trim()
    const date = rawDate ? cellDay(rawDate) : todayIso()
    if (!date) {
      fail("Неверная дата")
      continue
    }
    const stockNumber = String(row.stockNumber ?? "").trim()
    if (stockNumber) {
      if (usedNumbers.has(nameKey(stockNumber))) {
        fail("Инвентарный номер уже используется")
        continue
      }
      usedNumbers.add(nameKey(stockNumber))
    }
    prepared.push({
      line: row.line,
      productId: product.id,
      productName: product.name,
      clientId,
      client,
      serialNumber: String(row.serialNumber ?? "").trim(),
      stockNumber,
      warehouse,
      condition: knownCondition,
      date,
      comment: String(row.comment ?? "").trim(),
    })
  }
  if (errors.length) throw new InventoryError("Ошибки в файле", 400, undefined, { lines: errors.slice(0, 200) })

  await withTransaction(async (tx) => {
    for (const item of prepared) {
      const result = await tx
        .prepare(
          `INSERT INTO inventory_items (serial_number, client, client_id, inventory_type, product_id, inventory_code, warehouse, condition,
             responsible, attach_date, created_date, check_date, approved, comment, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, ?, ?)`,
        )
        .run(item.serialNumber, item.client, item.clientId, item.productName, item.productId, item.stockNumber, item.warehouse, item.condition, by, item.date, nowLocalIso(), item.comment, by)
      await insertLog(tx, {
        itemId: Number(result.lastInsertRowid),
        status: "create",
        clientId: item.clientId,
        client: item.client,
        warehouse: item.warehouse,
        condition: item.condition,
        date: item.date,
        comment: item.comment,
        user: by,
      })
    }
  })
  return { created: prepared.length }
}
