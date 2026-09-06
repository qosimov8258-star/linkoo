import "server-only"

import { getDb } from "@/lib/db"
import type { Client } from "@/components/clients/clients-data"

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
  tab: Client["tab"]
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
  }
}

export async function listClients(search?: string): Promise<Client[]> {
  const db = getDb()
  const rows = search
    ? ((await db
              .prepare("SELECT * FROM clients WHERE name LIKE ? OR phone LIKE ? ORDER BY id DESC")
              .all(`%${search}%`, `%${search}%`)) as ClientRow[])
    : ((await db.prepare("SELECT * FROM clients ORDER BY id DESC").all()) as ClientRow[])
  return rows.map(rowToClient)
}

export async function getClient(id: number): Promise<Client | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM clients WHERE id = ?").get(id)) as ClientRow | undefined
  return row ? rowToClient(row) : null
}

export async function createClient(input: ClientInput): Promise<Client> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO clients (name, phone, inn, type, zone, zone_agent, agent, deliverer, collector, balance, tab, updated_at)
       VALUES (@name, @phone, @inn, @type, @zone, @zoneAgent, @agent, @deliverer, @collector, @balance, @tab, datetime('now'))`,
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
      }))
  return (await getClient(Number(result.lastInsertRowid)))!
}

export async function updateClient(id: number, input: ClientInput): Promise<Client | null> {
  const db = getDb()
  const existing = (await getClient(id))
  if (!existing) return null

  await db.prepare(
        `UPDATE clients SET name = @name, phone = @phone, inn = @inn, type = @type, zone = @zone,
       zone_agent = @zoneAgent, agent = @agent, deliverer = @deliverer, collector = @collector,
       balance = @balance, tab = @tab, updated_at = datetime('now')
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
      })
  return (await getClient(id))
}

export async function deleteClient(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM clients WHERE id = ?").run(id))
  return result.changes > 0
}
