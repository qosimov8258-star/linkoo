"use client"

import { BarChart, Pencil, RotateCcw, Trash2, X } from "lucide-react"

import { actExcelRows, BalanceActTable, describeStatementRow, StatementComment, type ActColumn } from "@/components/analytics/balance/act-table"
import { supplierPaymentTypeLabel } from "@/components/analytics/supplier-balance-dialogs"
import { downloadExcelTable } from "@/lib/excel-export"
import type { StatementResult, StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Информация по балансу поставщика: NAME" (demo ProviderBalanceInfoForm,
// opened with ?openProvider): own period (?fromProviderDate&toProviderDate),
// "Скачать акт сверки", and the act — Дата | Приход / Расход / Баланс per
// currency | Комментарий | Тип оплаты | Организация | edit & delete for the
// manual "Нет типа" entries of this page.

export function SupplierActDialog({
  name,
  statement,
  loading,
  error,
  from,
  to,
  customPeriod,
  canEdit,
  onPeriodChange,
  onPeriodReset,
  onEdit,
  onDelete,
  onClose,
}: {
  name: string
  statement: StatementResult | null
  loading: boolean
  error: string
  from: string
  to: string
  /** true when the act has its own period (reset button shown). */
  customPeriod: boolean
  canEdit: boolean
  onPeriodChange: (period: { from: string; to: string }) => void
  onPeriodReset: () => void
  onEdit: (row: StatementRow) => void
  onDelete: (row: StatementRow) => void
  onClose: () => void
}) {
  const { t, language } = useLanguage()
  const title = name || statement?.entity.name || ""
  const paymentType = (row: StatementRow) => t(supplierPaymentTypeLabel(row.paymentType)) || "-"

  const excelColumns: ActColumn[] = [
    { label: "Комментарий", render: (row) => <StatementComment row={row} />, excel: (row) => describeStatementRow(row, t) || "-" },
    { label: "Тип оплаты", render: paymentType, excel: paymentType },
    { label: "Организация", render: (row) => row.organization || "-", excel: (row) => row.organization || "-" },
  ]
  const columns: ActColumn[] = [
    ...excelColumns,
    {
      label: "",
      render: (row) =>
        canEdit && row.editable && row.source === "supplier_manual" && row.sourceId ? (
          <span className="flex items-center gap-2 text-[#666]">
            <button type="button" onClick={() => onEdit(row)} aria-label={t("Изменить")} title={t("Изменить")} className="hover:text-[#4f70e7]">
              <Pencil className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onDelete(row)} aria-label={t("Удалить")} title={t("Удалить")} className="hover:text-[#e57373]">
              <Trash2 className="h-4 w-4" />
            </button>
          </span>
        ) : null,
    },
  ]

  const download = () => {
    if (!statement) return
    downloadExcelTable(`${t("Акт сверки")} ${title} ${statement.from} - ${statement.to}`, actExcelRows(statement, excelColumns, t, language))
  }
  const setPeriod = (next: { from: string; to: string }) => {
    if (!next.from || !next.to) return
    onPeriodChange(next.from <= next.to ? next : { from: next.to, to: next.from })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-[1000px] rounded-md bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-8 pr-4">
          <h2 className="font-bold uppercase text-[#333]">
            {t("Информация по балансу поставщика")}: <span className="text-[#666]">{title}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#666]">
            <X className="h-6 w-6" />
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#efefef] px-8 py-3">
          <div className="flex items-center gap-2 text-[13px] font-bold text-[#4f71dc]">
            <input
              type="date"
              value={from}
              aria-label={t("Дата начала")}
              onChange={(event) => setPeriod({ from: event.target.value, to })}
              className="h-9 rounded border border-transparent bg-transparent px-1 outline-none hover:border-[#dbe0e8] focus:border-[#4f71dc]"
            />
            <span>—</span>
            <input
              type="date"
              value={to}
              aria-label={t("Дата окончания")}
              onChange={(event) => setPeriod({ from, to: event.target.value })}
              className="h-9 rounded border border-transparent bg-transparent px-1 outline-none hover:border-[#dbe0e8] focus:border-[#4f71dc]"
            />
            {customPeriod && (
              <button type="button" onClick={onPeriodReset} aria-label={t("Сбросить")} title={t("Сбросить")} className="ml-1 text-[#9aa3b6] hover:text-[#4f71dc]">
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={download}
            disabled={!statement}
            className="flex h-[34px] items-center gap-2 rounded-sm bg-[#71ce87] px-4 text-[14px] font-semibold text-white disabled:opacity-50"
          >
            <BarChart className="h-4 w-4" /> {t("Скачать акт сверки")}
          </button>
        </div>

        <div className={`px-6 py-4 ${loading ? "opacity-60" : ""}`}>
          {error && <p className="py-10 text-center text-[#e57373]">{t(error)}</p>}
          {!statement && !error && <p className="py-16 text-center text-[#9aa3b6]">{t("Загрузка...")}</p>}
          {statement && !error && <BalanceActTable statement={statement} columns={columns} emptyText="Пока транзакции нет" />}
        </div>
      </div>
    </div>
  )
}
