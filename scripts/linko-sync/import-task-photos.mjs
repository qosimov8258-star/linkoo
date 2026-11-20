// Задачи → plan photos: Linko keeps the picture link of a plan the agent closed with a photo (today_plans[].image_url
// of main/task/<id>/), and its task drawer shows «Просмотреть» for it. import-tasks.mjs wrote the plans without the link
// before; this step puts it into task_plans.photo of the plan with the same task, day and comment (the drawer then
// shows «Просмотреть» too). Only an empty photo is set: a photo the app stored (an agent's upload) is kept.
//
//   node scripts/linko-sync/import-task-photos.mjs        (raw file: tasks_detail)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("task-photos")
const details = raw("tasks_detail")
const LINKO_MEDIA = /^https:\/\/[a-z0-9.-]+\.linko\.uz\/media\/[A-Za-z0-9/._-]+$/

const client = await connect()
await ensureRegistry(client)
const stats = { set: 0, same: 0, kept: 0, missing: [] }
try {
  await client.query("BEGIN")
  for (const task of Object.values(details ?? {})) {
    if (!task || task.__status) continue
    for (const plan of task.today_plans ?? []) {
      const url = String(plan.image_url ?? "")
      if (!LINKO_MEDIA.test(url)) continue
      const day = String(plan.date ?? "").slice(0, 10)
      const rows = (
        await client.query("SELECT id, photo FROM task_plans WHERE task_id = $1 AND plan_date = $2 AND comment = $3 ORDER BY id", [task.id, day, String(plan.comment ?? "")])
      ).rows
      if (rows.length !== 1) {
        stats.missing.push(`${task.id}:${day}`)
        continue
      }
      const row = rows[0]
      if (row.photo === url) stats.same++
      else if (row.photo) stats.kept++
      else {
        await client.query("UPDATE task_plans SET photo = $2 WHERE id = $1", [row.id, url])
        await register(client, run, "task_plans", row.id, "update", { photo: "" })
        stats.set++
      }
    }
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`task plan photos: set ${stats.set}, same ${stats.same}, kept ${stats.kept}${stats.missing.length ? `; plans not found: ${stats.missing.join(", ")}` : ""}`)
