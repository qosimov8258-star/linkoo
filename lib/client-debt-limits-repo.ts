import "server-only"

import { getDb, outsideTransaction, withTransaction } from "@/lib/db"

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

const SCHEMA_VERSION = 2

declare global {
  var __linkoClientDebtLimitsSchema: { version: number; ready: Promise<void> } | undefined
}

/** client_debt_limits, once per process and outside any request transaction (fresh-install safe). */
function ensureSchema(): Promise<void> {
  if (globalThis.__linkoClientDebtLimitsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:client_debt_limits:schema'))")
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS client_debt_limits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id INTEGER NOT NULL,
            organization_id INTEGER NOT NULL,
            organization TEXT NOT NULL DEFAULT '',
            amount DOUBLE PRECISION NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
        await tx.exec("CREATE INDEX IF NOT EXISTS client_debt_limits_client_idx ON client_debt_limits (client_id)")
      }),
    ).catch((error: unknown) => {
      globalThis.__linkoClientDebtLimitsSchema = undefined
      throw error
    })
    globalThis.__linkoClientDebtLimitsSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoClientDebtLimitsSchema!.ready
}

const rowToLimit = (row: Row): ClientDebtLimit => ({
  id: row.id,
  clientId: row.client_id,
  organizationId: row.organization_id,
  organization: row.organization,
  amount: Number(row.amount),
})

export async function listClientDebtLimits(clientId: number): Promise<ClientDebtLimit[]> {
  await ensureSchema()
  const db = getDb()
  const rows = (await db
    .prepare("SELECT id, client_id, organization_id, organization, amount FROM client_debt_limits WHERE client_id = ? ORDER BY id DESC")
    .all(clientId)) as Row[]
  return rows.map(rowToLimit)
}

export async function deleteClientDebtLimit(id: number): Promise<boolean> {
  await ensureSchema()
  return (await getDb().prepare("DELETE FROM client_debt_limits WHERE id = ?").run(id)).changes > 0
}

export type ClientDebtLimitInput = { clientId: number; organizationId: number; amount: number }

/** Adds a limit (one per client and organization): 404 when the client or organization does not exist, 409 when the
 * organization already has a limit for the client. The check and the insert run under a lock of the client, so two
 * parallel requests cannot both add one. */
export async function createClientDebtLimit(input: ClientDebtLimitInput): Promise<{ limit: ClientDebtLimit } | { error: string; status: number }> {
  await ensureSchema()
  return withTransaction(async (db) => {
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:client_debt_limits'), ?::int) AS ok").get(input.clientId)
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
  })
}

/**
 * Reference rule behind the "Тип лимита долга" list filter: a client with a zero limit may not go into debt
 * (`no_debt_*`), a client with a positive limit is limited (`debt_limit_*`), a client without limits has none
 * (`no_debt_limit`). «без/с учетом последнего заказа» is a per-client mode the reference only exposes through the filter;
 * nothing here sets it, so every limit counts «без учета последнего заказа» (the reference account's modes that the
 * removed demo scripts wrote into client_debt_limit_modes are not read).
 * Returns the types of every client that has limits; any other client is `no_debt_limit`.
 */
export async function getDebtLimitTypes(): Promise<Record<number, DebtLimitTypeId[]>> {
  await ensureSchema()
  const limits = (await getDb().prepare("SELECT client_id, amount FROM client_debt_limits").all()) as { client_id: number; amount: number }[]
  const kinds = new Map<number, { zero: boolean; positive: boolean }>()
  for (const row of limits) {
    const kind = kinds.get(row.client_id) ?? { zero: false, positive: false }
    if (Number(row.amount) > 0) kind.positive = true
    else kind.zero = true
    kinds.set(row.client_id, kind)
  }
  const result: Record<number, DebtLimitTypeId[]> = {}
  for (const [clientId, kind] of kinds) {
    const types: DebtLimitTypeId[] = []
    if (kind.zero) types.push("no_debt_no_order")
    if (kind.positive) types.push("debt_limit_no_order")
    result[clientId] = types
  }
  return result
}
