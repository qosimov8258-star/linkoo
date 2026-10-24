import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { cascadeProductTypeChange, productTypeUsage, type DictionaryRenameChange } from "@/lib/dictionaries-refs"
import {
  CREATED_ISO_SQL,
  DELETE_BLOCKED,
  DictionaryError,
  REQUIRED,
  buildTree,
  createdDateLabel,
  dictionariesDb,
  fieldError,
  filterTree,
  lockDictionary,
  organizationRequired,
  storedImageUrl,
  type DictionaryListQuery,
} from "@/lib/dictionaries-schema"
import { cleanText } from "@/lib/products-types"
import { lockCatalog } from "@/lib/products-write"
import type { ProductType, ProductTypeDetail, ProductTypeNode, ProductTypeTreeResult } from "@/components/analytics/product-types-data"

// "Типы продуктов" (demo main/product_type/, tree main/product_type/as_menu/).
//   * two levels: the parent must be a top-level type and a type with children stays on
//     top (products store the pair type / subcategory);
//   * names are unique among siblings by fin_key (the same child name may exist under two
//     parents, products tell them apart by the type);
//   * a rename or a move is carried into products / raw materials in the same transaction
//     (lib/dictionaries-refs.ts), a delete is refused (409 + usage) while items use the type
//     or it has children;
//   * Организация is a name (organizations.name; the organizations page renames it
//     everywhere), required as soon as organizations exist;
//   * the picture is a data URL in product_types.image, served by GET …/[id]/image.

type Row = {
  id: number
  name: string
  organization: string | null
  parent_id: number | null
  show_in_bot: number | null
  position: number | null
  image_ref: string | null
  image_version: string | null
  created_iso: string
}

const SELECT = `SELECT id, name, organization, parent_id, show_in_bot, position,
  CASE WHEN image LIKE 'data:image/%' THEN 'data:image/' ELSE image END AS image_ref,
  left(md5(COALESCE(image, '')), 12) AS image_version,
  ${CREATED_ISO_SQL} AS created_iso
  FROM product_types`

const DUPLICATE = "Тип продукта с таким наименованием уже существует"

function rowToType(row: Row): ProductType {
  const id = Number(row.id)
  return {
    id,
    name: row.name,
    organization: cleanText(row.organization),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    showInBot: Number(row.show_in_bot) === 1,
    createdDate: createdDateLabel(row.created_iso),
    position: Number(row.position ?? 0),
    imageUrl: storedImageUrl(row.image_ref, `/api/product-types/${id}/image`, row.image_version ?? ""),
    createdAt: row.created_iso,
  }
}

async function allRows(db: PgDb): Promise<Row[]> {
  return (await db.prepare(`${SELECT} ORDER BY id DESC`).all()) as Row[]
}

/** Plain list for the pickers (original contract: every type, id DESC). */
export async function listProductTypes(): Promise<ProductType[]> {
  return (await allRows(await dictionariesDb())).map(rowToType)
}

/** The tree grid: top-level types (searched, sorted, paged) with their children. Default order = name (the demo ignores its "order" field here). */
export async function listProductTypeTree(query: DictionaryListQuery): Promise<ProductTypeTreeResult> {
  const types = (await allRows(await dictionariesDb())).map(rowToType)
  const tree = filterTree(buildTree<ProductType, ProductTypeNode>(types, query.ordering || "name"), query.search)
  const start = (query.page - 1) * query.pageSize
  return { count: tree.length, results: tree.slice(start, start + query.pageSize) }
}

async function readRow(db: PgDb, id: number, lock = false): Promise<Row | undefined> {
  return (await db.prepare(`${SELECT} WHERE id = @id${lock ? " FOR UPDATE" : ""}`).get({ id })) as Row | undefined
}

async function nameOf(db: PgDb, id: number | null): Promise<string | null> {
  if (id === null) return null
  const row = (await db.prepare("SELECT name FROM product_types WHERE id = @id").get({ id })) as { name: string } | undefined
  return row?.name ?? null
}

async function childCount(db: PgDb, id: number): Promise<number> {
  const row = (await db.prepare("SELECT COUNT(*) AS n FROM product_types WHERE parent_id = @id").get({ id })) as { n: string | number }
  return Number(row.n)
}

async function toDetail(db: PgDb, row: Row, withUsage: boolean): Promise<ProductTypeDetail> {
  const type = rowToType(row)
  const parentName = (await nameOf(db, type.parentId)) ?? ""
  const detail: ProductTypeDetail = { ...type, parentName, childCount: await childCount(db, type.id) }
  if (withUsage) detail.usage = await productTypeUsage(db, { id: type.id, name: type.name, parent: type.parentId === null || !parentName ? null : parentName })
  return detail
}

/** Demo GET main/product_type/:id/; `withUsage` adds where the type is used. */
export async function getProductTypeDetail(id: number, withUsage = false): Promise<ProductTypeDetail | null> {
  const db = await dictionariesDb()
  const row = await readRow(db, id)
  return row ? toDetail(db, row, withUsage) : null
}

export async function getProductTypeImage(id: number): Promise<string | null> {
  const db = await dictionariesDb()
  const row = (await db.prepare("SELECT image FROM product_types WHERE id = @id").get({ id })) as { image: string | null } | undefined
  return row?.image ?? null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Write input; `undefined` = keep the stored value (PUT) / the default (POST). */
export type ProductTypeInput = {
  name: string
  organization?: string
  parentId?: number | null
  showInBot?: boolean
  position?: number
  /** data URL = new picture, null = remove. */
  image?: string | null
}

type Fields = { name: string; organization: string; parentId: number | null; showInBot: boolean; position: number; image: string | null | undefined }

/** `legacyEmpty`: the stored type has no organization (demo data) and keeps none, so editing it stays possible. */
async function validate(tx: PgDb, id: number | null, fields: Fields, legacyEmpty = false): Promise<string | null> {
  let parentName: string | null = null
  if (fields.parentId !== null) {
    if (fields.parentId === id) throw fieldError("parent", "Тип не может быть родителем самого себя")
    const parent = (await tx.prepare("SELECT name, parent_id FROM product_types WHERE id = @id").get({ id: fields.parentId })) as
      | { name: string; parent_id: number | null }
      | undefined
    if (!parent) throw fieldError("parent", "Родительская категория не найдена")
    if (parent.parent_id !== null) throw fieldError("parent", "Подкатегорию нельзя выбрать родительской категорией")
    if (id !== null && (await childCount(tx, id)) > 0) throw fieldError("parent", "Тип с подкатегориями не может быть подкатегорией")
    parentName = parent.name
  }
  const duplicate = await tx
    .prepare(
      `SELECT id FROM product_types WHERE fin_key(name) = fin_key(@name) AND parent_id IS NOT DISTINCT FROM @parentId::int
         AND (@exceptId::int IS NULL OR id <> @exceptId::int) LIMIT 1`,
    )
    .get({ name: fields.name, parentId: fields.parentId, exceptId: id })
  if (duplicate) throw fieldError("name", DUPLICATE)
  if (!fields.organization && !legacyEmpty && (await organizationRequired(tx))) throw fieldError("organization", REQUIRED)
  return parentName
}

/** Demo POST main/product_type/. */
export async function createProductType(input: ProductTypeInput): Promise<ProductTypeDetail> {
  await dictionariesDb()
  return withTransaction(async (tx) => {
    await lockDictionary(tx, "product_types")
    const fields: Fields = {
      name: input.name.trim(),
      organization: (input.organization ?? "").trim(),
      parentId: input.parentId ?? null,
      showInBot: input.showInBot ?? true,
      position: input.position ?? 0,
      image: input.image ?? null,
    }
    await validate(tx, null, fields)
    const result = await tx
      .prepare(
        `INSERT INTO product_types (name, organization, parent_id, show_in_bot, position, image, created_at, updated_at)
         VALUES (@name, @organization, @parentId, @showInBot, @position, @image, datetime('now'), datetime('now'))`,
      )
      .run({ ...fields, showInBot: fields.showInBot ? 1 : 0 })
    return toDetail(tx, (await readRow(tx, Number(result.lastInsertRowid)))!, false)
  })
}

export type ProductTypeUpdateResult = { type: ProductTypeDetail; renamed: DictionaryRenameChange[] }

/** Demo PUT main/product_type/:id. A rename / move is carried into the items. */
export async function updateProductType(id: number, input: ProductTypeInput): Promise<ProductTypeUpdateResult | null> {
  await dictionariesDb()
  return withTransaction(async (tx) => {
    await lockDictionary(tx, "product_types")
    const current = await readRow(tx, id, true)
    if (!current) return null
    const fields: Fields = {
      name: input.name.trim(),
      organization: input.organization === undefined ? cleanText(current.organization) : input.organization.trim(),
      parentId: input.parentId === undefined ? (current.parent_id === null ? null : Number(current.parent_id)) : input.parentId,
      showInBot: input.showInBot ?? Number(current.show_in_bot) === 1,
      position: input.position ?? Number(current.position ?? 0),
      image: input.image,
    }
    const parentName = await validate(tx, id, fields, !cleanText(current.organization))
    const currentParent = current.parent_id === null ? null : await nameOf(tx, Number(current.parent_id))
    let renamed: DictionaryRenameChange[] = []
    if (current.name !== fields.name || currentParent !== parentName) {
      await lockCatalog(tx)
      renamed = await cascadeProductTypeChange(tx, { name: current.name, parent: currentParent }, { name: fields.name, parent: parentName })
    }
    await tx
      .prepare(
        `UPDATE product_types SET name = @name, organization = @organization, parent_id = @parentId, show_in_bot = @showInBot,
           position = @position, ${fields.image === undefined ? "" : "image = @image, "}updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ ...fields, showInBot: fields.showInBot ? 1 : 0, id })
    return { type: await toDetail(tx, (await readRow(tx, id))!, false), renamed }
  })
}

/** Demo DELETE main/product_type/:id — refused while items use the type or it has children. */
export async function deleteProductType(id: number): Promise<boolean> {
  await dictionariesDb()
  return withTransaction(async (tx) => {
    await lockDictionary(tx, "product_types")
    const current = await readRow(tx, id, true)
    if (!current) return false
    await lockCatalog(tx)
    const parent = current.parent_id === null ? null : await nameOf(tx, Number(current.parent_id))
    const usage = await productTypeUsage(tx, { id, name: current.name, parent })
    if (usage.length) throw new DictionaryError(DELETE_BLOCKED, 409, undefined, usage)
    return (await tx.prepare("DELETE FROM product_types WHERE id = @id").run({ id })).changes > 0
  })
}
