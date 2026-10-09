"use client"

import { ExpenseReportView, type ExpenseReportConfig } from "@/components/analytics/expense-report-view"

// "Расходы по категориям" (demo #/statistics/outcome-category): every cash
// outflow of the period (expenses, supplier payments, client withdrawals,
// cashback, staff expenses — not transfers, deleted or unverified ones)
// grouped by its own expense category, in the base currency, with the share
// bar. Row → dialog with the per-currency totals and the operations.

const CONFIG: ExpenseReportConfig = {
  title: "Расходы по категориям",
  nameLabel: "Категория",
  emptyName: "Не указано",
  endpoint: "/api/cash/reports/expenses-by-category",
  detailParam: "key",
  excelTitle: "Статистика расходов по категориям",
}

export function CategoryExpensesView() {
  return <ExpenseReportView config={CONFIG} />
}
