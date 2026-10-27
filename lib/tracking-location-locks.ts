import "server-only"

import { z } from "zod"

import { getDb, outsideTransaction, withTransaction } from "@/lib/db"
import { dbId } from "@/lib/strict-number"

// "Блокировка локации" of clients (Отслеживание → Изменить блокировку локации): a locked
// client's location may not be moved by the field app. One row per locked client; unlocking
// removes the row. Rows of a client that no longer exists are never read (every read names the
// client ids it asks for), so a client delete does not need to touch this table.
//
// The table is created lazily, once per process, on the maintenance pool (outsideTransaction)
// under an advisory lock (fresh-install safe, idempotent). No other module reads it.

const SCHEMA_VERSION = 1

const DDL = `
CREATE TABLE IF NOT EXISTS client_location_locks (
  client_id INTEGER PRIMARY KEY,
  locked_by INTEGER,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

declare global {
  var __linkoClientLocationLocks: { version: number; ready: Promise<void> } | undefined
}

export function ensureLocationLockSchema(): Promise<void> {
  if (globalThis.__linkoClientLocationLocks?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:client-location-locks:schema'))")
        await tx.exec(DDL)
      }),
    ).catch((error) => {
      globalThis.__linkoClientLocationLocks = undefined
      throw error
    })
    globalThis.__linkoClientLocationLocks = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoClientLocationLocks!.ready
}

export const CLIENT_NOT_FOUND = "Клиент не найден"

/** PUT /api/tracking/location-locks: lock (true) or unlock (false) the location of these clients. */
export const locationLockSchema = z.object({
  clientIds: z
    .array(dbId(CLIENT_NOT_FOUND), { error: "Выберите клиентов" })
    .min(1, "Выберите клиентов")
    .max(500, "Не более 500 клиентов"),
  locked: z.boolean({ error: "Неверное значение" }),
})

export type LocationLockInput = z.infer<typeof locationLockSchema>

/** The ids of `clientIds` whose location is locked. */
export async function lockedClientIds(clientIds: number[]): Promise<Set<number>> {
  if (!clientIds.length) return new Set()
  await ensureLocationLockSchema()
  const rows = (await getDb()
    .prepare("SELECT client_id FROM client_location_locks WHERE client_id = ANY(@ids::int[])")
    .all({ ids: clientIds })) as Array<{ client_id: number }>
  return new Set(rows.map((row) => Number(row.client_id)))
}

export class LocationLockError extends Error {
  constructor(
    message: string,
    readonly clientId: number,
  ) {
    super(message)
    this.name = "LocationLockError"
  }
}

/**
 * Locks or unlocks the location of the clients. Every client must exist (LocationLockError with
 * the first missing id otherwise); the client rows are share-locked in id order, so a parallel
 * client delete waits and a parallel lock of the same clients cannot interleave.
 * Returns the number of clients whose flag changed.
 */
export async function setLocationLocks(input: LocationLockInput, userId: number): Promise<number> {
  await ensureLocationLockSchema()
  const clientIds = [...new Set(input.clientIds)].sort((a, b) => a - b)
  return withTransaction(async (tx) => {
    const rows = (await tx.prepare("SELECT id FROM clients WHERE id = ANY(@ids::int[]) ORDER BY id FOR SHARE").all({ ids: clientIds })) as Array<{ id: number }>
    const found = new Set(rows.map((row) => Number(row.id)))
    const missing = clientIds.find((id) => !found.has(id))
    if (missing !== undefined) throw new LocationLockError(CLIENT_NOT_FOUND, missing)
    if (input.locked) {
      const result = await tx
        .prepare(
          `INSERT INTO client_location_locks (client_id, locked_by)
           SELECT c, @userId FROM unnest(@ids::int[]) AS c
           ON CONFLICT (client_id) DO NOTHING`,
        )
        .run({ ids: clientIds, userId })
      return result.changes
    }
    const result = await tx.prepare("DELETE FROM client_location_locks WHERE client_id = ANY(@ids::int[])").run({ ids: clientIds })
    return result.changes
  })
}
