import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import {
  normalizeContractStatus,
  type ContractClientRef,
  type ContractDetail,
  type ContractFormOptions,
  type ContractImportResult,
  type ContractImportRow,
  type ContractInnInfo,
  type ContractInput,
  type ContractListQuery,
  type ContractListResult,
  type ContractNextNumber,
  type ContractOption,
  type ContractRow,
  type ContractStatus,
  type ContractTransaction,
} from "@/lib/contracts-types"
import { loadCurrencyContext } from "@/lib/finance/context"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import { nameKey, placeName } from "@/lib/finance/entities"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// "Договоры" (demo #/contracts — spec: scratchpad extra/spec-contracts.md).
//
// Storage: the historical `contracts` table (legacy text columns client / agent /
// zone / organization stay in sync for the cash core and the finance readers)
// extended with the demo fields — contract_number + prefix / suffix (unique per
// year + prefix + suffix, next number = max + 1), contract_date (business date,
// demo created_date), agent_id (employees), organization_id (organizations),
// created_by — plus `contract_clients` (a contract covers several clients,
// demo `markets`). Existing rows are never rewritten by the schema step.
//
// Money: payments made under a contract are customer_payments rows with
// contract_id (cash core, lib/cash). They are listed in the detail with totals per
// currency (demo `transactions`, requested with debt=true) and block deletion.

export class ContractError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    /** Form field the error belongs to (contractNumber, createdDate, officialName, inn, clientIds, agentId, status, organizationId). */
    readonly field?: string,
  ) {
    super(message)
  }
}

// --- schema ------------------------------------------------------------------------------

const CONTRACTS_SCHEMA_VERSION = 1

declare global {
  var __linkoContractsSchema: { version: number; ready: Promise<void> } | undefined
}

async function installSchema(): Promise<void> {
  await withTransaction(async (tx) => {
    // Several dev-server workers may race on the DDL; the lock serialises them.
    await tx.exec("SELECT pg_advisory_xact_lock(72120950)")
    await tx.exec(`
      CREATE TABLE IF NOT EXISTS contracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client TEXT NOT NULL DEFAULT '',
        agent TEXT NOT NULL DEFAULT '',
        zone TEXT NOT NULL DEFAULT '',
        inn TEXT NOT NULL DEFAULT '',
        organization TEXT NOT NULL DEFAULT '',
        comment TEXT NOT NULL DEFAULT '',
        official_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        year INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_number INTEGER;
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_prefix TEXT NOT NULL DEFAULT '';
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_suffix TEXT NOT NULL DEFAULT '';
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS agent_id INTEGER;
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS organization_id INTEGER;
      ALTER TABLE contracts ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS contracts_year_number_idx ON contracts (year, contract_number);
      CREATE TABLE IF NOT EXISTS contract_clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id INTEGER NOT NULL,
        client_id INTEGER NOT NULL,
        client_name TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        UNIQUE (contract_id, client_id)
      );
      CREATE INDEX IF NOT EXISTS contract_clients_client_idx ON contract_clients (client_id);
    `)
  })
}

/** Creates / extends the tables (once per process) and the finance SQL helpers (fin_*). */
export async function ensureContractsSchema(db: PgDb = getDb()): Promise<void> {
  if (globalThis.__linkoContractsSchema?.version !== CONTRACTS_SCHEMA_VERSION) {
    const ready = installSchema().catch((error) => {
      globalThis.__linkoContractsSchema = undefined
      throw error
    })
    globalThis.__linkoContractsSchema = { version: CONTRACTS_SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoContractsSchema!.ready
  await ensureFinanceSchema(db)
}

// --- shared SQL ------------------------------------------------------------------------------

const STATUS_SQL = `CASE WHEN lower(c.status) IN ('completed', 'finished') THEN 'completed'
  WHEN lower(c.status) IN ('cancelled', 'canceled') THEN 'cancelled' ELSE 'active' END`

/** One row per contract with the derived display values (alias b). */
const BASE_CTE = `WITH b AS (
  SELECT c.id, c.contract_number, c.contract_prefix, c.contract_suffix, c.year, c.official_name, c.inn, c.comment,
    c.created_by, c.client AS legacy_client, c.zone AS legacy_zone, c.agent_id, c.organization_id,
    COALESCE(NULLIF(c.contract_date, ''), to_char(fin_ts(c.created_at, true), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS eff_date,
    c.contract_prefix || COALESCE(c.contract_number::text, c.id::text) || c.contract_suffix AS full_no,
    COALESCE(NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), NULLIF(fin_place(c.agent), ''), '') AS agent_name,
    COALESCE(NULLIF(btrim(o.name), ''), NULLIF(fin_place(c.organization), ''), '') AS org_name,
    ${STATUS_SQL} AS st,
    EXISTS (SELECT 1 FROM contract_clients x WHERE x.contract_id = c.id) AS linked,
    COALESCE((SELECT string_agg(COALESCE(cl.name, cc.client_name), ' | ' ORDER BY cc.position, cc.id)
      FROM contract_clients cc LEFT JOIN clients cl ON cl.id = cc.client_id WHERE cc.contract_id = c.id), '') AS client_names,
    COALESCE((SELECT json_agg(json_build_object('id', cc.client_id, 'name', COALESCE(cl.name, cc.client_name), 'zone', COALESCE(fin_place(cl.zone), ''))
      ORDER BY cc.position, cc.id)
      FROM contract_clients cc LEFT JOIN clients cl ON cl.id = cc.client_id WHERE cc.contract_id = c.id), '[]'::json) AS clients_json
  FROM contracts c
  LEFT JOIN employees e ON e.id = c.agent_id
  LEFT JOIN organizations o ON o.id = c.organization_id
)`

const BASE_COLUMNS = `b.id, b.contract_number, b.contract_prefix, b.contract_suffix, b.year, b.official_name, b.inn, b.comment, b.created_by,
  b.legacy_client, b.legacy_zone, b.agent_id, b.organization_id, b.eff_date, b.full_no, b.agent_name, b.org_name, b.st, b.clients_json`

type BaseRow = {
  id: number
  contract_number: number | null
  contract_prefix: string
  contract_suffix: string
  year: number
  official_name: string
  inn: string
  comment: string
  created_by: string
  legacy_client: string
  legacy_zone: string
  agent_id: number | null
  organization_id: number | null
  eff_date: string
  full_no: string
  agent_name: string
  org_name: string
  st: ContractStatus
  clients_json: Array<{ id: number; name: string | null; zone: string | null }> | null
}

function rowClients(row: BaseRow): ContractClientRef[] {
  const linked = (row.clients_json ?? []).map((item) => ({ id: item.id, name: item.name ?? "", zone: placeName(item.zone) }))
  if (linked.length) return linked
  const legacy = placeName(row.legacy_client)
  return legacy ? [{ id: null, name: legacy, zone: placeName(row.legacy_zone) }] : []
}

function toRow(row: BaseRow, money?: { count: number; paid: Record<string, number> }): ContractRow {
  return {
    id: Number(row.id),
    contractNumber: row.contract_number === null ? null : Number(row.contract_number),
    contractPrefix: row.contract_prefix ?? "",
    contractSuffix: row.contract_suffix ?? "",
    fullNumber: row.full_no,
    createdDate: row.eff_date ?? "",
    year: Number(row.year),
    officialName: row.official_name ?? "",
    inn: row.inn ?? "",
    clients: rowClients(row),
    agent: { id: row.agent_id === null ? null : Number(row.agent_id), name: row.agent_name ?? "" },
    organization: { id: row.organization_id === null ? null : Number(row.organization_id), name: row.org_name ?? "" },
    comment: placeName(row.comment),
    status: row.st,
    createdBy: row.created_by ?? "",
    transactionsCount: money?.count ?? 0,
    paid: money?.paid ?? {},
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** Live payments per contract: count + Σ amount per currency (amount credited to the client). */
async function paymentTotals(db: PgDb, ids: number[]): Promise<Map<number, { count: number; paid: Record<string, number> }>> {
  const result = new Map<number, { count: number; paid: Record<string, number> }>()
  if (!ids.length) return result
  const { base } = await loadCurrencyContext(db)
  const rows = (await db
    .prepare(
      `SELECT p.contract_id, COALESCE(fin_cur(p.currency), ?) AS cur, COUNT(*)::int AS n, SUM(p.amount)::float8 AS total
       FROM customer_payments p
       WHERE p.contract_id = ANY(?::int[]) AND COALESCE(p.is_deleted, 0) = 0
       GROUP BY p.contract_id, 2`,
    )
    .all(base, ids)) as Array<{ contract_id: number; cur: string; n: number; total: number | null }>
  for (const row of rows) {
    const id = Number(row.contract_id)
    const entry = result.get(id) ?? { count: 0, paid: {} }
    entry.count += Number(row.n)
    entry.paid[row.cur] = round((entry.paid[row.cur] ?? 0) + Number(row.total ?? 0))
    result.set(id, entry)
  }
  return result
}

// --- list ------------------------------------------------------------------------------------

const ORDERINGS: Record<string, string> = {
  contract_number: "b.contract_number",
  full_number: "b.full_no",
  created_date: "b.eff_date",
  agent: "lower(b.agent_name)",
  agent__first_name: "lower(b.agent_name)",
  inn: "b.inn",
  official_name: "lower(b.official_name)",
  status: "b.st",
  client: "lower(b.client_names)",
  id: "b.id",
}

function orderBy(ordering: string): string {
  const desc = ordering.startsWith("-")
  const expr = ORDERINGS[desc ? ordering.slice(1) : ordering]
  if (!expr) return "b.id DESC"
  return `${expr} ${desc ? "DESC" : "ASC"} NULLS LAST, b.id ${desc ? "DESC" : "ASC"}`
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

export async function listContracts(query: ContractListQuery): Promise<ContractListResult> {
  const db = getDb()
  await ensureContractsSchema(db)
  const where: string[] = []
  const args: unknown[] = []
  if (query.tab !== "all") {
    where.push("b.st = ?")
    args.push(query.tab)
  }
  if (query.contractId) {
    where.push("b.id = ?")
    args.push(query.contractId)
  }
  if (query.fromDate) {
    where.push("b.eff_date >= ?")
    args.push(query.fromDate)
  }
  if (query.toDate) {
    where.push("b.eff_date < ?")
    args.push(`${query.toDate}T99`)
  }
  if (query.clientIds.length) {
    where.push(`(EXISTS (SELECT 1 FROM contract_clients cc WHERE cc.contract_id = b.id AND cc.client_id = ANY(?::int[]))
      OR (NOT b.linked AND fin_key(b.legacy_client) IN (SELECT fin_key(name) FROM clients WHERE id = ANY(?::int[]))))`)
    args.push(query.clientIds, query.clientIds)
  }
  if (query.zones.length) {
    const keys = query.zones.map(nameKey)
    where.push(`(EXISTS (SELECT 1 FROM contract_clients cc JOIN clients cl ON cl.id = cc.client_id
        WHERE cc.contract_id = b.id AND fin_key(cl.zone) = ANY(?::text[]))
      OR (NOT b.linked AND fin_key(b.legacy_zone) = ANY(?::text[])))`)
    args.push(keys, keys)
  }
  if (query.agents.length) {
    where.push("fin_key(b.agent_name) = ANY(?::text[])")
    args.push(query.agents.map(nameKey))
  }
  const search = query.search.trim()
  if (search) {
    const pattern = likePattern(search)
    where.push(`(b.full_no ILIKE ? OR b.official_name ILIKE ? OR b.inn ILIKE ? OR b.agent_name ILIKE ? OR b.comment ILIKE ?
      OR b.client_names ILIKE ? OR b.legacy_client ILIKE ?)`)
    args.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern)
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const counted = (await db.prepare(`${BASE_CTE} SELECT COUNT(*)::int AS n FROM b ${whereSql}`).get(...args)) as { n: number }
  const count = Number(counted?.n ?? 0)
  const pageSize = Math.max(0, query.pageSize)
  const lastPage = pageSize ? Math.max(1, Math.ceil(count / pageSize)) : 1
  const page = pageSize ? Math.min(Math.max(1, query.page), lastPage) : 1
  const limit = pageSize ? ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : ""
  const rows = (await db
    .prepare(`${BASE_CTE} SELECT ${BASE_COLUMNS} FROM b ${whereSql} ORDER BY ${orderBy(query.ordering)}${limit}`)
    .all(...args)) as BaseRow[]
  const totals = await paymentTotals(db, rows.map((row) => Number(row.id)))
  return { count, page, pageSize, results: rows.map((row) => toRow(row, totals.get(Number(row.id)))) }
}

async function loadRow(db: PgDb, id: number): Promise<BaseRow | undefined> {
  return (await db.prepare(`${BASE_CTE} SELECT ${BASE_COLUMNS} FROM b WHERE b.id = ?`).get(id)) as BaseRow | undefined
}

export async function getContract(id: number): Promise<ContractDetail | null> {
  const db = getDb()
  await ensureContractsSchema(db)
  const row = await loadRow(db, id)
  if (!row) return null
  const { base } = await loadCurrencyContext(db)
  const payments = (await db
    .prepare(
      `SELECT p.id, p.doc_no, p.created_by, p.client, COALESCE(NULLIF(cb.name, ''), p.kassa, '') AS cashbox,
         p.amount::float8 AS amount, COALESCE(fin_cur(p.currency), ?) AS currency, p.comment, p.accepted, p.order_id,
         COALESCE(to_char(COALESCE(fin_ts(NULLIF(p.payment_date, '')), fin_ts(p.paid_at), fin_ts(p.created_at, true)), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS ts
       FROM customer_payments p LEFT JOIN cashboxes cb ON cb.id = p.cashbox_id
       WHERE p.contract_id = ? AND COALESCE(p.is_deleted, 0) = 0
       ORDER BY ts DESC, p.id DESC`,
    )
    .all(base, id)) as Array<{
    id: number
    doc_no: number | string | null
    created_by: string | null
    client: string | null
    cashbox: string
    amount: number | null
    currency: string
    comment: string | null
    accepted: number | null
    order_id: number | null
    ts: string
  }>
  const transactions: ContractTransaction[] = payments.map((payment) => ({
    id: Number(payment.id),
    docNo: payment.doc_no === null ? null : Number(payment.doc_no),
    date: payment.ts,
    createdBy: payment.created_by ?? "",
    client: payment.client ?? "",
    cashbox: payment.cashbox,
    amount: Number(payment.amount ?? 0),
    currency: payment.currency,
    comment: placeName(payment.comment),
    accepted: Number(payment.accepted ?? 0) === 1,
    orderId: payment.order_id === null ? null : Number(payment.order_id),
  }))
  const sums = new Map<string, number>()
  for (const item of transactions) sums.set(item.currency, (sums.get(item.currency) ?? 0) + item.amount)
  const paid = Object.fromEntries([...sums].map(([currency, amount]) => [currency, round(amount)]))
  return {
    ...toRow(row, { count: transactions.length, paid }),
    transactions,
    totals: [...sums].map(([currency, amount]) => ({ currency, amount: round(amount) })),
  }
}

// --- numbering -------------------------------------------------------------------------------

async function nextNumber(db: PgDb, year: number, prefix: string, suffix: string): Promise<number> {
  const row = (await db
    .prepare("SELECT COALESCE(MAX(contract_number), 0)::int AS n FROM contracts WHERE year = ? AND contract_prefix = ? AND contract_suffix = ?")
    .get(year, prefix, suffix)) as { n: number }
  return Number(row?.n ?? 0) + 1
}

/** Demo GET /sales/contract/contract_number/: next free number of the year. Prefix / suffix
 * default to the ones of the latest numbered contract (the demo reads them from the company settings). */
export async function getNextContractNumber(params: { year?: number | null; prefix?: string | null; suffix?: string | null }): Promise<ContractNextNumber> {
  const db = getDb()
  await ensureContractsSchema(db)
  const year = params.year && params.year > 1900 ? params.year : Number(nowLocalIso().slice(0, 4))
  let prefix = params.prefix ?? null
  let suffix = params.suffix ?? null
  if (prefix === null || suffix === null) {
    const last = (await db
      .prepare("SELECT contract_prefix, contract_suffix FROM contracts WHERE contract_number IS NOT NULL ORDER BY id DESC LIMIT 1")
      .get()) as { contract_prefix: string; contract_suffix: string } | undefined
    prefix ??= last?.contract_prefix ?? ""
    suffix ??= last?.contract_suffix ?? ""
  }
  prefix = prefix.trim()
  suffix = suffix.trim()
  return { contractNumber: await nextNumber(db, year, prefix, suffix), contractPrefix: prefix, contractSuffix: suffix, year }
}

// --- writes ----------------------------------------------------------------------------------

type ExistingRow = { id: number; contract_date: string; created_at: string; contract_number: number | null; agent_id: number | null; agent: string; organization_id: number | null }

/** Input date → local "YYYY-MM-DDTHH:mm:ss"; a bare day keeps the stored time of the same day, else gets the current time. */
function contractDate(value: string | undefined, existing: ExistingRow | null): string {
  const text = String(value ?? "").trim()
  const previous = existing ? (parseAnyDate(existing.contract_date) ?? parseAnyDate(existing.created_at, true)) : null
  if (!text) return previous ?? nowLocalIso()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    if (!parseAnyDate(text)) throw new ContractError("Неверная дата", 400, "createdDate")
    if (previous && previous.slice(0, 10) === text) return previous
    return `${text}${nowLocalIso().slice(10)}`
  }
  const parsed = parseAnyDate(text)
  if (!parsed) throw new ContractError("Неверная дата", 400, "createdDate")
  return parsed
}

type Resolved = {
  date: string
  year: number
  number: number
  prefix: string
  suffix: string
  officialName: string
  inn: string
  clients: Array<{ id: number; name: string; zone: string }>
  agentId: number
  agentName: string
  organizationId: number | null
  organizationName: string
  status: ContractStatus
  comment: string
}

async function resolveInput(tx: PgDb, input: ContractInput, existing: ExistingRow | null): Promise<Resolved> {
  const date = contractDate(input.createdDate, existing)
  const year = Number(date.slice(0, 4))
  const prefix = String(input.contractPrefix ?? "").trim()
  const suffix = String(input.contractSuffix ?? "").trim()
  if (prefix.length > 20 || suffix.length > 20) throw new ContractError("Слишком длинный префикс или суффикс", 400, "contractNumber")

  const officialName = String(input.officialName ?? "").trim()
  if (!officialName) throw new ContractError("Укажите официальное название", 400, "officialName")
  const inn = String(input.inn ?? "").replace(/\s/g, "")
  if (!inn) throw new ContractError("Укажите ИНН", 400, "inn")
  if (!/^\d{1,20}$/.test(inn)) throw new ContractError("ИНН должен содержать только цифры", 400, "inn")

  const status = normalizeContractStatus(input.status)
  if (!status) throw new ContractError("Укажите статус", 400, "status")

  // Clients (demo markets): at least one; ids already linked stay valid even if the client row is gone.
  const ids = [...new Set((input.clientIds ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) throw new ContractError("Укажите клиентов", 400, "clientIds")
  const found = (await tx.prepare("SELECT id, name, zone FROM clients WHERE id = ANY(?::int[])").all(ids)) as Array<{ id: number; name: string; zone: string }>
  const linked = existing
    ? ((await tx.prepare("SELECT client_id, client_name FROM contract_clients WHERE contract_id = ?").all(existing.id)) as Array<{ client_id: number; client_name: string }>)
    : []
  const clients = ids.map((id) => {
    const row = found.find((item) => Number(item.id) === id)
    if (row) return { id, name: row.name ?? "", zone: placeName(row.zone) }
    const kept = linked.find((item) => Number(item.client_id) === id)
    if (kept) return { id, name: kept.client_name, zone: "" }
    throw new ContractError("Клиент не найден", 404, "clientIds")
  })

  const agentId = Number(input.agentId)
  if (!Number.isInteger(agentId) || agentId <= 0) throw new ContractError("Укажите агента", 400, "agentId")
  const employee = (await tx.prepare("SELECT id, first_name, last_name FROM employees WHERE id = ?").get(agentId)) as
    | { id: number; first_name: string; last_name: string }
    | undefined
  let agentName = employee ? `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim() : ""
  if (!employee) {
    if (existing && Number(existing.agent_id) === agentId) agentName = existing.agent
    else throw new ContractError("Сотрудник не найден", 404, "agentId")
  }

  let organizationId: number | null = null
  let organizationName = ""
  if (input.organizationId) {
    const organization = (await tx.prepare("SELECT id, name FROM organizations WHERE id = ?").get(input.organizationId)) as { id: number; name: string } | undefined
    if (!organization) throw new ContractError("Организация не найдена", 404, "organizationId")
    organizationId = Number(organization.id)
    organizationName = organization.name ?? ""
  }

  let number: number
  if (input.contractNumber !== undefined && input.contractNumber !== null) {
    number = Number(input.contractNumber)
    if (!Number.isInteger(number) || number <= 0 || number > 2_000_000_000) throw new ContractError("Неверный номер контракта", 400, "contractNumber")
  } else if (existing?.contract_number) {
    number = Number(existing.contract_number)
  } else {
    number = await nextNumber(tx, year, prefix, suffix)
  }
  const taken = (await tx
    .prepare("SELECT id FROM contracts WHERE year = ? AND contract_prefix = ? AND contract_number = ? AND contract_suffix = ? AND id <> ? LIMIT 1")
    .get(year, prefix, number, suffix, existing?.id ?? 0)) as { id: number } | undefined
  if (taken) throw new ContractError("Договор с таким номером уже существует", 400, "contractNumber")

  return {
    date,
    year,
    number,
    prefix,
    suffix,
    officialName,
    inn,
    clients,
    agentId,
    agentName,
    organizationId,
    organizationName,
    status,
    comment: String(input.comment ?? "").trim(),
  }
}

async function writeClients(tx: PgDb, contractId: number, clients: Resolved["clients"]): Promise<void> {
  await tx.prepare("DELETE FROM contract_clients WHERE contract_id = ?").run(contractId)
  for (const [position, client] of clients.entries()) {
    await tx.prepare("INSERT INTO contract_clients (contract_id, client_id, client_name, position) VALUES (?, ?, ?, ?)").run(contractId, client.id, client.name, position)
  }
}

/** Serialises numbering (next number + uniqueness check) across concurrent writes. */
const NUMBER_LOCK = "SELECT pg_advisory_xact_lock(72120951)"

export async function createContract(input: ContractInput, createdBy: string): Promise<ContractDetail> {
  await ensureContractsSchema()
  const id = await withTransaction(async (tx) => {
    await tx.exec(NUMBER_LOCK)
    const v = await resolveInput(tx, input, null)
    const first = v.clients[0]
    const result = await tx
      .prepare(
        `INSERT INTO contracts (client, agent, zone, inn, organization, comment, official_name, status, year,
           contract_number, contract_prefix, contract_suffix, contract_date, agent_id, organization_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(first.name, v.agentName, first.zone, v.inn, v.organizationName, v.comment, v.officialName, v.status, v.year, v.number, v.prefix, v.suffix, v.date, v.agentId, v.organizationId, createdBy)
    const contractId = Number(result.lastInsertRowid)
    await writeClients(tx, contractId, v.clients)
    return contractId
  })
  return (await getContract(id))!
}

async function loadExisting(tx: PgDb, id: number): Promise<ExistingRow | null> {
  const row = (await tx
    .prepare("SELECT id, contract_date, created_at, contract_number, agent_id, agent, organization_id FROM contracts WHERE id = ? FOR UPDATE")
    .get(id)) as ExistingRow | undefined
  return row ?? null
}

export async function updateContract(id: number, input: ContractInput): Promise<ContractDetail | null> {
  await ensureContractsSchema()
  const ok = await withTransaction(async (tx) => {
    await tx.exec(NUMBER_LOCK)
    const existing = await loadExisting(tx, id)
    if (!existing) return false
    const v = await resolveInput(tx, input, existing)
    const first = v.clients[0]
    await tx
      .prepare(
        `UPDATE contracts SET client = ?, agent = ?, zone = ?, inn = ?, organization = ?, comment = ?, official_name = ?, status = ?, year = ?,
           contract_number = ?, contract_prefix = ?, contract_suffix = ?, contract_date = ?, agent_id = ?, organization_id = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(first.name, v.agentName, first.zone, v.inn, v.organizationName, v.comment, v.officialName, v.status, v.year, v.number, v.prefix, v.suffix, v.date, v.agentId, v.organizationId, id)
    await writeClients(tx, id, v.clients)
    return true
  })
  return ok ? getContract(id) : null
}

/** Complete / cancel / reactivate (demo: the "Статус" select of the edit form). */
export async function setContractStatus(id: number, status: ContractStatus): Promise<ContractDetail | null> {
  const db = getDb()
  await ensureContractsSchema(db)
  const result = await db.prepare("UPDATE contracts SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
  return result.changes ? getContract(id) : null
}

/** Demo DELETE /sales/contract/:id/ — refused while any payment references the contract. */
export async function deleteContract(id: number): Promise<boolean> {
  await ensureContractsSchema()
  return withTransaction(async (tx) => {
    const existing = await loadExisting(tx, id)
    if (!existing) return false
    const used = (await tx.prepare("SELECT COUNT(*)::int AS n FROM customer_payments WHERE contract_id = ?").get(id)) as { n: number }
    if (Number(used?.n ?? 0) > 0) throw new ContractError("Удаление невозможно из-за связи с другими данными", 409)
    await tx.prepare("DELETE FROM contract_clients WHERE contract_id = ?").run(id)
    await tx.prepare("DELETE FROM contracts WHERE id = ?").run(id)
    return true
  })
}

// --- lookups ---------------------------------------------------------------------------------

/** Values of the filter popup and of the create / edit form. */
export async function getContractFormOptions(): Promise<ContractFormOptions> {
  const db = getDb()
  await ensureContractsSchema(db)
  const [employees, organizations, zones, agents] = await Promise.all([
    db.prepare("SELECT id, first_name, last_name FROM employees ORDER BY lower(first_name), lower(last_name), id").all() as Promise<Array<{ id: number; first_name: string; last_name: string }>>,
    db.prepare("SELECT id, name FROM organizations ORDER BY lower(name), id").all() as Promise<Array<{ id: number; name: string }>>,
    db.prepare("SELECT DISTINCT zone FROM clients UNION SELECT DISTINCT zone FROM contracts").all() as Promise<Array<{ zone: string }>>,
    db.prepare("SELECT DISTINCT agent FROM contracts").all() as Promise<Array<{ agent: string }>>,
  ])
  const unique = (values: string[]) => {
    const seen = new Map<string, string>()
    for (const value of values) {
      const name = placeName(value)
      if (name && !seen.has(nameKey(name))) seen.set(nameKey(name), name)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
  }
  const agentList = employees.map((row) => ({ id: Number(row.id), name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() })).filter((row) => row.name)
  return {
    agents: agentList,
    organizations: organizations.map((row) => ({ id: Number(row.id), name: row.name ?? "" })).filter((row) => row.name),
    zones: unique(zones.map((row) => row.zone)),
    agentNames: unique([...agentList.map((row) => row.name), ...agents.map((row) => row.agent)]),
  }
}

/**
 * Contract select of the payment dialogs (demo `clientContract`, api MARKET_CONTRACTS_LISTS with
 * {market} / {client}): active contracts covering the client — by link (client id, or clients with
 * the same name) or, for legacy contracts without links, by the stored client name. `includeId`
 * keeps the currently selected contract in the list (editing an old payment).
 */
export async function listContractOptions(params: { clientId?: number | null; client?: string; includeId?: number | null }): Promise<ContractOption[]> {
  const db = getDb()
  await ensureContractsSchema(db)
  const clientId = params.clientId ?? null
  const clientName = String(params.client ?? "").trim()
  let nameForLegacy = clientName
  if (clientId && !nameForLegacy) {
    const row = (await db.prepare("SELECT name FROM clients WHERE id = ?").get(clientId)) as { name: string } | undefined
    nameForLegacy = row?.name ?? ""
  }
  const where: string[] = []
  const args: unknown[] = []
  if (clientId || nameForLegacy) {
    where.push(`(EXISTS (SELECT 1 FROM contract_clients cc WHERE cc.contract_id = b.id
        AND (cc.client_id = ? OR (? <> '' AND cc.client_id IN (SELECT id FROM clients WHERE fin_key(name) = fin_key(?)))))
      OR (NOT b.linked AND ? <> '' AND fin_key(b.legacy_client) = fin_key(?)))`)
    args.push(clientId ?? 0, nameForLegacy, nameForLegacy, nameForLegacy, nameForLegacy)
  }
  const statusSql = params.includeId ? "(b.st = 'active' OR b.id = ?)" : "b.st = 'active'"
  if (params.includeId) args.push(params.includeId)
  where.push(statusSql)
  const rows = (await db
    .prepare(`${BASE_CTE} SELECT ${BASE_COLUMNS} FROM b WHERE ${where.join(" AND ")} ORDER BY b.eff_date DESC, b.id DESC LIMIT 500`)
    .all(...args)) as BaseRow[]
  return rows.map((row) => ({
    id: Number(row.id),
    fullNumber: row.full_no,
    label: row.full_no,
    hint: [row.official_name, row.org_name, row.year ? String(row.year) : ""].filter(Boolean).join(" · "),
    officialName: row.official_name ?? "",
    organization: row.org_name ?? "",
    year: Number(row.year),
    status: row.st,
  }))
}

/** "Проверить данные по ИНН" — local lookup (the demo asks the tax service): the newest
 * contract with this INN, else a client with this INN. */
export async function lookupInn(inn: string): Promise<ContractInnInfo> {
  const db = getDb()
  await ensureContractsSchema(db)
  const value = inn.replace(/\s/g, "")
  const contract = (await db
    .prepare("SELECT official_name FROM contracts WHERE regexp_replace(inn, '\\s', '', 'g') = ? AND btrim(official_name) <> '' ORDER BY id DESC LIMIT 1")
    .get(value)) as { official_name: string } | undefined
  if (contract) return { inn: value, name: contract.official_name, address: "", source: "contract" }
  const client = (await db
    .prepare("SELECT name, address FROM clients WHERE regexp_replace(COALESCE(inn, ''), '\\s', '', 'g') = ? ORDER BY id DESC LIMIT 1")
    .get(value)) as { name: string; address: string | null } | undefined
  if (client) return { inn: value, name: client.name ?? "", address: client.address ?? "", source: "client" }
  return { inn: value, name: "", address: "", source: null }
}

// --- Excel import ("Импортировать с excel") ------------------------------------------------------

const IMPORT_STATUS: Record<string, ContractStatus> = {
  "активный": "active",
  "актив": "active",
  "faol": "active",
  "aktiv": "active",
  "завершен": "completed",
  "закрытие": "completed",
  "yakunlandi": "completed",
  "отменен": "cancelled",
  "bekor qilingan": "cancelled",
}

/** Excel serial day (e.g. 45900) → "YYYY-MM-DD". */
function excelSerialDay(value: string): string | null {
  const serial = Number(value)
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10)
}

export async function importContracts(rows: ContractImportRow[], createdBy: string): Promise<ContractImportResult> {
  const db = getDb()
  await ensureContractsSchema(db)
  const [clients, employees, organizations] = await Promise.all([
    db.prepare("SELECT id, name FROM clients ORDER BY id").all() as Promise<Array<{ id: number; name: string }>>,
    db.prepare("SELECT id, first_name, last_name, login FROM employees ORDER BY id").all() as Promise<Array<{ id: number; first_name: string; last_name: string; login: string }>>,
    db.prepare("SELECT id, name FROM organizations ORDER BY id").all() as Promise<Array<{ id: number; name: string }>>,
  ])
  const clientByKey = new Map<string, number>()
  for (const row of clients) if (!clientByKey.has(nameKey(row.name))) clientByKey.set(nameKey(row.name), Number(row.id))
  const employeeByKey = new Map<string, number>()
  for (const row of employees) {
    for (const key of [`${row.first_name} ${row.last_name}`, `${row.last_name} ${row.first_name}`, row.login]) {
      if (nameKey(key) && !employeeByKey.has(nameKey(key))) employeeByKey.set(nameKey(key), Number(row.id))
    }
  }
  const organizationByKey = new Map(organizations.map((row) => [nameKey(row.name), Number(row.id)]))

  let created = 0
  const errors: ContractImportResult["errors"] = []
  for (const [index, row] of rows.entries()) {
    try {
      const whole = String(row.clients ?? "").trim()
      // Several clients are separated by ";", new lines or ", " (the Excel export joins them with ", ").
      const names = clientByKey.has(nameKey(whole)) ? [whole] : whole.split(/[;\n]|,(?!\d)/).map((name) => name.trim()).filter(Boolean)
      if (!names.length) throw new ContractError("Укажите клиентов", 400, "clientIds")
      const clientIds = names.map((name) => {
        const id = clientByKey.get(nameKey(name))
        if (!id) throw new ContractError(`Клиент не найден: ${name}`, 404, "clientIds")
        return id
      })
      const agentText = String(row.agent ?? "").trim()
      const agentId = agentText ? employeeByKey.get(nameKey(agentText)) : undefined
      if (!agentText) throw new ContractError("Укажите агента", 400, "agentId")
      if (!agentId) throw new ContractError(`Сотрудник не найден: ${agentText}`, 404, "agentId")
      const organizationText = placeName(row.organization)
      const organizationId = organizationText ? organizationByKey.get(nameKey(organizationText)) : undefined
      if (organizationText && !organizationId) throw new ContractError(`Организация не найдена: ${organizationText}`, 404, "organizationId")
      const statusText = nameKey(row.status)
      const status = statusText ? (IMPORT_STATUS[statusText] ?? normalizeContractStatus(statusText)) : "active"
      if (!status) throw new ContractError(`Неизвестный статус: ${row.status}`, 400, "status")
      const numberText = String(row.contractNumber ?? "").trim()
      if (numberText && !/^\d+$/.test(numberText)) throw new ContractError("Неверный номер контракта", 400, "contractNumber")
      const dateText = String(row.createdDate ?? "").trim()
      const day = dateText ? (excelSerialDay(dateText) ?? parseAnyDate(dateText)?.slice(0, 10) ?? null) : ""
      if (day === null) throw new ContractError("Неверная дата", 400, "createdDate")
      await createContract(
        {
          contractNumber: numberText ? Number(numberText) : null,
          contractPrefix: row.contractPrefix ?? "",
          contractSuffix: row.contractSuffix ?? "",
          createdDate: day,
          officialName: String(row.officialName ?? "").trim(),
          inn: String(row.inn ?? "").trim(),
          clientIds,
          agentId,
          status,
          comment: placeName(row.comment),
          organizationId: organizationId ?? null,
        },
        createdBy,
      )
      created += 1
    } catch (error) {
      if (!(error instanceof ContractError)) throw error
      errors.push({ row: index + 1, error: error.message })
    }
  }
  return { created, errors }
}

/** Client picker of the form / filter: name search (50 rows) + the selected ids (labels on reopen). */
export async function searchContractClients(params: { q: string; ids: number[] }): Promise<Array<{ id: number; name: string; zone: string; inn: string }>> {
  const db = getDb()
  await ensureContractsSchema(db)
  const q = params.q.trim()
  const rows = (await db
    .prepare(
      `(SELECT id, name, zone, inn FROM clients WHERE id = ANY(?::int[]))
       UNION
       (SELECT id, name, zone, inn FROM clients
        WHERE ? = '' OR name ILIKE ? OR COALESCE(inn, '') ILIKE ? OR COALESCE(phone, '') ILIKE ? OR COALESCE(code, '') ILIKE ?
        ORDER BY lower(name), id LIMIT 50)`,
    )
    .all(params.ids, q, likePattern(q), likePattern(q), likePattern(q), likePattern(q))) as Array<{ id: number; name: string; zone: string | null; inn: string | null }>
  return rows
    .map((row) => ({ id: Number(row.id), name: row.name ?? "", zone: placeName(row.zone), inn: row.inn ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.id - b.id)
}
