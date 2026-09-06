import "server-only"

import { getDb } from "@/lib/db"

export type ProductionBatch = {
  id: number
  startedAt: string
  completedAt: string
  batchDate: string
  stage: string
  user: string
  status: string
}

type Row = {
  id: number
  started_at: string
  completed_at: string
  batch_date: string
  stage: string
  user: string
  status: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS production_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      batch_date TEXT NOT NULL,
      stage TEXT NOT NULL,
      "user" TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'В процессе',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToBatch(row: Row): ProductionBatch {
  return {
    id: row.id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    batchDate: row.batch_date,
    stage: row.stage,
    user: row.user,
    status: row.status,
  }
}

export type ProductionBatchInput = {
  startedAt: string
  completedAt: string
  batchDate: string
  stage: string
  user: string
  status: string
}

export async function listProductionBatches(): Promise<ProductionBatch[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM production_batches ORDER BY id DESC").all()) as Row[]).map(rowToBatch)
}

export async function getProductionBatch(id: number): Promise<ProductionBatch | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM production_batches WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToBatch(row) : null
}

export async function createProductionBatch(input: ProductionBatchInput): Promise<ProductionBatch> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO production_batches (started_at, completed_at, batch_date, stage, "user", status)
       VALUES (@startedAt, @completedAt, @batchDate, @stage, @user, @status)`,
      )
      .run(input))
  return (await getProductionBatch(Number(result.lastInsertRowid)))!
}
