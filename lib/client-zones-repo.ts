import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { isUniqueViolation } from "@/lib/auth-request"
import { cascadeNameRename, existingReferences, keySql, nameKey, usageOf, type Usage } from "@/lib/platform-refs"

// Client zones (Клиенты → "Зона" of the client card, Территория). The table
// is created by the lib/db.ts bootstrap (client_zones). Clients keep the zone
// NAME (clients.zone), matched case / spacing-insensitively:
// - zones that clients already carry are added to the directory once per
//   process (older databases, Excel imports), and creating a client with a
//   new zone adds it (lib/clients-repo.ts → resolveClientZone); a client
//   UPDATE accepts only its own zone or a directory zone, so a form opened
//   before a rename cannot bring the old name back;
// - names are unique (409); a rename follows to clients, orders and contracts
//   in the same transaction; a zone still used is not deleted (409 + usage,
//   contract 7); child zones of a deleted zone lose their parent;
// - polygon is the outline drawn on Территория ([[lat, lng], …], ≥ 3 points);
//   "reassignClients" gives the zone to every client whose location lies inside.

export type LatLng = [number, number]

export type ClientZone = {
  id: number
  name: string
  branch: string
  parentId: number | null
  parent: string
  /** Outline drawn on Территория, null when none was drawn. */
  polygon: LatLng[] | null
  /** Clients in the zone, and how many of them have a location. */
  clients: number
  located: number
  createdBy: string
  createdAt: string
}

export type ClientZoneInput = {
  name: string
  /** Omitted on update = keep. */
  branch?: string
  parentId?: number | null
  /** null / [] clears the outline; omitted on update = keep. */
  polygon?: LatLng[] | null
  /** Give this zone to the clients located inside the outline. */
  reassignClients?: boolean
}

export type ClientZoneSaved = { zone: ClientZone; reassigned: number }

export class ClientZoneError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

type Row = {
  id: number
  name: string
  branch: string
  parent_id: number | null
  parent_name: string | null
  polygon: string
  created_by: string
  created_at: string
}

const NOT_SET = ["", "не указано", "не указан", "—", "-"]

/** "Не указано" / empty: no zone (never a directory entry). */
export function zoneIsUnset(name: string): boolean {
  return NOT_SET.includes(nameKey(name))
}

// Records that store the zone NAME.
const REFERENCES = [
  { table: "clients", column: "zone", kind: "name" as const },
  { table: "orders", column: "zone", kind: "name" as const },
  { table: "contracts", column: "zone", kind: "name" as const },
]

const MAX_ID = 2_147_483_647
const validId = (id: number) => Number.isSafeInteger(id) && id > 0 && id <= MAX_ID

/** Same advisory lock as lib/clients-repo.ts lockClients: always taken before the zones lock. */
async function lockClients(db: PgDb) {
  await db.exec("SELECT pg_advisory_xact_lock(72120936)")
}

/** Serialises the name checks of zone writes (the unique index backs it up). */
async function lockZones(db: PgDb) {
  await db.exec("SELECT pg_advisory_xact_lock(72120938)")
}

// ---------------------------------------------------------------------------
// Directory ← clients
// ---------------------------------------------------------------------------

/** Adds the zones clients carry but the directory lacks (one row per name key,
 * spelled as the lowest client id has it). Only inserts; idempotent. */
async function syncZonesFromClients(db: PgDb): Promise<void> {
  await db
    .prepare(
      `INSERT INTO client_zones (name)
       SELECT DISTINCT ON (k.key) k.name
         FROM (SELECT ${keySql("zone")} AS key, btrim(zone) AS name, id FROM clients) k
        WHERE k.key <> ALL(@unset::text[])
          AND NOT EXISTS (SELECT 1 FROM client_zones z WHERE ${keySql("z.name")} = k.key)
        ORDER BY k.key, k.id
       ON CONFLICT DO NOTHING`,
    )
    .run({ unset: NOT_SET })
}

const SYNC_VERSION = 1

declare global {
  var __linkoClientZonesSync: { version: number; ready: Promise<void> } | undefined
}

/** The directory holds every zone used by clients (checked once per process). */
export function ensureClientZones(): Promise<void> {
  if (globalThis.__linkoClientZonesSync?.version !== SYNC_VERSION) {
    const ready = outsideTransaction(() => withTransaction(async (tx) => {
      await lockClients(tx)
      await lockZones(tx)
      await syncZonesFromClients(tx)
    })).catch((error) => {
      globalThis.__linkoClientZonesSync = undefined
      throw error
    })
    globalThis.__linkoClientZonesSync = { version: SYNC_VERSION, ready }
  }
  return globalThis.__linkoClientZonesSync!.ready
}

/**
 * The zone a client is saved with: the directory spelling of `name`. A zone the
 * directory does not have yet is added when `create` is true, otherwise the
 * result is null (the caller refuses it). "Не указано" / empty / "—" → "Не указано".
 * Call it inside the client's transaction after lockClients (and after
 * ensureClientZones, outside that transaction).
 */
export async function resolveClientZone(db: PgDb, name: string, createdBy = "", create = true): Promise<string | null> {
  if (zoneIsUnset(name)) return "Не указано"
  const find = async () =>
    (await db.prepare(`SELECT name FROM client_zones WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY id LIMIT 1`).get({ name })) as
      | { name: string }
      | undefined
  const found = await find()
  if (found) return found.name
  if (!create) return null
  await lockZones(db)
  const again = await find()
  if (again) return again.name
  const trimmed = name.trim()
  await db.prepare("INSERT INTO client_zones (name, created_by) VALUES (@name, @createdBy)").run({ name: trimmed, createdBy })
  return trimmed
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function parsePolygon(raw: string | null | undefined): LatLng[] | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return null
    const ring = value.filter(
      (point): point is LatLng =>
        Array.isArray(point) && point.length === 2 && point.every((part) => typeof part === "number" && Number.isFinite(part)),
    )
    return ring.length >= 3 ? ring : null
  } catch {
    return null
  }
}

async function readZones(db: PgDb, id?: number): Promise<ClientZone[]> {
  const select = `SELECT z.id, z.name, z.branch, z.parent_id, p.name AS parent_name, z.polygon, z.created_by, z.created_at
                    FROM client_zones z LEFT JOIN client_zones p ON p.id = z.parent_id`
  const rows = (
    id
      ? await db.prepare(`${select} WHERE z.id = @id`).all({ id })
      : await db.prepare(`${select} ORDER BY lower(z.name), z.id`).all()
  ) as Row[]
  if (!rows.length) return []
  const counts = (await db
    .prepare(
      `SELECT ${keySql("zone")} AS key, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL)::int AS located
         FROM clients GROUP BY 1`,
    )
    .all()) as Array<{ key: string; n: number; located: number }>
  const byKey = new Map(counts.map((row) => [row.key, row]))
  // Twins by key (older data) share the clients: count them on the first one only.
  const counted = new Set<string>()
  return rows.map((row) => {
    const key = nameKey(row.name)
    const count = counted.has(key) ? undefined : byKey.get(key)
    counted.add(key)
    return {
      id: row.id,
      name: row.name,
      branch: row.branch,
      parentId: row.parent_id,
      parent: row.parent_name ?? "",
      polygon: parsePolygon(row.polygon),
      clients: Number(count?.n ?? 0),
      located: Number(count?.located ?? 0),
      createdBy: row.created_by,
      createdAt: row.created_at,
    }
  })
}

export async function listClientZones(): Promise<ClientZone[]> {
  await ensureClientZones()
  return readZones(getDb())
}

export async function getClientZone(id: number): Promise<ClientZone | null> {
  if (!validId(id)) return null
  await ensureClientZones()
  return (await readZones(getDb(), id))[0] ?? null
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

async function assertNameFree(db: PgDb, name: string, exceptId: number) {
  if (zoneIsUnset(name)) throw new ClientZoneError("Укажите название зоны", 400, { field: "name" })
  const twin = await db.prepare(`SELECT id FROM client_zones WHERE ${keySql("name")} = ${keySql("@name::text")} AND id <> @id`).get({ name, id: exceptId })
  if (twin) throw new ClientZoneError("Такая зона уже существует", 409, { field: "name" })
}

/** The branch as the Филиалы directory spells it ('' = none). */
async function branchName(db: PgDb, name: string): Promise<string> {
  if (zoneIsUnset(name)) return ""
  const table = (await db.prepare("SELECT to_regclass('branches') IS NOT NULL AS ok").get()) as { ok: boolean }
  const row = table.ok
    ? ((await db.prepare(`SELECT name FROM branches WHERE ${keySql("name")} = ${keySql("@name::text")} ORDER BY id LIMIT 1`).get({ name })) as { name: string } | undefined)
    : undefined
  if (!row) throw new ClientZoneError("Филиал не найден", 400, { field: "branch" })
  return row.name
}

/** The parent must exist and must not be the zone itself or one of its sub-zones. */
async function checkParent(db: PgDb, parentId: number | null, selfId: number): Promise<number | null> {
  if (parentId === null) return null
  if (!validId(parentId)) throw new ClientZoneError("Родительская зона не найдена", 400, { field: "parentId" })
  if (parentId === selfId) throw new ClientZoneError("Зона не может быть родительской для самой себя", 400, { field: "parentId" })
  const exists = await db.prepare("SELECT 1 AS ok FROM client_zones WHERE id = ?").get(parentId)
  if (!exists) throw new ClientZoneError("Родительская зона не найдена", 400, { field: "parentId" })
  if (selfId > 0) {
    const cycle = (await db
      .prepare(
        `WITH RECURSIVE up(id, parent_id, depth) AS (
           SELECT id, parent_id, 0 FROM client_zones WHERE id = @parent
           UNION ALL
           SELECT z.id, z.parent_id, up.depth + 1 FROM client_zones z JOIN up ON z.id = up.parent_id WHERE up.depth < 1000
         )
         SELECT 1 AS hit FROM up WHERE id = @self LIMIT 1`,
      )
      .get({ parent: parentId, self: selfId })) as { hit: number } | undefined
    if (cycle) throw new ClientZoneError("Зона не может быть родительской для самой себя", 400, { field: "parentId" })
  }
  return parentId
}

function polygonText(polygon: LatLng[] | null | undefined): string {
  return polygon && polygon.length >= 3 ? JSON.stringify(polygon.map(([lat, lng]) => [lat, lng])) : ""
}

/** Ray casting: is the point inside the ring (lat / lng treated as plane coordinates)? */
export function insidePolygon(point: LatLng, ring: LatLng[]): boolean {
  const [y, x] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]
    const [yj, xj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Gives `zone` to the located clients inside `ring`; returns how many changed. */
async function reassignClients(db: PgDb, zone: string, ring: LatLng[]): Promise<number> {
  const rows = (await db
    .prepare("SELECT id, zone, location_lat, location_lng FROM clients WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL")
    .all()) as Array<{ id: number; zone: string; location_lat: number; location_lng: number }>
  const ids = rows
    .filter((row) => nameKey(row.zone) !== nameKey(zone) && insidePolygon([Number(row.location_lat), Number(row.location_lng)], ring))
    .map((row) => row.id)
  if (!ids.length) return 0
  const result = await db.prepare("UPDATE clients SET zone = @zone, updated_at = datetime('now') WHERE id = ANY(@ids::int[])").run({ zone, ids })
  return result.changes
}

function needsOutline(input: ClientZoneInput, ring: LatLng[] | null): void {
  if (input.reassignClients && (!ring || ring.length < 3)) {
    throw new ClientZoneError("Нарисуйте контур зоны, чтобы переназначить клиентов", 400, { field: "polygon" })
  }
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new ClientZoneError("Такая зона уже существует", 409, { field: "name" })
  throw error
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createClientZone(input: ClientZoneInput, user?: { displayName?: string }): Promise<ClientZoneSaved> {
  await ensureClientZones()
  try {
    const { id, reassigned } = await withTransaction(async (tx) => {
      await lockClients(tx)
      await lockZones(tx)
      await assertNameFree(tx, input.name, 0)
      const branch = await branchName(tx, input.branch ?? "")
      const parentId = await checkParent(tx, input.parentId ?? null, 0)
      const ring = input.polygon && input.polygon.length ? input.polygon : null
      needsOutline(input, ring)
      const result = await tx
        .prepare("INSERT INTO client_zones (name, branch, parent_id, polygon, created_by) VALUES (@name, @branch, @parentId, @polygon, @createdBy)")
        .run({ name: input.name, branch, parentId, polygon: polygonText(ring), createdBy: user?.displayName ?? "" })
      const reassigned = input.reassignClients && ring ? await reassignClients(tx, input.name, ring) : 0
      return { id: Number(result.lastInsertRowid), reassigned }
    })
    return { zone: (await getClientZone(id))!, reassigned }
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Omitted branch / parentId / polygon keep the stored value; a rename follows to clients, orders and contracts. */
export async function updateClientZone(id: number, input: ClientZoneInput): Promise<ClientZoneSaved | null> {
  if (!validId(id)) return null
  await ensureClientZones()
  try {
    const outcome = await withTransaction(async (tx) => {
      await lockClients(tx)
      await lockZones(tx)
      const current = (await tx.prepare("SELECT id, name, branch, parent_id, polygon FROM client_zones WHERE id = ?").get(id)) as
        | Pick<Row, "id" | "name" | "branch" | "parent_id" | "polygon">
        | undefined
      if (!current) return null
      if (nameKey(current.name) !== nameKey(input.name)) await assertNameFree(tx, input.name, id)
      else if (zoneIsUnset(input.name)) throw new ClientZoneError("Укажите название зоны", 400, { field: "name" })
      const branch = input.branch === undefined ? current.branch : nameKey(input.branch) === nameKey(current.branch) ? current.branch : await branchName(tx, input.branch)
      const parentId = input.parentId === undefined ? current.parent_id : await checkParent(tx, input.parentId, id)
      const ring = input.polygon === undefined ? parsePolygon(current.polygon) : input.polygon && input.polygon.length ? input.polygon : null
      needsOutline(input, ring)
      await tx
        .prepare("UPDATE client_zones SET name = @name, branch = @branch, parent_id = @parentId, polygon = @polygon, updated_at = datetime('now') WHERE id = @id")
        .run({ id, name: input.name, branch, parentId, polygon: polygonText(ring) })
      // Another zone with the old key (older twins) keeps the records on its name.
      const twins = (await tx.prepare(`SELECT COUNT(*)::int AS n FROM client_zones WHERE ${keySql("name")} = ${keySql("@name::text")} AND id <> @id`).get({ name: current.name, id })) as {
        n: number
      }
      if (!twins.n) await cascadeNameRename(tx, await existingReferences(tx, REFERENCES), current.name, input.name)
      const reassigned = input.reassignClients && ring ? await reassignClients(tx, input.name, ring) : 0
      return { reassigned }
    })
    if (!outcome) return null
    return { zone: (await getClientZone(id))!, reassigned: outcome.reassigned }
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Refused (409 with the usage list) while clients, orders or contracts hold the zone. */
export async function deleteClientZone(id: number): Promise<boolean> {
  if (!validId(id)) return false
  await ensureClientZones()
  return withTransaction(async (tx) => {
    await lockClients(tx)
    await lockZones(tx)
    const current = (await tx.prepare("SELECT id, name FROM client_zones WHERE id = ?").get(id)) as { id: number; name: string } | undefined
    if (!current) return false
    const twins = (await tx.prepare(`SELECT COUNT(*)::int AS n FROM client_zones WHERE ${keySql("name")} = ${keySql("@name::text")} AND id <> @id`).get({ name: current.name, id })) as {
      n: number
    }
    if (!twins.n) {
      const usage: Usage[] = await usageOf(tx, await existingReferences(tx, REFERENCES), { id, name: current.name })
      if (usage.length) throw new ClientZoneError("Удаление невозможно из-за связи с другими данными", 409, { usage })
    }
    return (await tx.prepare("DELETE FROM client_zones WHERE id = ?").run(id)).changes > 0
  })
}
