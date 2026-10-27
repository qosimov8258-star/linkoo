import { NextResponse } from "next/server"

import { z } from "zod"

import { parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { employeeErrorResponse, parseEmployeeBody } from "@/lib/employees-api"
import { EmployeeInUseError, getEmployee, purgeEmployee, setEmployeeActive, updateEmployee } from "@/lib/employees-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Сотрудник не найден" }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseId((await params).id)
  const employee = id ? await getEmployee(id) : null
  if (!employee) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(employee)
}

// PUT /api/employees/[id] — a changed name is carried into cashboxes,
// warehouses, clients (agent / deliverer / collector), documents and production
// staff that store it.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseEmployeeBody(request)
  if ("error" in parsed) return parsed.error

  const result = await updateEmployee(id, parsed.data)
  if (!result) return NextResponse.json(NOT_FOUND, { status: 404 })
  if ("error" in result) return employeeErrorResponse(result.error)
  return NextResponse.json(result.employee)
}

const activeSchema = z.object({ active: z.boolean() })

/** { active: false } moves the employee to "Удаленные", { active: true } brings them back. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, activeSchema)
  if (parsed.error) return parsed.error
  const employee = await setEmployeeActive(id, parsed.data.active)
  if (!employee) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(employee)
}

// DELETE /api/employees/[id] — moves the employee to "Удаленные"; ?permanent=1 (only for an already deleted one)
// removes the record: 409 {error: "Удаление невозможно из-за связи с другими данными", usage}
// while a cashbox, warehouse, client, document or production record refers to the employee.
export async function DELETE(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  if (new URL(request.url).searchParams.get("permanent") === "1") {
    try {
      if (!(await purgeEmployee(id))) return NextResponse.json(NOT_FOUND, { status: 404 })
      return NextResponse.json({ ok: true })
    } catch (error) {
      if (error instanceof EmployeeInUseError) return NextResponse.json({ error: error.message, usage: error.usage }, { status: error.status })
      throw error
    }
  }
  const employee = await setEmployeeActive(id, false)
  if (!employee) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json({ ok: true })
}
