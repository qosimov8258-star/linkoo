import "server-only"

import { getDb } from "@/lib/db"

// The reference's agent day card header (market/detail_plan + the markets' plan statuses of that day), stored per agent and day.
export type AgentDayPlan = {
  orderTotal: number
  paymentTotal: number
  visitTasks: number
  visitDone: number
  noPlan: number
  reportTasks: number
  reportDone: number
  deliveryTasks: number
  deliveryDone: number
  returnTotal: number
  ordersDone: number
  rejectionsDone: number
  needVisit: number
}

export const EMPTY_DAY_PLAN: AgentDayPlan = { orderTotal: 0, paymentTotal: 0, visitTasks: 0, visitDone: 0, noPlan: 0, reportTasks: 0, reportDone: 0, deliveryTasks: 0, deliveryDone: 0, returnTotal: 0, ordersDone: 0, rejectionsDone: 0, needVisit: 0 }

async function ensure() {
  const db = getDb()
  await db.exec("CREATE TABLE IF NOT EXISTS agent_day_plans (user_id INTEGER NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, day))")
  return db
}

export async function getAgentDayPlan(userId: number, day: string): Promise<AgentDayPlan> {
  const db = await ensure()
  const row = (await db.prepare("SELECT data FROM agent_day_plans WHERE user_id = ? AND day = ?").get(userId, day)) as { data: string } | undefined
  if (!row) return EMPTY_DAY_PLAN
  try {
    return { ...EMPTY_DAY_PLAN, ...(JSON.parse(row.data) as Partial<AgentDayPlan>) }
  } catch {
    return EMPTY_DAY_PLAN
  }
}
