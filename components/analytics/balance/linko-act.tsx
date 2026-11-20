"use client"

import type { ReactNode } from "react"
import { CalendarDays, X } from "lucide-react"

import { BalanceAmount } from "@/components/analytics/balance/amount"
import { BuilderPeriod } from "@/components/analytics/builder-period"
import { currencyLabel, roundMoney } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import type { StatementResult, StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// The reconciliation act as Linko shows it today for a supplier («Информация по балансу поставщика:») and an employee
// («Информация по балансу сотрудника»), checked against its finance/provider_transactions/act and
// staff/salary_balance/act:
//   Дата | Приход (each currency) | Расход (each currency) | the page's text columns;
//   «Баланс на <from>»: the opening balance on its side — Приход when it is positive, Расход when negative;
//   the period's movements (a currency the row is not in shows «-»);
//   «Итоги на <to>»: that opening plus the period's income / expense;
//   «Баланс на <to>»: their sum with the currency, on its side;
//   «-» in the text columns of those three rows.

export type LinkoActColumn = {
  label: string
  render: (row: StatementRow) => ReactNode
  excel?: (row: StatementRow) => string | number
}

/** One currency's figures of the act's three summary rows. */
export function linkoActTotals(statement: StatementResult, code: string) {
  const summary = statement.summary[code]
  const opening = roundMoney(summary?.begin_balance ?? 0)
  const beginIncome = opening > 0 ? opening : 0
  const beginExpense = opening < 0 ? opening : 0
  const endIncome = roundMoney(beginIncome + (summary?.period_income ?? 0))
  const endExpense = roundMoney(beginExpense + (summary?.period_expense ?? 0))
  return { beginIncome, beginExpense, endIncome, endExpense, balance: roundMoney(endIncome + endExpense) }
}

const CELL = "border-b border-r border-[#efefef] px-[15px] py-[10px] text-left align-middle last:border-r-0"
const SUMMARY_ROW = "bg-[#F0F4F9] font-semibold text-[#374557]"

export function LinkoActTable({
  statement,
  columns,
  actions,
  digits = 3,
}: {
  statement: StatementResult
  /** The page's columns after the money ones (Комментарий, Тип оплаты, Организация). */
  columns: LinkoActColumn[]
  /** A last, untitled column (the supplier page's edit / delete of its own entries). */
  actions?: (row: StatementRow) => ReactNode
  digits?: number
}) {
  const { t, language } = useLanguage()
  const codes = statement.visibleCurrencies
  const totals = Object.fromEntries(codes.map((code) => [code, linkoActTotals(statement, code)]))
  const day = (prefix: string, iso: string) => `${t(prefix)} ${formatStatementDate(iso, language, false)}`
  const amount = (value: number, currency?: string) => <BalanceAmount value={value} digits={digits} currency={currency} />
  const dashes = (
    <>
      {columns.map((column) => (
        <td key={column.label} className={CELL}>-</td>
      ))}
      {actions && <td className={CELL} />}
    </>
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] text-[#333]">
        <thead>
          <tr className="bg-white font-semibold text-[#374557]">
            <th className={CELL}>{t("Дата")}</th>
            {codes.map((code) => (
              <th key={`in-${code}`} className={`${CELL} whitespace-nowrap`}>{t("Приход")} ({currencyLabel(code)})</th>
            ))}
            {codes.map((code) => (
              <th key={`out-${code}`} className={`${CELL} whitespace-nowrap`}>{t("Расход")} ({currencyLabel(code)})</th>
            ))}
            {columns.map((column) => (
              <th key={column.label} className={CELL}>{t(column.label)}</th>
            ))}
            {actions && <th className={CELL} />}
          </tr>
        </thead>
        <tbody>
          <tr className={SUMMARY_ROW}>
            <td className={`${CELL} whitespace-nowrap`}>{day("Баланс на", statement.from)}</td>
            {codes.map((code) => <td key={`in-${code}`} className={CELL}>{amount(totals[code].beginIncome)}</td>)}
            {codes.map((code) => <td key={`out-${code}`} className={CELL}>{amount(totals[code].beginExpense)}</td>)}
            {dashes}
          </tr>
          {statement.rows.map((row) => (
            <tr key={row.id} className={row.accepted ? "bg-white" : "bg-white text-[#9aa3b6]"}>
              <td className={`${CELL} whitespace-nowrap`}>{formatStatementDate(row.date, language)}</td>
              {codes.map((code) => (
                <td key={`in-${code}`} className={CELL}>{code !== row.currency ? "-" : row.amount > 0 ? amount(row.amount) : null}</td>
              ))}
              {codes.map((code) => (
                <td key={`out-${code}`} className={CELL}>{code !== row.currency ? "-" : row.amount < 0 ? amount(row.amount) : null}</td>
              ))}
              {columns.map((column) => (
                <td key={column.label} className={CELL}>{column.render(row)}</td>
              ))}
              {actions && <td className={CELL}>{actions(row)}</td>}
            </tr>
          ))}
          <tr className={SUMMARY_ROW}>
            <td className={`${CELL} whitespace-nowrap`}>{day("Итоги на", statement.to)}</td>
            {codes.map((code) => <td key={`in-${code}`} className={CELL}>{amount(totals[code].endIncome)}</td>)}
            {codes.map((code) => <td key={`out-${code}`} className={CELL}>{amount(totals[code].endExpense)}</td>)}
            {dashes}
          </tr>
          <tr className={SUMMARY_ROW}>
            <td className={`${CELL} whitespace-nowrap`}>{day("Баланс на", statement.to)}</td>
            {codes.map((code) => <td key={`in-${code}`} className={CELL}>{totals[code].balance > 0 ? amount(totals[code].balance, currencyLabel(code)) : null}</td>)}
            {codes.map((code) => <td key={`out-${code}`} className={CELL}>{totals[code].balance < 0 ? amount(totals[code].balance, currencyLabel(code)) : null}</td>)}
            {dashes}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Rows for downloadExcelTable: the act as the dialog shows it. */
export function linkoActExcelRows(statement: StatementResult, columns: LinkoActColumn[], t: (text: string) => string, language: string) {
  const codes = statement.visibleCurrencies
  const totals = Object.fromEntries(codes.map((code) => [code, linkoActTotals(statement, code)]))
  const day = (prefix: string, iso: string) => `${t(prefix)} ${formatStatementDate(iso, language, false)}`
  const dashes = columns.map(() => "-")
  const rows: Array<Array<string | number>> = [
    [t("Дата"), ...codes.map((code) => `${t("Приход")} (${currencyLabel(code)})`), ...codes.map((code) => `${t("Расход")} (${currencyLabel(code)})`), ...columns.map((column) => t(column.label))],
    [day("Баланс на", statement.from), ...codes.map((code) => totals[code].beginIncome), ...codes.map((code) => totals[code].beginExpense), ...dashes],
  ]
  for (const row of statement.rows) {
    rows.push([
      formatStatementDate(row.date, language),
      ...codes.map((code) => (code !== row.currency ? "-" : row.amount > 0 ? row.amount : "")),
      ...codes.map((code) => (code !== row.currency ? "-" : row.amount < 0 ? row.amount : "")),
      ...columns.map((column) => (column.excel ? column.excel(row) : "")),
    ])
  }
  rows.push([day("Итоги на", statement.to), ...codes.map((code) => totals[code].endIncome), ...codes.map((code) => totals[code].endExpense), ...dashes])
  rows.push([
    day("Баланс на", statement.to),
    ...codes.map((code) => (totals[code].balance > 0 ? `${totals[code].balance} ${currencyLabel(code)}` : "")),
    ...codes.map((code) => (totals[code].balance < 0 ? `${totals[code].balance} ${currencyLabel(code)}` : "")),
    ...dashes,
  ])
  return rows
}

/**
 * Linko's act dialog: a 1000 px card with the title and ×, the period (opens the date range picker; the supplier's has
 * a small calendar over it) and the green «Скачать акт сверки», then the act.
 */
export function LinkoActDialog({
  title,
  from,
  to,
  withCalendar = false,
  downloadDisabled,
  onPeriod,
  onDownload,
  onClose,
  children,
}: {
  title: string
  from: string
  to: string
  /** true: a small calendar over the period (supplier); "after": a calendar right after it (branch). */
  withCalendar?: boolean | "after"
  downloadDisabled?: boolean
  onPeriod: (from: string, to: string) => void
  onDownload: () => void
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useLanguage()
  return (
    // Modal as in Linko: only × closes it; vertically centred while it fits (my-auto).
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/40 px-3 py-[60px]">
      <div role="dialog" aria-modal="true" aria-label={title} className="my-auto w-full max-w-[1000px] rounded-[2px] bg-white shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[20px]">
          <h2 className="text-[13px] font-bold uppercase text-[#333]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#666] hover:text-black">
            <X className="h-[22px] w-[22px]" />
          </button>
        </header>
        <div className="flex items-center justify-between gap-3 px-[30px] py-[10px]">
          <div className={`flex w-[260px] ${withCalendar === "after" ? "flex-row items-center gap-[8px]" : "flex-col items-start"}`}>
            {withCalendar === true && <CalendarDays aria-hidden className="mb-[2px] h-[14px] w-[14px] text-[#bdbdbd]" />}
            <BuilderPeriod from={from} to={to} onApply={onPeriod} align="left" textClassName="!h-[24px] !pl-0 text-[13px]" className={withCalendar === "after" ? "min-w-0 flex-1" : "w-full"} />
            {withCalendar === "after" && <CalendarDays aria-hidden className="h-[16px] w-[16px] shrink-0 text-[#757575]" />}
          </div>
          <button
            type="button"
            onClick={onDownload}
            disabled={downloadDisabled}
            className="flex h-[34px] items-center gap-[8px] rounded-[2px] bg-[#71ce87] px-[15px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" aria-hidden className="h-[16px] w-[16px] fill-white"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z" /></svg>
            {t("Скачать акт сверки")}
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
