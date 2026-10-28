import "server-only"

import { getDb } from "@/lib/db"

// Reference "Транспорт" (main/transport/): model, number, driver, capacity (Объем, л),
// load_limit (Грузоподъёмность, кг) and an optional branch.
export type TransportVehicle = {
  id: number
  model: string
  number: string
  driver: string
  capacity: number
  loadLimit: number
  branch: { id: number; name: string } | null
}

type Row = {
  id: number
  model: string
  number: string
  driver: string
  capacity: number
  load_limit: number
  branch_id: number | null
  branch_name: string | null
}

const SEED = [
  { id: 1, model: "ISUZI", number: "01|M 079 AA", driver: "Jon Jones", capacity: 12, load_limit: 520, branch_id: null },
  { id: 2, model: "Fura", number: "01| Z 777 ZZ", driver: "Shoh oka", capacity: 20000, load_limit: 5000, branch_id: 6 },
  { id: 3, model: "volvo", number: "01A777AA", driver: "shafyor", capacity: 30000, load_limit: 5000, branch_id: null },
  { id: 4, model: "mercedes", number: "01n001nn", driver: "rizo", capacity: 60000, load_limit: 30000, branch_id: null },
  { id: 5, model: "Газель", number: "01 F 567 JH", driver: "Никита", capacity: 500, load_limit: 50, branch_id: 33 },
  { id: 6, model: "Ehrh", number: "1234", driver: "Shsh", capacity: 6, load_limit: 5, branch_id: 6 },
  { id: 7, model: "malibu 2", number: "01|AAA777", driver: "jumanazar", capacity: 2000, load_limit: 60, branch_id: null },
]

let ready: Promise<void> | null = null

async function ensureSchema() {
  ready ??= (async () => {
    const db = getDb()
    const existing = (await db.prepare("SELECT to_regclass('transports') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
    await db.exec(`
      CREATE TABLE IF NOT EXISTS transports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        number TEXT NOT NULL DEFAULT '',
        driver TEXT NOT NULL DEFAULT '',
        capacity DOUBLE PRECISION NOT NULL DEFAULT 0,
        load_limit DOUBLE PRECISION NOT NULL DEFAULT 0,
        branch_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    if (existing?.ok) return
    for (const row of SEED) {
      await db
        .prepare("INSERT INTO transports (id, model, number, driver, capacity, load_limit, branch_id) VALUES (@id, @model, @number, @driver, @capacity, @load_limit, @branch_id)")
        .run(row)
    }
    await db.exec("SELECT setval(pg_get_serial_sequence('transports', 'id'), (SELECT MAX(id) FROM transports))")
  })().catch((error) => {
    ready = null
    throw error
  })
  return ready
}

const SELECT = `SELECT t.id, t.model, t.number, t.driver, t.capacity, t.load_limit, t.branch_id, b.name AS branch_name
  FROM transports t LEFT JOIN branches b ON b.id = t.branch_id`

function toVehicle(row: Row): TransportVehicle {
  return {
    id: row.id,
    model: row.model,
    number: row.number,
    driver: row.driver,
    capacity: Number(row.capacity),
    loadLimit: Number(row.load_limit),
    branch: row.branch_id !== null && row.branch_name !== null ? { id: row.branch_id, name: row.branch_name } : null,
  }
}

export type TransportInput = { model: string; number: string; driver: string; capacity: number; loadLimit: number; branchId: number | null }

export async function listTransport(): Promise<TransportVehicle[]> {
  await ensureSchema()
  return ((await getDb().prepare(`${SELECT} ORDER BY t.id DESC`).all()) as Row[]).map(toVehicle)
}

export async function getTransport(id: number): Promise<TransportVehicle | null> {
  await ensureSchema()
  const row = (await getDb().prepare(`${SELECT} WHERE t.id = ?`).get(id)) as Row | undefined
  return row ? toVehicle(row) : null
}

export async function branchExists(id: number): Promise<boolean> {
  return Boolean(await getDb().prepare("SELECT 1 AS ok FROM branches WHERE id = ?").get(id))
}

export async function createTransport(input: TransportInput): Promise<TransportVehicle> {
  await ensureSchema()
  const result = await getDb()
    .prepare("INSERT INTO transports (model, number, driver, capacity, load_limit, branch_id) VALUES (@model, @number, @driver, @capacity, @loadLimit, @branchId)")
    .run(input)
  return (await getTransport(Number(result.lastInsertRowid)))!
}

export async function updateTransport(id: number, input: TransportInput): Promise<TransportVehicle | null> {
  await ensureSchema()
  if (!(await getTransport(id))) return null
  await getDb()
    .prepare(
      "UPDATE transports SET model = @model, number = @number, driver = @driver, capacity = @capacity, load_limit = @loadLimit, branch_id = @branchId, updated_at = datetime('now') WHERE id = @id",
    )
    .run({ id, ...input })
  return getTransport(id)
}

export async function deleteTransport(id: number): Promise<boolean> {
  await ensureSchema()
  return (await getDb().prepare("DELETE FROM transports WHERE id = ?").run(id)).changes > 0
}
