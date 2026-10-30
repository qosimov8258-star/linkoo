import "server-only"

import type { CurrencyRate, IndividualRate } from "@/components/analytics/currencies-data"
import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { parseAnyDate } from "@/lib/finance/dates"
import { MAX_DB_ID } from "@/lib/strict-number"

// "История обновления курса" of a currency (currency_rates: one row per "Установить курс")
// and the "Индивидуальный" rates (individual_rates). A fresh install starts with both tables
// empty: only what the company enters is shown.

// ---------------------------------------------------------------------------
// Schema (once per process, on the maintenance pool, never in a request transaction)
// ---------------------------------------------------------------------------

// 2: no demo seed; an older process's exact seed rows are removed (see removeSeedRows).
const SCHEMA_VERSION = 3

declare global {
  var __linkoCurrencyRatesSchema: { version: number; ready: Promise<void> } | undefined
}

const DDL = `
  CREATE TABLE IF NOT EXISTS currency_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currency_id INTEGER NOT NULL,
    rate DOUBLE PRECISION NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS currency_rates_currency_idx ON currency_rates (currency_id, id);
  CREATE TABLE IF NOT EXISTS individual_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rate DOUBLE PRECISION NOT NULL,
    begin_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`

// The demo rows an earlier build wrote into every database the first time these tables were
// created (another company's data). Only rows equal to them in every field are removed: their
// ids and creation stamps (2020–2025) are the seed's own, a row the company entered never has
// them (created_at is the server's clock), so real rates are never touched.
const SEED_USD_HISTORY: Array<[number, number, string]> = [
  [76, 9500, "2020-01-31 23:17:27"], [78, 9600, "2020-02-01 15:31:07"], [79, 9550, "2020-02-25 22:48:39"],
  [80, 9600, "2020-04-02 11:48:51"], [81, 9800, "2020-04-13 12:41:40"], [82, 10200, "2020-04-15 14:53:48"],
  [83, 10150, "2020-05-12 10:35:34"], [84, 10180, "2020-06-03 10:39:54"], [85, 10200, "2020-06-20 14:50:09"],
  [86, 10260, "2020-08-04 15:45:03"], [87, 10350, "2020-09-01 15:02:43"], [88, 10380, "2020-10-09 17:18:24"],
  [89, 10400, "2020-10-17 17:40:02"], [90, 10500, "2020-12-31 15:14:08"], [91, 10600, "2022-03-28 14:31:39"],
  [92, 11000, "2022-10-18 16:24:03"], [93, 11200, "2022-10-18 16:24:25"], [94, 12970, "2025-01-08 19:04:12"],
  [95, 12660, "2025-08-07 15:28:22"], [96, 12650, "2025-08-14 14:51:32"], [98, 12070.85, "2025-12-09 15:41:49"],
  [99, 12500, "2026-03-25 12:11:09"],
]
const SEED_EUR_RATE: [number, number, string] = [97, 14658, "2025-08-14 14:53:20"]
const SEED_INDIVIDUAL: Array<[number, string, number, string]> = [
  [1, "111", 15000, "2025-01-30 13:05:54"],
  [2, "yan", 12000, "2025-05-16 15:38:42"],
  [3, "individualni", 12650, "2025-08-09 15:23:20"],
]
const SEED_INDIVIDUAL_DAYS = ["2026-10-22", "2026-10-26"] as const
/** The seed's "Euro" currency (inserted only where no EUR existed). */
const SEED_EURO = { id: 3, name: "Euro", code: "EUR", rate: 14658, createdAt: "2025-08-14 14:50:40", updatedAt: "2025-08-14 14:53:20" }

async function removeSeedRows(tx: PgDb): Promise<void> {
  const seedRates = [
    ...SEED_USD_HISTORY.map(([id, rate, createdAt]) => ({ id, rate, createdAt, code: "USD" })),
    { id: SEED_EUR_RATE[0], rate: SEED_EUR_RATE[1], createdAt: SEED_EUR_RATE[2], code: "EUR" },
  ]
  await tx
    .prepare(
      `DELETE FROM currency_rates r
        USING jsonb_to_recordset(@rows::jsonb) AS s(id int, rate float8, "createdAt" text, code text)
        WHERE r.id = s.id AND r.rate = s.rate AND r.created_at = s."createdAt"
          AND r.currency_id IN (SELECT c.id FROM currencies c WHERE upper(btrim(c.code)) = s.code)`,
    )
    .run({ rows: JSON.stringify(seedRates) })
  await tx
    .prepare(
      `DELETE FROM individual_rates r
        USING jsonb_to_recordset(@rows::jsonb) AS s(id int, name text, rate float8, "createdAt" text)
        WHERE r.id = s.id AND r.name = s.name AND r.rate = s.rate AND r.created_at = s."createdAt"
          AND r.begin_date = @begin AND r.end_date = @end`,
    )
    .run({
      rows: JSON.stringify(SEED_INDIVIDUAL.map(([id, name, rate, createdAt]) => ({ id, name, rate, createdAt }))),
      begin: SEED_INDIVIDUAL_DAYS[0],
      end: SEED_INDIVIDUAL_DAYS[1],
    })

  // The seed's "Euro" currency: removed only while it is exactly the seed row (never renamed,
  // re-rated or edited since), has no rate history of the company and nothing uses it.
  const euro = await tx
    .prepare(
      `SELECT id, code FROM currencies
        WHERE id = @id AND name = @name AND code = @code AND rate = @rate AND is_base = 0 AND created_at = @createdAt AND updated_at = @updatedAt`,
    )
    .get(SEED_EURO)
  if (!euro) return
  // Same lock as every currency write (lib/currencies-repo.ts); NOWAIT so a request that holds it
  // never waits for this install (the cleanup is retried by the next process instead).
  try {
    await withTransaction(async (inner) => {
      await inner.exec("LOCK TABLE currencies IN SHARE ROW EXCLUSIVE MODE NOWAIT")
      const history = await inner.prepare("SELECT 1 AS ok FROM currency_rates WHERE currency_id = ? LIMIT 1").get(SEED_EURO.id)
      if (history) return
      const { currencyUsage } = await import("@/lib/currencies-repo")
      const { withEmployeeLinks } = await import("@/lib/employees-usage")
      const usage = await withEmployeeLinks(inner, "currencies", { id: SEED_EURO.id }, await currencyUsage(inner, euro as { id: number; code: string }))
      if (usage.length) return
      await inner
        .prepare(
          `DELETE FROM currencies
            WHERE id = @id AND name = @name AND code = @code AND rate = @rate AND is_base = 0 AND created_at = @createdAt AND updated_at = @updatedAt`,
        )
        .run(SEED_EURO)
    })
  } catch (error) {
    console.warn("currency seed cleanup skipped:", error instanceof Error ? error.message : error)
  }
}

async function install(): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:currency_rates:schema'))")
    await tx.exec(DDL)
    await removeSeedRows(tx)
    // Provable orphans: rate history rows of a currency that no longer exists (deleteCurrency of an
    // older build left them behind). No document reads a rate of a deleted currency.
    await tx.exec("DELETE FROM currency_rates r WHERE NOT EXISTS (SELECT 1 FROM currencies c WHERE c.id = r.currency_id)")
  })
}

/** currency_rates / individual_rates, once per process (outside any request transaction). */
export function ensureRatesSchema(): Promise<void> {
  if (globalThis.__linkoCurrencyRatesSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(install).catch((error: unknown) => {
      globalThis.__linkoCurrencyRatesSchema = undefined
      throw error
    })
    globalThis.__linkoCurrencyRatesSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoCurrencyRatesSchema!.ready
}

const validId = (id: number) => Number.isInteger(id) && id > 0 && id <= MAX_DB_ID

// ---------------------------------------------------------------------------
// Currency rate history
// ---------------------------------------------------------------------------

type RateRow = { id: number; currency_id: number; rate: number; created_at: string }

export async function listCurrencyRates(currencyId: number): Promise<CurrencyRate[]> {
  await ensureRatesSchema()
  if (!validId(currencyId)) return []
  const rows = (await getDb().prepare("SELECT id, currency_id, rate, created_at FROM currency_rates WHERE currency_id = ? ORDER BY id DESC").all(currencyId)) as RateRow[]
  return rows.map((row) => ({ id: row.id, currencyId: row.currency_id, rate: Number(row.rate), createdAt: row.created_at }))
}

export type SetRateResult = { ok: true } | { ok: false; error: "not_found" | "is_base" }

/** In the caller's transaction: a new history row, and the currency takes it as its current
 * rate. The first change of a currency first records the rate it had until then (stamped with
 * the currency's creation), so documents of before the change keep converting at that rate. */
async function writeRate(db: PgDb, currencyId: number, rate: number): Promise<SetRateResult> {
  // Same lock as every currency write (lib/currencies-repo.ts): changes of one currency run one after another.
  await db.exec("LOCK TABLE currencies IN SHARE ROW EXCLUSIVE MODE")
  const currency = (await db.prepare("SELECT id, is_base, rate FROM currencies WHERE id = ?").get(currencyId)) as
    | { id: number; is_base: number; rate: number | null }
    | undefined
  if (!currency) return { ok: false, error: "not_found" }
  if (currency.is_base === 1) return { ok: false, error: "is_base" }
  await db
    .prepare(
      `INSERT INTO currency_rates (currency_id, rate, created_at)
        SELECT c.id, c.rate, c.created_at FROM currencies c
         WHERE c.id = @currencyId AND c.rate > 0 AND c.rate <> @rate
           AND NOT EXISTS (SELECT 1 FROM currency_rates r WHERE r.currency_id = c.id)`,
    )
    .run({ currencyId, rate })
  await db.prepare("INSERT INTO currency_rates (currency_id, rate) VALUES (@currencyId, @rate)").run({ currencyId, rate })
  await db.prepare("UPDATE currencies SET rate = @rate, updated_at = datetime('now') WHERE id = @currencyId").run({ currencyId, rate })
  return { ok: true }
}

/** "Установить курс": a new history row; the currency takes it as the current rate. */
export async function setCurrencyRate(currencyId: number, rate: number): Promise<SetRateResult> {
  await ensureRatesSchema()
  if (!validId(currencyId)) return { ok: false, error: "not_found" }
  return withTransaction((tx) => writeRate(tx, currencyId, rate))
}

export type EditCurrencyResult = { ok: true } | { ok: false; error: "not_found" }

/** "Изменить валюту": the name and, when it differs from the current one, a new rate (a history
 * row, as "Установить курс"); the base currency's rate stays 1. One transaction under the
 * currencies lock, so a parallel edit never puts back an older rate. `rename` runs first, in the
 * same transaction (lib/currencies-repo.ts updateCurrency with the locked row's code / rate / base). */
export async function editCurrency(
  currencyId: number,
  rate: number | undefined,
  rename: (current: { code: string; rate: number; isBase: boolean }) => Promise<boolean>,
): Promise<EditCurrencyResult> {
  await ensureRatesSchema()
  if (!validId(currencyId)) return { ok: false, error: "not_found" }
  return withTransaction(async (tx) => {
    await tx.exec("LOCK TABLE currencies IN SHARE ROW EXCLUSIVE MODE")
    const current = (await tx.prepare("SELECT code, rate, is_base FROM currencies WHERE id = ?").get(currencyId)) as
      | { code: string; rate: number; is_base: number }
      | undefined
    if (!current) return { ok: false, error: "not_found" }
    const isBase = current.is_base === 1
    if (!(await rename({ code: current.code, rate: Number(current.rate), isBase }))) return { ok: false, error: "not_found" }
    if (!isBase && rate !== undefined && rate !== Number(current.rate)) await writeRate(tx, currencyId, rate)
    return { ok: true }
  })
}

// ---------------------------------------------------------------------------
// Conversion to the base currency for the reports
// ---------------------------------------------------------------------------

export type RateBook = {
  /** Canonical code of the base currency (lib/finance/context.ts). */
  base: string
  /** Units of the base currency per 1 unit of `code` that were valid at `stamp` (a stored date:
   * the "YYYY-MM-DD HH:MM:SS" UTC text of created_at columns, or any form parseAnyDate reads):
   * the latest history row up to then, else the oldest one known, else the currency's rate.
   * 1 for the base currency (an empty code is the base); null for a currency the table lacks. */
  rateAt(code: string | null | undefined, stamp: string | null | undefined): number | null
}

/** The currencies and their rate history, read once for a report. */
export async function loadRateBook(db: PgDb = getDb()): Promise<RateBook> {
  await ensureRatesSchema()
  const context = await loadCurrencyContext(db)
  const rows = (await db.prepare("SELECT currency_id, rate, created_at FROM currency_rates WHERE rate > 0 ORDER BY id").all()) as {
    currency_id: number
    rate: number
    created_at: string
  }[]
  const history = new Map<number, { at: string; rate: number }[]>()
  for (const row of rows) {
    const at = parseAnyDate(row.created_at, true)
    const rate = Number(row.rate)
    if (!at || !Number.isFinite(rate) || rate <= 0) continue
    const list = history.get(Number(row.currency_id)) ?? []
    list.push({ at, rate })
    history.set(Number(row.currency_id), list)
  }
  for (const list of history.values()) list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  const byCode = new Map(context.currencies.map((currency) => [currency.code, currency]))
  return {
    base: context.base,
    rateAt(code, stamp) {
      const canonical = normCurrency(code, context.base)
      if (canonical === context.base) return 1
      const currency = byCode.get(canonical)
      if (!currency) return null
      const list = currency.id === null ? undefined : history.get(Number(currency.id))
      if (list?.length) {
        const at = parseAnyDate(stamp, true)
        let found = list[0].rate
        if (at) for (const entry of list) if (entry.at <= at) found = entry.rate
        return found
      }
      return currency.rate && currency.rate > 0 ? currency.rate : null
    },
  }
}

// ---------------------------------------------------------------------------
// Individual rates
// ---------------------------------------------------------------------------

type IndividualRow = { id: number; name: string; rate: number; begin_date: string; end_date: string; created_at: string }

function toIndividual(row: IndividualRow): IndividualRate {
  return { id: row.id, name: row.name, rate: Number(row.rate), beginDate: row.begin_date, endDate: row.end_date, createdAt: row.created_at }
}

export async function listIndividualRates(): Promise<IndividualRate[]> {
  await ensureRatesSchema()
  return ((await getDb().prepare("SELECT * FROM individual_rates ORDER BY id DESC").all()) as IndividualRow[]).map(toIndividual)
}

export async function getIndividualRate(id: number): Promise<IndividualRate | null> {
  await ensureRatesSchema()
  if (!validId(id)) return null
  const row = (await getDb().prepare("SELECT * FROM individual_rates WHERE id = ?").get(id)) as IndividualRow | undefined
  return row ? toIndividual(row) : null
}

export type IndividualRateInput = { name: string; rate: number; beginDate: string; endDate: string }

export async function createIndividualRate(input: IndividualRateInput): Promise<IndividualRate> {
  await ensureRatesSchema()
  const result = await getDb()
    .prepare("INSERT INTO individual_rates (name, rate, begin_date, end_date) VALUES (@name, @rate, @beginDate, @endDate)")
    .run(input)
  return (await getIndividualRate(Number(result.lastInsertRowid)))!
}

export async function updateIndividualRate(id: number, input: IndividualRateInput): Promise<IndividualRate | null> {
  await ensureRatesSchema()
  if (!validId(id)) return null
  const result = await getDb()
    .prepare("UPDATE individual_rates SET name = @name, rate = @rate, begin_date = @beginDate, end_date = @endDate WHERE id = @id")
    .run({ id, ...input })
  if (!result.changes) return null
  return getIndividualRate(id)
}

/** Removes an individual rate (no document refers to one: a payment keeps the rate it used). false = no such rate. */
export async function deleteIndividualRate(id: number): Promise<boolean> {
  await ensureRatesSchema()
  if (!validId(id)) return false
  return (await getDb().prepare("DELETE FROM individual_rates WHERE id = ?").run(id)).changes > 0
}
