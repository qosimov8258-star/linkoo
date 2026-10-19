"use client"

import { SimpleExpenseReport, type ExpenseLine } from "./simple-expense-report"

const rows: ExpenseLine[] = []

export function CategoryExpensesView() {
  return <SimpleExpenseReport title="Расходы по категориям" labelHeader="Категория" rows={rows} fileName="category-expenses.xls" />
}
