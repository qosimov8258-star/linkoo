// INSERT-only import of the reference's production data (stages, equipment, operations, staff, products, batches
// and their movements) into the empty local production_* tables. Every row is registered in demo_seed_rows
// (domain 'qa-prod'). Re-running inserts nothing (ON CONFLICT DO NOTHING / existence checks).
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const url = fs.readFileSync(path.join(root, ".env"), "utf8").match(/DATABASE_URL=(.*)/)[1].trim()
const data = JSON.parse(fs.readFileSync(path.join(root, "scripts/demo/data/production-reference.json"), "utf8"))
const logs = JSON.parse(fs.readFileSync(path.join(root, "scripts/demo/data/production-logs.json"), "utf8"))
const ingredients = JSON.parse(fs.readFileSync(path.join(root, "scripts/demo/data/production-ingredients.json"), "utf8"))
const DOMAIN = "qa-prod"
// The reference stores naive Tashkent wall-clock times; keep them as the same instant everywhere.
const ts = (value) => (value ? `${value}${/[zZ]|[+-]\d\d:\d\d$/.test(value) ? "" : "+05:00"}` : "")

const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz default now())")
const counts = {}
async function register(table, id) {
  await client.query("INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1, $2, $3)", [table, String(id), DOMAIN])
  counts[table] = (counts[table] ?? 0) + 1
}
async function insertWithId(table, columns, values, id) {
  const marks = values.map((_, i) => `$${i + 1}`).join(", ")
  const res = await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${marks}) ON CONFLICT (id) DO NOTHING RETURNING id`, values)
  if (res.rowCount) await register(table, id)
  return res.rowCount
}
async function bumpSequence(table) {
  await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM ${table}), 1))`)
}

const employeeName = async (id) => {
  if (!id) return ""
  const r = await client.query("SELECT first_name, last_name FROM employees WHERE id = $1", [id])
  return r.rows[0] ? `${r.rows[0].first_name} ${r.rows[0].last_name}`.trim() : ""
}

await client.query(`CREATE TABLE IF NOT EXISTS production_operation_meta (
  operation_id INTEGER PRIMARY KEY REFERENCES production_operations(id) ON DELETE CASCADE,
  equipment_name TEXT NOT NULL DEFAULT '',
  sort_order INTEGER
)`)
await client.query("BEGIN")
try {
  for (const s of data.stages) {
    await insertWithId("production_stages", ["id", "name", "warehouse", "responsible", "created_at"], [s.id, s.name, s.warehouse, await employeeName(s.responsible_person), ts(s.created_date)], s.id)
  }
  const firstStage = Math.min(...data.stages.map((s) => s.id))
  for (const [stageId, v] of Object.entries(data.perStage)) {
    for (const e of v.equipment) {
      await insertWithId("production_equipment", ["id", "stage_id", "name", "status", "image", "created_at"], [e.id, Number(stageId), e.name, e.status, "", ts(e.created_date)], e.id)
    }
    for (const sh of v.shifts) {
      const exists = await client.query("SELECT 1 FROM production_staff WHERE stage_id = $1 AND employee_id = $2 AND shift = $3", [Number(stageId), sh.user_id, sh.shift])
      if (exists.rowCount) continue
      const r = await client.query(
        "INSERT INTO production_staff (stage_id, employee_id, employee_name, position, shift, begin_time, end_time, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [Number(stageId), sh.user_id, sh.name, sh.position, sh.shift, sh.begin, sh.end, ts(data.stages[0].created_date)],
      )
      await register("production_staff", r.rows[0].id)
    }
    for (const p of v.products) {
      const exists = await client.query("SELECT 1 FROM production_recipes WHERE stage_id = $1 AND item_kind = 'product' AND item_id = $2", [Number(stageId), p.id])
      if (exists.rowCount) continue
      const r = await client.query(
        "INSERT INTO production_recipes (stage_id, item_kind, item_id, item_name, item_type, unit, amount, created_at) VALUES ($1,'product',$2,$3,$4,$5,$6,$7) RETURNING id",
        [Number(stageId), p.id, p.name, p.type, p.unit, Number(p.amount) > 0 ? Number(p.amount) : 1, ts(data.stages[0].created_date)],
      )
      await register("production_recipes", r.rows[0].id)
    }
  }
  // Raw-material components of every recipe (the reference's product "ingredient_list").
  for (const [stageId, v] of Object.entries(data.perStage)) {
    for (const p of v.products) {
      const recipe = await client.query("SELECT id FROM production_recipes WHERE stage_id = $1 AND item_kind = 'product' AND item_id = $2", [Number(stageId), p.id])
      if (!recipe.rowCount) continue
      for (const component of ingredients[String(p.id)] ?? []) {
        const exists = await client.query("SELECT 1 FROM production_recipe_items WHERE recipe_id = $1 AND role = 'raw' AND item_kind = 'product' AND item_id = $2", [recipe.rows[0].id, component.item_id])
        if (exists.rowCount) continue
        const r = await client.query(
          "INSERT INTO production_recipe_items (recipe_id, role, item_kind, item_id, item_name, unit, amount) VALUES ($1,'raw','product',$2,$3,$4,$5) RETURNING id",
          [recipe.rows[0].id, component.item_id, component.name, component.unit, component.amount],
        )
        await register("production_recipe_items", r.rows[0].id)
      }
    }
  }
  // Operations are global in the reference; the local table needs a stage, so they hang off the first one.
  for (const o of data.operations) {
    await insertWithId("production_operations", ["id", "stage_id", "title", "duration", "type", "created_at"], [o.id, firstStage, o.title, o.duration, o.type, ts(o.created_date)], o.id)
  }
  // Batches of stages that were deleted in the reference keep only the stage name (stage_id stays empty).
  const knownStages = new Set(data.stages.map((s) => s.id))
  for (const p of data.parties) {
    const stageRef = knownStages.has(p.stage_id) ? p.stage_id : null
    const inserted = await insertWithId(
      "production_parties",
      ["id", "stage_id", "stage_name", "date", "comment", "status", "user_name", "created_at", "finished_at"],
      [p.id, stageRef, p.stage_name, p.date, p.comment, p.status === "canceled" ? "cancelled" : p.status, p.user, ts(p.created_date), ts(p.finished_date)],
      p.id,
    )
    if (!inserted) continue
    for (const m of p.movements) {
      const r = await client.query(
        `INSERT INTO production_movements (stage_id, party_id, warehouse, direction, item_kind, item_id, item_name, unit, amount, cost, is_defect, comment, image, date, shift, worker, user_name, created_at)
         VALUES ($1,$2,$3,$4,'product',$5,$6,$7,$8,$9,$10,$11,'',$12,'','',$13,$14) RETURNING id`,
        [stageRef, p.id, p.warehouse, m.direction, m.item_id, m.name, m.unit, m.amount, m.cost, m.defect, m.comment, (m.created_date ?? p.created_date).slice(0, 10), p.user, ts(m.created_date)],
      )
      await register("production_movements", r.rows[0].id)
    }
  }
  // Operations: the reference's own order and the equipment each one names.
  for (const [index, o] of data.operations.entries()) {
    const exists = await client.query("SELECT 1 FROM production_operation_meta WHERE operation_id = $1", [o.id])
    if (exists.rowCount) continue
    await client.query("INSERT INTO production_operation_meta (operation_id, equipment_name, sort_order) VALUES ($1, $2, $3)", [o.id, o.equipment ?? "", index + 1])
    await register("production_operation_meta", o.id)
  }
  // Shift entries of the Активность tab ("logs": produced products = return, spent raw material = writeoff); no batch.
  const stageWarehouse = new Map(data.stages.map((s) => [s.id, s.warehouse]))
  for (const log of logs) {
    const exists = await client.query("SELECT 1 FROM production_movements WHERE party_id IS NULL AND stage_id = $1 AND item_id = $2 AND amount = $3 AND created_at::timestamptz = $4::timestamptz", [log.stage_id, log.item_id, log.amount, ts(log.created_date)])
    if (exists.rowCount) continue
    const r = await client.query(
      `INSERT INTO production_movements (stage_id, party_id, warehouse, direction, item_kind, item_id, item_name, unit, amount, cost, is_defect, comment, image, date, shift, worker, user_name, created_at)
       VALUES ($1,NULL,$2,$3,'product',$4,$5,$6,$7,0,$8,$9,'',$10,'','',$11,$12) RETURNING id`,
      [log.stage_id, stageWarehouse.get(log.stage_id) ?? "", log.type === "return" ? "made" : "raw", log.item_id, log.name, log.unit, log.amount, log.defect, log.comment, log.created_date.slice(0, 10), log.user, ts(log.created_date)],
    )
    await register("production_movements", r.rows[0].id)
  }
  // The reference's production consumed more "shokolod" than the local receipts at the toshkent warehouse: add a
  // confirmed opening count (stock inventory) so no balance goes negative.
  const topUp = await client.query("SELECT id FROM stock_inventories WHERE comment = 'Начальный остаток (производство)'")
  if (!topUp.rowCount) {
    const stamp = "2020-01-01 10:00:00"
    const inv = await client.query(
      `INSERT INTO stock_inventories (warehouse, inv_date, for_day_end, type, status, comment, currency, total_price, created_by, created_at, confirmed_at, confirmed_by)
       VALUES ('toshkent', '2020-01-01', 0, 'fact_date', 'confirmed', 'Начальный остаток (производство)', 'SUM', $1, 'Admin Ritm', $2, $2, 'Admin Ritm') RETURNING id`,
      [500 * 4536.78, stamp],
    )
    await register("stock_inventories", inv.rows[0].id)
    const item = await client.query(
      `INSERT INTO stock_inventory_items (inventory_id, item_key, item_name, unit, amount, balance_amount, diff, cost, total_price, series, position)
       VALUES ($1, 'product:142', 'shokolod', 'dona', 500, 0, 500, 4536.78, $2, '', 0) RETURNING id`,
      [inv.rows[0].id, 500 * 4536.78],
    )
    await register("stock_inventory_items", item.rows[0].id)
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
}
for (const t of ["production_stages", "production_equipment", "production_parties", "production_operations"]) await bumpSequence(t)
console.log(JSON.stringify(counts))
await client.end()
