import { NextResponse } from "next/server"
import { z } from "zod"

import { nameField, textField } from "@/lib/auth-request"
import { EmployeeError, type EmployeeInput } from "@/lib/employees-repo"

export const employeeSchema = z.object({
  firstName: nameField("Укажите имя", 100),
  lastName: nameField("Укажите фамилию", 100),
  phone: textField(50).optional(),
  integrationCode: textField(100).optional(),
  position: textField(120).optional(),
  branch: textField(120).optional(),
  systemAccess: z.boolean().optional(),
  showInTracking: z.boolean().optional(),
  twoStepCheck: z.boolean().optional(),
  sessionLimit: z.boolean().optional(),
  gpsCheck: z.boolean().optional(),
  startPoint: z.boolean().optional(),
  organizations: z.array(textField(200)).max(500).optional(),
  active: z.boolean().optional(),
})

export function toEmployeeInput(data: z.infer<typeof employeeSchema>): EmployeeInput {
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

export function employeeErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof EmployeeError)) return null
  return NextResponse.json({ error: error.message, ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
}
