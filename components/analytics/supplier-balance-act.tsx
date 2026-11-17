"use client"

import Link from "next/link"
import { Pencil, Trash2 } from "lucide-react"

import { LinkoActDialog, LinkoActTable, linkoActExcelRows, type LinkoActColumn } from "@/components/analytics/balance/linko-act"
import { downloadExcelTable } from "@/lib/excel-export"
import type { StatementResult, StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// «Информация по балансу поставщика:» as Linko shows it (opened with ?openProvider): its own period
// (?fromProviderDate&toProviderDate), «Скачать акт сверки» and the act — Дата | Приход / Расход per currency |
// Комментарий | Тип оплаты | Организация | edit & delete of the page's own manual entries.

/** Linko's names of the act's documents where this app's differ. */
const ACT_TITLES: Record<string, string> = { "Возврат поставщику": "Возврат от поставщика" }

/** The comment as Linko's act words it (server text, so not translated): «<document> № <number> | <comment>» —
 * «Поставка № 12», «Оплата № 15» (the supply it paid), «Нет типа | <comment>». A supply expense charged to the supplier
 * is kept here as an entry whose comment is already its text («Доп. Расход № 7»). */
function actComment(row: StatementRow): string {
  if (row.source === "supplier_manual" && /^Доп\. Расход/.test(row.comment)) return row.comment
  const title = row.title ? `${ACT_TITLES[row.title] ?? row.title}${row.docNumber ? ` № ${row.docNumber}` : ""}` : ""
  return [title, row.comment].filter(Boolean).join(" | ") || "-"
}

/** Linko's act prints the payment type as «Наличные» / «Перечисления». */
const actPaymentType = (row: StatementRow) => (row.paymentType === "cash" ? "Наличные" : row.paymentType === "bank" ? "Перечисления" : "-")

export function SupplierActDialog({
  name,
  statement,
  loading,
  error,
  from,
  to,
  canEdit,
  onPeriodChange,
  onEdit,
  onDelete,
  onClose,
}: {
  /** The supplier, for the downloaded file's name (Linko's title does not print it). */
  name: string
  statement: StatementResult | null
  loading: boolean
  error: string
  from: string
  to: string
  canEdit: boolean
  onPeriodChange: (period: { from: string; to: string }) => void
  onEdit: (row: StatementRow) => void
  onDelete: (row: StatementRow) => void
  onClose: () => void
}) {
  const { t, language } = useLanguage()
  // Linko books no transaction for a supply of zero cost: such a supply is not a line of its act.
  const act = statement ? { ...statement, rows: statement.rows.filter((row) => !(row.source === "supplier_incoming" && row.amount === 0)) } : null
  const supplier = name || statement?.entity.name || ""
  const columns: LinkoActColumn[] = [
    {
      label: "Комментарий",
      render: (row) =>
        row.href ? (
          <Link href={row.href} className="text-[#1E4A9A] hover:underline">
            {actComment(row)}
          </Link>
        ) : (
          actComment(row)
        ),
      excel: actComment,
    },
    { label: "Тип оплаты", render: actPaymentType, excel: actPaymentType },
    { label: "Организация", render: (row) => row.organization || "-", excel: (row) => row.organization || "-" },
  ]
  const actions = (row: StatementRow) =>
    canEdit && row.editable && row.source === "supplier_manual" && row.sourceId ? (
      <span className="flex items-center gap-2 text-[#666]">
        <button type="button" onClick={() => onEdit(row)} aria-label={t("Изменить")} title={t("Изменить")} className="hover:text-[#1E4A9A]">
          <Pencil className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onDelete(row)} aria-label={t("Удалить")} title={t("Удалить")} className="hover:text-[#e57373]">
          <Trash2 className="h-4 w-4" />
        </button>
      </span>
    ) : null

  const download = () => {
    if (!act) return
    downloadExcelTable(`${t("Акт сверки")} ${supplier} ${act.from} - ${act.to}`, linkoActExcelRows(act, columns, t, language))
  }

  return (
    <LinkoActDialog
      title={`${t("Информация по балансу поставщика")}:`}
      from={from}
      to={to}
      withCalendar
      downloadDisabled={!statement}
      onPeriod={(begin, end) => onPeriodChange(begin <= end ? { from: begin, to: end } : { from: end, to: begin })}
      onDownload={download}
      onClose={onClose}
    >
      <div className={loading ? "opacity-60" : ""}>
        {error && <p className="py-10 text-center text-[13px] text-[#e57373]">{t(error)}</p>}
        {!statement && !error && <p className="py-16 text-center text-[13px] text-[#9aa3b6]">{t("Загрузка...")}</p>}
        {act && !error && <LinkoActTable statement={act} columns={columns} actions={actions} />}
      </div>
    </LinkoActDialog>
  )
}
