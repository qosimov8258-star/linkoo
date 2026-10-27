import "server-only"

import { z } from "zod"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { MAX_ID, MAX_MONEY } from "@/lib/finance/api"
import { loadCurrencyContext } from "@/lib/finance/context"
import { convertAmount, currencyLabel, formatMoney, normCurrency, roundMoney } from "@/lib/finance/currency"
import { customerPaymentColumns } from "@/lib/finance/customer-payment"
import { formatDotDate, isIsoDay, nowLocalIso, parseAnyDate, todayIso } from "@/lib/finance/dates"
import { innKey, loadContractNames, nameKey, placeName } from "@/lib/finance/entities"
import { FinanceInputError } from "@/lib/finance/group-payment"
import { ensureFinanceSchema, type FinanceSchema } from "@/lib/finance/schema"
import {
  CLIENT_CORRECTIONS_TABLE,
  clientBalanceSplit,
  ensureStoreReconciliationSchema,
  getStoreReconciliationList,
  RECONCILIATION_STORES,
  variantSchema,
  type StoreReconciliationParams,
} from "@/lib/finance-store-reconciliation"
import {
  RECONCILIATION_STATUS_VALUES,
  TEMPLATE_HEADERS,
  type DebtImportRequest,
  type DebtImportResult,
  type DebtImportRowResult,
  type DebtTemplateResult,
  type ReconciliationMessage,
  type ReconciliationMessagesResult,
  type ReconciliationMoney,
  type ReconciliationStatus,
  type ReconciliationVariant,
} from "@/lib/finance-store-reconciliation-types"

// Writes of "Сверка магазина через бот" / "Сверка счетов": reconciliation
// requests (no Telegram bot exists, so a request is only recorded) and debt
// terms — per client (variant client) or per account key (variant account,
// "inn:<inn>" or a client id) —, manual corrections (Списать / Добавить, always
// of one client) and "Установить долг с Excel" (shops only). Corrections are
// new rows of client_balance_corrections, which the client ledger reads as
// none_type_plus / none_type_minus — existing money rows are never edited.

export { FinanceInputError }

/** No Telegram bot integration exists in this installation. */
export const TELEGRAM_BOT_CONNECTED = false

const day = z.string().refine(isIsoDay, "YYYY-MM-DD")
const clientId = z.coerce.number().int().positive().max(MAX_ID)

// --- clients -----------------------------------------------------------------------

type ClientRecord = { id: number; name: string; code: string | null }

async function loadClient(db: PgDb, id: number): Promise<ClientRecord> {
  const row = (await db.prepare("SELECT id, name, code FROM clients WHERE id = @id").get({ id })) as ClientRecord | undefined
  if (!row) throw new FinanceInputError("Клиент не найден", 404)
  return { id: Number(row.id), name: String(row.name), code: row.code ?? null }
}

// --- reconciliation entities (shop = one client, account = clients of one INN) -----------------

/** Entity of a reconciliation request / debt term: variant + key (the list row key);
 * a shop may still be given by clientId (older callers). */
const entityFields = {
  variant: variantSchema.optional(),
  key: z.string().trim().min(1).max(200).optional(),
  clientId: clientId.optional(),
}

type EntityInput = { variant?: ReconciliationVariant; key?: string; clientId?: number }

const hasEntity = (input: EntityInput) => Boolean(input.key || input.clientId)
const ENTITY_REQUIRED = { message: "Не указан клиент", path: ["key"] }

export type ReconciliationEntity = { variant: ReconciliationVariant; key: string; name: string; clientIds: number[] }

/** Resolves a shop (clients.id) or an account ("inn:<inn>" = every client with
 * that INN, named like "Долги по счетам"; any other key = one client). */
export async function resolveReconciliationEntity(db: PgDb, input: EntityInput): Promise<ReconciliationEntity> {
  const variant = input.variant ?? "client"
  const key = (input.key ?? (input.clientId ? String(input.clientId) : "")).trim()
  if (variant === "account" && key.startsWith("inn:")) {
    const inn = innKey(key.slice(4))
    const clients = (await db.prepare("SELECT id, name, COALESCE(inn, '') AS inn FROM clients ORDER BY lower(name), id").all()) as Array<{
      id: number
      name: string
      inn: string
    }>
    const members = inn ? clients.filter((client) => innKey(client.inn) === inn) : []
    if (!members.length) throw new FinanceInputError("Клиент не найден", 404)
    const s = await ensureFinanceSchema(db)
    const contractName = (await loadContractNames(db, s)).get(inn)
    return { variant, key: `inn:${inn}`, name: contractName || String(members[0].name), clientIds: members.map((member) => Number(member.id)) }
  }
  if (!/^\d+$/.test(key)) throw new FinanceInputError("Клиент не найден", 404)
  const client = await loadClient(db, Number(key))
  return { variant, key: String(client.id), name: client.name, clientIds: [client.id] }
}

// --- reconciliation requests ("Телеграм") -------------------------------------------------

export const messageCreateSchema = z
  .object({ ...entityFields, debtDate: day.optional(), mode: z.enum(["created", "realization"]).optional() })
  .refine(hasEntity, ENTITY_REQUIRED)
export const messageStatusSchema = z.object({ status: z.enum(RECONCILIATION_STATUS_VALUES), variant: variantSchema.optional() })

type MessageRow = {
  id: number
  ek: string
  status: string
  text: string
  as_of: string
  telegram_user: string
  created_at: string
  created_by: string
  confirmed_at: string
}

function toMessage(row: MessageRow): ReconciliationMessage {
  let telegramUser: ReconciliationMessage["telegramUser"] = null
  if (row.telegram_user) {
    try {
      const parsed = JSON.parse(row.telegram_user) as { firstName?: string; secondName?: string; phoneNumber?: string }
      telegramUser = { firstName: parsed.firstName ?? "", secondName: parsed.secondName ?? "", phoneNumber: parsed.phoneNumber ?? "" }
    } catch {
      telegramUser = null
    }
  }
  return {
    id: Number(row.id),
    key: String(row.ek),
    status: (RECONCILIATION_STATUS_VALUES as readonly string[]).includes(row.status) ? (row.status as ReconciliationStatus) : null,
    text: row.text,
    asOf: row.as_of,
    telegramUser,
    createdAt: row.created_at,
    createdBy: row.created_by,
    confirmedAt: row.confirmed_at || null,
  }
}

function messageColumns(variant: ReconciliationVariant): string {
  return `id, ${RECONCILIATION_STORES[variant].key} AS ek, status, text, as_of, telegram_user, created_by,
  to_char(fin_ts(created_at, true), 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
  CASE WHEN confirmed_at = '' THEN '' ELSE to_char(fin_ts(confirmed_at, true), 'YYYY-MM-DD"T"HH24:MI:SS') END AS confirmed_at`
}

/** History of one client's / account's reconciliation requests (newest first). */
export async function listReconciliationMessages(
  variant: ReconciliationVariant,
  key: string,
  page = 1,
  pageSize = 25,
  db: PgDb = getDb(),
): Promise<ReconciliationMessagesResult> {
  await ensureStoreReconciliationSchema(db)
  await ensureFinanceSchema(db)
  const store = RECONCILIATION_STORES[variant]
  const count = Number(((await db.prepare(`SELECT COUNT(*) AS n FROM ${store.messages} WHERE ${store.key} = @key`).get({ key })) as { n: number }).n)
  const size = Math.max(1, Math.min(500, pageSize))
  const rows = (await db
    .prepare(`SELECT ${messageColumns(variant)} FROM ${store.messages} WHERE ${store.key} = @key ORDER BY id DESC LIMIT @limit OFFSET @offset`)
    .all({ key, limit: size, offset: (Math.max(1, page) - 1) * size })) as MessageRow[]
  return { count, page: Math.max(1, page), pageSize: size, rows: rows.map(toMessage), botConnected: TELEGRAM_BOT_CONNECTED }
}

/** Reconciliation text (Russian, like the server-side bot message of the demo). */
function reconciliationText(name: string, asOf: string, money: Map<string, ReconciliationMoney>): string {
  const lines = [...money.entries()]
    .filter(([, value]) => Math.abs(value.total) > 1e-9)
    .map(([code, value]) => `${currencyLabel(code)}: ${formatMoney(value.total)} (нал.: ${formatMoney(value.cash)}, переч.: ${formatMoney(value.bank)})`)
  return [`Акт сверки: ${name}`, `Баланс на ${formatDotDate(asOf)}:`, ...(lines.length ? lines : ["0"])].join("\n")
}

/** Σ of the clients' balance splits per currency (an account = its clients). */
function sumSplits(split: Awaited<ReturnType<typeof clientBalanceSplit>>, clientIds: number[]): Map<string, ReconciliationMoney> {
  const money = new Map<string, ReconciliationMoney>()
  for (const id of clientIds) {
    for (const [code, value] of split.get(String(id))?.currencies ?? []) {
      const current = money.get(code) ?? { cash: 0, bank: 0, total: 0 }
      money.set(code, { cash: roundMoney(current.cash + value.cash), bank: roundMoney(current.bank + value.bank), total: roundMoney(current.total + value.total) })
    }
  }
  return money
}

/** "Отправить сверку": records a request with the client's / account's current
 * balance. Without a Telegram bot nothing is delivered — the request is stored
 * with status "not_send" ("Не отправлено"). */
export async function createReconciliationRequest(
  input: z.infer<typeof messageCreateSchema>,
  createdBy: string,
): Promise<{ message: ReconciliationMessage; botConnected: boolean }> {
  const db = getDb()
  await ensureStoreReconciliationSchema(db)
  const s = await ensureFinanceSchema(db)
  const entity = await resolveReconciliationEntity(db, input)
  const asOf = input.debtDate ?? todayIso()
  const context = await loadCurrencyContext(db)
  const split = await clientBalanceSplit(db, s, context.base, { to: asOf, mode: input.mode ?? "created", clientIds: entity.clientIds })
  const money = sumSplits(split, entity.clientIds)
  const values = {
    status: TELEGRAM_BOT_CONNECTED ? "pending" : "not_send",
    text: reconciliationText(entity.name, asOf, money),
    as_of: asOf,
    balances: JSON.stringify(Object.fromEntries(money.entries())),
    created_by: createdBy,
  }
  const row = (
    entity.variant === "account"
      ? await db
          .prepare(
            `INSERT INTO account_reconciliation_messages (account_key, client_ids, status, text, as_of, balances, created_by)
             VALUES (@account_key, @client_ids, @status, @text, @as_of, @balances, @created_by) RETURNING ${messageColumns("account")}`,
          )
          .get({ ...values, account_key: entity.key, client_ids: JSON.stringify(entity.clientIds) })
      : await db
          .prepare(
            `INSERT INTO client_reconciliation_messages (client_id, status, text, as_of, balances, created_by)
             VALUES (@client_id, @status, @text, @as_of, @balances, @created_by) RETURNING ${messageColumns("client")}`,
          )
          .get({ ...values, client_id: entity.clientIds[0] })
  ) as MessageRow
  return { message: toMessage(row), botConnected: TELEGRAM_BOT_CONNECTED }
}

/** Status update of a request (for a future bot webhook / manual follow-up). */
export async function updateReconciliationStatus(id: number, status: ReconciliationStatus, variant: ReconciliationVariant = "client"): Promise<ReconciliationMessage | null> {
  const db = getDb()
  await ensureStoreReconciliationSchema(db)
  await ensureFinanceSchema(db)
  const row = (await db
    .prepare(
      `UPDATE ${RECONCILIATION_STORES[variant].messages}
       SET status = @status, updated_at = datetime('now'),
           confirmed_at = CASE WHEN @status IN ('confirmed', 'rejected') THEN datetime('now') ELSE '' END
       WHERE id = @id RETURNING ${messageColumns(variant)}`,
    )
    .get({ id, status })) as MessageRow | undefined
  return row ? toMessage(row) : null
}

// --- debt term ("Изменить срок долга") ---------------------------------------------------------

export const deadlineSchema = z
  .object({ ...entityFields, paymentDeadline: z.union([day, z.literal(""), z.null()]).optional() })
  .refine(hasEntity, ENTITY_REQUIRED)

/** Appends the client's / account's new debt term ("" / null clears it). */
export async function setPaymentDeadline(
  input: z.infer<typeof deadlineSchema>,
  createdBy: string,
): Promise<{ variant: ReconciliationVariant; key: string; paymentDeadline: string | null }> {
  const db = getDb()
  await ensureStoreReconciliationSchema(db)
  const entity = await resolveReconciliationEntity(db, input)
  const value = input.paymentDeadline || ""
  if (entity.variant === "account") {
    await db
      .prepare("INSERT INTO account_payment_deadlines (account_key, payment_deadline, created_by) VALUES (@account_key, @payment_deadline, @created_by)")
      .run({ account_key: entity.key, payment_deadline: value, created_by: createdBy })
  } else {
    await db
      .prepare("INSERT INTO client_payment_deadlines (client_id, payment_deadline, created_by) VALUES (@client_id, @payment_deadline, @created_by)")
      .run({ client_id: entity.clientIds[0], payment_deadline: value, created_by: createdBy })
  }
  return { variant: entity.variant, key: entity.key, paymentDeadline: value || null }
}

// --- Списать / Добавить ------------------------------------------------------------------------

export const correctionSchema = z.object({
  clientId,
  /** expense = "Списать" (none_type −), income = "Добавить" / Прочие приходы (none_type +),
   * payment = "Добавить" / Оплата (Кассир не принял) (customer payment waiting for the cashier). */
  kind: z.enum(["expense", "income", "payment"]),
  amount: z.coerce.number().finite().positive().max(MAX_MONEY),
  /** A currency of the currencies table (checked on write: 400 "Валюта не найдена"). */
  currency: z.string().trim().min(1).max(16),
  paymentType: z.enum(["cash", "bank", ""]).optional(),
  organization: z.string().trim().max(200).optional(),
  /** Local "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD"; default now. */
  date: z.string().trim().max(40).optional(),
  deliveryMan: z.string().trim().max(200).optional(),
  comment: z.string().trim().max(2000).optional(),
})

export type CorrectionInput = z.infer<typeof correctionSchema>

/** Canonical code of a currency of the currencies table (SUM / USD / EUR when the table is empty). */
async function knownCurrency(db: PgDb, value: string): Promise<string> {
  const code = normCurrency(value)
  const context = await loadCurrencyContext(db)
  if (!context.currencies.some((item) => item.code === code)) throw new FinanceInputError("Валюта не найдена")
  return code
}

/** Undo of a manual correction ("Списать" / "Добавить" / Excel debt line):
 * soft delete (is_deleted = 1), so the client ledger no longer counts it. */
export async function deleteClientCorrection(id: number, deletedBy: string): Promise<{ id: number; deleted: true }> {
  const db = getDb()
  await ensureStoreReconciliationSchema(db)
  const row = (await db
    .prepare(
      `UPDATE ${CLIENT_CORRECTIONS_TABLE} SET is_deleted = 1, deleted_at = datetime('now'), deleted_by = @deleted_by
       WHERE id = @id AND COALESCE(is_deleted, 0) = 0 RETURNING id`,
    )
    .get({ id, deleted_by: deletedBy })) as { id: number } | undefined
  if (!row) throw new FinanceInputError("Запись не найдена", 404)
  return { id: Number(row.id), deleted: true }
}

function localDate(value: string | undefined): string {
  if (!value) return nowLocalIso().slice(0, 16)
  const parsed = parseAnyDate(value)
  if (!parsed) throw new FinanceInputError("Неверная дата")
  return parsed.slice(0, 16)
}

/** One manual movement of a client: a correction row, or (kind "payment") an
 * unaccepted customer payment that shows up on "Оплаты от клиентов". */
export async function createClientCorrection(input: CorrectionInput, createdBy: string): Promise<{ id: number; table: string }> {
  const db = getDb()
  await ensureStoreReconciliationSchema(db)
  const s = await ensureFinanceSchema(db)
  const client = await loadClient(db, input.clientId)
  const currency = await knownCurrency(db, input.currency)
  const date = localDate(input.date)
  const amount = roundMoney(Math.abs(input.amount))
  const organization = placeName(input.organization)

  if (input.kind === "payment") {
    const context = await loadCurrencyContext(db)
    const sumEquivalent = convertAmount(amount, currency, context.base, context.rates)
    const columns = {
      ...customerPaymentColumns({
        client,
        cashbox: null,
        amount,
        currency,
        sumEquivalent,
        date,
        accepted: false,
        organization,
        deliveryMan: input.deliveryMan,
        comment: input.comment,
        createdBy,
      }),
      // The shared writer derives the icon from the cashbox; no cashbox yet, keep the chosen payment type.
      icon: input.paymentType === "bank" ? "card" : "cash",
      created_by: createdBy,
    }
    const names = Object.keys(columns).filter((name) => s.col("customer_payments", name))
    const row = (await db
      .prepare(`INSERT INTO customer_payments (${names.join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")}) RETURNING id`)
      .get(columns)) as { id: number }
    return { id: Number(row.id), table: "customer_payments" }
  }

  const row = (await db
    .prepare(
      `INSERT INTO ${CLIENT_CORRECTIONS_TABLE} (client_id, amount, currency, payment_type, organization, correction_date, comment, delivery_man, source, created_by)
       VALUES (@client_id, @amount, @currency, @payment_type, @organization, @correction_date, @comment, @delivery_man, 'manual', @created_by) RETURNING id`,
    )
    .get({
      client_id: client.id,
      amount: input.kind === "expense" ? -amount : amount,
      currency,
      payment_type: input.paymentType ?? "",
      organization,
      correction_date: date,
      comment: input.comment ?? "",
      delivery_man: placeName(input.deliveryMan),
      created_by: createdBy,
    })) as { id: number }
  return { id: Number(row.id), table: CLIENT_CORRECTIONS_TABLE }
}

// --- "Установить долг с Excel" -------------------------------------------------------------------

export type DebtTemplateParams = {
  debtDate: string
  currency: string
  organizations: string[]
  byPaymentType: boolean
  /** The page's list filters (which clients go into the template). */
  filters: StoreReconciliationParams
}

/** Template sheet: the filtered clients with their balance on the debt day in
 * the chosen currency (signed like the page: debt is negative), one row per
 * client and selected organization. Shops only ("Сверка счетов" has no import). */
export async function getDebtTemplate(params: DebtTemplateParams, db: PgDb = getDb()): Promise<DebtTemplateResult> {
  const currency = normCurrency(params.currency)
  const result = await getStoreReconciliationList({ ...params.filters, variant: "client", debtDate: params.debtDate, page: 1, pageSize: 0 }, db)
  const list = { ...result, rows: result.rows.flatMap((row) => (row.id === null ? [] : [{ ...row, id: row.id }])) }
  const s = await ensureFinanceSchema(db)
  const organizations = params.organizations.length ? params.organizations : [""]
  const splits = await Promise.all(
    organizations.map((organization) =>
      clientBalanceSplit(db, s, list.baseCurrency, {
        to: params.debtDate,
        mode: params.filters.mode,
        organizations: organization ? [organization] : [],
        clientIds: list.rows.map((row) => row.id),
      }),
    ),
  )
  const withOrganization = params.organizations.length > 0
  const header: string[] = [TEMPLATE_HEADERS.id, TEMPLATE_HEADERS.name]
  if (withOrganization) header.push(TEMPLATE_HEADERS.organization)
  if (params.byPaymentType) header.push(TEMPLATE_HEADERS.cash, TEMPLATE_HEADERS.bank)
  else header.push(TEMPLATE_HEADERS.amount)
  const rows: Array<Array<string | number>> = []
  for (const row of [...list.rows].sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id - b.id)) {
    organizations.forEach((organization, index) => {
      const money = splits[index].get(row.key)?.currencies.get(currency) ?? { cash: 0, bank: 0, total: 0 }
      const line: Array<string | number> = [row.id, row.name]
      if (withOrganization) line.push(organization)
      if (params.byPaymentType) line.push(money.cash, money.bank)
      else line.push(money.total)
      rows.push(line)
    })
  }
  return { header, rows, debtDate: params.debtDate, currency }
}

const importLine = z.object({
  line: z.coerce.number().int().min(1),
  id: z.string().max(100).default(""),
  name: z.string().max(500).default(""),
  organization: z.string().max(500).default(""),
  amount: z.string().max(100).default(""),
  cash: z.string().max(100).default(""),
  bank: z.string().max(100).default(""),
})

export const debtImportSchema = z.object({
  debtDate: day,
  currency: z.string().trim().min(1),
  organizations: z.array(z.string().trim().min(1)).default([]),
  byPaymentType: z.boolean().default(false),
  mode: z.enum(["created", "realization"]).default("created"),
  fileName: z.string().trim().max(300).optional(),
  rows: z.array(importLine).min(1).max(20000),
  commit: z.boolean().default(false),
})

/** "-1 234,5" / "−1 234.50" / "1,234.5" → number; "" → null; NaN → undefined. */
export function parseAmountCell(text: string): number | null | undefined {
  const raw = text.replace(/[\s  ]/g, "").replace(/−/g, "-")
  if (!raw) return null
  let normalized = raw
  if (raw.includes(",") && raw.includes(".")) normalized = raw.replace(/,/g, "")
  else if (raw.includes(",")) normalized = raw.replace(",", ".")
  if (!/^[-+]?\d+(\.\d+)?$/.test(normalized)) return undefined
  const value = Number(normalized)
  return Number.isFinite(value) && Math.abs(value) <= MAX_MONEY ? value : undefined
}

type ResolvedLine = {
  result: DebtImportRowResult
  organization: string
  cash: number | null
  bank: number | null
  amount: number | null
}

const EPSILON = 0.005

async function resolveLines(db: PgDb, request: DebtImportRequest): Promise<ResolvedLine[]> {
  const clients = (await db.prepare("SELECT id, name FROM clients ORDER BY id").all()) as Array<{ id: number; name: string }>
  const byId = new Map(clients.map((client) => [Number(client.id), client]))
  const byName = new Map<string, { id: number; name: string }>()
  for (const client of clients) if (!byName.has(nameKey(client.name))) byName.set(nameKey(client.name), client)
  const selected = new Map(request.organizations.map((name) => [nameKey(name), name.trim()]))
  const seen = new Set<string>()

  return request.rows.map((line) => {
    const result: DebtImportRowResult = {
      line: line.line,
      clientId: null,
      name: line.name.trim(),
      organization: "",
      current: null,
      target: { cash: null, bank: null, total: null },
      delta: { cash: 0, bank: 0, total: 0 },
      state: "error",
    }
    const resolved: ResolvedLine = { result, organization: "", cash: null, bank: null, amount: null }
    const fail = (error: string) => {
      result.error = error
      return resolved
    }

    const idText = line.id.trim()
    let client: { id: number; name: string } | undefined
    if (idText) {
      if (!/^\d+$/.test(idText)) return fail("Неверный ID клиента")
      client = byId.get(Number(idText))
    } else if (line.name.trim()) client = byName.get(nameKey(line.name))
    else return fail("Не указан клиент")
    if (!client) return fail("Клиент не найден")
    result.clientId = Number(client.id)
    result.name = client.name

    const orgText = placeName(line.organization)
    let organization = ""
    if (selected.size) {
      if (orgText) {
        const match = selected.get(nameKey(orgText))
        if (!match) return fail("Организация не выбрана")
        organization = match
      } else if (selected.size === 1) organization = [...selected.values()][0]
      else return fail("Не указана организация")
    } else if (orgText) return fail("Организация не выбрана")
    result.organization = organization
    resolved.organization = organization

    const duplicateKey = `${result.clientId}|${nameKey(organization)}`
    if (seen.has(duplicateKey)) return fail("Клиент повторяется в файле")
    seen.add(duplicateKey)

    if (request.byPaymentType) {
      const cash = parseAmountCell(line.cash)
      const bank = parseAmountCell(line.bank)
      if (cash === undefined || bank === undefined) return fail("Неверная сумма")
      resolved.cash = cash
      resolved.bank = bank
      if (cash === null && bank === null) {
        result.state = "skip"
        return resolved
      }
    } else {
      const amount = parseAmountCell(line.amount)
      if (amount === undefined) return fail("Неверная сумма")
      resolved.amount = amount
      if (amount === null) {
        result.state = "skip"
        return resolved
      }
    }
    result.state = "same"
    return resolved
  })
}

/** Current balances of the resolved lines (one ledger pass per organization). */
async function applyCurrent(db: PgDb, s: FinanceSchema, base: string, request: DebtImportRequest, lines: ResolvedLine[], currency: string) {
  const active = lines.filter((line) => line.result.state === "same")
  const organizations = [...new Set(active.map((line) => line.organization))]
  for (const organization of organizations) {
    const group = active.filter((line) => line.organization === organization)
    const split = await clientBalanceSplit(db, s, base, {
      to: request.debtDate,
      mode: request.mode,
      organizations: organization ? [organization] : [],
      clientIds: group.map((line) => line.result.clientId!),
    })
    for (const line of group) {
      const current = split.get(String(line.result.clientId))?.currencies.get(currency) ?? { cash: 0, bank: 0, total: 0 }
      const result = line.result
      result.current = current
      if (request.byPaymentType) {
        const cashDelta = line.cash === null ? 0 : roundMoney(line.cash - current.cash)
        const bankDelta = line.bank === null ? 0 : roundMoney(line.bank - current.bank)
        result.target = {
          cash: line.cash ?? current.cash,
          bank: line.bank ?? current.bank,
          total: roundMoney((line.cash ?? current.cash) + (line.bank ?? current.bank)),
        }
        result.delta = { cash: cashDelta, bank: bankDelta, total: roundMoney(cashDelta + bankDelta) }
      } else {
        const delta = roundMoney(line.amount! - current.total)
        result.target = { cash: null, bank: null, total: line.amount }
        result.delta = { cash: 0, bank: 0, total: delta }
      }
      result.state = Math.abs(result.delta.cash) >= EPSILON || Math.abs(result.delta.bank) >= EPSILON || Math.abs(result.delta.total) >= EPSILON ? "change" : "same"
    }
  }
}

function summarize(lines: ResolvedLine[], committed: boolean, corrections: number, importId: number | null): DebtImportResult {
  const rows = lines.map((line) => line.result)
  return {
    rows,
    changed: rows.filter((row) => row.state === "change").length,
    unchanged: rows.filter((row) => row.state === "same").length,
    skipped: rows.filter((row) => row.state === "skip").length,
    errors: rows.filter((row) => row.state === "error").length,
    committed,
    corrections,
    importId,
  }
}

/** Preview (commit = false) or apply (commit = true) of an uploaded debt
 * template: per line the balance on the debt day becomes the uploaded amount
 * (per payment type when split) by adding one correction per changed amount,
 * dated the debt day 23:59 in the chosen currency / organization. Lines with
 * errors block the commit. */
export async function importDebts(request: DebtImportRequest, createdBy: string): Promise<DebtImportResult> {
  const db = getDb()
  await ensureStoreReconciliationSchema(db)
  const currency = normCurrency(request.currency)
  const context = await loadCurrencyContext(db)
  if (!context.currencies.some((item) => item.code === currency)) throw new FinanceInputError("Валюта не найдена")

  if (!request.commit) {
    const s = await ensureFinanceSchema(db)
    const lines = await resolveLines(db, request)
    await applyCurrent(db, s, context.base, request, lines, currency)
    return summarize(lines, false, 0, null)
  }

  return withTransaction(async (tx) => {
    const s = await ensureFinanceSchema(tx)
    const lines = await resolveLines(tx, request)
    await applyCurrent(tx, s, context.base, request, lines, currency)
    if (lines.some((line) => line.result.state === "error")) throw new FinanceInputError("В файле есть ошибки")
    const changes = lines.filter((line) => line.result.state === "change")
    if (!changes.length) return summarize(lines, true, 0, null)

    const batch = (await tx
      .prepare(
        `INSERT INTO client_balance_imports (debt_date, currency, organizations, by_payment_type, mode, file_name, rows_count, created_by)
         VALUES (@debt_date, @currency, @organizations, @by_payment_type, @mode, @file_name, @rows_count, @created_by) RETURNING id`,
      )
      .get({
        debt_date: request.debtDate,
        currency,
        organizations: JSON.stringify(request.organizations),
        by_payment_type: request.byPaymentType ? 1 : 0,
        mode: request.mode,
        file_name: request.fileName ?? "",
        rows_count: request.rows.length,
        created_by: createdBy,
      })) as { id: number }
    const importId = Number(batch.id)
    const comment = `Установить долг с Excel${request.fileName ? ` (${request.fileName})` : ""}`
    let corrections = 0
    const insert = tx.prepare(
      `INSERT INTO ${CLIENT_CORRECTIONS_TABLE} (client_id, amount, currency, payment_type, organization, correction_date, comment, source, import_id, created_by)
       VALUES (@client_id, @amount, @currency, @payment_type, @organization, @correction_date, @comment, 'excel_import', @import_id, @created_by)`,
    )
    for (const line of changes) {
      const parts: Array<[string, number]> = request.byPaymentType
        ? [
            ["cash", line.result.delta.cash],
            ["bank", line.result.delta.bank],
          ]
        : [["", line.result.delta.total]]
      for (const [paymentType, amount] of parts) {
        if (Math.abs(amount) < EPSILON) continue
        await insert.run({
          client_id: line.result.clientId,
          amount,
          currency,
          payment_type: paymentType,
          organization: line.organization,
          correction_date: `${request.debtDate}T23:59`,
          comment,
          import_id: importId,
          created_by: createdBy,
        })
        corrections += 1
      }
    }
    await tx.prepare("UPDATE client_balance_imports SET corrections_count = @count WHERE id = @id").run({ count: corrections, id: importId })
    return summarize(lines, true, corrections, importId)
  })
}

const templateQuery = z.object({
  templateDate: day,
  currency: z.string().trim().min(1),
  templateOrganization: z.array(z.string().trim().min(1)).default([]),
  byPaymentType: z
    .enum(["1", "0", "true", "false"])
    .optional()
    .transform((value) => value === "1" || value === "true"),
})

/** Query of GET /api/store-reconciliation/template: the list filters (same
 * params as the list) + templateDate, currency, templateOrganization*, byPaymentType. */
export function parseDebtTemplateQuery(url: string, filters: StoreReconciliationParams): { data?: DebtTemplateParams; error?: z.ZodError } {
  const search = new URL(url).searchParams
  const parsed = templateQuery.safeParse({
    templateDate: search.get("templateDate") ?? "",
    currency: search.get("currency") ?? "",
    templateOrganization: search.getAll("templateOrganization").filter((value) => value.trim() !== ""),
    byPaymentType: search.get("byPaymentType") || undefined,
  })
  if (!parsed.success) return { error: parsed.error }
  return {
    data: {
      debtDate: parsed.data.templateDate,
      currency: parsed.data.currency,
      organizations: parsed.data.templateOrganization,
      byPaymentType: parsed.data.byPaymentType,
      filters,
    },
  }
}
