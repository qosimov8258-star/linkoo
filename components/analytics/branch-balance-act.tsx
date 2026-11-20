"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { useBalanceStatement } from "@/components/analytics/balance/use-balance"
import { LinkoActDialog, LinkoActTable, linkoActExcelRows, type LinkoActColumn } from "@/components/analytics/balance/linko-act"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatDotDate } from "@/lib/finance/dates"
import type { StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// «Информация по балансу филиала» as Linko shows it (?dynamicList=<branch>, main/branch/transaction_act): the page's
// period with a calendar after it, «Скачать акт сверки» (the act of that period at once) and the act — Дата | Приход /
// Расход per currency | Комментарий | Тип оплаты | Организация.

/** Act digits of the page (Linko ROUND_AMOUNT_FOR_CURRENCY). */
const DIGITS = 3

/** The comment as Linko's act words it (server text, so not translated): «Транзакция № <cash transaction> <comment>»,
 * «Перемещение на склад № <stock transfer> <comment>», «Нет типа <comment>». */
function commentText(row: StatementRow): string {
  const tail = row.comment ? ` ${row.comment}` : ""
  if (row.column === "payments") return row.docNumber ? `Транзакция № ${row.docNumber}${tail}` : row.comment || row.description
  if (row.column === "stock_transfer_minus" || row.column === "stock_transfer_plus") return row.docNumber ? `Перемещение на склад № ${row.docNumber}${tail}` : row.comment || row.description
  return `Нет типа${tail}`
}

/** Linko's act prints «Cash» as the payment type of every branch movement (cash, bank, stock transfer, manual). */
const PAYMENT_TYPE = "Cash"

export function BranchActDialog({
  entityKey,
  name,
  from: initialFrom,
  to: initialTo,
  onClose,
}: {
  /** BalanceRow.key (branches.id). */
  entityKey: string
  /** The branch, for the downloaded file's name (Linko's title does not print it). */
  name: string
  /** The page's period (the act starts with it). */
  from: string
  to: string
  onClose: () => void
}) {
  const { t, language } = useLanguage()
  const [period, setPeriod] = useState({ from: initialFrom, to: initialTo })
  const statement = useBalanceStatement("branch", entityKey, { from: period.from, to: period.to })
  const data = statement.data

  const columns: LinkoActColumn[] = [
    { label: "Комментарий", render: (row) => <span className="whitespace-pre-line">{commentText(row) || "-"}</span>, excel: (row) => commentText(row) || "-" },
    { label: "Тип оплаты", render: () => PAYMENT_TYPE, excel: () => PAYMENT_TYPE },
    { label: "Организация", render: (row) => row.organization || "-", excel: (row) => row.organization || "-" },
  ]

  const download = () => {
    if (!data) return
    const who = data.entity.name || name
    downloadExcelTable(`${t("Акт сверки")} ${who} ${data.from}_${data.to}`, [
      [`${t("Акт сверки")}: ${who}`],
      [`${formatDotDate(data.from)} – ${formatDotDate(data.to)}`],
      [],
      ...linkoActExcelRows(data, columns, t, language),
    ])
  }

  return (
    <LinkoActDialog
      title={t("Информация по балансу филиала")}
      from={period.from}
      to={period.to}
      withCalendar="after"
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
