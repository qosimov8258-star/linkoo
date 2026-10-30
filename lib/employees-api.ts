import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import type { Employee, EmployeeInput } from "@/components/analytics/employees-data"
import type { CurrentUser } from "@/lib/current-user"
import { ACCOUNT_ADMIN_ONLY } from "@/lib/employees-account"
import type { EmployeeError, EmployeeFailure } from "@/lib/employees-repo"
import { hasPermission } from "@/lib/rbac"
import { INVALID_ID, MAX_DB_ID } from "@/lib/strict-number"
import { NOT_JSON_MESSAGE, cleanJsonText, zodIssueKey } from "@/lib/validation"

const REQUIRED = "Обязательное поле"
/** An id: a JSON number that is a positive int4 (a larger number is no record, and Postgres would refuse it). */
export const idField = (message = INVALID_ID) => z.number({ error: message }).int(message).positive(message).max(MAX_DB_ID, message)
/** A list of ids (a form never sends more than a few hundred). */
export const idListField = () => z.array(idField(), { error: INVALID_ID }).max(1000, INVALID_ID)
const ids = idListField().default([])
const optionalId = idField().nullable().default(null)

export const employeeSchema = z
  .object({
    firstName: z.string().trim().min(1, REQUIRED).max(255),
    lastName: z.string().trim().min(1, REQUIRED).max(255),
    phone: z.string().trim().min(1, REQUIRED).max(64),
    integrationCode: z.string().trim().max(255).default(""),
    jobId: idField(REQUIRED),
    branchIds: idListField().min(1, REQUIRED),
    organizationIds: idListField().min(1, REQUIRED),
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
    // Never echoed: only hashed for the linked sign-in account (lib/employees-account.ts checks the policy).
    password: z.string().max(255, "Пароль слишком длинный").default(""),
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
    return { error: NextResponse.json({ error: NOT_JSON_MESSAGE }, { status: 400 }) }
  }
  // Strings NFC-normalised, invisible characters dropped, control characters of names folded (lib/validation.ts).
  const cleaned = cleanJsonText(json)
  if (cleaned.issue) {
    const fields = cleaned.issue.field ? { [cleaned.issue.field.split(".")[0]]: cleaned.issue.message } : {}
    return { error: NextResponse.json({ error: cleaned.issue.message, fields }, { status: 400 }) }
  }
  // Every refusal is a Russian i18n key (the schema's own message, else zodIssueKey's).
  const result = employeeSchema.safeParse(cleaned.value, { error: (issue) => zodIssueKey(issue as Parameters<typeof zodIssueKey>[0]) })
  if (!result.success) {
    const fields: Record<string, string> = {}
    for (const issue of result.error.issues) fields[String(issue.path[0] ?? "")] ??= issue.message
    return { error: NextResponse.json({ error: "Проверьте заполнение обязательных полей", fields }, { status: 400 }) }
  }
  return { data: result.data }
}

const ERRORS: Record<EmployeeError, { status: number; field?: string; message: string }> = {
  login_taken: { status: 409, field: "login", message: "Пользователь с таким логином уже существует" },
  // The login / password of the sign-in account (the failure carries the policy's own message).
  bad_login: { status: 400, field: "login", message: "Логин может содержать только буквы, цифры и символы . _ - @" },
  weak_password: { status: 400, field: "password", message: "Пароль слишком простой" },
  account_forbidden: { status: 403, field: "login", message: ACCOUNT_ADMIN_ONLY },
  bad_branch: { status: 400, field: "branchIds", message: "Выбран несуществующий филиал" },
  bad_organization: { status: 400, field: "organizationIds", message: "Организация не найдена" },
  bad_job: { status: 400, field: "jobId", message: "Выбрана несуществующая должность" },
  bad_access_right: { status: 400, field: "accessRightId", message: "Выбраны несуществующие права доступа" },
  bad_supervisor: { status: 400, field: "supervisorId", message: "Выбран несуществующий сотрудник" },
  bad_audit_agent: { status: 400, field: "auditAgentIds", message: "Выбран несуществующий сотрудник" },
  bad_stock: { status: 400, field: "stockIds", message: "Склад не найден" },
  bad_price_list: { status: 400, field: "priceListIds", message: "Прайс-лист не найден" },
  bad_currency: { status: 400, field: "currencyIds", message: "Валюта не найдена" },
  bad_cashbox: { status: 400, field: "cashboxIds", message: "Касса не найдена" },
  bad_location: { status: 400, field: "locationPointIds", message: "Точка локации не найдена" },
  bad_restriction: { status: 400, field: "restrictions", message: "Ограничение не найдено" },
  unknown_employee: { status: 404, message: "Сотрудник не найден" },
  self_reference: { status: 400, field: "supervisorId", message: "Нельзя выбрать самого сотрудника" },
  no_license: { status: 409, field: "licenseKey", message: "Нет доступных лицензий этого типа" },
  // A required reference whose stored record was deleted (the failure names the field).
  required: { status: 400, message: REQUIRED },
}

/** The message (a Russian i18n key) of a refused input. */
export function employeeErrorMessage(error: EmployeeError): string {
  return ERRORS[error].message
}

/** The message (a Russian i18n key) of a refused input, its own one first. */
export function employeeFailureMessage(failure: EmployeeFailure): string {
  return failure.message ?? ERRORS[failure.error].message
}

/** The JSON answer to a refused input: `{ error, fields: { field: message }, ids?, names? }` (the dialog
 * shows the message under the field; ids / names are the references that were not found). */
export function employeeErrorResponse(failure: EmployeeFailure): NextResponse {
  const info = ERRORS[failure.error]
  const field = failure.field ?? info.field
  const message = employeeFailureMessage(failure)
  return NextResponse.json(
    {
      error: message,
      fields: field ? { [field]: message } : {},
      ...(failure.ids?.length ? { ids: failure.ids } : {}),
      ...(failure.names?.length ? { names: failure.names } : {}),
    },
    { status: info.status },
  )
}

// Sign-in and security settings of an employee card: only staff managers (settings.manage) and the salary
// planners (finance.manage: the salary template is keyed by login) read them. Every other signed-in user gets
// the cards without them; the pickers across orders, cash and salary only need names, positions and links.
const PRIVATE_FIELDS = [
  "account",
  "canSignIn",
  "accesses",
  "twoStepCheck",
  "sessionLimit",
  "gpsCheck",
  "startPoint",
  "systemAccess",
  "showInTracking",
  "integrationCode",
] as const

/** The employee cards as `user` may read them (see PRIVATE_FIELDS). */
export function employeeCardsFor(user: CurrentUser, employees: Employee[]): Partial<Employee>[] {
  if (hasPermission(user, "settings.manage")) return employees
  const salaryPlanner = hasPermission(user, "finance.manage")
  return employees.map((employee) => {
    const card: Partial<Employee> = { ...employee }
    for (const field of PRIVATE_FIELDS) delete card[field]
    if (!salaryPlanner) delete card.login
    return card
  })
}
