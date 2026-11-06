// One-off repair after import-auth-logs.mjs met ids this app had already used: the app's own sign-ins (rows with a
// session of this app, user_sessions) that had taken ids Linko later used for its own rows are moved to new ids with
// their own values (kept in linko_sync_rows.previous), and the Linko rows lose that foreign session link.
//
//   node scripts/linko-sync/fix-auth-log-collisions.mjs
import { connect, ensureRegistry, register, runId } from "./lib.mjs"

const run = runId("auth-logs-collisions")
const client = await connect()
await ensureRegistry(client)
let moved = 0
try {
  await client.query("BEGIN")
  const rows = (
    await client.query(
      `SELECT l.*, (SELECT r.previous FROM linko_sync_rows r WHERE r.table_name = 'auth_logs' AND r.row_id = l.id::text AND r.action = 'update'
                     ORDER BY r.seq LIMIT 1) AS previous
         FROM auth_logs l
        WHERE l.session_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM linko_sync_rows r WHERE r.table_name = 'auth_logs' AND r.row_id = l.id::text AND r.action = 'update')
        ORDER BY l.id`,
    )
  ).rows
  for (const row of rows) {
    const old = { ...row, ...(row.previous ?? {}) }
    const inserted = (
      await client.query(
        `INSERT INTO auth_logs (employee_id, ip, browser, device, created_at, last_response_at, is_active, session_id, journal_revoked_at, journal_ended_by, journal_account_mark)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [old.employee_id, old.ip, old.browser, old.device, old.created_at, old.last_response_at, old.is_active, row.session_id, row.journal_revoked_at, row.journal_ended_by, row.journal_account_mark],
      )
    ).rows[0]
    await client.query("UPDATE auth_logs SET session_id = NULL, journal_revoked_at = NULL, journal_ended_by = NULL, journal_account_mark = NULL WHERE id = $1", [row.id])
    await register(client, run, "auth_logs", inserted.id, "insert", { movedFrom: row.id })
    moved++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`auth logs: ${moved} sign-ins of this app moved to new ids`)
