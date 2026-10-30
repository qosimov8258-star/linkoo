import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { dbErrorResponse } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { SalaryInputError, allSalaryRecords, listSalaryRecords, salaryKpiStats, setSalaries } from "@/lib/salary-records-repo"
import { dbId, strictNum } from "@/lib/strict-number"
import { parseJsonBody } from "@/lib/validation"

function clampMonth(value: string | null) {
  const month = Number(value)
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1
}

function clampYear(value: string | null) {
  const year = Number(value)
  return Number.isInteger(year) && year >= 1970 && year <= 2200 ? year : new Date().getFullYear()
}

/** GET /api/salary-records?month=&year=&tab=all|true|false&search=&page=&pageSize=  (all=1 returns the whole month). */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const url = new URL(request.url)
  const month = clampMonth(url.searchParams.get("month"))
  const year = clampYear(url.searchParams.get("year"))
  if (url.searchParams.get("stats") === "1") return NextResponse.json(await salaryKpiStats(month, year))
  if (url.searchParams.get("all") === "1") return NextResponse.json({ results: await allSalaryRecords(month, year) })
  const tabParam = url.searchParams.get("tab")
  const tab = tabParam === "true" || tabParam === "false" ? tabParam : "all"
  const pageSize = Math.min(500, Math.max(1, Number(url.searchParams.get("pageSize")) || 25))
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1)
  return NextResponse.json(await listSalaryRecords({ month, year, tab, search: url.searchParams.get("search") ?? "", page, pageSize }))
}

const MAX_MONEY = 1e13
const createSchema = z.object({
  month: strictNum(z.number({ error: "Неверные данные" }).int("Неверные данные").min(1, "Неверные данные").max(12, "Неверные данные"), "Неверные данные"),
  year: strictNum(z.number({ error: "Неверные данные" }).int("Неверные данные").min(2000, "Неверные данные").max(2100, "Неверные данные"), "Неверные данные"),
  currency: z.string({ error: "Неизвестная валюта" }).trim().max(100, "Неизвестная валюта").optional(),
  salaries: z
    .array(
      z.object({
        user: dbId("Выберите сотрудника"),
        salary: strictNum(z.number({ error: "Неверная сумма" }).min(0, "Сумма не может быть отрицательной").max(MAX_MONEY, "Слишком большая сумма"), "Неверная сумма"),
      }),
      { error: "Выберите сотрудника" },
    )
    .min(1, "Выберите сотрудника")
    .max(5000, "Слишком много значений"),
})

/** "Добавить зарплату": the salaries of the chosen employees for the month. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, createSchema)
  if (parsed.error) return parsed.error
  const { month, year, currency, salaries } = parsed.data
  try {
    const done = await setSalaries(month, year, currency ?? "", salaries.map((item) => ({ userId: item.user, salary: item.salary })))
    return NextResponse.json({ count: done }, { status: 201 })
  } catch (error) {
    if (error instanceof SalaryInputError) return NextResponse.json({ error: error.message }, { status: 400 })
    const response = dbErrorResponse(error)
    if (response) return response
    throw error
  }
}
