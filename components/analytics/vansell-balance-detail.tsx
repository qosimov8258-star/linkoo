"use client"

import { useState } from "react"
import Link from "next/link"
import { FileSpreadsheet, Loader2, Pencil } from "lucide-react"

import { BalanceAmount } from "@/components/analytics/balance/amount"
import { actExcelRows, describeStatementRow, type ActColumn } from "@/components/analytics/balance/act-table"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildBalanceQuery, useBalanceStatement } from "@/components/analytics/balance/use-balance"
import { VansellActPeriodDialog, VansellEditMovementDialog, VansellModal, type VansellEditTarget } from "@/components/analytics/vansell-balance-dialogs"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import { formatDotDate, formatStatementDate } from "@/lib/finance/dates"
import type { FinanceCurrency, StatementResult, StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Информация по баланс вэнсел" (demo module 3905): all-time movements of one
// van-sell agent, newest first, with "Итого" per currency, a currency
// filter, paging, the edit pencil on manual rows and "Скачать акт сверки".

/** The demo detail is not limited by dates. */
const ALL_TIME = { from: "2000-01-01", to: "2099-12-31" }

const DETAIL_PAGE_SIZE = 10

/** Manual "Нет типа" rows of this page's own ledger (editable in the demo). */
function isManual(row: StatementRow) {
  return row.editable && row.source === "vansell_manual" && (row.column === "none_type_plus" || row.column === "none_type_minus")
}

/** Demo texts: "Передача склада (Передача № 5)", "Оплата на кассу (Передача № 7)", "Нет типа (comment)". */
function RowDescription({ row }: { row: StatementRow }) {
  const { t } = useLanguage()
  if (row.title === "Нет типа" || !row.docNumber) return <span>{describeStatementRow(row, t)}</span>
  const reference = `${t("Передача")} № ${row.docNumber}`
  return (
    <span>
      {t(row.title)} (
      {row.href ? (
        <Link href={row.href} className="text-[#129fdd] hover:underline">
          {reference}
        </Link>
      ) : (
        reference
      )}
      )
    </span>
  )
}

function rowDescriptionText(row: StatementRow, t: (text: string) => string) {
  if (row.title === "Нет типа" || !row.docNumber) return describeStatementRow(row, t)
  return `${t(row.title)} (${t("Передача")} № ${row.docNumber})`
}

export function VansellDetailDialog({
  entityKey,
  name,
  currencies,
  canEdit,
  onClose,
  onChanged,
}: {
  entityKey: string
  /** Row name while the statement loads. */
  name: string
  currencies: FinanceCurrency[]
  canEdit: boolean
  onClose: () => void
  /** A movement was edited: refresh the list and totals. */
  onChanged: (message: string) => void
}) {
  const { t, language } = useLanguage()
  const [currency, setCurrency] = useState("")
  const [paging, setPaging] = useState({ page: 1, pageSize: DETAIL_PAGE_SIZE })
  const [edit, setEdit] = useState<VansellEditTarget | null>(null)
  const [actOpen, setActOpen] = useState(false)
  const statement = useBalanceStatement("vansell", entityKey, { ...ALL_TIME, currency, order: "desc", page: paging.page, pageSize: paging.pageSize })
  const data = statement.data
  const title = data?.entity.name || name
  const totalCodes = data ? (currency ? [currency] : data.visibleCurrencies) : []
  const currencyOptions = data?.currencies.length ? data.currencies : currencies

  const downloadAct = async (period: { from: string; to: string }) => {
    const response = await fetch(`/api/balances/vansell/statement?${buildBalanceQuery({ key: entityKey, ...period, order: "asc", pageSize: 0 })}`, { cache: "no-store" })
    const body = (await response.json().catch(() => null)) as (StatementResult & { error?: string }) | null
    if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
    const columns: ActColumn[] = [{ label: "Описание", render: () => null, excel: (row) => rowDescriptionText(row, t) }]
    const rows = actExcelRows(body, columns, t, language)
    downloadExcelTable(`${t("Акт сверки")} ${body.entity.name} ${period.from}_${period.to}`, [
      [`${t("Акт сверки")}: ${body.entity.name}`],
      [`${formatDotDate(period.from)} - ${formatDotDate(period.to)}`],
      [],
      ...rows,
    ])
  }

  return (
    <VansellModal
      width={900}
      onClose={onClose}
      title={
        <>
          {t("Информация по баланс вэнсел")} {title}
        </>
      }
    >
      {!data && statement.loading ? (
        <div className="flex h-[300px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
        </div>
      ) : !data ? (
        <div className="px-7 py-16 text-center text-[#e57373]">{statement.error ? t(statement.error) : t("Не удалось загрузить данные")}</div>
      ) : (
        <div className={statement.loading ? "opacity-60" : ""}>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#efefef] px-7 py-4">
            <div className="flex flex-wrap items-center gap-2.5 text-[15px] font-semibold text-[#333]">
              <span>{t("Итого")}:</span>
              {totalCodes.map((code, index) => (
                <span key={code}>
                  <BalanceAmount value={data.summary[code]?.end_balance ?? 0} currency={currencyLabel(code)} variant="card" digits={3} />
                  {!data.summary[code]?.end_balance && ` ${currencyLabel(code)}`}
                  {index < totalCodes.length - 1 && ","}
                </span>
              ))}
            </div>
            <button type="button" onClick={() => setActOpen(true)} className="flex h-10 items-center gap-2 rounded-md bg-[#71ce87] px-4 text-[13px] font-semibold uppercase text-white">
              <FileSpreadsheet className="h-5 w-5" /> {t("Скачать акт сверки")}
            </button>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4 px-7 py-3">
            <label className="flex w-[220px] flex-col text-[13px] font-medium text-[#586174]">
              {t("Валюта")}
              <select
                value={currency}
                onChange={(event) => {
                  setCurrency(event.target.value)
                  setPaging((current) => ({ ...current, page: 1 }))
                }}
                className="mt-1 h-9 border-b border-[#dbe0e8] bg-transparent text-[14px] font-semibold text-[#17233b] outline-none"
              >
                <option value="">{t("Все")}</option>
                {currencyOptions.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <BalancePagination page={paging.page} pageSize={paging.pageSize} count={data.count} onChange={setPaging} />
          </div>
          <div className="max-h-[445px] overflow-y-auto px-7 pb-6">
            <div className="grid grid-cols-[4fr_4fr_3fr_1fr] gap-3 border-b border-dashed border-[#dbe0e8] py-2.5 text-[13px] font-semibold text-[#586174]">
              <span>{t("Дата")}</span>
              <span>{t("Описание")}</span>
              <span>{t("Сумма")}</span>
              <span />
            </div>
            {data.rows.map((row) => (
              <div key={row.id} className="group grid grid-cols-[4fr_4fr_3fr_1fr] items-center gap-3 border-b border-dashed border-[#e1e5eb] py-2.5 text-[14px] text-[#333]">
                <span>{formatStatementDate(row.date, language)}</span>
                <RowDescription row={row} />
                <span>
                  <BalanceAmount value={row.amount} currency={currencyLabel(row.currency)} variant="card" digits={3} />
                  {!row.amount && ` ${currencyLabel(row.currency)}`}
                </span>
                <span className="flex justify-end">
                  {canEdit && isManual(row) && row.sourceId !== null && (
                    <button
                      type="button"
                      title={t("Изменить")}
                      aria-label={t("Изменить")}
                      onClick={() => setEdit({ id: row.sourceId!, employeeId: Number(data.entity.id), amount: row.amount, currency: row.currency, date: row.date })}
                      className="rounded-full p-1.5 text-[#666] opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:bg-[#f2f5f8]"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </span>
              </div>
            ))}
            {!data.rows.length && <p className="py-14 text-center text-[#9aa3b6]">{t("Пока транзакции нет")}</p>}
            {statement.error && <p className="pt-3 text-center text-[13px] text-[#e57373]">{t(statement.error)}</p>}
          </div>
        </div>
      )}
      {edit && (
        <VansellEditMovementDialog
          target={edit}
          currencies={currencyOptions}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null)
            statement.reload()
            onChanged("Успешно сохранено")
          }}
        />
      )}
      {actOpen && <VansellActPeriodDialog onClose={() => setActOpen(false)} onDownload={downloadAct} />}
    </VansellModal>
  )
}
