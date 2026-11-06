// Зарплата: the 30 salary plans a demo seed invented (salary_plans, registered in demo_seed_rows) added accruals Linko
// does not have to the employee balances (Баланс сотрудников: Оклад / KPI). Linko's salary data is the salary records
// (staff/salary, already in salary_records) and what was credited (salary_credits). This removes the demo plans.
//
//   node scripts/linko-sync/remove-demo-salary-plans.mjs
import { connect, ensureRegistry, register, runId } from "./lib.mjs"

const run = runId("salary-plans")
const client = await connect()
await ensureRegistry(client)
let removed = 0
try {
  await client.query("BEGIN")
  const rows = (await client.query(
    "SELECT s.* FROM salary_plans s JOIN demo_seed_rows d ON d.table_name = 'salary_plans' AND d.row_id = s.id::text",
  )).rows
  for (const row of rows) {
    await client.query("DELETE FROM salary_plans WHERE id = $1", [row.id])
    await register(client, run, "salary_plans", row.id, "delete", row)
    removed++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`salary plans: demo rows removed ${removed}`)
