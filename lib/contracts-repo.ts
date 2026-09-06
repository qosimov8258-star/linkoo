import "server-only"

import { getDb } from "@/lib/db"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
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
  `)
}

export type Contract = {
  id: string
  createdAt: string
  client: string
  zone: string
  agent: string
  inn: string
  status: "active" | "completed" | "cancelled"
  officialName: string
  year: number
  organization: string
  comment: string
}

type Row = {
  id: number
  client: string
  agent: string
  zone: string
  inn: string
  organization: string
  comment: string
  official_name: string
  status: string
  year: number
  created_at: string
}

function formatCreatedAt(raw: string): string {
  const date = new Date(`${raw.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(date)
}

function rowToContract(row: Row): Contract {
  const status = row.status === "completed" || row.status === "cancelled" ? row.status : "active"
  return {
    id: String(row.id),
    createdAt: formatCreatedAt(row.created_at),
    client: row.client,
    zone: row.zone,
    agent: row.agent,
    inn: row.inn,
    status,
    officialName: row.official_name,
    year: row.year,
    organization: row.organization,
    comment: row.comment,
  }
}

export type ContractInput = {
  client: string
  agent: string
  zone: string
  inn: string
  organization: string
  comment: string
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback
}

export function parseContractInput(body: unknown): ContractInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  return {
    client: str(value.client) || "Не указан",
    agent: str(value.agent) || "Admin Ritm",
    zone: str(value.zone) || "Не указан",
    inn: str(value.inn) || "0",
    organization: str(value.organization) || "Не указано",
    comment: str(value.comment) || "Не указано",
  }
}

export type ContractUpdateInput = Partial<{
  officialName: string
  client: string
  agent: string
  zone: string
  inn: string
  organization: string
  comment: string
  status: string
}>

export function parseContractUpdateInput(body: unknown): ContractUpdateInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const out: ContractUpdateInput = {}
  if (typeof value.officialName === "string") out.officialName = value.officialName.trim()
  if (typeof value.client === "string") out.client = value.client.trim()
  if (typeof value.agent === "string") out.agent = value.agent.trim()
  if (typeof value.zone === "string") out.zone = value.zone.trim()
  if (typeof value.inn === "string") out.inn = value.inn.trim()
  if (typeof value.organization === "string") out.organization = value.organization.trim()
  if (typeof value.comment === "string") out.comment = value.comment.trim()
  if (typeof value.status === "string") out.status = value.status.trim()
  if (Object.keys(out).length === 0) return null
  return out
}

export async function listContracts(): Promise<Contract[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM contracts ORDER BY id DESC").all()) as Row[]).map(rowToContract)
}

export async function getContract(id: number): Promise<Contract | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM contracts WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToContract(row) : null
}

export async function createContract(input: ContractInput): Promise<Contract> {
  const db = getDb()
  await ensureSchema(db)
  const year = new Date().getFullYear()
  const result = (await db
      .prepare(
        `INSERT INTO contracts (client, agent, zone, inn, organization, comment, official_name, status, year)
       VALUES (@client, @agent, @zone, @inn, @organization, @comment, @officialName, 'active', @year)`,
      )
      .run({
        client: input.client,
        agent: input.agent,
        zone: input.zone,
        inn: input.inn,
        organization: input.organization,
        comment: input.comment,
        officialName: input.client,
        year,
      }))
  return (await getContract(Number(result.lastInsertRowid)))!
}

export async function updateContract(id: number, patch: ContractUpdateInput): Promise<Contract | null> {
  const db = getDb()
  await ensureSchema(db)
  const existing = (await getContract(id))
  if (!existing) return null
  const merged = {
    officialName: patch.officialName ?? existing.officialName,
    client: patch.client ?? existing.client,
    agent: patch.agent ?? existing.agent,
    zone: patch.zone ?? existing.zone,
    inn: patch.inn ?? existing.inn,
    organization: patch.organization ?? existing.organization,
    comment: patch.comment ?? existing.comment,
    status: patch.status ?? existing.status,
  }
  await db.prepare(
        `UPDATE contracts SET official_name = @officialName, client = @client, agent = @agent, zone = @zone, inn = @inn,
      organization = @organization, comment = @comment, status = @status, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({ ...merged, id })
  return (await getContract(id))
}

export async function deleteContract(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM contracts WHERE id = ?").run(id)).changes > 0
}
