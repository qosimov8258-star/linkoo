import { NextResponse } from "next/server"
import { z } from "zod"

import { employeeErrorResponse, parseEmployeeBody } from "@/lib/employees-api"
import { purgeEmployee, setEmployeeActive, updateEmployee } from "@/lib/employees-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseEmployeeBody(request)
  if ("error" in parsed) return parsed.error

  const result = await updateEmployee(id, parsed.data)
  if (!result) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  if ("error" in result) return employeeErrorResponse(result.error)
  return NextResponse.json(result.employee)
}

const activeSchema = z.object({ active: z.boolean() })

/** { active: false } moves the employee to "Удаленные", { active: true } brings them back. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, activeSchema)
  if (parsed.error) return parsed.error
  const employee = await setEmployeeActive(id, parsed.data.active)
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  return NextResponse.json(employee)
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  if (new URL(request.url).searchParams.get("permanent") === "1") {
    if (!(await purgeEmployee(id))) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
    return NextResponse.json({ ok: true })
  }
  const employee = await setEmployeeActive(id, false)
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
