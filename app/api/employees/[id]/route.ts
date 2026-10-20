import { NextResponse } from "next/server"

import { employeeErrorResponse, employeeSchema, toEmployeeInput } from "@/app/api/employees/schema"
import { parseBody, parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { deleteEmployee, getEmployee, updateEmployee } from "@/lib/employees-repo"
import { requireRole } from "@/lib/rbac"

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
  const parsed = await parseBody(request, employeeSchema)
  if (parsed.error) return parsed.error

  try {
    const employee = await updateEmployee(id, toEmployeeInput(parsed.data))
    if (!employee) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(employee)
  } catch (error) {
    const response = employeeErrorResponse(error)
    if (response) return response
    throw error
  }
}

// DELETE /api/employees/[id] — 409 {error: "Удаление невозможно из-за связи с другими данными", usage}
// while a cashbox, warehouse, client, document or production record refers to the employee.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteEmployee(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = employeeErrorResponse(error)
    if (response) return response
    throw error
  }
}
