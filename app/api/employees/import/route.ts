import { NextResponse } from "next/server"
import { z } from "zod"

import { getDb } from "@/lib/db"
import { createEmployee, getEmployee, updateEmployee } from "@/lib/employees-repo"
import { ensureEmployeesSchema } from "@/lib/employees-schema"
import type { EmployeeInput } from "@/components/analytics/employees-data"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

const importSchema = z.object({
  mode: z.enum(["create", "update"]),
  rows: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        firstName: z.string().trim().default(""),
        lastName: z.string().trim().default(""),
        phone: z.string().trim().default(""),
        job: z.string().trim().default(""),
        branch: z.string().trim().default(""),
        integrationCode: z.string().trim().default(""),
      }),
    )
    .min(1)
    .max(2000),
})

async function idsByName(table: "job_positions" | "branches"): Promise<Map<string, number>> {
  const rows = (await getDb().prepare(`SELECT id, name FROM ${table}`).all()) as Array<{ id: number; name: string }>
  return new Map(rows.map((row) => [row.name.trim().toLowerCase(), row.id]))
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
    const jobId = row.job ? jobs.get(row.job.toLowerCase()) : current?.jobId
    const branchIds = row.branch ? [branches.get(row.branch.toLowerCase())].filter((id): id is number => Boolean(id)) : (current?.branchIds ?? [])
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
    const result = current && parsed.data.mode === "update" ? await updateEmployee(current.id, input) : await createEmployee(input)
    if (!result || "error" in result) errors.push({ row: line, message: "Не удалось сохранить сотрудника" })
    else saved += 1
  }
  return NextResponse.json({ saved, errors })
}
