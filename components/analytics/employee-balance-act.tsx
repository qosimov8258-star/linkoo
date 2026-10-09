"use client"

import { useState } from "react"
import Link from "next/link"
import { FileSpreadsheet, Loader2 } from "lucide-react"

import { actExcelRows, BalanceActTable, type ActColumn } from "@/components/analytics/balance/act-table"
import { buildBalanceQuery, useBalanceStatement } from "@/components/analytics/balance/use-balance"
import { EmployeeActPeriodDialog, EmployeeModal } from "@/components/analytics/employee-balance-dialogs"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatDotDate } from "@/lib/finance/dates"
import type { StatementResult, StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Информация по балансу сотрудника" (demo act modal, /staff/salary_balance/act/):
// the reconciliation act of one employee for a period — "Баланс на <from>",
// every movement (Приход / Расход per currency, Комментарий, Тип), "Итоги на
// <to>", "Баланс на <to>" — with its own period and "Скачать акт сверки".

/** Act digits of the page (demo ROUND_AMOUNT_FOR_CURRENCY). */
const DIGITS = 3

function commentText(row: StatementRow): string {
  return row.comment || row.description
}

export function EmployeeActDialog({
  entityKey,
  name,
  from: initialFrom,
  to: initialTo,
  onClose,
}: {
  /** BalanceRow.key (employees.id). */
  entityKey: string
  /** Row name while the statement loads. */
  name: string
  /** The page's period (the act starts with it). */
  from: string
  to: string
  onClose: () => void
}) {
  const { t, language } = useLanguage()
  const [period, setPeriod] = useState({ from: initialFrom, to: initialTo })
  const [actOpen, setActOpen] = useState(false)
  const statement = useBalanceStatement("employee", entityKey, { from: period.from, to: period.to })
  const data = statement.data
  const title = data?.entity.name || name

  const columns: ActColumn[] = [
    {
      label: "Комментарий",
      render: (row) => (
        <span className="block min-w-[180px] whitespace-pre-line" title={row.createdBy ? `${t("Создал")}: ${row.createdBy}` : undefined}>
          {commentText(row)}
        </span>
      ),
      excel: commentText,
    },
    {
      label: "Тип",
      render: (row) =>
        row.href ? (
          <Link href={row.href} className="whitespace-nowrap text-[#4f70e7] hover:underline">
            {t(row.title)}
          </Link>
        ) : (
          <span className="whitespace-nowrap">{t(row.title)}</span>
        ),
      excel: (row) => t(row.title),
    },
  ]

  const setDay = (field: "from" | "to", value: string) => {
    if (!value) return
    setPeriod((current) => {
      const next = { ...current, [field]: value }
      return next.from <= next.to ? next : { from: next.to, to: next.from }
    })
  }

  const downloadAct = async (range: { from: string; to: string }) => {
    const response = await fetch(`/api/balances/employee/statement?${buildBalanceQuery({ key: entityKey, ...range, pageSize: 0 })}`, { cache: "no-store" })
    const body = (await response.json().catch(() => null)) as (StatementResult & { error?: string }) | null
    if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
    downloadExcelTable(`${t("Акт сверки")} ${body.entity.name} ${range.from}_${range.to}`, [
      [`${t("Акт сверки")}: ${body.entity.name}`],
      [`${formatDotDate(range.from)} - ${formatDotDate(range.to)}`],
      [],
      ...actExcelRows(body, columns, t, language),
    ])
  }

  return (
    <EmployeeModal
      width={1000}
      onClose={onClose}
      title={
        <>
          {t("Информация по балансу сотрудника")}: {title}
        </>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#efefef] px-7 py-4">
        <label className="flex flex-col gap-1 text-[13px] font-medium text-[#586174]">
          {t("Выберите период")}
          <span className="flex items-center gap-2">
            <input
              type="date"
              value={period.from}
              onChange={(event) => setDay("from", event.target.value)}
              aria-label={t("С")}
              className="h-10 rounded-md border border-[#dbe0e8] px-3 text-[#17233b]"
            />
            <span>—</span>
            <input
              type="date"
              value={period.to}
              onChange={(event) => setDay("to", event.target.value)}
              aria-label={t("По")}
              className="h-10 rounded-md border border-[#dbe0e8] px-3 text-[#17233b]"
            />
          </span>
        </label>
        <button
          type="button"
          onClick={() => setActOpen(true)}
          disabled={!data}
          className="flex h-10 items-center gap-2 rounded-md bg-[#71ce87] px-4 text-[13px] font-semibold uppercase text-white disabled:opacity-50"
        >
          <FileSpreadsheet className="h-5 w-5" /> {t("Скачать акт сверки")}
        </button>
      </div>

      {!data && statement.loading ? (
        <div className="flex h-[300px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
        </div>
      ) : !data ? (
        <div className="px-7 py-16 text-center">
          <p className="text-[#e57373]">{statement.error ? t(statement.error) : t("Не удалось загрузить данные")}</p>
          <button type="button" onClick={statement.reload} className="mt-3 font-semibold text-[#4f70e7] underline">
            {t("Повторить")}
          </button>
        </div>
      ) : (
        <div className={`max-h-[65vh] overflow-y-auto px-7 py-5 ${statement.loading ? "opacity-60" : ""}`}>
          {statement.error && <p className="pb-3 text-center text-[13px] text-[#e57373]">{t(statement.error)}</p>}
          <BalanceActTable statement={data} columns={columns} digits={DIGITS} />
        </div>
      )}

      {actOpen && <EmployeeActPeriodDialog from={period.from} to={period.to} onClose={() => setActOpen(false)} onDownload={downloadAct} />}
    </EmployeeModal>
  )
}
