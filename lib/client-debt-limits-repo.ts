import "server-only"

import { getDb } from "@/lib/db"

/** One reference `market/debt_limit/` row: how much debt a client may carry for an organization. */
export type ClientDebtLimit = {
  id: number
  clientId: number
  organizationId: number
  organization: string
  amount: number
}

/** The reference "Тип лимита долга" filter values. */
export const DEBT_LIMIT_TYPE_IDS = [
  "no_debt_no_order",
  "no_debt_with_order",
  "debt_limit_no_order",
  "debt_limit_with_order",
  "no_debt_limit",
] as const
export type DebtLimitTypeId = (typeof DEBT_LIMIT_TYPE_IDS)[number]

type Row = { id: number; client_id: number; organization_id: number; organization: string; amount: number }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS client_debt_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      organization_id INTEGER NOT NULL,
      organization TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS client_debt_limit_modes (
      client_id INTEGER NOT NULL,
      with_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (client_id, with_order)
    );
  `)
}

const rowToLimit = (row: Row): ClientDebtLimit => ({
  id: row.id,
  clientId: row.client_id,
  organizationId: row.organization_id,
  organization: row.organization,
  amount: Number(row.amount),
})

export async function listClientDebtLimits(clientId: number): Promise<ClientDebtLimit[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db
    .prepare("SELECT id, client_id, organization_id, organization, amount FROM client_debt_limits WHERE client_id = ? ORDER BY id DESC")
    .all(clientId)) as Row[]
  return rows.map(rowToLimit)
}

export async function deleteClientDebtLimit(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM client_debt_limits WHERE id = ?").run(id)).changes > 0
}

export type ClientDebtLimitInput = { clientId: number; organizationId: number; amount: number }

/** Adds a limit (one per client and organization). Returns null when the client or organization does not exist. */
export async function createClientDebtLimit(input: ClientDebtLimitInput): Promise<{ limit: ClientDebtLimit } | { error: string; status: number }> {
  const db = getDb()
  await ensureSchema(db)
  const client = await db.prepare("SELECT id FROM clients WHERE id = ?").get(input.clientId)
  if (!client) return { error: "Клиент не найден", status: 404 }
  const organization = (await db.prepare("SELECT id, name FROM organizations WHERE id = ?").get(input.organizationId)) as { id: number; name: string } | undefined
  if (!organization) return { error: "Организация не найдена", status: 404 }
  const existing = await db
    .prepare("SELECT id FROM client_debt_limits WHERE client_id = ? AND organization_id = ?")
    .get(input.clientId, input.organizationId)
  if (existing) return { error: "Лимит для этой организации уже установлен", status: 409 }
  const result = await db
    .prepare("INSERT INTO client_debt_limits (client_id, organization_id, organization, amount) VALUES (?, ?, ?, ?)")
    .run(input.clientId, organization.id, organization.name, input.amount)
  const row = (await db
    .prepare("SELECT id, client_id, organization_id, organization, amount FROM client_debt_limits WHERE id = ?")
    .get(Number(result.lastInsertRowid))) as Row
  return { limit: rowToLimit(row) }
}

/**
 * Reference rule behind the "Тип лимита долга" list filter: a client with a zero limit may not go into debt
 * (`no_debt_*`), a client with a positive limit is limited (`debt_limit_*`), a client without limits has none
 * (`no_debt_limit`). «без/с учетом последнего заказа» is a per-client mode the reference only exposes through the filter.
 * Returns the types of every client that has limits; any other client is `no_debt_limit`.
 */
export async function getDebtLimitTypes(): Promise<Record<number, DebtLimitTypeId[]>> {
  const db = getDb()
  await ensureSchema(db)
  const limits = (await db.prepare("SELECT client_id, amount FROM client_debt_limits").all()) as { client_id: number; amount: number }[]
  const modeRows = (await db.prepare("SELECT client_id, with_order FROM client_debt_limit_modes").all()) as { client_id: number; with_order: number }[]
  const modes = new Map<number, Set<number>>()
  for (const row of modeRows) {
    const set = modes.get(row.client_id) ?? new Set<number>()
    set.add(Number(row.with_order) ? 1 : 0)
    modes.set(row.client_id, set)
  }
  const kinds = new Map<number, { zero: boolean; positive: boolean }>()
  for (const row of limits) {
    const kind = kinds.get(row.client_id) ?? { zero: false, positive: false }
    if (Number(row.amount) > 0) kind.positive = true
    else kind.zero = true
    kinds.set(row.client_id, kind)
  }
  const result: Record<number, DebtLimitTypeId[]> = {}
  for (const [clientId, kind] of kinds) {
    const orderModes = modes.get(clientId) ?? new Set([0])
    const types: DebtLimitTypeId[] = []
    for (const withOrder of [0, 1]) {
      if (!orderModes.has(withOrder)) continue
      const suffix = withOrder ? "with_order" : "no_order"
      if (kind.zero) types.push(`no_debt_${suffix}` as DebtLimitTypeId)
      if (kind.positive) types.push(`debt_limit_${suffix}` as DebtLimitTypeId)
    }
    result[clientId] = types
  }
  return result
}
