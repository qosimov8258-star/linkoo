import "server-only"

import { getDb, outsideTransaction } from "@/lib/db"
import type { Permission } from "@/components/analytics/access-rights-data"

type Row = { id: number; category: string; type: string; label: string; code: string; categories: string }

function rowToPermission(row: Row): Permission {
  let categories: string[] = []
  try {
    categories = JSON.parse(row.categories) as string[]
  } catch {
    categories = []
  }
  return { id: row.id, category: row.category, type: row.type, label: row.label, code: row.code, categories }
}

let categoriesReady: Promise<void> | null = null
/** permission_categories, once per process on the maintenance pool (never inside a request transaction). */
function ensureCategories() {
  categoriesReady ??= outsideTransaction(() =>
    getDb().exec("CREATE TABLE IF NOT EXISTS permission_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)"),
  ).catch((error: unknown) => {
    categoriesReady = null
    throw error
  })
  return categoriesReady
}

/** `label` is the reference's full permission name ("Продажи/Добавить заказ (add_order)"). */
export async function listPermissions(): Promise<Permission[]> {
  const db = getDb()
  return ((await db.prepare("SELECT id, category, type, label, code, categories FROM permissions ORDER BY sort_order ASC, id ASC").all()) as Row[]).map(rowToPermission)
}

/** Permission categories in the reference's order (billing `permission_category/`). */
export async function listPermissionCategories(): Promise<string[]> {
  await ensureCategories()
  const rows = (await getDb().prepare("SELECT name FROM permission_categories ORDER BY sort_order ASC, id ASC").all()) as Array<{ name: string }>
  return rows.map((row) => row.name)
}
