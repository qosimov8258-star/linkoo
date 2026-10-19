"use client"

import { SimpleExpenseReport, type ExpenseLine } from "./simple-expense-report"

const rows: ExpenseLine[] = []

export function PayrollExpensesView() {
  return <SimpleExpenseReport title="Расходы на персонал" labelHeader="Сотрудник" rows={rows} fileName="payroll-expenses.xls" />
}
