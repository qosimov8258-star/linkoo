import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { employeeErrorResponse, parseEmployeeBody } from "@/lib/employees-api"
import { createEmployee, listEmployees } from "@/lib/employees-repo"
import { attachLicenseToEmployee } from "@/lib/subscriptions-repo"
import { requireRole } from "@/lib/rbac"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listEmployees())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseEmployeeBody(request)
  if ("error" in parsed) return parsed.error

  const result = await createEmployee(parsed.data)
  if ("error" in result) return employeeErrorResponse(result.error)
  if (parsed.data.licenseKey) {
    const attached = await attachLicenseToEmployee(result.employee.id, parsed.data.licenseKey)
    if (!attached) return NextResponse.json({ ...result.employee, warning: "Нет доступных лицензий этого типа" }, { status: 201 })
  }
  return NextResponse.json(result.employee, { status: 201 })
}
