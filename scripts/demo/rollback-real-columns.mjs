// The REAL→double precision widening kept a full copy of each table in demo_seed_backup_real_<table> (columns stay double precision).
// This restores the old float4 values by id; run only if the widened values must be reverted.
import pg from "pg"
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const { rows } = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'demo_seed_backup_real_%'")
for (const { table_name } of rows) {
  const table = table_name.replace("demo_seed_backup_real_", "")
  const cols = (await c.query("SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND data_type='real'", [table_name])).rows.map((r) => r.column_name)
  if (!cols.length) continue
  const set = cols.map((col) => `${col} = b.${col}`).join(", ")
  const r = await c.query(`UPDATE ${table} t SET ${set} FROM ${table_name} b WHERE b.id = t.id`)
  console.log(table, r.rowCount)
}
await c.end()
