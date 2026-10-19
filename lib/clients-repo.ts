import "server-only"

import { getDb } from "@/lib/db"
import type { Client } from "@/components/clients/clients-data"

// Additive columns for the full "Добавить клиента" form (branch, address &
// map location, contact details, and per-client settings) so a database
// created before that form existed still works — ADD COLUMN IF NOT EXISTS is
// a no-op once the column is already there.
async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS sales_channel TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS realization_by TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS landmark TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS location_lat REAL;`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS location_lng REAL;`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS telegram_location_link TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_person TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_delivery INTEGER NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS unlimited_debt INTEGER NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS attributes TEXT NOT NULL DEFAULT '{}';`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS in_route INTEGER NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_problem INTEGER NOT NULL DEFAULT 0;`)
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

export type ClientInput = Omit<Client, "id">

const allowedTabs = new Set(["unconfirmed", "problem", "plan", "closing", "all"])

export function parseClientInput(body: unknown): ClientInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>

  const name = typeof value.name === "string" ? value.name.trim() : ""
  const phone = typeof value.phone === "string" ? value.phone.trim() : ""
  const type = typeof value.type === "string" ? value.type.trim() : ""
  const zone = typeof value.zone === "string" ? value.zone.trim() : ""
  if (!name || !phone || !type || !zone) return null

  const tab = typeof value.tab === "string" && allowedTabs.has(value.tab) ? (value.tab as ClientInput["tab"]) : "all"
  const balance = typeof value.balance === "number" && Number.isFinite(value.balance) ? value.balance : undefined
  const locationLat = typeof value.locationLat === "number" && Number.isFinite(value.locationLat) ? value.locationLat : undefined
  const locationLng = typeof value.locationLng === "number" && Number.isFinite(value.locationLng) ? value.locationLng : undefined

  return {
    name,
    phone,
    type,
    zone,
    inn: typeof value.inn === "string" && value.inn.trim() ? value.inn.trim() : undefined,
    zoneAgent: typeof value.zoneAgent === "string" && value.zoneAgent.trim() ? value.zoneAgent.trim() : "Не указано",
    agent: typeof value.agent === "string" && value.agent.trim() ? value.agent.trim() : "Не указано",
    deliverer: typeof value.deliverer === "string" && value.deliverer.trim() ? value.deliverer.trim() : "Не указано",
    collector: typeof value.collector === "string" && value.collector.trim() ? value.collector.trim() : "Не указано",
    balance,
    tab,
    branch: typeof value.branch === "string" ? value.branch.trim() || undefined : undefined,
    salesChannel: typeof value.salesChannel === "string" ? value.salesChannel.trim() || undefined : undefined,
    realizationBy: typeof value.realizationBy === "string" ? value.realizationBy.trim() || undefined : undefined,
    address: typeof value.address === "string" ? value.address.trim() || undefined : undefined,
    landmark: typeof value.landmark === "string" ? value.landmark.trim() || undefined : undefined,
    locationLat,
    locationLng,
    telegramLocationLink: typeof value.telegramLocationLink === "string" ? value.telegramLocationLink.trim() || undefined : undefined,
    code: typeof value.code === "string" ? value.code.trim() || undefined : undefined,
    contactPerson: typeof value.contactPerson === "string" ? value.contactPerson.trim() || undefined : undefined,
    note: typeof value.note === "string" ? value.note.trim() || undefined : undefined,
    autoDelivery: typeof value.autoDelivery === "boolean" ? value.autoDelivery : undefined,
    unlimitedDebt: typeof value.unlimitedDebt === "boolean" ? value.unlimitedDebt : undefined,
    attributes:
      value.attributes && typeof value.attributes === "object" && !Array.isArray(value.attributes)
        ? (Object.fromEntries(Object.entries(value.attributes as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>)
        : undefined,
  }
}

export async function listClients(search?: string): Promise<Client[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = search
    ? ((await db
              .prepare("SELECT * FROM clients WHERE name LIKE ? OR phone LIKE ? ORDER BY id DESC")
              .all(`%${search}%`, `%${search}%`)) as ClientRow[])
    : ((await db.prepare("SELECT * FROM clients ORDER BY id DESC").all()) as ClientRow[])
  return rows.map(rowToClient)
}

export async function getClient(id: number): Promise<Client | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM clients WHERE id = ?").get(id)) as ClientRow | undefined
  return row ? rowToClient(row) : null
}

export async function createClient(input: ClientInput): Promise<Client> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO clients (
           name, phone, inn, type, zone, zone_agent, agent, deliverer, collector, balance, tab,
           branch, sales_channel, realization_by, address, landmark, location_lat, location_lng,
           telegram_location_link, code, contact_person, note, auto_delivery, unlimited_debt, attributes, updated_at
         )
       VALUES (
           @name, @phone, @inn, @type, @zone, @zoneAgent, @agent, @deliverer, @collector, @balance, @tab,
           @branch, @salesChannel, @realizationBy, @address, @landmark, @locationLat, @locationLng,
           @telegramLocationLink, @code, @contactPerson, @note, @autoDelivery, @unlimitedDebt, @attributes, datetime('now')
         )`,
      )
      .run({
        name: input.name,
        phone: input.phone,
        inn: input.inn ?? null,
        type: input.type,
        zone: input.zone,
        zoneAgent: input.zoneAgent,
        agent: input.agent,
        deliverer: input.deliverer,
        collector: input.collector,
        balance: input.balance ?? null,
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
      }))
  return (await getClient(Number(result.lastInsertRowid)))!
}

export async function updateClient(id: number, input: ClientInput): Promise<Client | null> {
  const db = getDb()
  await ensureSchema(db)
  const existing = (await getClient(id))
  if (!existing) return null

  await db.prepare(
        `UPDATE clients SET name = @name, phone = @phone, inn = @inn, type = @type, zone = @zone,
       zone_agent = @zoneAgent, agent = @agent, deliverer = @deliverer, collector = @collector,
       balance = @balance, tab = @tab,
       branch = @branch, sales_channel = @salesChannel, realization_by = @realizationBy,
       address = @address, landmark = @landmark, location_lat = @locationLat, location_lng = @locationLng,
       telegram_location_link = @telegramLocationLink, code = @code, contact_person = @contactPerson,
       note = @note, auto_delivery = @autoDelivery, unlimited_debt = @unlimitedDebt, attributes = @attributes,
       updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        name: input.name,
        phone: input.phone,
        inn: input.inn ?? null,
        type: input.type,
        zone: input.zone,
        zoneAgent: input.zoneAgent,
        agent: input.agent,
        deliverer: input.deliverer,
        collector: input.collector,
        balance: input.balance ?? null,
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
      })
  return (await getClient(id))
}

export async function deleteClient(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db.prepare("DELETE FROM clients WHERE id = ?").run(id))
  return result.changes > 0
}
