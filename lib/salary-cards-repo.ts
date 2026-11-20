import "server-only"

import { getDb } from "@/lib/db"
import { allSalaryRecords } from "@/lib/salary-records-repo"

/**
 * The row card of a «Зарплата и установка планов» record (the reference's staff/salary/<id>/): the record with the KPI
 * balances stored for its employee and month (salary_kpi_balances, created by the salary schema bootstrap), in the
 * shape of the KPI detail panel ("KPI план филиалов" uses the same card).
 */
export async function salaryCard(id: number) {
  const db = getDb()
  const head = (await db.prepare("SELECT month, year FROM salary_records WHERE id = ?").get(id)) as { month: number; year: number } | undefined
  if (!head) return null
  // allSalaryRecords also makes sure the salary tables exist
  const record = (await allSalaryRecords(head.month, head.year)).find((item) => item.id === id)
  if (!record) return null
  type BalanceRow = { kpi_id: number; kpi_name: string; plan_type: string; level: number | null; level_from: number | null; level_to: number | null; plan: number; sales: number | null; returns: number | null; fact: number | null; bonus: number; forecast: number | null; daily_plan: number | null; last_date: string | null }
  const balances = (await db
    .prepare("SELECT * FROM salary_kpi_balances WHERE user_id = ? AND month = ? AND year = ? ORDER BY kpi_id ASC, level ASC")
    .all(record.userId, record.month, record.year)) as BalanceRow[]
  const num = (value: number | null) => (value == null ? null : Number(value))
  return {
    id: record.id,
    name: record.name,
    month: record.month,
    year: record.year,
    salary: record.salary,
    currency: record.currency,
    lastDate: balances.reduce<string | null>((last, item) => (item.last_date && (!last || item.last_date > last) ? item.last_date : last), null),
    bonusLines: record.currencies.map((item) => ({ value: item.totalBonus, currency: item.name })),
    totalLines: record.currencies.map((item) => ({ value: item.totalSalary, currency: item.name })),
    balances: balances.map((item) => ({
      performanceIndicator: { id: item.kpi_id, name: item.kpi_name, planType: item.plan_type, supported: true },
      performanceIndicatorLevel: item.level == null ? null : { level: item.level, fromAmount: Number(item.level_from ?? 0), toAmount: Number(item.level_to ?? 0) },
      planAmount: Number(item.plan),
      salesAmount: num(item.sales),
      returnAmount: num(item.returns),
      factAmount: num(item.fact),
      dailyPlan: num(item.daily_plan),
      planForecast: num(item.forecast),
      bonusAmount: Number(item.bonus),
    })),
  }
}
