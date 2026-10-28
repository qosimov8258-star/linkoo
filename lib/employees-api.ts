import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import type { EmployeeInput } from "@/components/analytics/employees-data"
import type { EmployeeError } from "@/lib/employees-repo"

const REQUIRED = "Обязательное поле"
const ids = z.array(z.number().int().positive()).default([])
const optionalId = z.number().int().positive().nullable().default(null)

export const employeeSchema = z
  .object({
    firstName: z.string().trim().min(1, REQUIRED).max(255),
    lastName: z.string().trim().min(1, REQUIRED).max(255),
    phone: z.string().trim().min(1, REQUIRED).max(64),
    integrationCode: z.string().trim().max(255).default(""),
    jobId: z.number({ error: REQUIRED }).int().positive(REQUIRED),
    branchIds: z.array(z.number().int().positive()).min(1, REQUIRED),
    organizationIds: z.array(z.number().int().positive()).min(1, REQUIRED),
    systemAccess: z.boolean().default(false),
    showInTracking: z.boolean().default(false),
    twoStepCheck: z.boolean().default(false),
    sessionLimit: z.boolean().default(false),
    gpsCheck: z.boolean().default(true),
    startPoint: z.boolean().default(false),
    locationPointIds: ids,
    cashboxIds: ids,
    requestCashboxIds: ids,
    login: z.string().trim().max(255).default(""),
    accessRightId: optionalId,
    password: z.string().max(255).default(""),
    licenseKey: z.string().trim().max(64).default(""),
    supervisorId: optionalId,
    deliveryManId: optionalId,
    auditAgentIds: ids,
    stockIds: ids,
    requestStockIds: ids,
    priceListIds: ids,
    marketPriceListIds: ids,
    currencyIds: ids,
  })
  .superRefine((value, ctx) => {
    if (!value.systemAccess) return
    if (!value.login) ctx.addIssue({ code: "custom", path: ["login"], message: REQUIRED })
    if (!value.accessRightId) ctx.addIssue({ code: "custom", path: ["accessRightId"], message: REQUIRED })
  })

export type EmployeeBody = z.infer<typeof employeeSchema>

/** Reads the body; on a validation failure answers 400 with `{ error, fields: { path: message } }` for the dialog. */
export async function parseEmployeeBody(request: Request): Promise<{ data: EmployeeInput } | { error: NextResponse }> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return { error: NextResponse.json({ error: "Тело запроса не является JSON" }, { status: 400 }) }
  }
  const result = employeeSchema.safeParse(json)
  if (!result.success) {
    const fields: Record<string, string> = {}
    for (const issue of result.error.issues) fields[String(issue.path[0] ?? "")] ??= issue.message
    return { error: NextResponse.json({ error: "Проверьте заполнение обязательных полей", fields }, { status: 400 }) }
  }
  return { data: result.data }
}

const ERRORS: Record<EmployeeError, { status: number; field?: string; message: string }> = {
  login_taken: { status: 409, field: "login", message: "Пользователь с таким логином уже существует" },
  bad_branch: { status: 400, field: "branchIds", message: "Выбран несуществующий филиал" },
  bad_organization: { status: 400, field: "organizationIds", message: "Организация не найдена" },
  bad_job: { status: 400, field: "jobId", message: "Выбрана несуществующая должность" },
  bad_access_right: { status: 400, field: "accessRightId", message: "Выбраны несуществующие права доступа" },
  bad_supervisor: { status: 400, field: "supervisorId", message: "Выбран несуществующий сотрудник" },
  no_license: { status: 409, field: "licenseKey", message: "Нет доступных лицензий этого типа" },
}

export function employeeErrorResponse(error: EmployeeError): NextResponse {
  const info = ERRORS[error]
  return NextResponse.json({ error: info.message, fields: info.field ? { [info.field]: info.message } : {} }, { status: info.status })
}
