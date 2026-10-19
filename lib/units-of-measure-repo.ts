import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { cascadeUnitRename, unitUsage, type DictionaryRenameChange } from "@/lib/dictionaries-refs"
import {
  CREATED_ISO_SQL,
  DELETE_BLOCKED,
  DictionaryError,
  buildTree,
  createdDateLabel,
  dictionariesDb,
  fieldError,
  filterTree,
  lockDictionary,
  type DictionaryListQuery,
} from "@/lib/dictionaries-schema"
import { lockCatalog } from "@/lib/products-write"
import type { UnitOfMeasure, UnitOfMeasureDetail, UnitOfMeasureNode, UnitOfMeasureTreeResult } from "@/components/analytics/units-of-measure-data"

// "Ед.измерения" (demo main/measurement/, tree main/measurement/hierarchy/).
//   * two levels: the parent must be a top-level unit (demo picker params {parent: 0}) and a
//     unit with children stays on top;
//   * names are unique over the whole table by fin_key (products store the bare name);
//   * a rename is carried into products / raw materials (unit, product_group, the unit token
//     of sub_unit) and into the document lines that store the unit, in the same transaction
//     (lib/dictionaries-refs.ts); a delete is refused (409 + usage) while anything uses the
//     unit or it has children.

type Row = { id: number; name: string; parent_id: number | null; is_weighted: number | null; created_iso: string }

const SELECT = `SELECT id, name, parent_id, is_weighted, ${CREATED_ISO_SQL} AS created_iso FROM units_of_measure`

const DUPLICATE = "Единица измерения с таким наименованием уже существует"

function rowToUnit(row: Row): UnitOfMeasure {
  return {
    id: Number(row.id),
    name: row.name,
    createdDate: createdDateLabel(row.created_iso),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    isWeighted: Number(row.is_weighted) === 1,
    createdAt: row.created_iso,
  }
}

async function allRows(db: PgDb): Promise<Row[]> {
  return (await db.prepare(`${SELECT} ORDER BY id DESC`).all()) as Row[]
}

/** Plain list for the pickers (original contract: every unit, id DESC). */
export async function listUnitsOfMeasure(): Promise<UnitOfMeasure[]> {
  return (await allRows(await dictionariesDb())).map(rowToUnit)
}

/** The tree grid: top-level units (searched, sorted, paged) with their children. Default order = newest first. */
export async function listUnitTree(query: DictionaryListQuery): Promise<UnitOfMeasureTreeResult> {
  const units = (await allRows(await dictionariesDb())).map(rowToUnit)
  // No ordering = the demo hierarchy order (newest first): created_date descending.
  const tree = filterTree(buildTree<UnitOfMeasure, UnitOfMeasureNode>(units, query.ordering || "-created_date"), query.search)
  const start = (query.page - 1) * query.pageSize
  return { count: tree.length, results: tree.slice(start, start + query.pageSize) }
}

async function readRow(db: PgDb, id: number, lock = false): Promise<Row | undefined> {
  return (await db.prepare(`${SELECT} WHERE id = @id${lock ? " FOR UPDATE" : ""}`).get({ id })) as Row | undefined
}

async function childCount(db: PgDb, id: number): Promise<number> {
  const row = (await db.prepare("SELECT COUNT(*) AS n FROM units_of_measure WHERE parent_id = @id").get({ id })) as { n: string | number }
  return Number(row.n)
}

async function toDetail(db: PgDb, row: Row, withUsage: boolean): Promise<UnitOfMeasureDetail> {
  const unit = rowToUnit(row)
  const parent = unit.parentId === null ? undefined : ((await db.prepare("SELECT name FROM units_of_measure WHERE id = @id").get({ id: unit.parentId })) as { name: string } | undefined)
  const detail: UnitOfMeasureDetail = { ...unit, parentName: parent?.name ?? "", childCount: await childCount(db, unit.id) }
  if (withUsage) detail.usage = await unitUsage(db, { id: unit.id, name: unit.name })
  return detail
}

/** Demo GET main/measurement/:id/; `withUsage` adds where the unit is used. */
export async function getUnitDetail(id: number, withUsage = false): Promise<UnitOfMeasureDetail | null> {
  const db = await dictionariesDb()
  const row = await readRow(db, id)
  return row ? toDetail(db, row, withUsage) : null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Write input; `undefined` = keep the stored value (PUT) / the default (POST). */
export type UnitOfMeasureInput = { name: string; parentId?: number | null; isWeighted?: boolean }

async function validate(tx: PgDb, id: number | null, name: string, parentId: number | null): Promise<void> {
  if (parentId !== null) {
    if (parentId === id) throw fieldError("parent", "Единица не может быть родителем самой себя")
    const parent = (await tx.prepare("SELECT parent_id FROM units_of_measure WHERE id = @id").get({ id: parentId })) as { parent_id: number | null } | undefined
    if (!parent) throw fieldError("parent", "Родительская категория не найдена")
    if (parent.parent_id !== null) throw fieldError("parent", "Дочернюю единицу нельзя выбрать родительской")
    if (id !== null && (await childCount(tx, id)) > 0) throw fieldError("parent", "Единица с дочерними единицами не может быть дочерней")
  }
  const duplicate = await tx
    .prepare("SELECT id FROM units_of_measure WHERE fin_key(name) = fin_key(@name) AND (@exceptId::int IS NULL OR id <> @exceptId::int) LIMIT 1")
    .get({ name, exceptId: id })
  if (duplicate) throw fieldError("name", DUPLICATE)
}

/** Demo POST main/measurement/ {name, parent, is_weighted}. */
export async function createUnitOfMeasure(input: UnitOfMeasureInput): Promise<UnitOfMeasureDetail> {
  await dictionariesDb()
  return withTransaction(async (tx) => {
    await lockDictionary(tx, "units_of_measure")
    const name = input.name.trim()
    const parentId = input.parentId ?? null
    await validate(tx, null, name, parentId)
    const result = await tx
      .prepare(
        `INSERT INTO units_of_measure (name, parent_id, is_weighted, created_at, updated_at)
         VALUES (@name, @parentId, @isWeighted, datetime('now'), datetime('now'))`,
      )
      .run({ name, parentId, isWeighted: input.isWeighted ? 1 : 0 })
    return toDetail(tx, (await readRow(tx, Number(result.lastInsertRowid)))!, false)
  })
}

export type UnitUpdateResult = { unit: UnitOfMeasureDetail; renamed: DictionaryRenameChange[] }

/** Demo PUT main/measurement/:id. A rename is carried into the items and document lines. */
export async function updateUnitOfMeasure(id: number, input: UnitOfMeasureInput): Promise<UnitUpdateResult | null> {
  await dictionariesDb()
  return withTransaction(async (tx) => {
    await lockDictionary(tx, "units_of_measure")
    const current = await readRow(tx, id, true)
    if (!current) return null
    const name = input.name.trim()
    const parentId = input.parentId === undefined ? (current.parent_id === null ? null : Number(current.parent_id)) : input.parentId
    const isWeighted = input.isWeighted ?? Number(current.is_weighted) === 1
    await validate(tx, id, name, parentId)
    let renamed: DictionaryRenameChange[] = []
    if (current.name !== name) {
      await lockCatalog(tx)
      renamed = await cascadeUnitRename(tx, current.name, name)
    }
    await tx
      .prepare("UPDATE units_of_measure SET name = @name, parent_id = @parentId, is_weighted = @isWeighted, updated_at = datetime('now') WHERE id = @id")
      .run({ id, name, parentId, isWeighted: isWeighted ? 1 : 0 })
    return { unit: await toDetail(tx, (await readRow(tx, id))!, false), renamed }
  })
}

/** Demo DELETE main/measurement/:id — refused while anything uses the unit or it has children. */
export async function deleteUnitOfMeasure(id: number): Promise<boolean> {
  await dictionariesDb()
  return withTransaction(async (tx) => {
    await lockDictionary(tx, "units_of_measure")
    const current = await readRow(tx, id, true)
    if (!current) return false
    await lockCatalog(tx)
    const usage = await unitUsage(tx, { id, name: current.name })
    if (usage.length) throw new DictionaryError(DELETE_BLOCKED, 409, undefined, usage)
    return (await tx.prepare("DELETE FROM units_of_measure WHERE id = @id").run({ id })).changes > 0
  })
}
