import "server-only"

import type { CurrencyRate, IndividualRate } from "@/components/analytics/currencies-data"
import { getDb } from "@/lib/db"

// Reference finance/currency_rate/ (history of a currency's rate) and finance/individual_rate/.
// The first call creates both tables and loads the reference rows.

const USD_HISTORY: Array<[number, number, string]> = [
  [76, 9500, "2020-01-31 23:17:27"], [78, 9600, "2020-02-01 15:31:07"], [79, 9550, "2020-02-25 22:48:39"],
  [80, 9600, "2020-04-02 11:48:51"], [81, 9800, "2020-04-13 12:41:40"], [82, 10200, "2020-04-15 14:53:48"],
  [83, 10150, "2020-05-12 10:35:34"], [84, 10180, "2020-06-03 10:39:54"], [85, 10200, "2020-06-20 14:50:09"],
  [86, 10260, "2020-08-04 15:45:03"], [87, 10350, "2020-09-01 15:02:43"], [88, 10380, "2020-10-09 17:18:24"],
  [89, 10400, "2020-10-17 17:40:02"], [90, 10500, "2020-12-31 15:14:08"], [91, 10600, "2022-03-28 14:31:39"],
  [92, 11000, "2022-10-18 16:24:03"], [93, 11200, "2022-10-18 16:24:25"], [94, 12970, "2025-01-08 19:04:12"],
  [95, 12660, "2025-08-07 15:28:22"], [96, 12650, "2025-08-14 14:51:32"], [98, 12070.85, "2025-12-09 15:41:49"],
  [99, 12500, "2026-03-25 12:11:09"],
]

const INDIVIDUAL: Array<[number, string, number, string]> = [
  [1, "111", 15000, "2025-01-30 13:05:54"],
  [2, "yan", 12000, "2025-05-16 15:38:42"],
  [3, "individualni", 12650, "2025-08-09 15:23:20"],
]

let ready: Promise<void> | null = null

export function ensureRatesSchema() {
  ready ??= (async () => {
    const db = getDb()
    const existing = (await db.prepare("SELECT to_regclass('currency_rates') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
    await db.exec(`
      CREATE TABLE IF NOT EXISTS currency_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        currency_id INTEGER NOT NULL,
        rate DOUBLE PRECISION NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS individual_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        rate DOUBLE PRECISION NOT NULL,
        begin_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    if (existing?.ok) return
    const sql = [
      "UPDATE currencies SET name = 'SUM', created_at = '2018-01-02 18:47:57', updated_at = '2018-01-31 23:17:27' WHERE code = 'SUM'",
      "UPDATE currencies SET name = 'USD', rate = 12500, created_at = '2018-01-02 18:47:57', updated_at = '2026-03-25 12:11:09' WHERE code = 'USD'",
      "INSERT INTO currencies (id, name, code, rate, is_base, created_at, updated_at) SELECT 3, 'Euro', 'EUR', 14658, 0, '2025-08-14 14:50:40', '2025-08-14 14:53:20' WHERE NOT EXISTS (SELECT 1 FROM currencies WHERE code = 'EUR')",
    ]
    for (const statement of sql) await db.exec(statement)
    const base = (await db.prepare("SELECT id FROM currencies WHERE code = 'USD'").get()) as { id: number } | undefined
    const euro = (await db.prepare("SELECT id FROM currencies WHERE code = 'EUR'").get()) as { id: number } | undefined
    const insertRate = "INSERT INTO currency_rates (id, currency_id, rate, created_at) VALUES (@id, @currency, @rate, @createdAt)"
    if (base) for (const [id, rate, createdAt] of USD_HISTORY) await db.prepare(insertRate).run({ id, currency: base.id, rate, createdAt })
    if (euro) await db.prepare(insertRate).run({ id: 97, currency: euro.id, rate: 14658, createdAt: "2025-08-14 14:53:20" })
    for (const [id, name, rate, createdAt] of INDIVIDUAL) {
      await db
        .prepare("INSERT INTO individual_rates (id, name, rate, begin_date, end_date, created_at) VALUES (@id, @name, @rate, '2026-10-22', '2026-10-26', @createdAt)")
        .run({ id, name, rate, createdAt })
    }
    await db.exec("SELECT setval(pg_get_serial_sequence('currency_rates', 'id'), (SELECT MAX(id) FROM currency_rates))")
    await db.exec("SELECT setval(pg_get_serial_sequence('individual_rates', 'id'), (SELECT MAX(id) FROM individual_rates))")
    await db.exec("SELECT setval(pg_get_serial_sequence('currencies', 'id'), (SELECT MAX(id) FROM currencies))")
  })().catch((error) => {
    ready = null
    throw error
  })
  return ready
}

type RateRow = { id: number; currency_id: number; rate: number; created_at: string }

export async function listCurrencyRates(currencyId: number): Promise<CurrencyRate[]> {
  await ensureRatesSchema()
  const rows = (await getDb().prepare("SELECT id, currency_id, rate, created_at FROM currency_rates WHERE currency_id = ? ORDER BY id DESC").all(currencyId)) as RateRow[]
  return rows.map((row) => ({ id: row.id, currencyId: row.currency_id, rate: Number(row.rate), createdAt: row.created_at }))
}

export type SetRateResult = { ok: true } | { ok: false; error: "not_found" | "is_base" }

/** "Установить курс": a new history row; the currency takes it as the current rate. */
export async function setCurrencyRate(currencyId: number, rate: number): Promise<SetRateResult> {
  await ensureRatesSchema()
  const db = getDb()
  const currency = (await db.prepare("SELECT id, is_base FROM currencies WHERE id = ?").get(currencyId)) as { id: number; is_base: number } | undefined
  if (!currency) return { ok: false, error: "not_found" }
  if (currency.is_base === 1) return { ok: false, error: "is_base" }
  await db.prepare("INSERT INTO currency_rates (currency_id, rate) VALUES (@currencyId, @rate)").run({ currencyId, rate })
  await db.prepare("UPDATE currencies SET rate = @rate, updated_at = datetime('now') WHERE id = @currencyId").run({ currencyId, rate })
  return { ok: true }
}

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
  if (!(await getIndividualRate(id))) return null
  await getDb()
    .prepare("UPDATE individual_rates SET name = @name, rate = @rate, begin_date = @beginDate, end_date = @endDate WHERE id = @id")
    .run({ id, ...input })
  return getIndividualRate(id)
}
