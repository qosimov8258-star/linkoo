import "server-only"

import { getDb } from "@/lib/db"

// Zones drawn on the territory page ("Добавить" → name, branch, parent, polygon). The reference posts
// {title, parent, branch, update_market_border, coordinates: Polygon} to its zones endpoint; here every
// new zone is a row of zone_extra next to the 109 reference zones of components/tracking/zone-polygons.json
// (those are not edited). Ids start at 1000 so they never meet a reference zone id.

export type ExtraZone = {
  id: number
  title: string
  parent: string
  branch: string
  updateMarketBorder: boolean
  /** [lat, lng] points, not closed. */
  ring: [number, number][]
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS zone_extra (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      parent TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      update_market_border INTEGER NOT NULL DEFAULT 0,
      ring TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

type Row = { id: number; title: string; parent: string; branch: string; update_market_border: number; ring: string }

const toZone = (row: Row): ExtraZone => ({
  id: Number(row.id),
  title: row.title,
  parent: row.parent,
  branch: row.branch,
  updateMarketBorder: Number(row.update_market_border) === 1,
  ring: JSON.parse(row.ring || "[]") as [number, number][],
})

export async function listExtraZones(): Promise<ExtraZone[]> {
  const db = getDb()
  await ensureSchema(db)
  // zones removed through "Удалить" (zone_removals, see zone-bindings-repo) are not listed or drawn any more
  await db.exec("CREATE TABLE IF NOT EXISTS zone_removals (id INTEGER PRIMARY KEY AUTOINCREMENT, zone_id INTEGER NOT NULL UNIQUE, removed_at TEXT NOT NULL DEFAULT (datetime('now')))")
  return ((await db.prepare("SELECT id, title, parent, branch, update_market_border, ring FROM zone_extra WHERE id NOT IN (SELECT zone_id FROM zone_removals) ORDER BY id").all()) as Row[]).map(toZone)
}

export async function createExtraZone(input: { title: string; parent: string; branch: string; updateMarketBorder: boolean; ring: [number, number][] }): Promise<ExtraZone> {
  const db = getDb()
  await ensureSchema(db)
  const next = (await db.prepare("SELECT COALESCE(MAX(id), 999) + 1 AS id FROM zone_extra").get()) as { id: number }
  await db
    .prepare("INSERT INTO zone_extra (id, title, parent, branch, update_market_border, ring) VALUES (?, ?, ?, ?, ?, ?)")
    .run(Number(next.id), input.title, input.parent, input.branch, input.updateMarketBorder ? 1 : 0, JSON.stringify(input.ring))
  return { id: Number(next.id), title: input.title, parent: input.parent, branch: input.branch, updateMarketBorder: input.updateMarketBorder, ring: input.ring }
}
