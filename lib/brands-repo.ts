import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { brandUsage, cascadeBrandRename, type DictionaryRenameChange } from "@/lib/dictionaries-refs"
import {
  CREATED_ISO_SQL,
  CREATED_ORDER_SQL,
  DELETE_BLOCKED,
  DictionaryError,
  REQUIRED,
  createdDateLabel,
  dictionariesDb,
  fieldError,
  lockDictionary,
  organizationRequired,
  storedImageUrl,
  type DictionaryListQuery,
} from "@/lib/dictionaries-schema"
import { cleanText } from "@/lib/products-types"
import { lockCatalog } from "@/lib/products-write"
import type { Brand, BrandDetail, BrandListResult } from "@/components/analytics/brands-data"

// "Бренд" (demo main/brand/?thumbnail_type=large).
//   * names are unique by fin_key; a rename is carried into every text column `brand`
//     (products, raw_materials, …) in the same transaction and a delete is refused
//     (409 + usage) while anything uses the brand (lib/dictionaries-refs.ts);
//   * Организация is a name, required as soon as organizations exist;
//   * the picture is a data URL in brands.photo_url, served by GET /api/brands/[id]/image.

type Row = { id: number; name: string; organization: string | null; image_ref: string | null; image_version: string | null; created_iso: string }

const SELECT = `SELECT id, name, organization,
  CASE WHEN photo_url LIKE 'data:image/%' THEN 'data:image/' ELSE photo_url END AS image_ref,
  left(md5(COALESCE(photo_url, '')), 12) AS image_version,
  ${CREATED_ISO_SQL} AS created_iso
  FROM brands`

const DUPLICATE = "Бренд с таким наименованием уже существует"

function rowToBrand(row: Row): Brand {
  const id = Number(row.id)
  return {
    id,
    name: row.name,
    organization: cleanText(row.organization),
    createdDate: createdDateLabel(row.created_iso),
    photoUrl: storedImageUrl(row.image_ref, `/api/brands/${id}/image`, row.image_version ?? ""),
    createdAt: row.created_iso,
  }
}

/** Plain list for the pickers (original contract: every brand, id DESC). */
export async function listBrands(): Promise<Brand[]> {
  const db = await dictionariesDb()
  return ((await db.prepare(`${SELECT} ORDER BY id DESC`).all()) as Row[]).map(rowToBrand)
}

const ORDER_COLUMNS: Record<string, string> = {
  id: "id",
  image: "(photo_url IS NOT NULL AND photo_url <> '')",
  name: "lower(name)",
  division: "lower(COALESCE(organization, ''))",
  created_date: CREATED_ORDER_SQL,
}

function orderBy(ordering: string): string {
  if (!ordering) return "lower(name) ASC, id ASC"
  const desc = ordering.startsWith("-")
  const expression = ORDER_COLUMNS[desc ? ordering.slice(1) : ordering] ?? "lower(name)"
  const direction = desc ? "DESC" : "ASC"
  return `${expression} ${direction} NULLS LAST, id ${direction}`
}

/** The grid (demo GET main/brand/?search&ordering&page&page_size; default order = name). */
export async function listBrandsPage(query: DictionaryListQuery): Promise<BrandListResult> {
  const db = await dictionariesDb()
  const where = "WHERE (@needle = '' OR strpos(fin_key(concat_ws(' ', name, organization)), fin_key(@needle)) > 0)"
  const params = { needle: query.search.trim() }
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM brands ${where}`).get(params)) as { n: string | number }
  const rows = (await db
    .prepare(`${SELECT} ${where} ORDER BY ${orderBy(query.ordering)} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as Row[]
  return { count: Number(total.n), results: rows.map(rowToBrand) }
}

async function readRow(db: PgDb, id: number, lock = false): Promise<Row | undefined> {
  return (await db.prepare(`${SELECT} WHERE id = @id${lock ? " FOR UPDATE" : ""}`).get({ id })) as Row | undefined
}

/** Demo GET main/brand/:id/; `withUsage` adds where the brand is used. */
export async function getBrandDetail(id: number, withUsage = false): Promise<BrandDetail | null> {
  const db = await dictionariesDb()
  const row = await readRow(db, id)
  if (!row) return null
  const brand = rowToBrand(row)
  return withUsage ? { ...brand, usage: await brandUsage(db, brand) } : brand
}

export async function getBrandImage(id: number): Promise<string | null> {
  const db = await dictionariesDb()
  const row = (await db.prepare("SELECT photo_url FROM brands WHERE id = @id").get({ id })) as { photo_url: string | null } | undefined
  return row?.photo_url ?? null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Write input; `undefined` = keep the stored value (PUT) / the default (POST). */
export type BrandInput = { name: string; organization?: string; image?: string | null }

async function validate(tx: PgDb, id: number | null, name: string, organization: string): Promise<void> {
  const duplicate = await tx
    .prepare("SELECT id FROM brands WHERE fin_key(name) = fin_key(@name) AND (@exceptId::int IS NULL OR id <> @exceptId::int) LIMIT 1")
    .get({ name, exceptId: id })
  if (duplicate) throw fieldError("name", DUPLICATE)
  if (!organization && (await organizationRequired(tx))) throw fieldError("organization", REQUIRED)
}

/** Demo POST main/brand/ {name, division, image}. */
export async function createBrand(input: BrandInput): Promise<Brand> {
  await dictionariesDb()
  return withTransaction(async (tx) => {
    await lockDictionary(tx, "brands")
    const name = input.name.trim()
    const organization = (input.organization ?? "").trim()
    await validate(tx, null, name, organization)
    const result = await tx
      .prepare("INSERT INTO brands (name, organization, photo_url, created_at, updated_at) VALUES (@name, @organization, @image, datetime('now'), datetime('now'))")
      .run({ name, organization, image: input.image ?? null })
    return rowToBrand((await readRow(tx, Number(result.lastInsertRowid)))!)
  })
}

export type BrandUpdateResult = { brand: Brand; renamed: DictionaryRenameChange[] }

/** Demo PUT main/brand/:id. A rename is carried into the items. */
export async function updateBrand(id: number, input: BrandInput): Promise<BrandUpdateResult | null> {
  await dictionariesDb()
  return withTransaction(async (tx) => {
    await lockDictionary(tx, "brands")
    const current = await readRow(tx, id, true)
    if (!current) return null
    const name = input.name.trim()
    const organization = input.organization === undefined ? cleanText(current.organization) : input.organization.trim()
    await validate(tx, id, name, organization)
    let renamed: DictionaryRenameChange[] = []
    if (current.name !== name) {
      await lockCatalog(tx)
      renamed = await cascadeBrandRename(tx, current.name, name)
    }
    await tx
      .prepare(`UPDATE brands SET name = @name, organization = @organization, ${input.image === undefined ? "" : "photo_url = @image, "}updated_at = datetime('now') WHERE id = @id`)
      .run({ id, name, organization, image: input.image ?? null })
    return { brand: rowToBrand((await readRow(tx, id))!), renamed }
  })
}

/** Demo DELETE main/brand/:id — refused while anything uses the brand. */
export async function deleteBrand(id: number): Promise<boolean> {
  await dictionariesDb()
  return withTransaction(async (tx) => {
    await lockDictionary(tx, "brands")
    const current = await readRow(tx, id, true)
    if (!current) return false
    await lockCatalog(tx)
    const usage = await brandUsage(tx, { name: current.name })
    if (usage.length) throw new DictionaryError(DELETE_BLOCKED, 409, undefined, usage)
    return (await tx.prepare("DELETE FROM brands WHERE id = @id").run({ id })).changes > 0
  })
}
