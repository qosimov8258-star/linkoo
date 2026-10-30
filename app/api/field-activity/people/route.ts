import { NextResponse } from "next/server"

import { requireFieldReader, scopeAllows } from "@/lib/field-activity/actor"
import { fieldRoute } from "@/lib/field-activity/http"
import { listEmployees } from "@/lib/employees-repo"

// GET /api/field-activity/people — the employees the agent filters and agent lists of the field
// pages (Время работы агента, Анализ маршрутов, Проверка фотоотчетов, the dashboard's visits
// widget) may name: the Сотрудники list (same rows and order as GET /api/employees, including the
// branch picked in the top bar) narrowed to the reader's field scope (lib/field-activity/actor.ts) —
// an agent gets only their own employee and the agents they supervise, never anyone else's name.
// Only the fields those lists use are sent (no logins, phones or access settings).
// → [{id, firstName, lastName, name, position, branchIds, active, supervisorId}]; 403 for a user
// without any field scope.
export async function GET() {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  return fieldRoute(async () => {
    const employees = await listEmployees()
    return NextResponse.json(
      employees
        .filter((employee) => scopeAllows(reader.scope, employee.id))
        .map((employee) => ({
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          name: employee.name,
          position: employee.position,
          branchIds: employee.branchIds,
          active: employee.active,
          supervisorId: employee.supervisorId,
        })),
    )
  })
}
