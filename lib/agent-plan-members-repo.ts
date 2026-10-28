import "server-only"

import { listFieldEmployees } from "@/lib/field-activity/employees"

// The field employees of "Анализ маршрутов" and of the photo-report employee strip: the same list and
// role groups as Отслеживание (lib/field-activity/employees.ts) — the employees shown in tracking
// (employees.show_in_tracking), each in the group of its job position (agent / merch / delivery /
// collector; other positions only under "Все"), in name order. No table of its own: the older
// agent_plan_members / agent_plan_order tables of existing databases are left as they are and are no
// longer read.

export type AgentPlanMember = {
  employeeId: number
  active: boolean
  /** Of "agent" | "merch" | "delivery" | "collector" (the ?group= tabs); empty for other positions. */
  groups: string[]
  /** Position in the display order (name order). */
  position: number
}

export async function listAgentPlanMembers(): Promise<AgentPlanMember[]> {
  const employees = await listFieldEmployees({ activeOnly: false, trackedOnly: true })
  return employees.map((employee, index) => ({
    employeeId: employee.employeeId,
    active: employee.active,
    groups: employee.group === "other" ? [] : [employee.group],
    position: index,
  }))
}
