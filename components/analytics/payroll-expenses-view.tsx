"use client"

import { ExpenseReportView, type ExpenseReportConfig } from "@/components/analytics/expense-report-view"

// "Расходы на персонал" (demo #/statistics/expenditure-on-staff): the
// per-employee allocations of cash staff expenses (category option
// "Расход на сотрудников", cash_entry_staff) grouped by employee, in the base
// currency, with the share bar; extra filter "Категория расходов". Row →
// dialog with the employee's totals per currency and the allocations, each
// opening its operation on the cash page.

const CONFIG: ExpenseReportConfig = {
  title: "Расходы на персонал",
  nameLabel: "Сотрудник",
  emptyName: "Не указан",
  endpoint: "/api/cash/reports/staff-expenses",
  detailParam: "employee",
  categoryFilter: true,
  excelTitle: "Статистика расходов на персонал",
  rowLinks: true,
}

export function PayrollExpensesView() {
  return <ExpenseReportView config={CONFIG} />
}
