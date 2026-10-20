import "server-only"

import { z } from "zod"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { listCashboxesWithBalances } from "@/lib/cash/cashboxes"
import { assertCashbackAvailable, CashError, clientCashbackBalance, loadClient, lockClientCashback, MAX_DB_ID, MAX_MONEY } from "@/lib/cash/common"
import { guardCashboxBalances } from "@/lib/cash/guard"
import { ensureCashSchema } from "@/lib/cash/schema"
import { insertCashbackPayout } from "@/lib/cashback-requests-payout"
import {
  type CashbackRequestCurrency,
  type CashbackRequestDecision,
  type CashbackRequestDetail,
  type CashbackRequestListResult,
  type CashbackRequestRow,
  type CashbackRequestStatus,
} from "@/lib/cashback-requests-types"
import { loadCurrencyContext, withSeenCodes, type CurrencyContext } from "@/lib/finance/context"
import { currencyLabel, normCurrency, roundMoney } from "@/lib/finance/currency"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import { ensureLoyaltySchema } from "@/lib/loyalty-card-repo"

// "Запросы на снятие кэшбэка" (demo #/cashback-requests, telegram/cashback_request/).
// Clients ask for a cashback payout from the Telegram bot; a manager confirms
// a request choosing a cashbox (→ cash-core payout op 22 + loyalty "withdraw",
// lib/cashback-requests-payout.ts, same transaction) or rejects it (no money).
//
// Effective status: a confirmed request whose payout was deleted (or re-routed
// to a non-cashback operation) on the cash page — its cash entry is gone,
// soft-deleted or no longer carries the loyalty row — reads as "pending"
// again and can be confirmed anew; nothing is written on reads.

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1

// The original table (id, client, amount, currency, status, created_at,
// updated_at) is kept as is; the new columns are added next to it.
const DDL = `
CREATE TABLE IF NOT EXISTS cashback_withdrawal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'SUM',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE cashback_withdrawal_requests ADD COLUMN IF NOT EXISTS client_id INTEGER;
ALTER TABLE cashback_withdrawal_requests ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '';
ALTER TABLE cashback_withdrawal_requests ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '';
ALTER TABLE cashback_withdrawal_requests ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE cashback_withdrawal_requests ADD COLUMN IF NOT EXISTS cashbox_id INTEGER;
ALTER TABLE cashback_withdrawal_requests ADD COLUMN IF NOT EXISTS cash_entry_id INTEGER;
ALTER TABLE cashback_withdrawal_requests ADD COLUMN IF NOT EXISTS cash_doc_no BIGINT;
ALTER TABLE cashback_withdrawal_requests ADD COLUMN IF NOT EXISTS decided_at TEXT NOT NULL DEFAULT '';
ALTER TABLE cashback_withdrawal_requests ADD COLUMN IF NOT EXISTS decided_by TEXT NOT NULL DEFAULT '';
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'cashback_withdrawal_requests' AND column_name = 'amount') = 'real' THEN
    ALTER TABLE cashback_withdrawal_requests ALTER COLUMN amount TYPE double precision;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS cashback_withdrawal_requests_client_idx ON cashback_withdrawal_requests (client_id);
CREATE INDEX IF NOT EXISTS cashback_withdrawal_requests_entry_idx ON cashback_withdrawal_requests (cash_entry_id);
`

declare global {
  var __linkoCashbackRequestsSchema: { version: number; ready: Promise<void> } | undefined
}

async function install(): Promise<void> {
  // Loyalty (type / created_by columns, fin_* functions) and the cash core first.
  await ensureLoyaltySchema()
  await ensureCashSchema()
  await withTransaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(72120902)")
    await tx.exec(DDL)
  })
}

export async function ensureCashbackRequestsSchema(): Promise<void> {
  const cached = globalThis.__linkoCashbackRequestsSchema
  if (!cached || cached.version !== SCHEMA_VERSION) {
    const ready = install().catch((error: unknown) => {
      globalThis.__linkoCashbackRequestsSchema = undefined
      throw error
    })
    globalThis.__linkoCashbackRequestsSchema = { version: SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoCashbackRequestsSchema!.ready
}

// ---------------------------------------------------------------------------
// Input schemas (zod v4)
// ---------------------------------------------------------------------------

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value)
const text = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max).optional())
const int = (min: number, max: number) => z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).optional())

export const cashbackRequestListQuerySchema = z.object({
  search: text(200),
  status: z.preprocess(emptyToUndefined, z.enum(["pending", "confirmed", "rejected"]).optional()),
  currency: text(16),
  /** id | -id (demo: only № is sortable). */
  ordering: z.preprocess(emptyToUndefined, z.enum(["id", "-id"]).optional()),
  page: int(1, 1_000_000),
  /** 0 = every row. */
  pageSize: int(0, 5000),
})
export type CashbackRequestListQuery = z.infer<typeof cashbackRequestListQuerySchema>

/** POST — creation path for the Telegram bot (the demo page has no create UI). */
export const cashbackRequestCreateSchema = z.object({
  clientId: z.coerce.number().int().positive().max(MAX_DB_ID),
  amount: z.coerce.number().finite().positive().max(MAX_MONEY),
  currency: z.string().trim().min(1).max(16),
  comment: z.string().trim().max(500).optional(),
  /** Where the request came from (telegram, manager, …). */
  source: z.string().trim().max(40).optional(),
})
export type CashbackRequestCreateInput = z.infer<typeof cashbackRequestCreateSchema>

/** PUT — demo {cashbox, status: "confirmed" | "rejected"}; `cashboxId` is our name. */
export const cashbackRequestDecisionSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") return value
    const body = value as Record<string, unknown>
    const cashbox = body.cashbox && typeof body.cashbox === "object" ? (body.cashbox as Record<string, unknown>).id : body.cashbox
    return { ...body, cashboxId: body.cashboxId ?? cashbox }
  },
  z.discriminatedUnion("status", [
    z.object({ status: z.literal("confirmed"), cashboxId: z.coerce.number({ error: "Укажите кассу" }).int().positive({ error: "Укажите кассу" }).max(MAX_DB_ID, { error: "Касса не найдена" }) }),
    z.object({ status: z.literal("rejected") }),
  ]),
)

export function searchParamsObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of params) out[key] = value
  return out
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every request with its client, payout liveness and effective status (alias "r"). */
const BASE_SQL = `
  SELECT q.id, q.client AS client_text, q.client_id, c.id AS c_id, c.name AS c_name, c.phone AS c_phone, c.inn AS c_inn, c.code AS c_code,
         q.amount::double precision AS amount, COALESCE(fin_cur(q.currency), @base::text) AS cur, q.status AS stored_status,
         q.cashbox_id, qcb.name AS cashbox_name, qcb.payment_type AS cashbox_type,
         q.cash_entry_id, q.cash_doc_no, e.doc_no AS e_doc_no, e.amount::double precision AS e_amount,
         COALESCE(fin_cur(NULLIF(e.currency, '')), fin_cur(ecb.currency), @base::text) AS e_cur, ecb.name AS e_cashbox,
         (e.id IS NOT NULL AND e.is_deleted = 0
            AND EXISTS (SELECT 1 FROM loyalty_card_transactions l WHERE l.transaction_id = e.id)) AS payout_alive,
         q.comment, q.source, q.created_at, q.created_by, q.decided_at, q.decided_by
  FROM cashback_withdrawal_requests q
  LEFT JOIN clients c ON c.id = COALESCE(
    q.client_id,
    (SELECT c2.id FROM clients c2 WHERE fin_key(c2.name) = fin_key(q.client) AND fin_key(q.client) <> '' ORDER BY c2.id LIMIT 1))
  LEFT JOIN cash_management_entries e ON e.id = q.cash_entry_id
  LEFT JOIN cashboxes qcb ON qcb.id = q.cashbox_id
  LEFT JOIN cashboxes ecb ON ecb.id = e.cashbox_id`

const EFFECTIVE_STATUS_SQL = `CASE
    WHEN r.stored_status = 'confirmed' AND r.cash_entry_id IS NOT NULL AND NOT r.payout_alive THEN 'pending'
    WHEN r.stored_status IN ('confirmed', 'rejected') THEN r.stored_status
    ELSE 'pending' END`

type BaseRow = {
  id: number
  client_text: string | null
  client_id: number | null
  c_id: number | null
  c_name: string | null
  amount: number | null
  cur: string
  stored_status: string | null
  status: CashbackRequestStatus
  cashbox_id: number | null
  cashbox_name: string | null
  cashbox_type: string | null
  cash_entry_id: number | null
  cash_doc_no: string | number | null
  e_doc_no: string | number | null
  e_amount: number | null
  e_cur: string | null
  e_cashbox: string | null
  payout_alive: boolean
  comment: string | null
  source: string | null
  created_at: string | null
  created_by: string | null
  decided_at: string | null
  decided_by: string | null
  total?: string | number
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function cashboxKind(value: string | null): "cash" | "bank" {
  return /^(банк|bank|card|карт|переч|o'tkaz|otkaz|transfer)/.test(String(value ?? "").trim().toLowerCase()) ? "bank" : "cash"
}

function toRow(row: BaseRow): CashbackRequestRow {
  const alive = Boolean(row.payout_alive)
  const confirmed = row.status === "confirmed"
  const cancelled = row.stored_status === "confirmed" && row.status === "pending"
  return {
    id: Number(row.id),
    client: row.c_id
      ? { id: Number(row.c_id), name: String(row.c_name ?? ""), exists: true }
      : { id: numOrNull(row.client_id), name: String(row.client_text ?? ""), exists: false },
    amount: roundMoney(Number(row.amount ?? 0), 5),
    currency: row.cur,
    status: row.status,
    cancelledPayoutDocNo: cancelled ? numOrNull(row.cash_doc_no) : null,
    cashbox: confirmed && row.cashbox_id && row.cashbox_name !== null ? { id: Number(row.cashbox_id), name: String(row.cashbox_name), type: cashboxKind(row.cashbox_type) } : null,
    payout:
      confirmed && alive && row.cash_entry_id
        ? {
            entryId: Number(row.cash_entry_id),
            docNo: numOrNull(row.e_doc_no),
            cashbox: String(row.e_cashbox ?? ""),
            amount: roundMoney(Math.abs(Number(row.e_amount ?? 0)), 5),
            currency: String(row.e_cur ?? row.cur),
          }
        : null,
    comment: String(row.comment ?? ""),
    source: String(row.source ?? ""),
    createdAt: parseAnyDate(row.created_at, true),
    createdBy: String(row.created_by ?? ""),
    decidedAt: row.decided_at ? parseAnyDate(row.decided_at) : null,
    decidedBy: String(row.decided_by ?? ""),
  }
}

function currencyChoices(cc: CurrencyContext): CashbackRequestCurrency[] {
  return cc.currencies.map((currency) => ({ code: currency.code, label: currencyLabel(currency.code) }))
}

/** GET /api/cashback-withdrawal-requests — demo GET telegram/cashback_request/?currency&status
 * (+ search, ordering and paging, which the demo writes to the URL but never sends). */
export async function listCashbackRequests(query: CashbackRequestListQuery): Promise<CashbackRequestListResult> {
  await ensureCashbackRequestsSchema()
  const db = getDb()
  const cc = await loadCurrencyContext(db)
  const pageSize = query.pageSize ?? 25
  const page = query.page ?? 1
  const search = query.search ?? ""
  const searchId = /^\d{1,9}$/.test(search) ? Number(search) : 0
  const params = {
    base: cc.base,
    status: query.status ?? "",
    currency: query.currency ? normCurrency(query.currency, cc.base) : "",
    search,
    searchId,
    limit: pageSize > 0 ? pageSize : null,
    offset: pageSize > 0 ? (page - 1) * pageSize : 0,
  }
  const rows = (await db
    .prepare(
      `WITH r AS (${BASE_SQL}), f AS (SELECT r.*, ${EFFECTIVE_STATUS_SQL} AS status FROM r)
       SELECT f.*, COUNT(*) OVER () AS total FROM f
       WHERE (@status::text = '' OR f.status = @status::text)
         AND (@currency::text = '' OR f.cur = @currency::text)
         AND (@search::text = ''
              OR strpos(fin_key(COALESCE(f.c_name, f.client_text)), fin_key(@search::text)) > 0
              OR strpos(fin_key(f.c_phone), fin_key(@search::text)) > 0
              OR strpos(fin_key(f.c_inn), fin_key(@search::text)) > 0
              OR strpos(fin_key(f.c_code), fin_key(@search::text)) > 0
              OR f.id = @searchId::int)
       ORDER BY f.id ${query.ordering === "id" ? "ASC" : "DESC"}
       LIMIT @limit::int OFFSET @offset::int`,
    )
    .all(params)) as BaseRow[]
  let count = rows.length ? Number(rows[0].total) : 0
  if (!rows.length && params.offset > 0) {
    // Page past the end: the count still has to be right for the paginator.
    const total = (await db
      .prepare(
        `WITH r AS (${BASE_SQL}), f AS (SELECT r.*, ${EFFECTIVE_STATUS_SQL} AS status FROM r)
         SELECT COUNT(*) AS n FROM f
         WHERE (@status::text = '' OR f.status = @status::text)
           AND (@currency::text = '' OR f.cur = @currency::text)
           AND (@search::text = ''
                OR strpos(fin_key(COALESCE(f.c_name, f.client_text)), fin_key(@search::text)) > 0
                OR strpos(fin_key(f.c_phone), fin_key(@search::text)) > 0
                OR strpos(fin_key(f.c_inn), fin_key(@search::text)) > 0
                OR strpos(fin_key(f.c_code), fin_key(@search::text)) > 0
                OR f.id = @searchId::int)`,
      )
      .get({ ...params, limit: undefined, offset: undefined })) as { n: string | number }
    count = Number(total.n)
  }
  const seen = (await db.prepare("SELECT DISTINCT COALESCE(fin_cur(currency), @base::text) AS cur FROM cashback_withdrawal_requests").all({ base: cc.base })) as Array<{ cur: string }>
  return {
    count,
    page,
    pageSize,
    rows: rows.map(toRow),
    currencies: currencyChoices(withSeenCodes(cc, seen.map((row) => row.cur))),
    baseCurrency: cc.base,
  }
}

async function loadRequestRow(db: PgDb, id: number, base: string): Promise<BaseRow | undefined> {
  return (await db
    .prepare(`WITH r AS (${BASE_SQL}) SELECT r.*, ${EFFECTIVE_STATUS_SQL} AS status FROM r WHERE r.id = @id::int`)
    .get({ base, id })) as BaseRow | undefined
}

/** The client's cashback balance in `cur` (same expression as "Накопительная карта"). */
async function cashbackBalance(db: PgDb, clientId: number, cur: string, base: string): Promise<number> {
  return clientCashbackBalance(db, clientId, cur, base)
}

/** Σ amount of the client's effectively pending requests in `cur`, except `excludeId`. */
async function pendingReserved(db: PgDb, clientId: number, cur: string, base: string, excludeId = 0): Promise<number> {
  const row = (await db
    .prepare(
      `WITH r AS (${BASE_SQL}), f AS (SELECT r.*, ${EFFECTIVE_STATUS_SQL} AS status FROM r)
       SELECT COALESCE(SUM(f.amount), 0) AS amount FROM f
       WHERE f.status = 'pending' AND f.c_id = @clientId::int AND f.cur = @cur::text AND f.id <> @excludeId::int`,
    )
    .get({ base, clientId, cur, excludeId })) as { amount: number | string }
  return roundMoney(Number(row.amount ?? 0), 5)
}

/** GET /api/cashback-withdrawal-requests/[id] — demo GET telegram/cashback_request/%d/ (+ what the
 * confirm dialog needs: the client's balance and the cashboxes in the request currency). */
export async function getCashbackRequestDetail(id: number): Promise<CashbackRequestDetail> {
  await ensureCashbackRequestsSchema()
  const db = getDb()
  const cc = await loadCurrencyContext(db)
  const row = await loadRequestRow(db, id, cc.base)
  if (!row) throw new CashError("Запрос не найден", 404)
  const request = toRow(row)
  const clientId = request.client.exists ? request.client.id : null
  const [balance, reserved, cashboxes] = await Promise.all([
    clientId ? cashbackBalance(db, clientId, request.currency, cc.base) : Promise.resolve(0),
    clientId ? pendingReserved(db, clientId, request.currency, cc.base, request.id) : Promise.resolve(0),
    listCashboxesWithBalances(db),
  ])
  return {
    request,
    balance,
    reserved,
    cashboxes: cashboxes.cashboxes
      .filter((cashbox) => cashbox.currency === request.currency)
      .map((cashbox) => ({ id: cashbox.id, name: cashbox.name, type: cashbox.type, currency: cashbox.currency, balance: cashbox.balance })),
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Serialises cashback checks of one client (balance read → payout / reservation);
 * the same lock as the loyalty page and the cash core's cashback payouts. */
async function lockClient(tx: PgDb, clientId: number): Promise<void> {
  await lockClientCashback(tx, clientId)
}

/** POST /api/cashback-withdrawal-requests — a new pending request (Telegram bot / API).
 * amount ≤ the client's cashback balance minus his other pending requests in that currency. */
export async function createCashbackRequest(input: CashbackRequestCreateInput, user: string): Promise<CashbackRequestRow> {
  await ensureCashbackRequestsSchema()
  const cc = await loadCurrencyContext(getDb())
  const cur = normCurrency(input.currency, cc.base)
  if (!cc.currencies.some((currency) => currency.code === cur)) throw new CashError("Неизвестная валюта", 400, "currency")
  const amount = roundMoney(input.amount, 5)
  if (!(amount > 0)) throw new CashError("Укажите сумму", 400, "amount")

  const id = await withTransaction(async (tx) => {
    const client = await loadClient(tx, input.clientId)
    await lockClient(tx, client.id)
    const available = roundMoney((await cashbackBalance(tx, client.id, cur, cc.base)) - (await pendingReserved(tx, client.id, cur, cc.base)), 5)
    if (amount > available) throw new CashError("Сумма больше доступного кэшбэка клиента", 400, "amount")
    const inserted = await tx
      .prepare(
        `INSERT INTO cashback_withdrawal_requests (client, client_id, amount, currency, status, comment, source, created_by)
         VALUES (@client, @clientId, @amount, @currency, 'pending', @comment, @source, @createdBy)`,
      )
      .run({ client: client.name, clientId: client.id, amount, currency: cur, comment: input.comment ?? "", source: input.source || "api", createdBy: user })
    return Number(inserted.lastInsertRowid)
  })
  return (await getCashbackRequestDetail(id)).request
}

/** PUT /api/cashback-withdrawal-requests/[id] — demo PUT {cashbox, status}.
 * confirmed: payout from the cashbox (cash op 22 + loyalty withdraw) and the status, in ONE transaction;
 * rejected: status only. Only an (effectively) pending request can be decided (409 otherwise). */
export async function decideCashbackRequest(id: number, decision: CashbackRequestDecision, user: string): Promise<CashbackRequestRow> {
  await ensureCashbackRequestsSchema()
  const cc = await loadCurrencyContext(getDb())
  await withTransaction(async (tx) => {
    const locked = await tx.prepare("SELECT id FROM cashback_withdrawal_requests WHERE id = @id::int FOR UPDATE").get({ id })
    if (!locked) throw new CashError("Запрос не найден", 404)
    const row = (await loadRequestRow(tx, id, cc.base))!
    if (row.status !== "pending") throw new CashError("Запрос уже обработан", 409)
    const now = nowLocalIso()

    if (decision.status === "rejected") {
      await tx
        .prepare(
          `UPDATE cashback_withdrawal_requests
           SET status = 'rejected', cashbox_id = NULL, cash_entry_id = NULL, cash_doc_no = NULL,
               decided_at = @now, decided_by = @user, updated_at = datetime('now')
           WHERE id = @id::int`,
        )
        .run({ id, now, user })
      return
    }

    if (!row.c_id) throw new CashError("Клиент не найден", 404, "client")
    const clientId = Number(row.c_id)
    const amount = roundMoney(Number(row.amount ?? 0), 5)
    if (!(amount > 0)) throw new CashError("Укажите сумму", 400, "amount")
    // Lock order: request → cashbox (overdraft guard) → client cashback (as the cash core does).
    await guardCashboxBalances(
      tx,
      [decision.cashboxId],
      cc.base,
      async () => {
        await assertCashbackAvailable(tx, { clientId, amount, currency: row.cur, base: cc.base, field: "amount" })
        const payout = await insertCashbackPayout(
          tx,
          {
            cashboxId: decision.cashboxId,
            clientId,
            amount,
            currency: row.cur,
            comment: [`Запрос на снятие кэшбэка № ${id}`, String(row.comment ?? "").trim()].filter(Boolean).join(" · "),
            user,
          },
          cc,
        )
        await tx
          .prepare(
            `UPDATE cashback_withdrawal_requests
             SET status = 'confirmed', client_id = @clientId, cashbox_id = @cashboxId, cash_entry_id = @entryId, cash_doc_no = @docNo,
                 decided_at = @now, decided_by = @user, updated_at = datetime('now')
             WHERE id = @id::int`,
          )
          .run({ id, clientId, cashboxId: payout.cashbox.id, entryId: payout.entryId, docNo: payout.docNo, now, user })
      },
      "cashbox",
    )
  })
  return (await getCashbackRequestDetail(id)).request
}
