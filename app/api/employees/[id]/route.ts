import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteEmployee, updateEmployee, type EmployeeInput } from "@/lib/employees-repo"

const employeeSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().optional(),
  integrationCode: z.string().optional(),
  position: z.string().optional(),
  branch: z.string().optional(),
  systemAccess: z.boolean().optional(),
  showInTracking: z.boolean().optional(),
  twoStepCheck: z.boolean().optional(),
  sessionLimit: z.boolean().optional(),
  gpsCheck: z.boolean().optional(),
  startPoint: z.boolean().optional(),
  organizations: z.array(z.string()).optional(),
  active: z.boolean().optional(),
})

function toEmployeeInput(data: z.infer<typeof employeeSchema>): EmployeeInput {
  return {
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phone ?? "",
    integrationCode: data.integrationCode ?? "",
    position: data.position ?? "",
    branch: data.branch ?? "",
    systemAccess: data.systemAccess ?? true,
    showInTracking: data.showInTracking ?? true,
    twoStepCheck: data.twoStepCheck ?? false,
    sessionLimit: data.sessionLimit ?? false,
    gpsCheck: data.gpsCheck ?? true,
    startPoint: data.startPoint ?? false,
    organizations: data.organizations ?? [],
    active: data.active ?? true,
  }
}

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, employeeSchema)
  if (parsed.error) return parsed.error

  const employee = (await updateEmployee(id, toEmployeeInput(parsed.data)))
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  return NextResponse.json(employee)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteEmployee(id))
  if (!ok) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
