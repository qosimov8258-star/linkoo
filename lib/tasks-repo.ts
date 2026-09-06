import "server-only"

import { getDb } from "@/lib/db"
import { todayTaskLabel } from "@/components/analytics/tasks-data"
import type { Task, TaskStatus } from "@/components/analytics/tasks-data"

type Row = {
  id: number
  responsible: string
  store: string
  description: string
  date: string
  status: TaskStatus
}

function rowToTask(row: Row): Task {
  return {
    id: row.id,
    responsible: row.responsible,
    store: row.store,
    description: row.description,
    date: row.date,
    status: row.status,
  }
}

export type TaskInput = {
  responsible: string
  store: string
  description: string
  status: TaskStatus
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

const validStatuses: TaskStatus[] = ["in_progress", "fulfilled", "closed"]

export function parseTaskInput(body: unknown): TaskInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const responsible = str(value.responsible).trim()
  const store = str(value.store).trim()
  if (!responsible || !store) return null

  const status = validStatuses.includes(value.status as TaskStatus) ? (value.status as TaskStatus) : "in_progress"

  return {
    responsible,
    store,
    description: str(value.description),
    status,
  }
}

export async function listTasks(): Promise<Task[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM tasks ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToTask)
}

export async function getTask(id: number): Promise<Task | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM tasks WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToTask(row) : null
}

export async function createTask(input: TaskInput): Promise<Task> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO tasks (responsible, store, description, date, status)
       VALUES (@responsible, @store, @description, @date, @status)`,
      )
      .run({ ...input, date: todayTaskLabel() }))
  return (await getTask(Number(result.lastInsertRowid)))!
}

export async function updateTask(id: number, input: TaskInput): Promise<Task | null> {
  if (!(await getTask(id))) return null
  const db = getDb()
  await db.prepare(
        `UPDATE tasks SET responsible = @responsible, store = @store, description = @description, status = @status,
      updated_at = datetime('now')
     WHERE id = @id`,
      ).run({ ...input, id })
  return (await getTask(id))
}

export async function deleteTask(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM tasks WHERE id = ?").run(id))
  return result.changes > 0
}
