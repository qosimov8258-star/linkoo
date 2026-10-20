import "server-only"

import { getDb } from "@/lib/db"

export type AgentRoute = {
  id: number
  agent: string
  routeDate: string
  planVisits: number
  routeVisited: number
  routeEffective: number
  routeRefused: number
  routeSales: number
  outsideVisited: number
  outsideEffective: number
  outsideRefused: number
  outsideSales: number
  checkIn: string
  checkOut: string
  gpsLat: number | null
  gpsLng: number | null
  photoUrl: string
}

type Row = {
  id: number
  agent: string
  route_date: string
  plan_visits: number
  route_visited: number
  route_effective: number
  route_refused: number
  route_sales: number
  outside_visited: number
  outside_effective: number
  outside_refused: number
  outside_sales: number
  check_in: string
  check_out: string
  gps_lat: number | null
  gps_lng: number | null
  photo_url: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agent_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      route_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  // Additive columns: per-day field-work summary for an agent's route, covering
  // the plan/route/outside-of-route visit metrics the reporting views need
  // (visits, effective visits, refusals, sales) plus check-in/out and GPS.
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS plan_visits DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS route_visited DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS route_effective DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS route_refused DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS route_sales DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS outside_visited DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS outside_effective DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS outside_refused DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS outside_sales DOUBLE PRECISION NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS check_in TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS check_out TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS gps_lng DOUBLE PRECISION;`)
  await db.exec(`ALTER TABLE agent_routes ADD COLUMN IF NOT EXISTS photo_url TEXT NOT NULL DEFAULT '';`)
  await db.exec(`
    -- Money precision (contract 3): an older database created these columns as REAL (float4).
    DO $$
    DECLARE c text;
    BEGIN
      FOR c IN SELECT column_name FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'agent_routes' AND data_type = 'real' LOOP
        EXECUTE format('ALTER TABLE agent_routes ALTER COLUMN %I TYPE double precision USING (%I::text)::double precision', c, c);
      END LOOP;
    END $$;
  `)
}

const SELECT_COLUMNS = `
  id, agent, route_date, plan_visits, route_visited, route_effective, route_refused, route_sales,
  outside_visited, outside_effective, outside_refused, outside_sales, check_in, check_out, gps_lat, gps_lng, photo_url
`

function rowToAgentRoute(row: Row): AgentRoute {
  return {
    id: row.id,
    agent: row.agent,
    routeDate: row.route_date,
    planVisits: Number(row.plan_visits) || 0,
    routeVisited: Number(row.route_visited) || 0,
    routeEffective: Number(row.route_effective) || 0,
    routeRefused: Number(row.route_refused) || 0,
    routeSales: Number(row.route_sales) || 0,
    outsideVisited: Number(row.outside_visited) || 0,
    outsideEffective: Number(row.outside_effective) || 0,
    outsideRefused: Number(row.outside_refused) || 0,
    outsideSales: Number(row.outside_sales) || 0,
    checkIn: row.check_in ?? "",
    checkOut: row.check_out ?? "",
    gpsLat: row.gps_lat ?? null,
    gpsLng: row.gps_lng ?? null,
    photoUrl: row.photo_url ?? "",
  }
}

export type AgentRouteInput = {
  agent: string
  routeDate: string
  planVisits: number
  routeVisited: number
  routeEffective: number
  routeRefused: number
  routeSales: number
  outsideVisited: number
  outsideEffective: number
  outsideRefused: number
  outsideSales: number
  checkIn: string
  checkOut: string
  gpsLat: number | null
  gpsLng: number | null
  photoUrl: string
}

function toNumber(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value)
  return Number.isFinite(num) ? num : 0
}

export function parseAgentRouteInput(body: unknown): AgentRouteInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const agent = typeof value.agent === "string" ? value.agent.trim() : ""
  if (!agent) return null
  const routeDate = typeof value.routeDate === "string" && value.routeDate.trim() ? value.routeDate.trim() : new Date().toISOString().slice(0, 10)
  const gpsLat = value.gpsLat === null || value.gpsLat === undefined || value.gpsLat === "" ? null : toNumber(value.gpsLat)
  const gpsLng = value.gpsLng === null || value.gpsLng === undefined || value.gpsLng === "" ? null : toNumber(value.gpsLng)
  return {
    agent,
    routeDate,
    planVisits: toNumber(value.planVisits),
    routeVisited: toNumber(value.routeVisited),
    routeEffective: toNumber(value.routeEffective),
    routeRefused: toNumber(value.routeRefused),
    routeSales: toNumber(value.routeSales),
    outsideVisited: toNumber(value.outsideVisited),
    outsideEffective: toNumber(value.outsideEffective),
    outsideRefused: toNumber(value.outsideRefused),
    outsideSales: toNumber(value.outsideSales),
    checkIn: typeof value.checkIn === "string" ? value.checkIn.trim() : "",
    checkOut: typeof value.checkOut === "string" ? value.checkOut.trim() : "",
    gpsLat,
    gpsLng,
    photoUrl: typeof value.photoUrl === "string" ? value.photoUrl.trim() : "",
  }
}

export async function listAgentRoutes(): Promise<AgentRoute[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare(`SELECT ${SELECT_COLUMNS} FROM agent_routes ORDER BY id DESC`).all()) as Row[]).map(rowToAgentRoute)
}

export async function createAgentRoute(input: AgentRouteInput): Promise<AgentRoute> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO agent_routes (
          agent, route_date, plan_visits, route_visited, route_effective, route_refused, route_sales,
          outside_visited, outside_effective, outside_refused, outside_sales, check_in, check_out, gps_lat, gps_lng, photo_url
        ) VALUES (
          @agent, @routeDate, @planVisits, @routeVisited, @routeEffective, @routeRefused, @routeSales,
          @outsideVisited, @outsideEffective, @outsideRefused, @outsideSales, @checkIn, @checkOut, @gpsLat, @gpsLng, @photoUrl
        )`,
      )
      .run(input))
  const row = (await db.prepare(`SELECT ${SELECT_COLUMNS} FROM agent_routes WHERE id = ?`).get(Number(result.lastInsertRowid))) as Row
  return rowToAgentRoute(row)
}
