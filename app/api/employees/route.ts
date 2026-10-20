import { NextResponse } from "next/server"

import { employeeErrorResponse, employeeSchema, toEmployeeInput } from "@/app/api/employees/schema"
import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { createEmployee, listEmployees } from "@/lib/employees-repo"
import { requireRole } from "@/lib/rbac"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listEmployees())
}

// POST /api/employees — branch and position must name an existing Филиал and
// Должность (400 otherwise).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, employeeSchema)
  if (parsed.error) return parsed.error

  try {
    const employee = await createEmployee(toEmployeeInput(parsed.data))
    return NextResponse.json(employee, { status: 201 })
  } catch (error) {
    const response = employeeErrorResponse(error)
    if (response) return response
    throw error
  }
}
