import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { readCatalogRow } from "@/lib/products-catalog"
import { CATALOG_TABLE, catalogDb } from "@/lib/products-schema"
import { catalogKey, type CatalogKind } from "@/lib/products-types"
import { CatalogError, lockCatalog } from "@/lib/products-write"

// Photos ("добавить фото", slideshow "Сделать основным" / "Удалить") and agent limits
// ("Добавить лимит" for the selected items, "Удалить" in the detail) of products and raw
// materials. Photos are stored as data URLs (like inventory photos) in product_images.

export const MAX_IMAGES = 20

async function syncHasPhoto(tx: PgDb, kind: CatalogKind, id: number): Promise<void> {
  await tx
    .prepare(
      `UPDATE ${CATALOG_TABLE[kind]} SET has_photo = CASE WHEN EXISTS (SELECT 1 FROM product_images WHERE item_kind = @kind AND item_id = @id) THEN 1 ELSE 0 END WHERE id = @id`,
    )
    .run({ kind, id })
}

/** Makes `imageId` (or the oldest image when null) the only primary photo of the item. */
async function setPrimary(tx: PgDb, kind: CatalogKind, id: number, imageId: number | null): Promise<void> {
  const target =
    imageId ??
    Number(
      ((await tx.prepare("SELECT id FROM product_images WHERE item_kind = @kind AND item_id = @id ORDER BY id LIMIT 1").get({ kind, id })) as { id?: number } | undefined)?.id ?? 0,
    )
  if (!target) return
  await tx.prepare("UPDATE product_images SET is_primary = CASE WHEN id = @target THEN 1 ELSE 0 END WHERE item_kind = @kind AND item_id = @id").run({ kind, id, target })
}

export async function addCatalogImage(kind: CatalogKind, id: number, data: string, isPrimary: boolean, userName: string): Promise<number | null> {
  await catalogDb()
  return withTransaction(async (tx) => {
    await lockCatalog(tx)
    if (!(await readCatalogRow(tx, kind, id, true))) return null
    const count = Number(((await tx.prepare("SELECT COUNT(*) AS n FROM product_images WHERE item_kind = @kind AND item_id = @id").get({ kind, id })) as { n: number }).n)
    if (count >= MAX_IMAGES) throw new CatalogError(`Не более ${MAX_IMAGES} фотографий`, 400)
    const result = await tx
      .prepare("INSERT INTO product_images (item_kind, item_id, data, is_primary, created_by) VALUES (@kind, @id, @data, 0, @user)")
      .run({ kind, id, data, user: userName })
    const imageId = Number(result.lastInsertRowid)
    if (isPrimary || count === 0) await setPrimary(tx, kind, id, imageId)
    await syncHasPhoto(tx, kind, id)
    return imageId
  })
}

/** false when the image does not belong to the item. */
export async function setPrimaryCatalogImage(kind: CatalogKind, id: number, imageId: number): Promise<boolean> {
  await catalogDb()
  return withTransaction(async (tx) => {
    const found = await tx.prepare("SELECT id FROM product_images WHERE id = @imageId AND item_kind = @kind AND item_id = @id FOR UPDATE").get({ imageId, kind, id })
    if (!found) return false
    await setPrimary(tx, kind, id, imageId)
    return true
  })
}

export async function deleteCatalogImage(kind: CatalogKind, id: number, imageId: number): Promise<boolean> {
  await catalogDb()
  return withTransaction(async (tx) => {
    const found = (await tx
      .prepare("SELECT id, is_primary FROM product_images WHERE id = @imageId AND item_kind = @kind AND item_id = @id FOR UPDATE")
      .get({ imageId, kind, id })) as { id: number; is_primary: number } | undefined
    if (!found) return false
    await tx.prepare("DELETE FROM product_images WHERE id = @imageId").run({ imageId })
    if (Number(found.is_primary) === 1) await setPrimary(tx, kind, id, null)
    await syncHasPhoto(tx, kind, id)
    return true
  })
}

export async function getCatalogImage(kind: CatalogKind, id: number, imageId: number): Promise<{ type: string; data: Buffer } | null> {
  const db = await catalogDb()
  const row = (await db.prepare("SELECT data FROM product_images WHERE id = @imageId AND item_kind = @kind AND item_id = @id").get({ imageId, kind, id })) as
    | { data: string }
    | undefined
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/.exec(row?.data ?? "")
  return match ? { type: match[1], data: Buffer.from(match[2], "base64") } : null
}

export const AGENT_NOT_FOUND = "Сотрудник не найден"

/**
 * Agent names → the employees' "Имя Фамилия" as stored (fin_key match; active employees win).
 * 400 "Сотрудник не найден" (+ `missing` names in the field error) when one is not an employee.
 */
async function resolveAgents(tx: PgDb, agents: string[]): Promise<string[]> {
  const wanted = [...new Map(agents.map((agent) => [catalogKey(agent), agent.trim()])).values()].filter(Boolean)
  // Matched in SQL (fin_key on both sides), so JS and Postgres case rules never disagree.
  const rows = (await tx
    .prepare(
      `SELECT w.name AS wanted,
              (SELECT btrim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) FROM employees e
                WHERE fin_key(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) = fin_key(w.name)
                ORDER BY (COALESCE(e.active, 1) <> 0) DESC, e.id LIMIT 1) AS employee
         FROM unnest(@names::text[]) WITH ORDINALITY AS w(name, position)
        ORDER BY w.position`,
    )
    .all({ names: wanted })) as Array<{ wanted: string; employee: string | null }>
  const missing = rows.filter((row) => !row.employee).map((row) => row.wanted)
  if (missing.length) throw new CatalogError(AGENT_NOT_FOUND, 400, { agents: `${AGENT_NOT_FOUND}: ${missing.join(", ")}` })
  return [...new Set(rows.map((row) => row.employee!))]
}

/** "Добавление лимита": sets the amount of every agent (an employee) on every selected item. */
export async function addCatalogLimits(kind: CatalogKind, ids: number[], agents: string[], amount: number, userName: string): Promise<number> {
  await catalogDb()
  return withTransaction(async (tx) => {
    await lockCatalog(tx)
    let count = 0
    const names = await resolveAgents(tx, agents)
    for (const id of [...new Set(ids)]) {
      if (!(await readCatalogRow(tx, kind, id, true))) continue
      for (const agent of names) {
        const updated = await tx
          .prepare("UPDATE product_limits SET amount = @amount, created_by = @user WHERE item_kind = @kind AND item_id = @id AND fin_key(agent) = fin_key(@agent)")
          .run({ amount, user: userName, kind, id, agent })
        if (!updated.changes) {
          await tx
            .prepare("INSERT INTO product_limits (item_kind, item_id, agent, amount, created_by) VALUES (@kind, @id, @agent, @amount, @user)")
            .run({ kind, id, agent, amount, user: userName })
        }
        count += 1
      }
    }
    return count
  })
}

export async function deleteCatalogLimit(kind: CatalogKind, id: number, limitId: number): Promise<boolean> {
  const db = await catalogDb()
  const result = await db.prepare("DELETE FROM product_limits WHERE id = @limitId AND item_kind = @kind AND item_id = @id").run({ limitId, kind, id })
  return result.changes > 0
}
