import "server-only"

import { getDb } from "@/lib/db"

// Membership of the reference's `agents_plans`: the employees "Анализ маршрутов" lists (its "Не Вышли N" counts
// the active ones). The rows come from scripts/demo/seed-agent-plan.mjs; while the table is empty the page
// falls back to every active employee.

export type AgentPlanMember = { employeeId: number; active: boolean; /** Of "agent" | "merch" | "delivery" | "collector" (the reference's ?group= tabs); an employee may be in several. */ groups: string[]; /** Position in the reference's display order (-1 when unknown). */ position: number }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agent_plan_members (
      employee_id INTEGER PRIMARY KEY,
      active INTEGER NOT NULL DEFAULT 1,
      group_key TEXT NOT NULL DEFAULT ''
    );
  `)
  await db.exec("ALTER TABLE agent_plan_members ADD COLUMN IF NOT EXISTS group_key TEXT NOT NULL DEFAULT ''")
}

export async function listAgentPlanMembers(): Promise<AgentPlanMember[]> {
  const db = getDb()
  await ensureSchema(db)
  await db.exec("CREATE TABLE IF NOT EXISTS agent_plan_order (employee_id INTEGER PRIMARY KEY, position INTEGER NOT NULL)")
  const rows = (await db
    .prepare(
      `SELECT m.employee_id, m.active, m.group_key, COALESCE(o.position, -1) AS position FROM agent_plan_members m
       LEFT JOIN agent_plan_order o ON o.employee_id = m.employee_id ORDER BY m.employee_id`,
    )
    .all()) as Array<{ employee_id: number; active: number; group_key: string; position: number }>
  return rows.map((row) => ({ employeeId: Number(row.employee_id), active: Number(row.active) === 1, groups: String(row.group_key || "").split(",").filter(Boolean), position: Number(row.position) }))
}
