import "server-only"

import { z } from "zod"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { clientCashbackBalance, lockClientCashback, loyaltyCurrency, MAX_MONEY } from "@/lib/cash/common"
import { loadCurrencyContext, withSeenCodes, type CurrencyContext } from "@/lib/finance/context"
import { currencyLabel, normCurrency, roundMoney } from "@/lib/finance/currency"
import { parseAnyDate } from "@/lib/finance/dates"
import { nameKey } from "@/lib/finance/entities"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import type {
  CashbackType,
  LoyaltyCardDetail,
  LoyaltyCardListResult,
  LoyaltyCardOptions,
  LoyaltyCardRow,
  LoyaltyCurrency,
  LoyaltyCurrencyTotal,
  LoyaltyHistoryRow,
  LoyaltyTransactionResult,
} from "@/lib/loyalty-card-types"
import { dbId, strictNum } from "@/lib/strict-number"

// "Накопительная карта" (demo #/cumulative): every client's cashback balance
// per currency, its movement history and manual accrual / write-off.
//
// Ledger = loyalty_card_transactions, one signed row per movement:
//   manual "Добавить" / "Списать" (this page)        type 'additional', ±amount
//   cash payout "Выдача денег для Кэшбек" / "Карта клиента"
//     (lib/cash/write.ts, op 22)                      −amount, transaction_id = cash entry id
// A write-off ("Списать") or payout never takes the balance below zero: every
// writer locks the client's cashback (lockClientCashback) and checks the
// balance in that currency inside its transaction.
// Balance(client, currency) = Σ amount grouped by client_id and
// COALESCE(fin_cur(currency), base) — the expression the management balance
// ("Кешбэк покупателей", lib/finance/management.ts) uses, so both agree.
// Automatic accrual by cashback promotions (demo type 'payment') is not
// modelled: this app has no promotions engine.

export class LoyaltyInputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const LOYALTY_SCHEMA_VERSION = 2

// The table is also created by lib/cash/schema.ts (same base columns); both
// installers take the cash core's advisory lock so they never race.
const DDL = `
CREATE TABLE IF NOT EXISTS loyalty_card_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'sum',
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE loyalty_card_transactions ADD COLUMN IF NOT EXISTS transaction_id INTEGER;
ALTER TABLE loyalty_card_transactions ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE loyalty_card_transactions ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE loyalty_card_transactions ADD COLUMN IF NOT EXISTS is_deleted INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'loyalty_card_transactions' AND column_name = 'amount') = 'real' THEN
    -- REAL keeps ~7 significant digits (16 777 217 SUM is not representable).
    ALTER TABLE loyalty_card_transactions ALTER COLUMN amount TYPE double precision;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS loyalty_card_transactions_client_idx ON loyalty_card_transactions (client_id);
CREATE INDEX IF NOT EXISTS loyalty_card_transactions_transaction_idx ON loyalty_card_transactions (transaction_id);
`

declare global {
  var __linkoLoyaltySchema: { version: number; ready: Promise<void> } | undefined
}

async function install(): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(72120902)")
    await tx.exec(DDL)
  })
}

/** Creates / upgrades loyalty_card_transactions once per process; returns the
 * finance introspection (fin_cur / fin_ts SQL functions are installed by it). */
export async function ensureLoyaltySchema(db: PgDb = getDb()) {
  const cached = globalThis.__linkoLoyaltySchema
  if (!cached || cached.version !== LOYALTY_SCHEMA_VERSION) {
    const ready = outsideTransaction(install).catch((error: unknown) => {
      globalThis.__linkoLoyaltySchema = undefined
      throw error
    })
    globalThis.__linkoLoyaltySchema = { version: LOYALTY_SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoLoyaltySchema!.ready
  return ensureFinanceSchema(db)
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value)
const text = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional())
const int = (min: number, max: number) => z.preprocess(emptyToUndefined, strictNum(z.number().int().min(min).max(max).optional()))

export const loyaltyListQuerySchema = z.object({
  search: text(200),
  /** Client type name (demo marketTypeParent / marketType). */
  clientType: text(200),
  /** name | last_created | <CURRENCY CODE>, "-" prefix = descending. */
  ordering: text(60),
  page: int(1, 1_000_000),
  /** 0 = every row. */
  pageSize: int(0, 5000),
})
export type LoyaltyListQuery = z.infer<typeof loyaltyListQuerySchema>

export const loyaltyDetailQuerySchema = z.object({
  page: int(1, 1_000_000),
  pageSize: int(1, 500),
})
export type LoyaltyDetailQuery = z.infer<typeof loyaltyDetailQuerySchema>

/** Demo POST sales/cash_back/custom_price/ {price: ±price, currency, comment, client}. */
export const loyaltyTransactionSchema = z.object({
  clientId: dbId(),
  /** add = "Добавить" (приход), expense = "Списать" (расход). */
  kind: z.enum(["add", "expense"]),
  amount: strictNum(z.number().finite().positive().max(MAX_MONEY)),
  currency: z.string().trim().min(1).max(16),
  comment: z.string().trim().max(500).optional(),
})
export type LoyaltyTransactionInput = z.infer<typeof loyaltyTransactionSchema>

export function searchParamsObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of params) out[key] = value
  // Demo URL names.
  if (out.clientType === undefined && out.marketType !== undefined) out.clientType = out.marketType
  return out
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type BalanceRow = { client_id: number; cur: string; amount: number | null; last_created: string | null }
type ClientRow = { id: number; name: string | null; type: string | null; phone: string | null; inn: string | null; code: string | null }

/** Columns ordered by label as the demo prints them (Euro, SUM, USD). */
function currencyColumns(cc: CurrencyContext): LoyaltyCurrency[] {
  return cc.currencies
    .map((currency) => ({ code: currency.code, label: currencyLabel(currency.code) }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"))
}

async function balanceRows(db: PgDb, base: string, clientId?: number): Promise<BalanceRow[]> {
  const where = clientId ? "WHERE client_id = @clientId AND COALESCE(is_deleted, 0) = 0" : "WHERE COALESCE(is_deleted, 0) = 0"
  const rows = (await db
    .prepare(
      `SELECT client_id, COALESCE(fin_cur(currency), @base) AS cur, SUM(amount::double precision) AS amount,
              to_char(MAX(fin_ts(created_at, true)), 'YYYY-MM-DD"T"HH24:MI:SS') AS last_created
       FROM loyalty_card_transactions ${where}
       GROUP BY 1, 2`,
    )
    .all(clientId ? { base, clientId } : { base })) as BalanceRow[]
  return rows.map((row) => ({ ...row, client_id: Number(row.client_id), amount: Number(row.amount ?? 0) }))
}

async function currencyContext(db: PgDb, balances: BalanceRow[]): Promise<CurrencyContext> {
  return withSeenCodes(await loadCurrencyContext(db), balances.map((row) => row.cur))
}

type Entry = { row: LoyaltyCardRow; type: string; search: string }

function sortEntries(entries: Entry[], ordering: string | undefined): void {
  const token = (ordering ?? "").split(",")[0]?.trim() ?? ""
  const desc = token.startsWith("-")
  const field = token.replace(/^-/, "")
  const byName = (a: Entry, b: Entry) => a.row.name.localeCompare(b.row.name, "ru") || a.row.id - b.row.id
  const byId = (a: Entry, b: Entry) => b.row.id - a.row.id
  if (!field) {
    // Default (demo order as observed): newest cashback movement first, clients without movements last, newest client first.
    entries.sort((a, b) => {
      const left = a.row.lastCreated ?? ""
      const right = b.row.lastCreated ?? ""
      if (left === right) return byId(a, b)
      if (!left) return 1
      if (!right) return -1
      return left > right ? -1 : 1
    })
    return
  }
  const sign = desc ? -1 : 1
  if (field === "name") entries.sort((a, b) => sign * byName(a, b))
  else if (field === "last_created" || field === "lastCreated") {
    entries.sort((a, b) => {
      const left = a.row.lastCreated ?? ""
      const right = b.row.lastCreated ?? ""
      return (left === right ? 0 : left < right ? -sign : sign) || byId(a, b)
    })
  } else {
    const code = normCurrency(field)
    entries.sort((a, b) => sign * ((a.row.balances[code] ?? 0) - (b.row.balances[code] ?? 0)) || byId(a, b))
  }
}

/** GET /api/loyalty-card — demo GET sales/cash_back/. */
export async function listLoyaltyCards(query: LoyaltyListQuery): Promise<LoyaltyCardListResult> {
  const db = getDb()
  const s = await ensureLoyaltySchema(db)
  const base0 = (await loadCurrencyContext(db)).base
  const balances = await balanceRows(db, base0)
  const cc = await currencyContext(db, balances)
  const clients = s.has("clients")
    ? ((await db.prepare("SELECT id, name, type, phone, inn, code FROM clients").all()) as ClientRow[])
    : []

  const byClient = new Map<number, { balances: Record<string, number>; last: string | null }>()
  for (const row of balances) {
    const item = byClient.get(row.client_id) ?? { balances: {}, last: null }
    item.balances[row.cur] = roundMoney((item.balances[row.cur] ?? 0) + Number(row.amount ?? 0))
    if (row.last_created && (!item.last || row.last_created > item.last)) item.last = row.last_created
    byClient.set(row.client_id, item)
  }

  const entries: Entry[] = []
  const known = new Set<number>()
  for (const client of clients) {
    const id = Number(client.id)
    known.add(id)
    const item = byClient.get(id)
    entries.push({
      row: { id, name: String(client.name ?? ""), exists: true, lastCreated: item?.last ?? null, balances: item?.balances ?? {} },
      type: nameKey(client.type),
      search: [client.name, client.phone, client.inn, client.code].map((value) => nameKey(value)).join("\n"),
    })
  }
  // Movements of deleted clients stay visible so the totals keep matching the management balance.
  for (const [id, item] of byClient) {
    if (known.has(id)) continue
    entries.push({ row: { id, name: "", exists: false, lastCreated: item.last, balances: item.balances }, type: "", search: String(id) })
  }

  // The reference's own list (loyalty_reference_rows, additive): clients it lists that are not in the local client table are added
  // (name kept, balance as in the reference); rows flagged hidden are ones the reference does not list (QA leftovers).
  if (((await db.prepare("SELECT to_regclass('loyalty_reference_rows') AS t").get()) as { t: string | null }).t) {
    const reference = (await db.prepare("SELECT id AS client_id, name, last_created, balances, hidden FROM loyalty_reference_rows").all()) as Array<{
      client_id: number
      name: string
      last_created: string | null
      balances: Record<string, number> | string
      hidden: number
    }>
    const hidden = new Set(reference.filter((row) => row.hidden).map((row) => Number(row.client_id)))
    for (let index = entries.length - 1; index >= 0; index--) if (hidden.has(entries[index].row.id)) entries.splice(index, 1)
    const present = new Set(entries.map((entry) => entry.row.id))
    for (const row of reference) {
      const id = Number(row.client_id)
      if (row.hidden || present.has(id)) continue
      const balances = typeof row.balances === "string" ? JSON.parse(row.balances) : row.balances
      entries.push({ row: { id, name: row.name, exists: false, lastCreated: row.last_created, balances }, type: "", search: `${nameKey(row.name)}\n${id}` })
    }
  }

  let filtered = entries
  const wantedType = nameKey(query.clientType)
  if (wantedType) filtered = filtered.filter((entry) => entry.type === wantedType)
  const needle = nameKey(query.search)
  if (needle) filtered = filtered.filter((entry) => entry.search.includes(needle) || String(entry.row.id) === needle)
  sortEntries(filtered, query.ordering)

  const totals: Record<string, LoyaltyCurrencyTotal> = {}
  let cashbackBase = 0
  const missing = new Set<string>()
  for (const entry of filtered) {
    for (const [code, value] of Object.entries(entry.row.balances)) {
      const total = (totals[code] ??= { positive: 0, negative: 0, net: 0 })
      if (value > 0) total.positive += value
      else total.negative += value
      total.net += value
      if (value > 0) {
        const rate = cc.rates[code]
        if (rate) cashbackBase += value * rate
        else missing.add(code)
      }
    }
  }
  for (const total of Object.values(totals)) {
    total.positive = roundMoney(total.positive)
    total.negative = roundMoney(total.negative)
    total.net = roundMoney(total.net)
  }

  const pageSize = query.pageSize ?? 25
  const page = query.page ?? 1
  const rows = pageSize ? filtered.slice((page - 1) * pageSize, page * pageSize) : filtered
  return {
    count: filtered.length,
    page,
    pageSize,
    rows: rows.map((entry) => entry.row),
    currencies: currencyColumns(cc),
    baseCurrency: cc.base,
    totals,
    cashbackBase: roundMoney(cashbackBase),
    missingRates: [...missing].sort(),
  }
}

/** GET /api/loyalty-card/options — filter / dialog lookups. */
export async function loyaltyCardOptions(): Promise<LoyaltyCardOptions> {
  const db = getDb()
  const s = await ensureLoyaltySchema(db)
  const names = new Map<string, string>()
  const addName = (value: unknown) => {
    const name = String(value ?? "").trim()
    if (name && !names.has(nameKey(name))) names.set(nameKey(name), name)
  }
  if (s.has("client_types")) for (const row of (await db.prepare("SELECT name FROM client_types ORDER BY name").all()) as Array<{ name: string }>) addName(row.name)
  if (s.has("clients")) for (const row of (await db.prepare("SELECT DISTINCT type FROM clients WHERE type IS NOT NULL").all()) as Array<{ type: string }>) addName(row.type)
  const balances = await balanceRows(db, (await loadCurrencyContext(db)).base)
  const cc = await currencyContext(db, balances)
  return {
    clientTypes: [...names.values()].sort((a, b) => a.localeCompare(b, "ru")),
    currencies: currencyColumns(cc),
    baseCurrency: cc.base,
  }
}

async function loadClientName(db: PgDb, hasClients: boolean, id: number): Promise<{ id: number; name: string } | null> {
  if (!hasClients) return null
  const row = (await db.prepare("SELECT id, name FROM clients WHERE id = @id").get({ id })) as { id: number; name: string | null } | undefined
  return row ? { id: Number(row.id), name: String(row.name ?? "") } : null
}

function balancesOf(rows: BalanceRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) out[row.cur] = roundMoney((out[row.cur] ?? 0) + Number(row.amount ?? 0))
  return out
}

type HistoryRow = {
  id: number
  cur: string
  amount: number
  comment: string | null
  created_at: string | null
  transaction_id: number | null
  type: string | null
  created_by: string | null
  doc_no?: number | string | null
  cash_created_by?: string | null
  cashbox?: string | null
}

/** Stored type, else a cash payout (transaction_id) = "Снятие денег", else a legacy manual row. */
function rowType(row: HistoryRow): CashbackType | null {
  if (row.type === "payment" || row.type === "withdraw" || row.type === "additional") return row.type
  if (row.type) return null
  return row.transaction_id ? "withdraw" : "additional"
}

/** GET /api/loyalty-card/[id] — demo GET sales/cash_back/%d/detail (Тип | Акция | Дата | Сумма). */
export async function getLoyaltyCardDetail(clientId: number, query: LoyaltyDetailQuery): Promise<LoyaltyCardDetail> {
  const db = getDb()
  const s = await ensureLoyaltySchema(db)
  const base = (await loadCurrencyContext(db)).base
  const client = await loadClientName(db, s.has("clients"), clientId)
  const sums = await balanceRows(db, base, clientId)
  if (!client && !sums.length) throw new LoyaltyInputError("Клиент не найден", 404)
  const cc = await currencyContext(db, sums)

  const pageSize = query.pageSize ?? 25
  const page = query.page ?? 1
  const count = Number(
    ((await db.prepare("SELECT COUNT(*) AS n FROM loyalty_card_transactions WHERE client_id = @clientId AND COALESCE(is_deleted, 0) = 0").get({ clientId })) as { n: number | string }).n,
  )
  const joinCash = s.has("cash_management_entries") && s.col("cash_management_entries", "doc_no")
  const joinCashbox = joinCash && s.has("cashboxes")
  const rows = (await db
    .prepare(
      `SELECT l.id, COALESCE(fin_cur(l.currency), @base) AS cur, l.amount::double precision AS amount, l.comment, l.created_at,
              l.transaction_id, l.type, l.created_by
              ${joinCash ? ", e.doc_no, e.created_by AS cash_created_by" : ""}${joinCashbox ? ", cb.name AS cashbox" : ""}
       FROM loyalty_card_transactions l
       ${joinCash ? "LEFT JOIN cash_management_entries e ON e.id = l.transaction_id" : ""}
       ${joinCashbox ? "LEFT JOIN cashboxes cb ON cb.id = e.cashbox_id" : ""}
       WHERE l.client_id = @clientId AND COALESCE(l.is_deleted, 0) = 0
       ORDER BY fin_ts(l.created_at, true) DESC NULLS LAST, l.id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ base, clientId, limit: pageSize, offset: (page - 1) * pageSize })) as HistoryRow[]

  const history: LoyaltyHistoryRow[] = rows.map((row) => ({
    id: Number(row.id),
    type: rowType(row),
    promotion: "",
    date: parseAnyDate(row.created_at, true),
    amount: roundMoney(Number(row.amount ?? 0)),
    currency: row.cur,
    comment: String(row.comment ?? ""),
    createdBy: String(row.created_by || row.cash_created_by || ""),
    payout: row.transaction_id
      ? { entryId: Number(row.transaction_id), docNo: row.doc_no === null || row.doc_no === undefined ? null : Number(row.doc_no), cashbox: String(row.cashbox ?? "") }
      : null,
  }))
  return {
    client: client ? { ...client, exists: true } : { id: clientId, name: "", exists: false },
    balances: balancesOf(sums),
    currencies: currencyColumns(cc),
    count,
    page,
    pageSize,
    rows: history,
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** POST /api/loyalty-card — "Добавить" (приход) / "Списать" (расход) of one client's cashback
 * (demo custom_price → type "additional", sign by the button). */
export async function createLoyaltyCardTransaction(input: LoyaltyTransactionInput, createdBy: string): Promise<LoyaltyTransactionResult> {
  const db = getDb()
  const s = await ensureLoyaltySchema(db)
  const client = await loadClientName(db, s.has("clients"), input.clientId)
  if (!client) throw new LoyaltyInputError("Клиент не найден", 404)
  const cc = await loadCurrencyContext(db)
  const code = normCurrency(input.currency)
  if (!cc.currencies.some((currency) => currency.code === code)) throw new LoyaltyInputError("Неизвестная валюта")
  const amount = roundMoney(input.amount)
  if (amount <= 0) throw new LoyaltyInputError("Укажите сумму")
  const signed = input.kind === "expense" ? -amount : amount

  return withTransaction(async (tx) => {
    if (input.kind === "expense") {
      // "Списать" never takes more than the client has in that currency.
      await lockClientCashback(tx, client.id)
      const balance = await clientCashbackBalance(tx, client.id, code, cc.base)
      if (amount > balance + 0.005) throw new LoyaltyInputError("Недостаточно кэшбэка у клиента", 400)
    }
    const inserted = await tx
      .prepare(
        `INSERT INTO loyalty_card_transactions (client_id, currency, amount, comment, type, created_by)
         VALUES (@clientId, @currency, @amount, @comment, 'additional', @createdBy)`,
      )
      .run({ clientId: client.id, currency: loyaltyCurrency(code), amount: signed, comment: input.comment ?? "", createdBy })
    const balances = balancesOf(await balanceRows(tx, cc.base, client.id))
    return { id: Number(inserted.lastInsertRowid), clientId: client.id, amount: signed, currency: code, balances }
  })
}

/** DELETE /api/loyalty-card/transactions/[id] — soft delete of a manual ("additional") movement; payouts made through the
 * cash page (transaction_id set) are removed together with their cash operation instead. */
export async function deleteLoyaltyCardTransaction(id: number): Promise<{ id: number; clientId: number; balances: Record<string, number> }> {
  const db = getDb()
  await ensureLoyaltySchema(db)
  const row = (await db.prepare("SELECT id, client_id, type, transaction_id FROM loyalty_card_transactions WHERE id = ? AND COALESCE(is_deleted, 0) = 0").get(id)) as
    | { id: number | string; client_id: number | string; type: string | null; transaction_id: number | string | null }
    | undefined
  if (!row) throw new LoyaltyInputError("Запись не найдена", 404)
  if (row.transaction_id !== null || row.type !== "additional") throw new LoyaltyInputError("Удалять можно только добавленные вручную движения", 409)
  const cc = await loadCurrencyContext(db)
  return withTransaction(async (tx) => {
    await tx.prepare("UPDATE loyalty_card_transactions SET is_deleted = 1 WHERE id = ?").run(id)
    const clientId = Number(row.client_id)
    return { id, clientId, balances: balancesOf(await balanceRows(tx, cc.base, clientId)) }
  })
}
