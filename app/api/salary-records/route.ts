import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { allSalaryRecords, listSalaryRecords, salaryKpiStats, setSalaries } from "@/lib/salary-records-repo"

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

const createSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(1970).max(2200),
  currency: z.string().trim().optional(),
  salaries: z.array(z.object({ user: z.coerce.number().int(), salary: z.coerce.number().finite().nonnegative() })).min(1),
})

/** "Добавить зарплату": the salaries of the chosen employees for the month. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, createSchema)
  if (parsed.error) return parsed.error
  const { month, year, currency, salaries } = parsed.data
  const done = await setSalaries(month, year, currency ?? "", salaries.map((item) => ({ userId: item.user, salary: item.salary })))
  return NextResponse.json({ count: done }, { status: 201 })
}
