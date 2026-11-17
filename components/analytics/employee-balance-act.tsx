"use client"

import { useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"

import { useBalanceStatement } from "@/components/analytics/balance/use-balance"
import { LinkoActDialog, LinkoActTable, linkoActExcelRows, type LinkoActColumn } from "@/components/analytics/balance/linko-act"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatDotDate } from "@/lib/finance/dates"
import type { StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// «Информация по балансу сотрудника» as Linko shows it (?dynamicList=<employee>, staff/salary_balance/act): its own
// period, «Скачать акт сверки» (the act of that period at once) and the act — Дата | Приход / Расход per currency |
// Комментарий (a link to the cash entry when the movement has one).

/** Act digits of the page (Linko ROUND_AMOUNT_FOR_CURRENCY). */
const DIGITS = 3

/** The comment as Linko's act words it (server text, so not translated): «Зарплата», «КПИ», « № <cash entry> |
 * <comment> (<category>)» for a cash payment, «Штраф | <comment>»; a correction keeps its own text. */
function commentText(row: StatementRow): string {
  switch (row.column) {
    case "monthly":
      return row.comment || "Зарплата"
    case "performance_bonus":
      return row.comment || "КПИ"
    case "payment":
      return row.docNumber ? ` № ${row.docNumber} | ${row.comment}${row.category ? ` (${row.category})` : ""}` : row.comment || row.description
    case "penalty":
      return ["Штраф", row.comment].filter(Boolean).join(" | ")
    default:
      return row.comment || row.description
  }
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
  /** The employee, for the downloaded file's name (Linko's title does not print it). */
  name: string
  /** The page's period (the act starts with it). */
  from: string
  to: string
  onClose: () => void
}) {
  const { t, language } = useLanguage()
  const [period, setPeriod] = useState({ from: initialFrom, to: initialTo })
  const statement = useBalanceStatement("employee", entityKey, { from: period.from, to: period.to })
  const data = statement.data

  const columns: LinkoActColumn[] = [
    {
      label: "Комментарий",
      render: (row) => {
        const text = commentText(row) || "-"
        return row.href ? (
          <Link href={row.href} className="text-[#1E4A9A] hover:underline" title={row.createdBy ? `${t("Создал")}: ${row.createdBy}` : undefined}>
            {text}
          </Link>
        ) : (
          <span className="whitespace-pre-line" title={row.createdBy ? `${t("Создал")}: ${row.createdBy}` : undefined}>{text}</span>
        )
      },
      excel: (row) => commentText(row) || "-",
    },
  ]

  const download = () => {
    if (!data) return
    const who = data.entity.name || name
    downloadExcelTable(`${t("Акт сверки")} ${who} ${data.from}_${data.to}`, [
      [`${t("Акт сверки")}: ${who}`],
      [`${formatDotDate(data.from)} - ${formatDotDate(data.to)}`],
      [],
      ...linkoActExcelRows(data, columns, t, language),
    ])
  }

  return (
    <LinkoActDialog
      title={t("Информация по балансу сотрудника")}
      from={period.from}
      to={period.to}
      downloadDisabled={!data}
      onPeriod={(begin, end) => setPeriod(begin <= end ? { from: begin, to: end } : { from: end, to: begin })}
      onDownload={download}
      onClose={onClose}
    >
      {!data && statement.loading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#1E4A9A]" />
        </div>
      ) : !data ? (
        <div className="px-7 py-16 text-center">
          <p className="text-[#e57373]">{statement.error ? t(statement.error) : t("Не удалось загрузить данные")}</p>
          <button type="button" onClick={statement.reload} className="mt-3 font-semibold text-[#1E4A9A] underline">
            {t("Повторить")}
          </button>
        </div>
      ) : (
        <div className={statement.loading ? "opacity-60" : ""}>
          {statement.error && <p className="py-3 text-center text-[13px] text-[#e57373]">{t(statement.error)}</p>}
          <LinkoActTable statement={data} columns={columns} digits={DIGITS} />
        </div>
      )}
    </LinkoActDialog>
  )
}
