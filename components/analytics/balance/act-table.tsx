"use client"

import type { ReactNode } from "react"
import Link from "next/link"

import { BalanceAmount } from "@/components/analytics/balance/amount"
import { currencyLabel, roundMoney } from "@/lib/finance/currency"
import { formatDayMonth, formatStatementDate } from "@/lib/finance/dates"
import type { StatementResult, StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Reconciliation act ("акт сверки") table used by the client / account act
// and the supplier / employee detail views: Дата | Приход / Расход / Баланс
// per currency | page columns, with the demo's "Баланс на <from>" first row
// and "Итоги на <to>" / "Баланс на <to>" footer rows.

/** "Заказ № 12" / "Нет типа (comment)" / description text — the demo's comment column text. */
export function describeStatementRow(row: StatementRow, t: (text: string) => string): string {
  const title = row.title ? `${t(row.title)}${row.docNumber ? ` № ${row.docNumber}` : ""}` : ""
  const details = [row.description, row.comment].filter((text) => text && text !== title).join(", ")
  if (row.title === "Нет типа") return details ? `${title} (${details})` : title
  return [title, details].filter(Boolean).join(" | ")
}

/** "Наличные" / "Перечисление" / "" for a payment type code. */
export function paymentTypeLabel(paymentType: string): string {
  if (paymentType === "cash") return "Наличные"
  if (paymentType === "bank") return "Перечисление"
  return ""
}

export type ActColumn = { label: string; render: (row: StatementRow) => ReactNode; excel?: (row: StatementRow) => string | number }

export function BalanceActTable({
  statement,
  currencies,
  columns,
  digits = 2,
  emptyText = "Пока транзакции нет",
}: {
  statement: StatementResult
  /** Currency codes to show (default statement.visibleCurrencies). */
  currencies?: string[]
  /** Columns after the money columns (comment, organization, actions, …). */
  columns: ActColumn[]
  digits?: number
  emptyText?: string
}) {
  const { t, language } = useLanguage()
  const codes = currencies ?? statement.visibleCurrencies
  const moneyCells = (values: Record<string, { income: number | null; expense: number | null; balance: number | null }>) =>
    codes.flatMap((code) => {
      const value = values[code]
      return [
        <td key={`${code}-in`} className="border-b border-[#e1e5eb] px-3 py-2.5 whitespace-nowrap">
          {value?.income !== null && value?.income !== undefined ? <BalanceAmount value={value.income} digits={digits} /> : null}
        </td>,
        <td key={`${code}-out`} className="border-b border-[#e1e5eb] px-3 py-2.5 whitespace-nowrap">
          {value?.expense !== null && value?.expense !== undefined ? <BalanceAmount value={value.expense} digits={digits} /> : null}
        </td>,
        <td key={`${code}-bal`} className="border-b border-[#e1e5eb] px-3 py-2.5 whitespace-nowrap">
          {value?.balance !== null && value?.balance !== undefined ? <BalanceAmount value={value.balance} digits={digits} /> : null}
        </td>,
      ]
    })
  const summaryCells = (kind: "begin" | "end") =>
    Object.fromEntries(
      codes.map((code) => {
        const summary = statement.summary[code]
        return [
          code,
          kind === "begin"
            ? { income: summary?.begin_income ?? 0, expense: summary?.begin_expense ?? 0, balance: summary?.begin_balance ?? 0 }
            : { income: summary?.end_income ?? 0, expense: summary?.end_expense ?? 0, balance: null },
        ]
      }),
    )
  const finalCells = Object.fromEntries(
    codes.map((code) => {
      const balance = statement.summary[code]?.end_balance ?? 0
      return [code, { income: balance > 0 ? balance : null, expense: balance < 0 ? balance : null, balance: null }]
    }),
  )
  const label = (prefix: string, iso: string) => `${t(prefix)} ${formatDayMonth(iso, language)} ${iso.slice(0, 4)}`

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="bg-[#edf2f7] text-[#253653]">
            <th rowSpan={2} className="border border-[#e1e5eb] px-3 py-2 text-left font-semibold">
              {t("Дата")}
            </th>
            {codes.map((code) => (
              <th key={code} colSpan={3} className="border border-[#e1e5eb] px-3 py-2 text-center font-semibold">
                {currencyLabel(code)}
              </th>
            ))}
            {columns.map((column) => (
              <th key={column.label} rowSpan={2} className="border border-[#e1e5eb] px-3 py-2 text-left font-semibold">
                {t(column.label)}
              </th>
            ))}
          </tr>
          <tr className="bg-white text-[#17233b]">
            {codes.flatMap((code) => [
              <th key={`${code}-in`} className="border-b border-[#e1e5eb] px-3 py-2 text-left font-medium">
                {t("Приход")} ({currencyLabel(code)})
              </th>,
              <th key={`${code}-out`} className="border-b border-[#e1e5eb] px-3 py-2 text-left font-medium">
                {t("Расход")} ({currencyLabel(code)})
              </th>,
              <th key={`${code}-bal`} className="border-b border-[#e1e5eb] px-3 py-2 text-left font-medium">
                {t("Баланс")} ({currencyLabel(code)})
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          <tr className="bg-[#F4F8FB] font-semibold">
            <td className="border-b border-[#e1e5eb] px-3 py-2.5 whitespace-nowrap">{label("Баланс на", statement.from)}</td>
            {moneyCells(summaryCells("begin"))}
            {columns.map((column) => (
              <td key={column.label} className="border-b border-[#e1e5eb]" />
            ))}
          </tr>
          {statement.rows.map((row) => (
            <tr key={row.id} className={row.accepted ? "" : "text-[#9aa3b6]"}>
              <td className="border-b border-[#e1e5eb] px-3 py-2.5 whitespace-nowrap">{formatStatementDate(row.date, language)}</td>
              {moneyCells({
                [row.currency]: { income: row.amount > 0 ? row.amount : null, expense: row.amount < 0 ? row.amount : null, balance: row.balance },
              })}
              {columns.map((column) => (
                <td key={column.label} className="border-b border-[#e1e5eb] px-3 py-2.5">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {!statement.rows.length && (
            <tr>
              <td colSpan={1 + codes.length * 3 + columns.length} className="border-b border-[#e1e5eb] px-3 py-10 text-center text-[#9aa3b6]">
                {t(emptyText)}
              </td>
            </tr>
          )}
          <tr className="bg-[#F4F8FB] font-semibold">
            <td className="border-b border-[#e1e5eb] px-3 py-2.5 whitespace-nowrap">{label("Итоги на", statement.to)}</td>
            {moneyCells(summaryCells("end"))}
            {columns.map((column) => (
              <td key={column.label} className="border-b border-[#e1e5eb]" />
            ))}
          </tr>
          <tr className="bg-[#F4F8FB] font-semibold">
            <td className="border-b border-[#e1e5eb] px-3 py-2.5 whitespace-nowrap">{label("Баланс на", statement.to)}</td>
            {moneyCells(finalCells)}
            {columns.map((column) => (
              <td key={column.label} className="border-b border-[#e1e5eb]" />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Comment cell linking to the source document when the row has a link. */
export function StatementComment({ row }: { row: StatementRow }) {
  const { t } = useLanguage()
  const text = describeStatementRow(row, t)
  return row.href ? (
    <Link href={row.href} className="text-[#4f70e7] hover:underline">
      {text}
    </Link>
  ) : (
    <span>{text}</span>
  )
}

/** Rows for downloadExcelTable: the act ("Акт сверки") as shown on screen. */
export function actExcelRows(statement: StatementResult, columns: ActColumn[], t: (text: string) => string, language: string, currencies = statement.visibleCurrencies) {
  const header = [t("Дата"), ...currencies.flatMap((code) => [`${t("Приход")} (${currencyLabel(code)})`, `${t("Расход")} (${currencyLabel(code)})`, `${t("Баланс")} (${currencyLabel(code)})`]), ...columns.map((column) => t(column.label))]
  const blank = columns.map(() => "")
  const dayLabel = (prefix: string, iso: string) => `${t(prefix)} ${formatDayMonth(iso, language)} ${iso.slice(0, 4)}`
  const rows: Array<Array<string | number>> = [header]
  rows.push([dayLabel("Баланс на", statement.from), ...currencies.flatMap((code) => [statement.summary[code]?.begin_income ?? 0, statement.summary[code]?.begin_expense ?? 0, statement.summary[code]?.begin_balance ?? 0]), ...blank])
  for (const row of statement.rows) {
    rows.push([
      formatStatementDate(row.date, language),
      ...currencies.flatMap((code) => (code === row.currency ? [row.amount > 0 ? row.amount : "", row.amount < 0 ? row.amount : "", row.balance] : ["", "", ""])),
      ...columns.map((column) => (column.excel ? column.excel(row) : "")),
    ])
  }
  rows.push([dayLabel("Итоги на", statement.to), ...currencies.flatMap((code) => [statement.summary[code]?.end_income ?? 0, statement.summary[code]?.end_expense ?? 0, ""]), ...blank])
  rows.push([
    dayLabel("Баланс на", statement.to),
    ...currencies.flatMap((code) => {
      const balance = roundMoney(statement.summary[code]?.end_balance ?? 0)
      return [balance > 0 ? balance : "", balance < 0 ? balance : "", ""]
    }),
    ...blank,
  ])
  return rows
}

/** Accounting-style act ("Бухгалтерский акт сверки"): Дебет = what increases
 * the counterparty's debt (negative movements), Кредит = positive movements,
 * with opening / turnover / closing saldo lines per currency. */
export function accountingActExcelRows(statement: StatementResult, t: (text: string) => string, language: string, currencies = statement.visibleCurrencies) {
  const rows: Array<Array<string | number>> = [[t("Дата"), t("Документ"), t("Валюта"), t("Дебет"), t("Кредит")]]
  for (const code of currencies) {
    const summary = statement.summary[code]
    const opening = summary?.begin_balance ?? 0
    rows.push([formatStatementDate(statement.from, language, false), t("Сальдо начальное"), currencyLabel(code), opening < 0 ? -opening : "", opening > 0 ? opening : ""])
    let debit = 0
    let credit = 0
    for (const row of statement.rows.filter((item) => item.currency === code)) {
      if (row.amount < 0) debit -= row.amount
      else credit += row.amount
      rows.push([formatStatementDate(row.date, language), describeStatementRow(row, t), currencyLabel(code), row.amount < 0 ? -row.amount : "", row.amount > 0 ? row.amount : ""])
    }
    rows.push(["", t("Обороты за период"), currencyLabel(code), roundMoney(debit), roundMoney(credit)])
    const closing = summary?.end_balance ?? 0
    rows.push([formatStatementDate(statement.to, language, false), t("Сальдо конечное"), currencyLabel(code), closing < 0 ? -closing : "", closing > 0 ? closing : ""])
  }
  return rows
}
