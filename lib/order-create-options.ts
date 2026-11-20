import "server-only"

import type { CurrentUser } from "@/lib/current-user"
import { getDb, type PgDb } from "@/lib/db"
import { loadEntities } from "@/lib/finance/entities"
import { ensureFinanceSchema } from "@/lib/finance/schema"

/**
 * Lists and defaults of the «Добавление заказа» / «Изменение заказа» form that depend on the signed-in user,
 * as Linko builds them:
 * - Агент: Linko main/crud/for_select — the active users, by id.
 * - Доставщик: the same select with ?group=delivery — active users of the delivery group; here the employees
 *   whose access right carries the «Доставщик» capability (the rule «Долги доставщиков» lists them by), by id.
 * - Прайс лист: the user's own price lists (authConfirm.priceLists = the employee card's «Прайс-листы») in their
 *   position order; every active list when the account has no employee or the card names none.
 * - Defaults of a new order (Linko initialValues): Агент = the user itself, Прайс лист = its first list,
 *   Склад = its first linked warehouse («Связанные склады», authConfirm.stocks is ordered by id).
 */
export type OrderFormOptions = {
  agents: string[]
  deliverers: string[]
  priceLists: string[]
  defaults: { agent: string; priceList: string; warehouse: string }
}

type EmployeeRow = { id: number; first_name: string | null; last_name: string | null; active: number | null; details: string | null }

const fullName = (row: Pick<EmployeeRow, "first_name" | "last_name">) => `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()

function idList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw.map(Number).filter((id) => Number.isInteger(id) && id > 0)
}

async function tableHas(db: PgDb, table: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(?) IS NOT NULL AS ok").get(`public.${table}`)) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

export async function getOrderFormOptions(user: Pick<CurrentUser, "employeeId">): Promise<OrderFormOptions> {
  const db = getDb()
  const employees = (await db.prepare("SELECT id, first_name, last_name, active, details FROM employees ORDER BY id").all()) as EmployeeRow[]
  const active = employees.filter((row) => Number(row.active ?? 1) === 1 && fullName(row))
  const agents = [...new Set(active.map(fullName))]

  let deliverers: string[] = []
  try {
    const records = await loadEntities("deliverer", db, await ensureFinanceSchema(db))
    const delivery = new Set(records.filter((record) => Number(record.info.is_deliverer) === 1 && record.id !== null).map((record) => Number(record.id)))
    deliverers = [...new Set(active.filter((row) => delivery.has(row.id)).map(fullName))]
  } catch {
    deliverers = []
  }

  const me = user.employeeId ? employees.find((row) => row.id === user.employeeId) : undefined
  let details: { priceListIds?: unknown; stockIds?: unknown } = {}
  try {
    details = JSON.parse(me?.details || "{}") as typeof details
  } catch {
    details = {}
  }

  let priceLists: string[] = []
  if (await tableHas(db, "price_lists")) {
    const rows = (await db
      .prepare("SELECT id, name FROM price_lists WHERE COALESCE(is_active, 1) = 1 ORDER BY COALESCE(position, 0), id")
      .all()) as Array<{ id: number; name: string }>
    const own = new Set(idList(details.priceListIds))
    const mine = own.size ? rows.filter((row) => own.has(Number(row.id))) : []
    priceLists = [...new Set((mine.length ? mine : rows).map((row) => String(row.name ?? "")).filter(Boolean))]
  }

  let warehouse = ""
  const stockIds = idList(details.stockIds).sort((a, b) => a - b)
  if (stockIds.length && (await tableHas(db, "warehouses"))) {
    const rows = (await db
      .prepare("SELECT id, name FROM warehouses WHERE id = ANY(?::int[]) AND COALESCE(active, 1) <> 0 ORDER BY id")
      .all(stockIds)) as Array<{ id: number; name: string }>
    warehouse = String(rows[0]?.name ?? "")
  }

  return {
    agents,
    deliverers,
    priceLists,
    defaults: { agent: me && Number(me.active ?? 1) === 1 ? fullName(me) : "", priceList: priceLists[0] ?? "", warehouse },
  }
}
