import "server-only"

import { getDb } from "@/lib/db"
import type { Permission } from "@/components/analytics/access-rights-data"

type Row = { id: number; category: string; type: string; label: string; code: string }

function rowToPermission(row: Row): Permission {
  return { id: row.id, category: row.category, type: row.type, label: row.label, code: row.code }
}

export async function listPermissions(): Promise<Permission[]> {
  const db = getDb()
  return ((await db.prepare("SELECT id, category, type, label, code FROM permissions ORDER BY sort_order ASC, id ASC").all()) as Row[]).map(rowToPermission)
}
