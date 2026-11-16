import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { ensureClientZones } from "@/lib/client-zones-repo"

// Территория → «Управлять территориями»: Linko's «Привязать агента / Отвязать агента / Привязать филиал» on the
// checked zones, the «Ответственный персонал» filter and «агентов не распределено» (market/border, bulk bind).
// A zone's agents are the employees responsible for it (client_zone_agents); a zone's branch is client_zones.branch.

export type ZoneAgent = { id: number; name: string }
export type ZoneAgentsState = {
  /** The employees a zone can be given: the active ones whose access right carries «Агент» (all active without it). */
  agents: ZoneAgent[]
  /** zone id → its agents' ids. */
  bindings: Record<number, number[]>
  /** Agents without any zone (Linko's passive_agents). */
  unbound: number
}

export class ZoneAgentsError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

declare global {
  var __linkoZoneAgentsSchema: Promise<void> | undefined
}

function ensureZoneAgentsSchema(): Promise<void> {
  globalThis.__linkoZoneAgentsSchema ??= outsideTransaction(() =>
    withTransaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:client_zone_agents'))")
      await tx.exec(`CREATE TABLE IF NOT EXISTS client_zone_agents (
        zone_id INTEGER NOT NULL REFERENCES client_zones(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (zone_id, employee_id)
      )`)
    }),
  ).catch((error: unknown) => {
    globalThis.__linkoZoneAgentsSchema = undefined
    throw error
  })
  return globalThis.__linkoZoneAgentsSchema
}

/** Active employees whose access right carries the «Агент» capability; every active employee when no right does. */
async function listAgents(db: PgDb): Promise<ZoneAgent[]> {
  const employees = (await db
    .prepare(
      `SELECT e.id, btrim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS name,
              COALESCE(e.access_right_id, (SELECT u.access_right_id FROM users u WHERE u.employee_id = e.id ORDER BY u.id LIMIT 1)) AS right_id
         FROM employees e WHERE e.active = 1 ORDER BY e.id`,
    )
    .all()) as { id: number; name: string; right_id: number | null }[]
  const tables = (await db.prepare("SELECT to_regclass('public.capabilities') IS NOT NULL AND to_regclass('public.access_rights') IS NOT NULL AS ok").get()) as { ok: boolean }
  let agentRights: Set<number> | null = null
  if (tables.ok) {
    const capabilities = (await db.prepare("SELECT id FROM capabilities WHERE lower(btrim(name)) = 'агент'").all()) as { id: number }[]
    if (capabilities.length) {
      const wanted = new Set(capabilities.map((row) => Number(row.id)))
      const rights = (await db.prepare("SELECT id, capability_ids FROM access_rights").all()) as { id: number; capability_ids: string | null }[]
      agentRights = new Set(
        rights
          .filter((right) => {
            try {
              const list = JSON.parse(right.capability_ids || "[]") as unknown
              return Array.isArray(list) && list.some((id) => wanted.has(Number(id)))
            } catch {
              return false
            }
          })
          .map((right) => Number(right.id)),
      )
    }
  }
  return employees
    .filter((row) => row.name && (!agentRights || (row.right_id !== null && agentRights.has(Number(row.right_id)))))
    .map((row) => ({ id: Number(row.id), name: row.name }))
}

export async function getZoneAgentsState(): Promise<ZoneAgentsState> {
  await ensureClientZones()
  await ensureZoneAgentsSchema()
  const db = getDb()
  const agents = await listAgents(db)
  const rows = (await db.prepare("SELECT zone_id, employee_id FROM client_zone_agents ORDER BY zone_id, employee_id").all()) as { zone_id: number; employee_id: number }[]
  const bindings: Record<number, number[]> = {}
  for (const row of rows) (bindings[Number(row.zone_id)] ??= []).push(Number(row.employee_id))
  const bound = new Set(rows.map((row) => Number(row.employee_id)))
  return { agents, bindings, unbound: agents.filter((agent) => !bound.has(agent.id)).length }
}

async function checkZones(db: PgDb, zoneIds: number[]) {
  const found = (await db.prepare("SELECT id FROM client_zones WHERE id = ANY(?::int[])").all(zoneIds)) as { id: number }[]
  if (found.length !== new Set(zoneIds).size) throw new ZoneAgentsError("Зона не найдена", 404)
}

/** «Привязать агента» / «Отвязать агента» on the checked zones. */
export async function setZoneAgent(action: "bind" | "unbind", zoneIds: number[], employeeId: number): Promise<ZoneAgentsState> {
  await ensureClientZones()
  await ensureZoneAgentsSchema()
  await withTransaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:client_zone_agents'))")
    await checkZones(tx, zoneIds)
    const employee = (await tx.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(employeeId)) as { id: number } | undefined
    if (!employee) throw new ZoneAgentsError("Сотрудник не найден", 404)
    if (action === "bind") {
      await tx
        .prepare("INSERT INTO client_zone_agents (zone_id, employee_id) SELECT unnest(?::int[]), ? ON CONFLICT DO NOTHING RETURNING zone_id")
        .run(zoneIds, employeeId)
    } else {
      await tx.prepare("DELETE FROM client_zone_agents WHERE zone_id = ANY(?::int[]) AND employee_id = ?").run(zoneIds, employeeId)
    }
  })
  return getZoneAgentsState()
}

/** «Привязать филиал»: the checked zones get this branch (a name from Филиалы). */
export async function setZonesBranch(zoneIds: number[], branch: string): Promise<void> {
  await ensureClientZones()
  await withTransaction(async (tx) => {
    await checkZones(tx, zoneIds)
    const row = (await tx.prepare("SELECT name FROM branches WHERE lower(btrim(name)) = lower(btrim(?)) ORDER BY id LIMIT 1").get(branch)) as { name: string } | undefined
    if (!row) throw new ZoneAgentsError("Филиал не найден", 404)
    await tx.prepare("UPDATE client_zones SET branch = ?, updated_at = datetime('now') WHERE id = ANY(?::int[])").run(row.name, zoneIds)
  })
}
