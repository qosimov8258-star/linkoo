import "server-only"

import { getDb } from "@/lib/db"

export type ZoneBindingKind = "agent" | "unbind-agent" | "branch"
export type ZoneBinding = { zoneId: number; kind: ZoneBindingKind; value: string }
export type ZoneBindingState = { bindings: ZoneBinding[]; removed: number[] }

type BindingRow = { zone_id: number; kind: ZoneBindingKind; value: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS zone_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS zone_removals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id INTEGER NOT NULL UNIQUE,
      removed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

/** Zone links are append-only: the newest row of a kind wins, rows are never updated or deleted. */
export async function getZoneBindingState(): Promise<ZoneBindingState> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db.prepare("SELECT zone_id, kind, value FROM zone_bindings ORDER BY id").all()) as BindingRow[]
  const removed = (await db.prepare("SELECT zone_id FROM zone_removals ORDER BY zone_id").all()) as { zone_id: number }[]
  return {
    bindings: rows.map((row) => ({ zoneId: row.zone_id, kind: row.kind, value: row.value })),
    removed: removed.map((row) => row.zone_id),
  }
}

export async function addZoneBindings(kind: ZoneBindingKind, zoneIds: number[], value: string): Promise<void> {
  const db = getDb()
  await ensureSchema(db)
  const insert = db.prepare("INSERT INTO zone_bindings (zone_id, kind, value) VALUES (?, ?, ?)")
  for (const zoneId of zoneIds) await insert.run(zoneId, kind, value)
}

export async function removeZones(zoneIds: number[]): Promise<void> {
  const db = getDb()
  await ensureSchema(db)
  const insert = db.prepare("INSERT INTO zone_removals (zone_id) VALUES (?) ON CONFLICT (zone_id) DO NOTHING")
  for (const zoneId of zoneIds) await insert.run(zoneId)
}
