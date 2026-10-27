import "server-only"

import { isUniqueViolation } from "@/lib/auth-request"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { cascadeNameRename, discoverReferences, keySql, nameKey, usageOf, type Usage } from "@/lib/platform-refs"

// Филиалы. The default price list must be a price list of Прайс-листы ('' = none)
// and the currency a currency of Валюты (stored as its code: SUM, USD, EUR, …);
// both are stored in the directory's own spelling. An update keeps an unchanged
// legacy value (a renamed / removed list, an older "Euro"), so old rows stay editable.

let schemaReady: Promise<void> | null = null

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = outsideTransaction(async () => {
      const db = getDb()
      await db.exec(`
        CREATE TABLE IF NOT EXISTS branches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          price_list TEXT NOT NULL DEFAULT '',
          currency TEXT NOT NULL DEFAULT 'SUM',
          debt_tracking INTEGER NOT NULL DEFAULT 1,
          is_main INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
      // One branch name per company (case- and space-insensitive) and at most
      // one main branch. Older databases with several mains keep the oldest;
      // an index is skipped (and the API still refuses new twins) while
      // duplicate names exist.
      await db.exec(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'branches_one_main') THEN
            UPDATE branches SET is_main = 0
             WHERE is_main = 1 AND id <> (SELECT min(id) FROM branches WHERE is_main = 1);
            CREATE UNIQUE INDEX branches_one_main ON branches ((is_main)) WHERE is_main = 1;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'branches_name_key') THEN
            BEGIN
              CREATE UNIQUE INDEX branches_name_key ON branches (lower(btrim(name)));
            EXCEPTION WHEN unique_violation THEN
              RAISE NOTICE 'branches_name_key skipped: duplicate branch names exist';
            END;
          END IF;
        END $$;
      `)
    }).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  await schemaReady
}

/** Currency code of Валюты (older rows may still hold "Euro"; read as EUR). */
export type BranchCurrency = string

export type BranchRecord = {
  id: number
  name: string
  date: string
  debtTracking: boolean
  isMain: boolean
  priceList: string
  currency: BranchCurrency
}

type Row = {
  id: number
  name: string
  price_list: string
  currency: string
  debt_tracking: number
  is_main: number
  created_at: string
}

export type BranchUsage = Usage

export class BranchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly usage?: BranchUsage[],
  ) {
    super(message)
  }
}

function formatDate(raw: string): string {
  const date = new Date(`${raw.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return raw
  const months = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
  return `${String(date.getUTCDate()).padStart(2, "0")} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

function toCurrency(value: string): BranchCurrency {
  return normCurrency(value)
}

function rowToBranch(row: Row): BranchRecord {
  return {
    id: row.id,
    name: row.name,
    date: formatDate(row.created_at),
    debtTracking: row.debt_tracking === 1,
    isMain: row.is_main === 1,
    priceList: row.price_list,
    currency: toCurrency(row.currency),
  }
}

export type BranchInput = {
  name: string
  priceList: string
  /** A currency of Валюты; empty = the base currency. */
  currency: BranchCurrency
  debtTracking: boolean
  isMain: boolean
}

/** Partial input of an update: omitted fields keep their current value. */
export type BranchPatch = Partial<BranchInput> & { name: string }

/** Columns that store a branch: text `branch`, `*_branch`, `branch_name`,
 * `*_branch_name` (by name) and integer `branch_id`, `*_branch_id` (by id). */
function branchReferences(db: PgDb) {
  return discoverReferences(
    db,
    `c.column_name IN ('branch', 'branch_name', 'branch_id')
       OR c.column_name LIKE '%\\_branch' OR c.column_name LIKE '%\\_branch\\_name' OR c.column_name LIKE '%\\_branch\\_id'`,
    "name",
    "branches",
  )
}

export async function listBranches(): Promise<BranchRecord[]> {
  const db = getDb()
  await ensureSchema()
  return ((await db.prepare("SELECT * FROM branches ORDER BY LOWER(name) COLLATE \"C\" ASC").all()) as Row[]).map(rowToBranch)
}

export async function getBranch(id: number): Promise<BranchRecord | null> {
  const db = getDb()
  await ensureSchema()
  const row = (await db.prepare("SELECT * FROM branches WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToBranch(row) : null
}

/** Where the branch is used (warehouses, cashboxes, employees, suppliers, clients, balance entries …). */
export async function branchUsage(db: PgDb, branch: { id: number; name: string }): Promise<BranchUsage[]> {
  return usageOf(db, await branchReferences(db), { id: branch.id, name: branch.name })
}

async function lockBranches(db: PgDb) {
  await db.prepare("LOCK TABLE branches IN SHARE ROW EXCLUSIVE MODE").run()
}

async function assertNameFree(db: PgDb, name: string, exceptId: number) {
  const twin = await db.prepare(`SELECT id FROM branches WHERE ${keySql("name")} = ${keySql("?::text")} AND id <> ?`).get(name, exceptId)
  if (twin) throw new BranchError("Филиал с таким названием уже существует", 409)
}

const NOT_SET = new Set(["", "не указано", "не указан", "—", "-"])

/** The default price list as Прайс-листы spells it ('' = none); an unchanged stored value is kept. */
async function resolvePriceList(db: PgDb, value: string | undefined, current?: Row): Promise<string> {
  if (current && (value === undefined || nameKey(value) === nameKey(current.price_list))) return current.price_list
  const name = (value ?? "").trim()
  if (NOT_SET.has(nameKey(name))) return ""
  const table = (await db.prepare("SELECT to_regclass('price_lists') IS NOT NULL AS ok").get()) as { ok: boolean }
  const row = table.ok
    ? ((await db.prepare(`SELECT name FROM price_lists WHERE ${keySql("name")} = ${keySql("?::text")} ORDER BY id LIMIT 1`).get(name)) as { name: string } | undefined)
    : undefined
  if (!row) throw new BranchError("Прайс-лист не найден", 400)
  return row.name
}

/** The currency code of Валюты; empty = the base currency on create, unchanged on update.
 * A company that has no currency yet can only use its base unit. */
async function resolveCurrency(db: PgDb, value: string | undefined, current?: Row): Promise<string> {
  const text = (value ?? "").trim()
  if (current && (!text || normCurrency(text) === normCurrency(current.currency))) return current.currency
  const context = await loadCurrencyContext(db)
  if (!text) return context.base
  const code = normCurrency(text)
  if (context.currencies.some((currency) => currency.code === code)) return code
  if (code === context.base) {
    const any = (await db.prepare("SELECT EXISTS (SELECT 1 FROM currencies) AS ok").get()) as { ok: boolean }
    if (!any.ok) return code
  }
  throw new BranchError("Валюта не найдена", 400)
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new BranchError("Филиал с таким названием уже существует", 409)
  throw error
}

export async function createBranch(input: BranchInput): Promise<BranchRecord> {
  await ensureSchema()
  try {
    const id = await withTransaction(async (tx) => {
      await lockBranches(tx)
      await assertNameFree(tx, input.name, 0)
      const priceList = await resolvePriceList(tx, input.priceList)
      const currency = await resolveCurrency(tx, input.currency)
      // The first branch of a company is its main branch; a new main replaces the old one.
      const hasMain = await tx.prepare("SELECT 1 FROM branches WHERE is_main = 1").get()
      const isMain = input.isMain || !hasMain
      if (isMain) await tx.prepare("UPDATE branches SET is_main = 0, updated_at = datetime('now') WHERE is_main = 1").run()
      const result = await tx
        .prepare(
          `INSERT INTO branches (name, price_list, currency, debt_tracking, is_main)
           VALUES (@name, @priceList, @currency, @debtTracking, @isMain)`,
        )
        .run({
          name: input.name,
          priceList,
          currency,
          debtTracking: input.debtTracking ? 1 : 0,
          isMain: isMain ? 1 : 0,
        })
      return Number(result.lastInsertRowid)
    })
    return (await getBranch(id))!
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Updates the branch. A new name is carried into every record that stores the
 * branch by name; making it main unsets the previous main branch; the main
 * branch cannot be "un-mained" directly (make another branch main instead). */
export async function updateBranch(id: number, patch: BranchPatch): Promise<BranchRecord | null> {
  await ensureSchema()
  try {
    const found = await withTransaction(async (tx) => {
      await lockBranches(tx)
      const current = (await tx.prepare("SELECT * FROM branches WHERE id = ?").get(id)) as Row | undefined
      if (!current) return false
      if (nameKey(current.name) !== nameKey(patch.name)) await assertNameFree(tx, patch.name, id)
      const isMain = patch.isMain ?? current.is_main === 1
      if (!isMain && current.is_main === 1) {
        throw new BranchError("Нельзя снять признак основного филиала: сделайте основным другой филиал", 400)
      }
      const priceList = await resolvePriceList(tx, patch.priceList, current)
      const currency = await resolveCurrency(tx, patch.currency, current)
      if (isMain && current.is_main !== 1) {
        await tx.prepare("UPDATE branches SET is_main = 0, updated_at = datetime('now') WHERE is_main = 1 AND id <> ?").run(id)
      }
      await tx
        .prepare(
          `UPDATE branches SET name = @name, price_list = @priceList, currency = @currency,
             debt_tracking = @debtTracking, is_main = @isMain, updated_at = datetime('now')
           WHERE id = @id`,
        )
        .run({
          id,
          name: patch.name,
          priceList,
          currency,
          debtTracking: (patch.debtTracking ?? current.debt_tracking === 1) ? 1 : 0,
          isMain: isMain ? 1 : 0,
        })
      if (current.name !== patch.name) await cascadeNameRename(tx, await branchReferences(tx), current.name, patch.name)
      return true
    })
    return found ? await getBranch(id) : null
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Refused while anything references the branch (409 with the usage list) and
 * always for the main branch. */
export async function deleteBranch(id: number): Promise<boolean> {
  await ensureSchema()
  return withTransaction(async (tx) => {
    await lockBranches(tx)
    const current = (await tx.prepare("SELECT * FROM branches WHERE id = ?").get(id)) as Row | undefined
    if (!current) return false
    if (current.is_main === 1) throw new BranchError("Нельзя удалить основной филиал", 409)
    const usage = await branchUsage(tx, current)
    if (usage.length) throw new BranchError("Удаление невозможно из-за связи с другими данными", 409, usage)
    return (await tx.prepare("DELETE FROM branches WHERE id = ?").run(id)).changes > 0
  })
}
