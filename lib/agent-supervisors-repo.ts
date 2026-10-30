import "server-only"

import { getDb } from "@/lib/db"

export type AgentSupervisor = { agentId: number; agent: string; supervisorId: number; supervisor: string }

/**
 * Agent -> supervisor pairs. The supervisor is stored on the employee card (`details.supervisorId`), the same place
 * the reference app keeps it; reports match agents by their "first last" name like the visit rows do. `employeeIds`
 * (the reader's field scope, lib/field-activity/actor.ts) keeps only the pairs of those agents (undefined = all).
 */
export async function listAgentSupervisors(employeeIds?: number[]): Promise<AgentSupervisor[]> {
  if (employeeIds && !employeeIds.length) return []
  const rows = (await getDb()
    .prepare(
      `SELECT e.id AS agent_id, trim(e.first_name || ' ' || e.last_name) AS agent, s.id AS supervisor_id, trim(s.first_name || ' ' || s.last_name) AS supervisor
         FROM employees e
         JOIN employees s ON s.id = CASE WHEN (e.details::json->>'supervisorId') ~ '^[0-9]{1,9}$' THEN (e.details::json->>'supervisorId')::int END
        WHERE ${employeeIds ? "e.id = ANY(@employeeIds::int[])" : "true"}
        ORDER BY e.id`,
    )
    .all(...(employeeIds ? [{ employeeIds }] : []))) as Array<{ agent_id: number; agent: string; supervisor_id: number; supervisor: string }>
  return rows.map((row) => ({ agentId: Number(row.agent_id), agent: row.agent, supervisorId: Number(row.supervisor_id), supervisor: row.supervisor }))
}
