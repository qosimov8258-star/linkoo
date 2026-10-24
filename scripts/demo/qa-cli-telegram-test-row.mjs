// QA helper (domain "qa-cli"): inserts ONE test bot user so the delete flow of "Пользователи Телеграм бота" can be
// exercised without touching the real rows. INSERT-only; registered in demo_seed_rows. The test itself deletes it
// through the app (DELETE /api/telegram-users/<id>).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const url = process.env.DATABASE_URL || fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)[1].trim()
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text NOT NULL, row_id text NOT NULL, domain text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (table_name, row_id, domain))")
  const id = "9999000001"
  const result = await client.query(
    "INSERT INTO telegram_users (id, first_name, last_name, username, phone, language, market_id, market_name, created_date, last_active) VALUES ($1, 'QA', 'Test', 'qa_cli_test', '', '', NULL, '', $2, $2) ON CONFLICT (id) DO NOTHING RETURNING id",
    [id, new Date().toISOString()],
  )
  if (result.rowCount) await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('telegram_users', $1, 'qa-cli') ON CONFLICT DO NOTHING", [id])
  console.log({ inserted: result.rowCount })
} finally {
  await client.end()
}
