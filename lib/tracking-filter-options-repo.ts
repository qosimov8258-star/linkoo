import "server-only"

import { getDb } from "@/lib/db"

export type TrackingFilterOptions = {
  clients: string[]
  clientTypes: string[]
  zones: string[]
  agents: string[]
  deliverers: string[]
  branches: string[]
  refusalTypes: string[]
  agentRoutes: string[]
}

type NameRow = { name: string }

const names = (rows: unknown) => (rows as NameRow[]).map((row) => row.name).filter(Boolean)

/** Option lists of the "Показать на карте" filter dialog, read from the live tables. */
export async function getTrackingFilterOptions(): Promise<TrackingFilterOptions> {
  const db = getDb()
  const staff = async (positionPattern: string) =>
    names(
      await db
        .prepare(
          `SELECT TRIM(first_name || ' ' || last_name) AS name FROM employees
           WHERE active = 1 AND LOWER(position) LIKE ? ORDER BY first_name, last_name`,
        )
        .all(positionPattern),
    )
  return {
    clients: names(await db.prepare("SELECT DISTINCT name FROM clients WHERE name <> '' ORDER BY name LIMIT 300").all()),
    clientTypes: names(await db.prepare("SELECT name FROM client_types ORDER BY id").all()),
    zones: names(await db.prepare("SELECT DISTINCT zone AS name FROM clients WHERE zone <> '' AND zone <> 'Не указано' ORDER BY zone").all()),
    agents: await staff("%агент%"),
    deliverers: await staff("%доставщик%"),
    branches: names(await db.prepare("SELECT name FROM branches ORDER BY id").all()),
    refusalTypes: names(await db.prepare("SELECT name FROM refusal_types ORDER BY id").all()),
    agentRoutes: names(await db.prepare("SELECT DISTINCT agent AS name FROM agent_routes ORDER BY agent LIMIT 200").all()),
  }
}
