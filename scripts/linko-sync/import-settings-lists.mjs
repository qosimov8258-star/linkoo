// Small lists the app clears when they look exactly like what an older build seeded (its "legacy seed" cleanups):
// the Telegram bot users, Транспорт, Смены and the subscribers of Шаблоны уведомлений. Imported from Linko they are
// this company's own data, written so that the cleanups leave them alone:
// - telegram_users: every Linko bot user with source = 'linko' (the cleanup only removes source = '' rows);
// - transports / work_shifts: Linko's rows by id, marked as written by the sync (updated_at <> created_at: the cleanup
//   only removes rows never edited);
// - notification_template_users: Linko's subscribers per template, under new link ids (the cleanup only removes links
//   whose id, template and user are the seeded ones).
//
//   node scripts/linko-sync/import-settings-lists.mjs     (raw: telegram_users, transports, shifts, notification_templates)
import { connect, ensureRegistry, fullName, raw, register, runId } from "./lib.mjs"

const run = runId("settings-lists")
/** Registers a row the upsert above inserted or changed; one that came out as it was is left out of the registry. */
async function registerChange(client, table, id, before) {
  if (before) {
    const after = (await client.query(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0]
    if (JSON.stringify(after) === JSON.stringify(before)) return
  }
  await register(client, run, table, id, before ? "update" : "insert", before ?? null)
}
const client = await connect()
await ensureRegistry(client)
const stats = { telegram: 0, transports: 0, shifts: 0, subscribers: 0 }
try {
  await client.query("BEGIN")

  // Telegram bot users
  await client.query("ALTER TABLE telegram_users ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT ''")
  for (const u of raw("telegram_users")) {
    const values = [
      u.telegram_id,
      u.first_name ?? "",
      u.last_name ?? "",
      u.username ?? "",
      u.phone_number ?? "",
      u.language ?? "",
      u.market?.id ?? null,
      u.market?.name ?? "",
      u.created_date ?? "",
      u.last_active ?? "",
    ]
    const before = (await client.query("SELECT * FROM telegram_users WHERE id = $1", [u.telegram_id])).rows[0]
    await client.query(
      `INSERT INTO telegram_users (id, first_name, last_name, username, phone, language, market_id, market_name, created_date, last_active, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'linko')
       ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, username = EXCLUDED.username,
         phone = EXCLUDED.phone, language = EXCLUDED.language, market_id = EXCLUDED.market_id, market_name = EXCLUDED.market_name,
         created_date = EXCLUDED.created_date, last_active = EXCLUDED.last_active, source = 'linko'`,
      values,
    )
    await registerChange(client, "telegram_users", u.telegram_id, before)
    stats.telegram++
  }

  // Транспорт and Смены: Linko's rows, marked as written by the sync.
  for (const t of raw("transports")) {
    const values = [t.id, t.model ?? "", t.number ?? "", typeof t.driver === "object" && t.driver ? fullName(t.driver) : (t.driver ?? ""), Number(t.capacity) || 0, Number(t.load_limit) || 0, t.branch?.id ?? (typeof t.branch === "number" ? t.branch : null)]
    const before = (await client.query("SELECT * FROM transports WHERE id = $1", [t.id])).rows[0]
    await client.query(
      `INSERT INTO transports (id, model, number, driver, capacity, load_limit, branch_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'), to_char(now() AT TIME ZONE 'UTC' + interval '1 second', 'YYYY-MM-DD HH24:MI:SS'))
       ON CONFLICT (id) DO UPDATE SET model = EXCLUDED.model, number = EXCLUDED.number, driver = EXCLUDED.driver, capacity = EXCLUDED.capacity,
         load_limit = EXCLUDED.load_limit, branch_id = EXCLUDED.branch_id,
         updated_at = CASE WHEN transports.updated_at = transports.created_at THEN to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') ELSE transports.updated_at END`,
      values,
    )
    await client.query("UPDATE transports SET updated_at = to_char(now() AT TIME ZONE 'UTC' + interval '1 second', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1 AND updated_at = created_at", [t.id])
    await registerChange(client, "transports", t.id, before)
    stats.transports++
  }
  await client.query("SELECT setval(pg_get_serial_sequence('transports', 'id'), GREATEST((SELECT MAX(id) FROM transports), 1))")
  for (const s of raw("shifts")) {
    const before = (await client.query("SELECT * FROM work_shifts WHERE id = $1", [s.id])).rows[0]
    await client.query(
      `INSERT INTO work_shifts (id, name, begin_time, end_time, created_at, updated_at)
       VALUES ($1, $2, $3, $4, datetime('now'), to_char(now() AT TIME ZONE 'UTC' + interval '1 second', 'YYYY-MM-DD HH24:MI:SS'))
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, begin_time = EXCLUDED.begin_time, end_time = EXCLUDED.end_time`,
      [s.id, s.name ?? "", s.begin_time ?? "", s.end_time ?? ""],
    )
    await client.query("UPDATE work_shifts SET updated_at = to_char(now() AT TIME ZONE 'UTC' + interval '1 second', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1 AND updated_at = created_at", [s.id])
    await registerChange(client, "work_shifts", s.id, before)
    stats.shifts++
  }
  await client.query("SELECT setval(pg_get_serial_sequence('work_shifts', 'id'), GREATEST((SELECT MAX(id) FROM work_shifts), 1))")

  // Subscribers of the notification templates: Linko's, under link ids after every seeded one.
  const templates = raw("notification_templates")
  const known = new Set((await client.query("SELECT id FROM notification_templates")).rows.map((r) => r.id))
  const before = (await client.query("SELECT * FROM notification_template_users ORDER BY id")).rows
  const wanted = []
  for (const template of templates) {
    if (!known.has(template.id)) continue
    for (const user of template.users ?? []) wanted.push([template.id, Number(typeof user === "object" ? user.id : user)])
  }
  stats.subscribers = wanted.length
  // The links are replaced only when Linko's subscribers differ from the stored ones (a re-run keeps their ids).
  const pairs = (rows) => [...new Set(rows.map(([templateId, userId]) => `${templateId}:${userId}`))].sort()
  if (JSON.stringify(pairs(before.map((row) => [row.template_id, Number(row.user_id)]))) !== JSON.stringify(pairs(wanted))) {
    await client.query("DELETE FROM notification_template_users")
    let id = Math.max(1000, ...before.map((row) => row.id + 1))
    for (const [templateId, userId] of wanted) {
      await client.query("INSERT INTO notification_template_users (id, template_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id++, templateId, userId])
    }
    await client.query("SELECT setval(pg_get_serial_sequence('notification_template_users', 'id'), GREATEST((SELECT MAX(id) FROM notification_template_users), 1))")
    await register(client, run, "notification_template_users", "all", "replace", before)
  }

  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`settings lists: ${JSON.stringify(stats)}`)
