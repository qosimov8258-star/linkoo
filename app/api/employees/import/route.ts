import { NextResponse } from "next/server"
import { z } from "zod"

import { getDb } from "@/lib/db"
import { employeeFailureMessage, idField } from "@/lib/employees-api"
import { EmployeeAccessError, createEmployee, getEmployee, updateEmployee } from "@/lib/employees-repo"
import { ensureEmployeesSchema } from "@/lib/employees-schema"
import type { EmployeeInput } from "@/components/analytics/employees-data"
import { nameKey } from "@/lib/platform-refs"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const TOO_LONG = "Не более 255 символов"
const text = () => z.string().trim().max(255, TOO_LONG).default("")

const importSchema = z.object({
  mode: z.enum(["create", "update"], { error: "Неверное значение" }),
  rows: z
    .array(
      z.object({
        id: idField().optional(),
        firstName: text(),
        lastName: text(),
        phone: z.string().trim().max(64, "Слишком длинное значение").default(""),
        job: text(),
        branch: text(),
        integrationCode: text(),
      }),
    )
    .min(1, "Не удалось найти сотрудников для импорта в выбранном файле")
    .max(2000, "Слишком много значений"),
})

/** Ids by name key (case, spaces and Unicode form ignored); empty while the table does not exist yet. */
async function idsByName(table: "job_positions" | "branches"): Promise<Map<string, number>> {
  const db = getDb()
  const exists = (await db.prepare("SELECT to_regclass(@name::text) IS NOT NULL AS ok").get({ name: table })) as { ok: boolean } | undefined
  if (!exists?.ok) return new Map()
  const rows = (await db.prepare(`SELECT id, name FROM ${table} ORDER BY id`).all()) as Array<{ id: number; name: string }>
  const byName = new Map<string, number>()
  for (const row of rows) {
    const key = nameKey(row.name.normalize("NFC"))
    if (!byName.has(key)) byName.set(key, Number(row.id))
  }
  return byName
}

/** "Импортировать" / "Обновить с excel": creates employees from rows (or updates the ones named by №). Row errors are reported, the rest is saved. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, importSchema)
  if (parsed.error) return parsed.error
  await ensureEmployeesSchema()
  const [jobs, branches] = await Promise.all([idsByName("job_positions"), idsByName("branches")])

  let saved = 0
  const errors: Array<{ row: number; message: string }> = []
  for (const [index, row] of parsed.data.rows.entries()) {
    const line = index + 1
    const current = row.id ? await getEmployee(row.id) : null
    if (parsed.data.mode === "update" && !current) {
      errors.push({ row: line, message: "Сотрудник не найден" })
      continue
    }
    const jobId = row.job ? jobs.get(nameKey(row.job)) : current?.jobId
    const branchIds = row.branch ? [branches.get(nameKey(row.branch))].filter((id): id is number => Boolean(id)) : (current?.branchIds ?? [])
    const firstName = row.firstName || current?.firstName || ""
    const lastName = row.lastName || current?.lastName || ""
    const phone = row.phone || current?.phone || ""
    if (!firstName || !lastName || !phone) {
      errors.push({ row: line, message: "Заполните имя, фамилию и телефон" })
      continue
    }
    if (!jobId) {
      errors.push({ row: line, message: "Должность не найдена" })
      continue
    }
    if (!branchIds.length) {
      errors.push({ row: line, message: "Филиал не найден" })
      continue
    }
    const input: EmployeeInput = {
      firstName,
      lastName,
      phone,
      integrationCode: row.integrationCode || current?.integrationCode || "",
      jobId,
      branchIds,
      organizationIds: current?.organizationIds ?? [],
      systemAccess: current?.systemAccess ?? false,
      showInTracking: current?.showInTracking ?? false,
      twoStepCheck: current?.twoStepCheck ?? false,
      sessionLimit: current?.sessionLimit ?? false,
      gpsCheck: current?.gpsCheck ?? true,
      startPoint: current?.startPoint ?? false,
      locationPointIds: current?.locationPointIds ?? [],
      login: current?.login ?? "",
      accessRightId: current?.accessRightId ?? null,
      password: "",
      licenseKey: "",
      supervisorId: current?.supervisorId ?? null,
      deliveryManId: current?.deliveryManId ?? null,
      auditAgentIds: current?.auditAgentIds ?? [],
      stockIds: current?.stockIds ?? [],
      requestStockIds: current?.requestStockIds ?? [],
      priceListIds: current?.priceListIds ?? [],
      marketPriceListIds: current?.marketPriceListIds ?? [],
      currencyIds: current?.currencyIds ?? [],
    }
    const actor = { id: auth.user.id, role: auth.user.role }
    let result: Awaited<ReturnType<typeof updateEmployee>>
    try {
      result = current && parsed.data.mode === "update" ? await updateEmployee(current.id, input, actor) : await createEmployee(input, actor)
    } catch (error) {
      // An access change refused for this row (the employee's access changed meanwhile): the row's own message.
      if (!(error instanceof EmployeeAccessError)) throw error
      errors.push({ row: line, message: error.message })
      continue
    }
    if (!result) errors.push({ row: line, message: "Сотрудник не найден" })
    else if ("error" in result) errors.push({ row: line, message: employeeFailureMessage(result) })
    else saved += 1
  }
  return NextResponse.json({ saved, errors })
}
