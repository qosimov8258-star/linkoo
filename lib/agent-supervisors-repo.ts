import "server-only"

import { getDb } from "@/lib/db"

export type AgentSupervisor = { agent: string; supervisor: string }

/**
 * Agent -> supervisor pairs. The supervisor is stored on the employee card (`details.supervisorId`), the same place
 * the reference app keeps it; reports match agents by their "first last" name like the visit rows do.
 */
export async function listAgentSupervisors(): Promise<AgentSupervisor[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT trim(e.first_name || ' ' || e.last_name) AS agent, trim(s.first_name || ' ' || s.last_name) AS supervisor
         FROM employees e
         JOIN employees s ON s.id = CASE WHEN (e.details::json->>'supervisorId') ~ '^[0-9]+$' THEN (e.details::json->>'supervisorId')::int END
        ORDER BY e.id`,
    )
    .all()) as AgentSupervisor[]
  return rows
}
