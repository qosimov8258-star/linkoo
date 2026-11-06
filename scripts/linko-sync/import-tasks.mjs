// Задачи: the tasks of the Linko account (main/task + each task's plans, main/task/<id>/) into tasks / task_plans by
// Linko id. The demo tasks an earlier seed wrote (demo_seed_rows, not in Linko) are removed with their plans.
// The tables are brought to the shape lib/tasks-repo.ts gives them (same idempotent DDL) before writing.
//
//   node scripts/linko-sync/import-tasks.mjs        (raw files: tasks, tasks_detail)
import { connect, ensureRegistry, fullName, raw, register, runId, utcIso } from "./lib.mjs"

const run = runId("tasks")
const list = raw("tasks")
const details = raw("tasks_detail")
const utcText = (local) => (local ? utcIso(local).slice(0, 19).replace("T", " ") : null)
const STATUS = { new: "new", in_progress: "in_progress", done: "done", finished: "finished", closed: "finished", fulfilled: "done" }
const PLAN_STATUS = { pending: "pending", in_progress: "in_progress", done: "done", undone: "undone", finished: "finished", new: "new" }

const client = await connect()
await ensureRegistry(client)
const stats = { tasks: { insert: 0, update: 0 }, plans: 0, removedDemo: 0 }
try {
  await client.query("BEGIN")
  await client.query(`
    ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS client_id INTEGER,
      ADD COLUMN IF NOT EXISTS employee_id INTEGER,
      ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER,
      ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS grade INTEGER;
    CREATE TABLE IF NOT EXISTS task_plans (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL,
      plan_date TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      response TEXT NOT NULL DEFAULT '',
      photo TEXT NOT NULL DEFAULT '',
      done_at TEXT NOT NULL DEFAULT '',
      done_by_user_id INTEGER,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS task_plans_task_id_idx ON task_plans (task_id);
    CREATE INDEX IF NOT EXISTS tasks_date_idx ON tasks (date);
    CREATE INDEX IF NOT EXISTS tasks_employee_id_idx ON tasks (employee_id);`)

  const linkoIds = list.map((task) => Number(task.id))
  const demo = (
    await client.query(
      `SELECT t.id FROM tasks t JOIN demo_seed_rows d ON d.table_name = 'tasks' AND d.row_id = t.id::text WHERE NOT (t.id = ANY($1::int[]))`,
      [linkoIds],
    )
  ).rows.map((row) => Number(row.id))
  if (demo.length) {
    await client.query("DELETE FROM task_plans WHERE task_id = ANY($1::int[])", [demo])
    await client.query("DELETE FROM tasks WHERE id = ANY($1::int[])", [demo])
    await register(client, run, "tasks", "demo", "delete", { ids: demo })
    stats.removedDemo = demo.length
  }

  for (const item of list) {
    const task = details[item.id] && !details[item.id].__status ? details[item.id] : item
    const values = {
      responsible: fullName(task.responsible_user),
      store: String(task.market?.name ?? ""),
      description: String(task.title ?? ""),
      date: String(task.end_date ?? "").slice(0, 10),
      status: STATUS[task.status] ?? "in_progress",
      created_at: utcText(task.created_date),
      client_id: task.market?.id ?? null,
      employee_id: task.responsible_user?.id ?? null,
      created_by: fullName(task.created_by),
      grade: task.grade ?? null,
    }
    const exists = (await client.query("SELECT 1 FROM tasks WHERE id = $1", [task.id])).rowCount > 0
    if (exists) {
      await client.query(
        `UPDATE tasks SET responsible = $2, store = $3, description = $4, date = $5, status = $6, created_at = $7, client_id = $8, employee_id = $9,
           created_by = $10, grade = $11, updated_at = datetime('now') WHERE id = $1`,
        [task.id, ...Object.values(values)],
      )
      await register(client, run, "tasks", task.id, "update")
      stats.tasks.update++
    } else {
      await client.query(
        `INSERT INTO tasks (id, responsible, store, description, date, status, created_at, client_id, employee_id, created_by, grade)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [task.id, ...Object.values(values)],
      )
      await register(client, run, "tasks", task.id, "insert")
      stats.tasks.insert++
    }
    // The task's plans as Linko lists them (replacing what an earlier run or the app's backfill made).
    await client.query("DELETE FROM task_plans WHERE task_id = $1", [task.id])
    for (const plan of task.today_plans ?? []) {
      const status = PLAN_STATUS[plan.status] ?? "pending"
      await client.query(
        `INSERT INTO task_plans (task_id, plan_date, comment, status, response, photo, done_at, created_at)
         VALUES ($1, $2, $3, $4, $5, '', $6, $7)`,
        [task.id, String(plan.date ?? "").slice(0, 10), String(plan.comment ?? ""), status, String(plan.response ?? ""), status === "done" || status === "finished" ? values.created_at : "", values.created_at],
      )
      stats.plans++
    }
  }
  await client.query("SELECT setval(pg_get_serial_sequence('tasks', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM tasks), 1))")
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`tasks: ${list.length} in Linko →`, JSON.stringify(stats))
