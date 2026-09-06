import "server-only"

import { getDb } from "@/lib/db"

export type ProductRestrictionScope = "products" | "types"

export type ProductRestriction = {
  id: number
  employee: string
  items: string[]
}

type Row = {
  id: number
  scope: string
  employee: string
  items: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS product_restrictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      employee TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(scope, employee)
    );
  `)
}

function parseItems(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function rowToRestriction(row: Row): ProductRestriction {
  return { id: row.id, employee: row.employee, items: parseItems(row.items) }
}

export type ApplyRestrictionInput = {
  scope: ProductRestrictionScope
  employee: string
  mode: "add" | "remove" | "replace"
  items: string[]
}

export async function listProductRestrictions(scope: ProductRestrictionScope): Promise<ProductRestriction[]> {
  const db = getDb()
  await ensureSchema(db)
  return (
    (await db.prepare("SELECT * FROM product_restrictions WHERE scope = ? ORDER BY id ASC").all(scope)) as Row[]
  ).map(rowToRestriction)
}

/** Applies an add/remove/replace operation for one employee's restriction list within a
 * scope, mirroring the previous client-only reducer logic. Removing all items deletes the
 * row instead of leaving an empty restriction behind. */
export async function applyProductRestriction(input: ApplyRestrictionInput): Promise<ProductRestriction[]> {
  const db = getDb()
  await ensureSchema(db)

  const existing = (await db
      .prepare("SELECT * FROM product_restrictions WHERE scope = ? AND employee = ?")
      .get(input.scope, input.employee)) as Row | undefined

  if (input.mode === "add") {
    const merged = existing ? Array.from(new Set([...parseItems(existing.items), ...input.items])) : input.items
    await db.prepare(
            `INSERT INTO product_restrictions (scope, employee, items) VALUES (@scope, @employee, @items)
       ON CONFLICT(scope, employee) DO UPDATE SET items = excluded.items, updated_at = datetime('now')`,
          ).run({ scope: input.scope, employee: input.employee, items: JSON.stringify(merged) })
  } else if (input.mode === "remove") {
    if (existing) {
      const remaining = parseItems(existing.items).filter((item) => !input.items.includes(item))
      if (remaining.length) {
        await db.prepare("UPDATE product_restrictions SET items = ?, updated_at = datetime('now') WHERE id = ?").run(
                    JSON.stringify(remaining),
                    existing.id,
                  )
      } else {
        await db.prepare("DELETE FROM product_restrictions WHERE id = ?").run(existing.id)
      }
    }
  } else {
    await db.prepare(
            `INSERT INTO product_restrictions (scope, employee, items) VALUES (@scope, @employee, @items)
       ON CONFLICT(scope, employee) DO UPDATE SET items = excluded.items, updated_at = datetime('now')`,
          ).run({ scope: input.scope, employee: input.employee, items: JSON.stringify(input.items) })
  }

  return (await listProductRestrictions(input.scope))
}
