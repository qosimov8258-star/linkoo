import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import {
  CREATED_ISO_SQL,
  CREATED_ORDER_SQL,
  DELETE_BLOCKED,
  DictionaryError,
  REQUIRED,
  createdDateLabel,
  dictionariesDb,
  fieldError,
  filterTree,
  sortNodes,
} from "@/lib/dictionaries-schema"
import { dictionaryKey } from "@/components/analytics/dictionaries-data"
import type { Cell, CellListResult, CellType, CellTypeNode } from "@/components/analytics/cells-data"

// "Тип ячейки" (demo #/cell-type, API stock/cell_type/hierarchy/) and "Ячейки" (demo #/cell,
// API stock/cell/). A cell type is a tree node (parent category + name); a cell has a name,
// a barcode and a cell type. A cell type that cells (or child types) still use cannot be deleted.

const SCHEMA_VERSION = 1

declare global {
  var __linkoCellsSchema: { version: number; ready: Promise<void> } | undefined
}

async function install(db: PgDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cell_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES cell_types(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cells (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      barcode TEXT NOT NULL DEFAULT '',
      cell_type_id INTEGER REFERENCES cell_types(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

async function cellsDb(): Promise<PgDb> {
  const db = await dictionariesDb()
  if (globalThis.__linkoCellsSchema?.version !== SCHEMA_VERSION) {
    const ready = install(db).catch((error) => {
      globalThis.__linkoCellsSchema = undefined
      throw error
    })
    globalThis.__linkoCellsSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoCellsSchema!.ready
  return db
}

// ---------------------------------------------------------------------------
// Cell types
// ---------------------------------------------------------------------------

type TypeRow = { id: number; name: string; parent_id: number | null; created_iso: string }

const TYPE_SELECT = `SELECT id, name, parent_id, ${CREATED_ISO_SQL} AS created_iso FROM cell_types`

function rowToType(row: TypeRow): CellType {
  return { id: Number(row.id), name: row.name, parentId: row.parent_id === null ? null : Number(row.parent_id), createdDate: createdDateLabel(row.created_iso), createdAt: row.created_iso }
}

/** The tree of the page (demo GET stock/cell_type/hierarchy/); a node that matches the search keeps its children. */
export async function listCellTypeTree(search: string): Promise<CellTypeNode[]> {
  const db = await cellsDb()
  const rows = ((await db.prepare(`${TYPE_SELECT} ORDER BY id`).all()) as TypeRow[]).map(rowToType)
  const nodes = new Map<number, CellTypeNode>(rows.map((row) => [row.id, { ...row, children: [] }]))
  const roots: CellTypeNode[] = []
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sortLevel = (level: CellTypeNode[]): CellTypeNode[] => sortNodes(level, "created_date").map((node) => ({ ...node, children: sortLevel(node.children) }))
  return filterTree(sortLevel(roots), search)
}

/** Flat list for pickers (every type, id order). */
export async function listCellTypes(): Promise<CellType[]> {
  const db = await cellsDb()
  return ((await db.prepare(`${TYPE_SELECT} ORDER BY id`).all()) as TypeRow[]).map(rowToType)
}

async function readType(db: PgDb, id: number, lock = false): Promise<TypeRow | undefined> {
  return (await db.prepare(`${TYPE_SELECT} WHERE id = @id${lock ? " FOR UPDATE" : ""}`).get({ id })) as TypeRow | undefined
}

export async function getCellType(id: number): Promise<CellType | null> {
  const row = await readType(await cellsDb(), id)
  return row ? rowToType(row) : null
}

async function lockCells(tx: PgDb) {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:cells')) AS ok").get()
}

async function assertParent(tx: PgDb, id: number | null, parentId: number | null) {
  if (parentId === null) return
  if (id !== null && parentId === id) throw fieldError("parent", "Нельзя выбрать саму категорию родительской")
  if (!(await readType(tx, parentId))) throw fieldError("parent", "Категория не найдена")
  // a type cannot move under one of its own descendants
  let cursor: number | null = parentId
  for (let depth = 0; id !== null && cursor !== null && depth < 100; depth += 1) {
    if (cursor === id) throw fieldError("parent", "Нельзя выбрать вложенную категорию родительской")
    cursor = ((await tx.prepare("SELECT parent_id FROM cell_types WHERE id = @id").get({ id: cursor })) as { parent_id: number | null } | undefined)?.parent_id ?? null
  }
}

export type CellTypeInput = { name: string; parentId: number | null }

export async function createCellType(input: CellTypeInput): Promise<CellType> {
  await cellsDb()
  return withTransaction(async (tx) => {
    await lockCells(tx)
    const name = input.name.trim()
    if (!name) throw fieldError("name", REQUIRED)
    await assertParent(tx, null, input.parentId)
    const result = await tx.prepare("INSERT INTO cell_types (name, parent_id) VALUES (@name, @parentId)").run({ name, parentId: input.parentId })
    return rowToType((await readType(tx, Number(result.lastInsertRowid)))!)
  })
}

export async function updateCellType(id: number, input: CellTypeInput): Promise<CellType | null> {
  await cellsDb()
  return withTransaction(async (tx) => {
    await lockCells(tx)
    if (!(await readType(tx, id, true))) return null
    const name = input.name.trim()
    if (!name) throw fieldError("name", REQUIRED)
    await assertParent(tx, id, input.parentId)
    await tx.prepare("UPDATE cell_types SET name = @name, parent_id = @parentId, updated_at = datetime('now') WHERE id = @id").run({ id, name, parentId: input.parentId })
    return rowToType((await readType(tx, id))!)
  })
}

export async function deleteCellType(id: number): Promise<boolean> {
  await cellsDb()
  return withTransaction(async (tx) => {
    await lockCells(tx)
    if (!(await readType(tx, id, true))) return false
    const usage = []
    const cells = Number(((await tx.prepare("SELECT COUNT(*) AS n FROM cells WHERE cell_type_id = @id").get({ id })) as { n: string | number }).n)
    if (cells) usage.push({ table: "cells", label: "Ячейки", count: cells })
    const children = Number(((await tx.prepare("SELECT COUNT(*) AS n FROM cell_types WHERE parent_id = @id").get({ id })) as { n: string | number }).n)
    if (children) usage.push({ table: "cell_types", label: "Тип ячейки", count: children })
    if (usage.length) throw new DictionaryError(DELETE_BLOCKED, 409, undefined, usage)
    return (await tx.prepare("DELETE FROM cell_types WHERE id = @id").run({ id })).changes > 0
  })
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

type CellRow = { id: number; name: string; barcode: string; cell_type_id: number | null; cell_type: string | null; created_iso: string }

const CELL_SELECT = `SELECT c.id, c.name, c.barcode, c.cell_type_id, t.name AS cell_type,
  ${CREATED_ISO_SQL.replace(/created_at/g, "c.created_at")} AS created_iso
  FROM cells c LEFT JOIN cell_types t ON t.id = c.cell_type_id`

function rowToCell(row: CellRow): Cell {
  return {
    id: Number(row.id),
    name: row.name,
    barcode: row.barcode ?? "",
    cellTypeId: row.cell_type_id === null ? null : Number(row.cell_type_id),
    cellType: row.cell_type ?? "",
    createdDate: createdDateLabel(row.created_iso),
    createdAt: row.created_iso,
  }
}

export async function listCellsPage(query: { search: string; page: number; pageSize: number }): Promise<CellListResult> {
  const db = await cellsDb()
  const where = "WHERE (@needle = '' OR strpos(fin_key(concat_ws(' ', c.name, c.barcode, t.name)), fin_key(@needle)) > 0)"
  const params = { needle: dictionaryKey(query.search) ? query.search.trim() : "" }
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM cells c LEFT JOIN cell_types t ON t.id = c.cell_type_id ${where}`).get(params)) as { n: string | number }
  const rows = (await db
    .prepare(`${CELL_SELECT} ${where} ORDER BY ${CREATED_ORDER_SQL.replace("created_at", "c.created_at")} ASC NULLS LAST, c.id ASC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: query.pageSize, offset: (query.page - 1) * query.pageSize })) as CellRow[]
  return { count: Number(total.n), results: rows.map(rowToCell) }
}

async function readCell(db: PgDb, id: number, lock = false): Promise<CellRow | undefined> {
  // FOR UPDATE cannot lock the nullable side of an outer join
  return (await db.prepare(`${CELL_SELECT} WHERE c.id = @id${lock ? " FOR UPDATE OF c" : ""}`).get({ id })) as CellRow | undefined
}

export async function getCell(id: number): Promise<Cell | null> {
  const row = await readCell(await cellsDb(), id)
  return row ? rowToCell(row) : null
}

export type CellInput = { name: string; barcode: string; cellTypeId: number | null }

async function validateCell(tx: PgDb, input: CellInput) {
  if (!input.name.trim()) throw fieldError("name", REQUIRED)
  if (input.cellTypeId !== null && !(await readType(tx, input.cellTypeId))) throw fieldError("cellType", "Тип ячейки не найден")
}

export async function createCell(input: CellInput): Promise<Cell> {
  await cellsDb()
  return withTransaction(async (tx) => {
    await lockCells(tx)
    await validateCell(tx, input)
    const result = await tx
      .prepare("INSERT INTO cells (name, barcode, cell_type_id) VALUES (@name, @barcode, @cellTypeId)")
      .run({ name: input.name.trim(), barcode: input.barcode.trim(), cellTypeId: input.cellTypeId })
    return rowToCell((await readCell(tx, Number(result.lastInsertRowid)))!)
  })
}

export async function updateCell(id: number, input: CellInput): Promise<Cell | null> {
  await cellsDb()
  return withTransaction(async (tx) => {
    await lockCells(tx)
    if (!(await readCell(tx, id, true))) return null
    await validateCell(tx, input)
    await tx
      .prepare("UPDATE cells SET name = @name, barcode = @barcode, cell_type_id = @cellTypeId, updated_at = datetime('now') WHERE id = @id")
      .run({ id, name: input.name.trim(), barcode: input.barcode.trim(), cellTypeId: input.cellTypeId })
    return rowToCell((await readCell(tx, id))!)
  })
}

export async function deleteCell(id: number): Promise<boolean> {
  await cellsDb()
  return withTransaction(async (tx) => {
    await lockCells(tx)
    return (await tx.prepare("DELETE FROM cells WHERE id = @id").run({ id })).changes > 0
  })
}
