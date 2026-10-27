import "server-only"

import { CLIENT_COLUMNS, getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { ensureClientZones, resolveClientZone } from "@/lib/client-zones-repo"
import { clientLedgerBalances } from "@/lib/orders-repo"
import { keySql, nameKey, quoteIdent } from "@/lib/platform-refs"
import type { Client } from "@/components/clients/clients-data"

// Clients.
// - `balance` is the client's OPENING balance (finance source "client_opening");
//   an update without it keeps the stored one, null clears it.
// - type must be a client type (Типы клиентов), branch a Филиал (or none);
//   agent / deliverer / collector / zone agent must be employees (or
//   "Не указано"). Unchanged legacy values are kept as they are.
// - zone is a zone of the directory (lib/client-zones-repo.ts), spelled as the
//   directory has it; a zone the directory does not have yet is added to it.
// - A second client with the same name and the same phone or INN is refused
//   (409) unless `allowDuplicate` is set.
// - Deleting a client that documents reference (orders, payments, returns,
//   loyalty, contracts, corrections, equipment…) or that has an opening
//   balance is refused with 409 and the usage list (contract 7). Soft-deleted
//   documents (is_deleted / deleted = 1) do not count; they keep the client's
//   id and name as a snapshot.
// - A rename cascades to the documents that store the client name and links
//   their legacy name-only rows by client_id (contract 6).
// - Listed clients carry their CURRENT ledger balance (balanceLines /
//   currentBalances) and last order / payment days from lib/finance.

export class ClientError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

// The client columns are created by the lib/db.ts bootstrap (CLIENT_COLUMNS),
// so every module that joins clients finds them on a fresh database; this
// repeats them for a process that started before the bootstrap had them.
const DDL = `
${CLIENT_COLUMNS.map(([name, type]) => `ALTER TABLE clients ADD COLUMN IF NOT EXISTS ${name} ${type};`).join("\n")}
DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['balance', 'location_lat', 'location_lng'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'clients' AND column_name = c AND data_type = 'real') THEN
      EXECUTE format('ALTER TABLE clients ALTER COLUMN %I TYPE double precision USING round(%I::numeric, 6)::double precision', c, c);
    END IF;
  END LOOP;
END $$;
`

const SCHEMA_VERSION = 1

declare global {
  var __linkoClientsSchema: { version: number; ready: Promise<void> } | undefined
}

/** Additive client columns (full "Добавить клиента" form), once per process. */
export function ensureClientsSchema(): Promise<void> {
  if (globalThis.__linkoClientsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() => withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(72120935)")
      await tx.exec(DDL)
    })).catch((error) => {
      globalThis.__linkoClientsSchema = undefined
      throw error
    })
    globalThis.__linkoClientsSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoClientsSchema!.ready
}

type ClientRow = {
  id: number
  name: string
  phone: string
  inn: string | null
  type: string
  zone: string
  zone_agent: string
  agent: string
  deliverer: string
  collector: string
  balance: number | null
  created_at?: string | null
  created_by?: string | null
  tab: Client["tab"]
  branch: string
  sales_channel: string
  realization_by: string
  address: string
  landmark: string
  location_lat: number | null
  location_lng: number | null
  telegram_location_link: string
  code: string
  contact_person: string
  note: string
  auto_delivery: number
  unlimited_debt: number
  attributes?: string | null
  in_route?: number | null
  is_problem?: number | null
}

function rowToClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    inn: row.inn ?? undefined,
    type: row.type,
    zone: row.zone,
    zoneAgent: row.zone_agent,
    agent: row.agent,
    deliverer: row.deliverer,
    collector: row.collector,
    balance: row.balance ?? undefined,
    tab: row.tab,
    inRoute: row.in_route === 1,
    isProblem: row.is_problem === 1,
    branch: row.branch || undefined,
    salesChannel: row.sales_channel || undefined,
    realizationBy: row.realization_by || undefined,
    address: row.address || undefined,
    landmark: row.landmark || undefined,
    locationLat: row.location_lat ?? undefined,
    locationLng: row.location_lng ?? undefined,
    telegramLocationLink: row.telegram_location_link || undefined,
    code: row.code || undefined,
    contactPerson: row.contact_person || undefined,
    note: row.note || undefined,
    autoDelivery: row.auto_delivery === 1,
    unlimitedDebt: row.unlimited_debt === 1,
    attributes: parseAttributes(row.attributes),
    balanceLines: parseBalanceLines(row.attributes),
    createdAt: row.created_at ?? undefined,
    createdBy: row.created_by || undefined,
  }
}

function parseBalanceLines(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined
  try {
    const value = (JSON.parse(raw) as Record<string, unknown>)._balances
    return typeof value === "string" && value ? value.split("|") : undefined
  } catch {
    return undefined
  }
}

function parseAttributes(raw: string | null | undefined): Record<string, string> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const entries = Object.entries(parsed as Record<string, unknown>).filter(([k, v]) => !k.startsWith("_") && typeof v === "string" && v !== "") as [string, string][]
    return entries.length ? Object.fromEntries(entries) : undefined
  } catch {
    return undefined
  }
}

/** Fields written by create / update. `balance`: undefined = keep (update), null = none. */
export type ClientInput = Omit<Client, "id" | "balance" | "balanceLines" | "currentBalances" | "lastOrder" | "lastPayment" | "createdAt" | "createdBy"> & {
  balance?: number | null
  /** Create / rename even when a client with the same name and phone / INN exists. */
  allowDuplicate?: boolean
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function attachLedger(clients: Client[]): Promise<Client[]> {
  if (!clients.length) return clients
  const balances = await clientLedgerBalances(clients.length <= 50 ? { keys: clients.map((client) => String(client.id)) } : {})
  if (!balances.size) return clients
  for (const client of clients) {
    const ledger = balances.get(client.id)
    if (!ledger) continue
    client.balanceLines = ledger.lines
    client.currentBalances = ledger.byCurrency
    client.lastOrder = ledger.lastOrder
    client.lastPayment = ledger.lastPayment
  }
  return clients
}

export async function listClients(search?: string, options: { withBalances?: boolean } = {}): Promise<Client[]> {
  await ensureClientsSchema()
  const db = getDb()
  const rows = search
    ? ((await db
        .prepare("SELECT * FROM clients WHERE name ILIKE @q OR phone ILIKE @q ORDER BY id DESC")
        .all({ q: `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%` })) as ClientRow[])
    : ((await db.prepare("SELECT * FROM clients ORDER BY id DESC").all()) as ClientRow[])
  const clients = rows.map(rowToClient)
  return options.withBalances === false ? clients : attachLedger(clients)
}

export async function getClient(id: number, options: { withBalances?: boolean } = {}): Promise<Client | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await ensureClientsSchema()
  const row = (await getDb().prepare("SELECT * FROM clients WHERE id = ?").get(id)) as ClientRow | undefined
  if (!row) return null
  const client = rowToClient(row)
  return options.withBalances === false ? client : (await attachLedger([client]))[0]
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const NOT_SET = new Set(["", "не указано", "не указан", "—", "-"])

function digitsOf(phone: string): string[] {
  return phone
    .split(",")
    .map((part) => part.replace(/\D/g, ""))
    .filter((digits) => digits.length >= 5)
    .map((digits) => digits.slice(-9))
}

async function clientTypeName(db: PgDb, name: string): Promise<string> {
  const exists = (await db.prepare("SELECT to_regclass('client_types') IS NOT NULL AS ok").get()) as { ok: boolean }
  const row = exists.ok
    ? ((await db.prepare(`SELECT name FROM client_types WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY id LIMIT 1`).get({ name })) as { name: string } | undefined)
    : undefined
  if (!row) throw new ClientError(`Тип клиента «${name}» не найден. Добавьте его в «Типы клиентов»`, 400, { field: "type" })
  return row.name
}

/** The branch as the Филиалы directory spells it ('' = none). */
async function branchName(db: PgDb, name: string): Promise<string> {
  if (NOT_SET.has(nameKey(name))) return ""
  const exists = (await db.prepare("SELECT to_regclass('branches') IS NOT NULL AS ok").get()) as { ok: boolean }
  const row = exists.ok
    ? ((await db.prepare(`SELECT name FROM branches WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY id LIMIT 1`).get({ name })) as { name: string } | undefined)
    : undefined
  if (!row) throw new ClientError("Филиал не найден", 400, { field: "branch" })
  return row.name
}

async function employeeName(db: PgDb, name: string, field: string, label: string): Promise<string> {
  if (NOT_SET.has(nameKey(name))) return "Не указано"
  const row = (await db
    .prepare(`SELECT btrim(first_name || ' ' || last_name) AS name FROM employees WHERE ${keySql("first_name || ' ' || last_name")} = ${keySql("@name::text")} ORDER BY id LIMIT 1`)
    .get({ name })) as { name: string } | undefined
  if (!row) throw new ClientError(`${label}: сотрудник «${name}» не найден`, 400, { field })
  return row.name
}

/** Validates the references of `input` (only values that differ from `existing`). */
async function validateReferences(db: PgDb, input: ClientInput, existing?: Client, createdBy = ""): Promise<ClientInput> {
  const out = { ...input }
  if (!existing || nameKey(existing.type) !== nameKey(input.type)) out.type = await clientTypeName(db, input.type)
  // Branch: a Филиал of the directory ('' / "Не указано" = none); an unchanged legacy value is kept.
  if (!existing || nameKey(existing.branch ?? "") !== nameKey(input.branch ?? "")) out.branch = await branchName(db, input.branch ?? "")
  // Zone: always saved with the directory spelling. A new client (dialog, API,
  // Excel import) may bring a new zone, which is added to the directory. An
  // update accepts only the client's own zone or a directory zone: a form opened
  // before a zone rename must not bring the old name back as a new zone.
  const keepsZone = existing !== undefined && nameKey(existing.zone) === nameKey(input.zone)
  const zone = await resolveClientZone(db, input.zone, createdBy, !existing || keepsZone)
  if (zone === null) throw new ClientError("Зона не найдена", 400, { field: "zone" })
  out.zone = zone
  const people: Array<["agent" | "deliverer" | "collector" | "zoneAgent", string]> = [
    ["agent", "Ответственный агент"],
    ["deliverer", "Ответственный доставщик"],
    ["collector", "Ответственный инкассатор"],
    ["zoneAgent", "Агент зоны"],
  ]
  for (const [field, label] of people) {
    const value = input[field] ?? ""
    if (existing && nameKey(existing[field] ?? "") === nameKey(value)) continue
    out[field] = await employeeName(db, value, field, label)
  }
  return out
}

/** 409 when another client has the same name and the same phone or INN. */
async function assertNotDuplicate(db: PgDb, input: ClientInput, exceptId: number) {
  if (input.allowDuplicate) return
  const twins = (await db
    .prepare(`SELECT id, name, phone, inn FROM clients WHERE ${keySql("name")} = ${keySql("@name::text")} AND id <> @id`)
    .all({ name: input.name, id: exceptId })) as Array<{ id: number; name: string; phone: string; inn: string | null }>
  if (!twins.length) return
  const phones = new Set(digitsOf(input.phone))
  const inn = (input.inn ?? "").replace(/\s/g, "")
  const twin = twins.find((row) => digitsOf(row.phone).some((digits) => phones.has(digits)) || (inn !== "" && (row.inn ?? "").replace(/\s/g, "") === inn))
  if (twin) {
    throw new ClientError(`Клиент «${twin.name}» с таким телефоном или ИНН уже существует (№${twin.id})`, 409, { duplicateId: twin.id })
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function writeParams(input: ClientInput, balance: number | null) {
  return {
    name: input.name,
    phone: input.phone,
    inn: input.inn ?? null,
    type: input.type,
    zone: input.zone,
    zoneAgent: input.zoneAgent,
    agent: input.agent,
    deliverer: input.deliverer,
    collector: input.collector,
    balance,
    tab: input.tab,
    branch: input.branch ?? "",
    salesChannel: input.salesChannel ?? "",
    realizationBy: input.realizationBy ?? "",
    address: input.address ?? "",
    landmark: input.landmark ?? "",
    locationLat: input.locationLat ?? null,
    locationLng: input.locationLng ?? null,
    telegramLocationLink: input.telegramLocationLink ?? "",
    code: input.code ?? "",
    contactPerson: input.contactPerson ?? "",
    note: input.note ?? "",
    autoDelivery: input.autoDelivery ? 1 : 0,
    unlimitedDebt: input.unlimitedDebt ? 1 : 0,
    attributes: JSON.stringify(input.attributes ?? {}),
  }
}

async function lockClients(db: PgDb) {
  await db.exec("SELECT pg_advisory_xact_lock(72120936)")
}

export async function createClient(input: ClientInput, user?: { displayName: string }): Promise<Client> {
  await ensureClientsSchema()
  await ensureClientZones()
  const id = await withTransaction(async (tx) => {
    await lockClients(tx)
    const checked = await validateReferences(tx, input, undefined, user?.displayName ?? "")
    await assertNotDuplicate(tx, checked, 0)
    const result = await tx
      .prepare(
        `INSERT INTO clients (
           name, phone, inn, type, zone, zone_agent, agent, deliverer, collector, balance, tab,
           branch, sales_channel, realization_by, address, landmark, location_lat, location_lng,
           telegram_location_link, code, contact_person, note, auto_delivery, unlimited_debt, attributes, created_by, updated_at
         )
         VALUES (
           @name, @phone, @inn, @type, @zone, @zoneAgent, @agent, @deliverer, @collector, @balance, @tab,
           @branch, @salesChannel, @realizationBy, @address, @landmark, @locationLat, @locationLng,
           @telegramLocationLink, @code, @contactPerson, @note, @autoDelivery, @unlimitedDebt, @attributes, @createdBy, datetime('now')
         )`,
      )
      .run({ ...writeParams(checked, checked.balance ?? null), createdBy: user?.displayName ?? "" })
    return Number(result.lastInsertRowid)
  })
  return (await getClient(id))!
}

/** Documents that store the client name (and, where present, the client id). */
const NAME_REFERENCES: Array<{ table: string; name: string; id?: string }> = [
  { table: "orders", name: "client", id: "client_id" },
  { table: "customer_payments", name: "client", id: "client_id" },
  { table: "cash_management_entries", name: "client_name", id: "client_id" },
  { table: "client_returns", name: "client", id: "client_id" },
  { table: "cashback_withdrawal_requests", name: "client", id: "client_id" },
  { table: "inventory_items", name: "client", id: "client_id" },
  { table: "inventory_item_requests", name: "client", id: "client_id" },
  { table: "inventory_item_checks", name: "client", id: "client_id" },
  { table: "contract_clients", name: "client_name", id: "client_id" },
  // Tasks keep the store name as a snapshot next to client_id (lib/tasks-repo.ts).
  { table: "tasks", name: "store", id: "client_id" },
]

async function columnsOf(db: PgDb, tables: string[]): Promise<Map<string, Set<string>>> {
  const rows = (await db
    .prepare(
      `SELECT c.table_name, c.column_name FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND c.table_name = ANY(@tables::text[])`,
    )
    .all({ tables })) as Array<{ table_name: string; column_name: string }>
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, new Set())
    map.get(row.table_name)!.add(row.column_name)
  }
  return map
}

/** Rename: documents linked by id get the new name; legacy name-only rows get the id too
 * (only when the old name identified this client alone). */
async function cascadeRename(db: PgDb, id: number, oldName: string, newName: string) {
  if (oldName === newName) return
  const columns = await columnsOf(db, NAME_REFERENCES.map((ref) => ref.table))
  const twins = (await db.prepare(`SELECT COUNT(*)::int AS n FROM clients WHERE ${keySql("name")} = ${keySql("@name::text")} AND id <> @id`).get({ name: oldName, id })) as { n: number }
  const byName = twins.n === 0
  for (const ref of NAME_REFERENCES) {
    const cols = columns.get(ref.table)
    if (!cols?.has(ref.name)) continue
    const table = quoteIdent(ref.table)
    const nameCol = quoteIdent(ref.name)
    if (ref.id && cols.has(ref.id)) {
      const idCol = quoteIdent(ref.id)
      const legacy = byName ? ` OR (${idCol} IS NULL AND ${keySql(nameCol)} = ${keySql("@oldName::text")})` : ""
      await db
        .prepare(`UPDATE ${table} SET ${nameCol} = @newName, ${idCol} = @id WHERE (${idCol} = @id${legacy}) AND (${nameCol} IS DISTINCT FROM @newName OR ${idCol} IS DISTINCT FROM @id)`)
        .run({ id, oldName, newName })
    } else if (byName) {
      await db.prepare(`UPDATE ${table} SET ${nameCol} = @newName WHERE ${keySql(nameCol)} = ${keySql("@oldName::text")}`).run({ oldName, newName })
    }
  }
  // Contracts list their clients by name.
  const contracts = await columnsOf(db, ["contracts"])
  if (byName && contracts.get("contracts")?.has("client")) {
    await db.prepare(`UPDATE contracts SET client = @newName WHERE ${keySql("client")} = ${keySql("@oldName::text")}`).run({ oldName, newName })
  }
}

export async function updateClient(id: number, input: ClientInput, user?: { displayName: string }): Promise<Client | null> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null
  await ensureClientsSchema()
  // The directory must hold every zone clients carry before an update is checked against it.
  await ensureClientZones()
  const found = await withTransaction(async (tx) => {
    await lockClients(tx)
    const row = (await tx.prepare("SELECT * FROM clients WHERE id = ? FOR UPDATE").get(id)) as ClientRow | undefined
    if (!row) return false
    const existing = rowToClient(row)
    const checked = await validateReferences(tx, input, existing, user?.displayName ?? "")
    if (nameKey(checked.name) !== nameKey(existing.name) || checked.phone !== existing.phone || (checked.inn ?? "") !== (existing.inn ?? "")) {
      await assertNotDuplicate(tx, checked, id)
    }
    // An omitted opening balance keeps the stored one; null clears it.
    const balance = input.balance === undefined ? (row.balance ?? null) : input.balance
    await tx
      .prepare(
        `UPDATE clients SET name = @name, phone = @phone, inn = @inn, type = @type, zone = @zone,
           zone_agent = @zoneAgent, agent = @agent, deliverer = @deliverer, collector = @collector,
           balance = @balance, tab = @tab,
           branch = @branch, sales_channel = @salesChannel, realization_by = @realizationBy,
           address = @address, landmark = @landmark, location_lat = @locationLat, location_lng = @locationLng,
           telegram_location_link = @telegramLocationLink, code = @code, contact_person = @contactPerson,
           note = @note, auto_delivery = @autoDelivery, unlimited_debt = @unlimitedDebt, attributes = @attributes,
           updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ ...writeParams(checked, balance), id })
    await cascadeRename(tx, id, row.name, checked.name)
    return true
  })
  return found ? getClient(id) : null
}

// ---------------------------------------------------------------------------
// Delete (contract 7)
// ---------------------------------------------------------------------------

export type ClientUsage = { table: string; label: string; count: number }

/** Documents referencing the client: by id, by name for legacy rows without an id, or in id lists.
 * `deleted`: the soft-delete flag of the table; rows with it set to 1 are not counted. */
const USAGE: Array<{ table: string; label: string; id?: string; name?: string; idList?: string; deleted?: string }> = [
  { table: "orders", label: "Заказы", id: "client_id", name: "client" },
  { table: "customer_payments", label: "Оплаты от клиентов", id: "client_id", name: "client", deleted: "is_deleted" },
  { table: "client_payments", label: "Оплаты от клиентов", id: "client_id" },
  { table: "client_bulk_payments", label: "Оплаты от клиентов", idList: "client_ids", deleted: "is_deleted" },
  { table: "account_bulk_payments", label: "Оплаты от клиентов", idList: "client_ids", deleted: "is_deleted" },
  { table: "client_returns", label: "Возвраты", id: "client_id", name: "client" },
  { table: "loyalty_card_transactions", label: "Накопительная карта", id: "client_id" },
  { table: "cashback_withdrawal_requests", label: "Запросы на снятие кэшбэка", id: "client_id", name: "client" },
  { table: "contract_clients", label: "Договоры", id: "client_id", name: "client_name" },
  { table: "contracts", label: "Договоры", name: "client" },
  { table: "client_balance_corrections", label: "Баланс клиентов", id: "client_id", deleted: "is_deleted" },
  { table: "cash_management_entries", label: "Управления кассой", id: "client_id", name: "client_name", deleted: "is_deleted" },
  { table: "inventory_items", label: "Работа с инвентарем", id: "client_id", name: "client", deleted: "deleted" },
  { table: "tasks", label: "Задачи", id: "client_id", name: "store" },
  { table: "field_visits", label: "Визиты", id: "client_id" },
  { table: "field_refusals", label: "Отказы", id: "client_id" },
  { table: "field_photo_reports", label: "Фото отчеты", id: "client_id" },
]

export async function clientUsage(db: PgDb, client: { id: number; name: string; balance: number | null }): Promise<ClientUsage[]> {
  const columns = await columnsOf(db, [...new Set(USAGE.map((ref) => ref.table))])
  const twins = (await db.prepare(`SELECT COUNT(*)::int AS n FROM clients WHERE ${keySql("name")} = ${keySql("@name::text")} AND id <> @id`).get({ name: client.name, id: client.id })) as { n: number }
  const byName = twins.n === 0
  const usage = new Map<string, ClientUsage>()
  for (const ref of USAGE) {
    const cols = columns.get(ref.table)
    if (!cols) continue
    const conditions: string[] = []
    const hasId = ref.id && cols.has(ref.id)
    if (hasId) conditions.push(`${quoteIdent(ref.id!)} = @id`)
    if (ref.name && cols.has(ref.name) && byName) {
      conditions.push(`(${hasId ? `${quoteIdent(ref.id!)} IS NULL AND ` : ""}${keySql(quoteIdent(ref.name))} = ${keySql("@name::text")})`)
    }
    if (ref.idList && cols.has(ref.idList)) conditions.push(`${quoteIdent(ref.idList)}::text ~ ('(^|[^0-9])' || @id::text || '([^0-9]|$)')`)
    if (!conditions.length) continue
    // Soft-deleted documents no longer reference anybody (they are not shown, counted or restored).
    const live = ref.deleted && cols.has(ref.deleted) ? ` AND COALESCE(${quoteIdent(ref.deleted)}, 0) = 0` : ""
    const row = (await db
      .prepare(`SELECT COUNT(*)::int AS n FROM ${quoteIdent(ref.table)} WHERE (${conditions.join(" OR ")})${live}`)
      .get({ id: client.id, name: client.name })) as { n: number }
    if (row.n > 0) {
      const current = usage.get(ref.label)
      usage.set(ref.label, { table: current?.table ?? ref.table, label: ref.label, count: (current?.count ?? 0) + row.n })
    }
  }
  if (client.balance !== null && Math.abs(client.balance) > 0.000001) {
    usage.set("Первоначальный баланс", { table: "clients", label: "Первоначальный баланс", count: 1 })
  }
  return [...usage.values()]
}

/** Refused (409 + usage) while documents reference the client or it has an opening balance. */
export async function deleteClient(id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return false
  await ensureClientsSchema()
  return withTransaction(async (tx) => {
    await lockClients(tx)
    const row = (await tx.prepare("SELECT id, name, balance FROM clients WHERE id = ? FOR UPDATE").get(id)) as { id: number; name: string; balance: number | null } | undefined
    if (!row) return false
    const usage = await clientUsage(tx, row)
    if (usage.length) throw new ClientError("Удаление невозможно из-за связи с другими данными", 409, { usage })
    // Route plans and the location lock are settings of the client, not documents: they go with it.
    // Both tables are created lazily, so they may not exist yet.
    const extras = (await tx
      .prepare("SELECT to_regclass('field_route_plans') IS NOT NULL AS plans, to_regclass('client_location_locks') IS NOT NULL AS locks")
      .get()) as { plans: boolean; locks: boolean }
    if (extras.plans) await tx.prepare("DELETE FROM field_route_plans WHERE client_id = ?").run(id)
    if (extras.locks) await tx.prepare("DELETE FROM client_location_locks WHERE client_id = ?").run(id)
    return (await tx.prepare("DELETE FROM clients WHERE id = ?").run(id)).changes > 0
  })
}
