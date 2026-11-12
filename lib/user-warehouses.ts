import "server-only"

import type { CurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"

/**
 * Linko scopes some stock reports (Рекомендованный запас, Остаток на определенную дату) to the warehouses linked to
 * the signed-in user's employee card («Связанные склады», employees.details.stockIds): its admin sees robot moshina
 * 5 211 available there, not the 160 552 of every warehouse that Остаток shows. Names of those warehouses; [] when
 * the account has no employee or the card links none (then every warehouse counts).
 */
export async function linkedWarehouseNames(user: Pick<CurrentUser, "employeeId">): Promise<string[]> {
  if (!user.employeeId) return []
  const db = getDb()
  const row = (await db.prepare("SELECT details FROM employees WHERE id = ?").get(user.employeeId)) as { details: string | null } | undefined
  let ids: number[] = []
  try {
    const details = JSON.parse(row?.details || "{}") as { stockIds?: unknown }
    if (Array.isArray(details.stockIds)) ids = details.stockIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
  } catch {
    ids = []
  }
  if (!ids.length) return []
  const rows = (await db.prepare("SELECT name FROM warehouses WHERE id = ANY(?::int[]) ORDER BY id").all(ids)) as Array<{ name: string }>
  return rows.map((warehouse) => String(warehouse.name ?? "")).filter(Boolean)
}
