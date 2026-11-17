import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"

// Клиенты → the shop's card → «Агенты магазина» (Linko's market users: market/market/{id}/ extra_message.market_users,
// saved by «Изменение агентов» → set_market_user): the agents a shop is given, each with a comment and the price lists
// they sell to it by. One row per agent; saving replaces the shop's whole list, like Linko's dialog. Rows copied from
// Linko carry its record id (linko_id, scripts/linko-sync/import-market-users.mjs).

export type ClientAgentPriceList = { id: number; name: string }
export type ClientAgent = { employeeId: number; name: string; description: string; priceLists: ClientAgentPriceList[] }
export type ClientAgentInput = { employeeId: number; description: string; priceListIds: number[] }
export type ClientAgentOptions = {
  /** The active employees (Linko's user search of the dialog). */
  agents: Array<{ id: number; name: string }>
  priceLists: ClientAgentPriceList[]
}

export class ClientAgentsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export const CLIENT_MARKET_USERS_DDL = `CREATE TABLE IF NOT EXISTS client_market_users (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_list_ids TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  linko_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, employee_id)
)`

declare global {
  var __linkoClientMarketUsersSchema: Promise<void> | undefined
}

function ensureSchema(): Promise<void> {
  globalThis.__linkoClientMarketUsersSchema ??= outsideTransaction(() =>
    withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:client_market_users'))")
      await tx.exec(CLIENT_MARKET_USERS_DDL)
    }),
  ).catch((error: unknown) => {
    globalThis.__linkoClientMarketUsersSchema = undefined
    throw error
  })
  return globalThis.__linkoClientMarketUsersSchema
}

function idList(value: string | null | undefined): number[] {
  try {
    const list = JSON.parse(value || "[]") as unknown
    return Array.isArray(list) ? list.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : []
  } catch {
    return []
  }
}

async function priceListNames(db: PgDb): Promise<Map<number, string>> {
  const exists = (await db.prepare("SELECT to_regclass('public.price_lists') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!exists?.ok) return new Map()
  const rows = (await db.prepare("SELECT id, name FROM price_lists ORDER BY id").all()) as Array<{ id: number; name: string }>
  return new Map(rows.map((row) => [Number(row.id), row.name ?? ""]))
}

/** The shop's agents in Linko's order (the latest added first), with their price lists' names. */
export async function listClientAgents(clientId: number): Promise<ClientAgent[]> {
  await ensureSchema()
  const db = getDb()
  const [rows, names] = await Promise.all([
    db
      .prepare(
        `SELECT m.employee_id, m.description, m.price_list_ids,
                btrim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS name
           FROM client_market_users m LEFT JOIN employees e ON e.id = m.employee_id
          WHERE m.client_id = ? ORDER BY m.position, m.id`,
      )
      .all(clientId) as Promise<Array<{ employee_id: number; description: string; price_list_ids: string; name: string | null }>>,
    priceListNames(db),
  ])
  return rows.map((row) => ({
    employeeId: Number(row.employee_id),
    name: row.name || `№${row.employee_id}`,
    description: row.description ?? "",
    priceLists: idList(row.price_list_ids)
      .filter((id) => names.has(id))
      .map((id) => ({ id, name: names.get(id)! })),
  }))
}

/** What «Изменение агентов» offers: the active employees and the price lists. */
export async function clientAgentOptions(): Promise<ClientAgentOptions> {
  const db = getDb()
  const [agents, names] = await Promise.all([
    db
      .prepare(
        `SELECT id, btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name
           FROM employees WHERE COALESCE(active, 1) = 1 ORDER BY id DESC`,
      )
      .all() as Promise<Array<{ id: number; name: string }>>,
    priceListNames(db),
  ])
  return {
    agents: agents.filter((row) => row.name).map((row) => ({ id: Number(row.id), name: row.name })),
    priceLists: [...names].map(([id, name]) => ({ id, name })),
  }
}

/** «Сохранить» of «Изменение агентов»: the shop's list becomes `items` (in their order). An agent listed twice keeps
 * its first entry, as Linko's dialog keeps one row per agent. */
export async function setClientAgents(clientId: number, items: ClientAgentInput[]): Promise<ClientAgent[]> {
  await ensureSchema()
  await withTransaction(async (db) => {
    if (!(await db.prepare("SELECT id FROM clients WHERE id = ? FOR SHARE").get(clientId))) throw new ClientAgentsError("Клиент не найден", 404)
    const seen = new Set<number>()
    const unique = items.filter((item) => !seen.has(item.employeeId) && seen.add(item.employeeId))
    if (unique.length) {
      const known = new Set(
        ((await db.prepare("SELECT id FROM employees WHERE id = ANY(?::int[])").all(unique.map((item) => item.employeeId))) as Array<{ id: number }>).map((row) => Number(row.id)),
      )
      if (unique.some((item) => !known.has(item.employeeId))) throw new ClientAgentsError("Сотрудник не найден")
      const lists = await priceListNames(db)
      if (unique.some((item) => item.priceListIds.some((id) => !lists.has(id)))) throw new ClientAgentsError("Прайс лист не найден")
    }
    await db.prepare("DELETE FROM client_market_users WHERE client_id = ?").run(clientId)
    for (const [position, item] of unique.entries()) {
      await db
        .prepare("INSERT INTO client_market_users (client_id, employee_id, description, price_list_ids, position) VALUES (?, ?, ?, ?, ?)")
        .run(clientId, item.employeeId, item.description.trim(), JSON.stringify([...new Set(item.priceListIds)]), position)
    }
  })
  return listClientAgents(clientId)
}
