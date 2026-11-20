import "server-only"

import { getDb, outsideTransaction } from "@/lib/db"
import type { Permission } from "@/components/analytics/access-rights-data"

type Row = { id: number; category: string; type: string; label: string; code: string; categories: string; tags: string }

function jsonNames(text: string): string[] {
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function rowToPermission(row: Row): Permission {
  return { id: row.id, category: row.category, type: row.type, label: row.label, code: row.code, categories: jsonNames(row.categories), tags: jsonNames(row.tags) }
}

let categoriesReady: Promise<void> | null = null
/** permission_categories and permission_tags (Linko's billing permission_category/ and permission_tag/, filled by
 * scripts/linko-sync) and the permissions' tags column, once per process on the maintenance pool (never inside a
 * request transaction). */
function ensureCategories() {
  categoriesReady ??= outsideTransaction(() =>
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS permission_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS permission_tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
      ALTER TABLE permissions ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT '[]';
    `),
  ).catch((error: unknown) => {
    categoriesReady = null
    throw error
  })
  return categoriesReady
}

/** `label` is the reference's full permission name ("Продажи/Добавить заказ (add_order)"). */
export async function listPermissions(): Promise<Permission[]> {
  await ensureCategories()
  const db = getDb()
  return ((await db.prepare("SELECT id, category, type, label, code, categories, tags FROM permissions ORDER BY sort_order ASC, id ASC").all()) as Row[]).map(rowToPermission)
}

/** Permission tags in the reference's order (billing `permission_tag/`: Мобильный, Десктоп, Общее, CONFIGURATION). */
export async function listPermissionTags(): Promise<string[]> {
  await ensureCategories()
  const rows = (await getDb().prepare("SELECT name FROM permission_tags ORDER BY sort_order ASC, id ASC").all()) as Array<{ name: string }>
  return rows.map((row) => row.name)
}

/** Permission categories in the reference's order (billing `permission_category/`). */
export async function listPermissionCategories(): Promise<string[]> {
  await ensureCategories()
  const rows = (await getDb().prepare("SELECT name FROM permission_categories ORDER BY sort_order ASC, id ASC").all()) as Array<{ name: string }>
  return rows.map((row) => row.name)
}
