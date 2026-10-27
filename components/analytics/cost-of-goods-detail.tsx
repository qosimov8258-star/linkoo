"use client"

import { useState, type ReactNode } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, ErrorBlock, LoadingBlock } from "@/components/analytics/cash-management-shared"
import { CheckIcon, DocumentLink, fmtCost, fmtSum, recordDate } from "@/components/analytics/cost-of-goods-shared"
import { docDate } from "@/components/analytics/internal-transfers-shared"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { NET_COST_API, NET_COST_SOURCE_LABELS, type NetCostDetail, type NetCostDocument } from "@/lib/net-cost-types"

// Detail of a cost record (demo c46 module 4664): "Себестоимость №id" + product; source
// (Поставка № / Передача на склад № / "Произвольная себестоимость"), Склад, Дата,
// Уср. Себестоимость, Себестоимость; the three checks; "Характеристика" (Рассчитанный
// баланс, Сумма переоценки, Общая сумма переоценки, Последнее время проверки); edit /
// delete for manual records. Ours adds "Документы": the source document and every
// movement valued at this record's average until the next record, and the demo's
// "Причины отрицательного баланса" table (fact dialog, module 4670).

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex h-[25px] items-center gap-x-[5.1px] leading-[25px]">
      <span>{label}:</span>
      <span className="font-semibold">{children}</span>
    </li>
  )
}

function DocumentsTable({ rows, showCost = true }: { rows: NetCostDocument[]; showCost?: boolean }) {
  const { t, language } = useLanguage()
  const th = "whitespace-nowrap border-b border-[#eceef3] bg-[#f6f7fb] px-3 py-2 text-left text-[12px] font-semibold text-[#8a90a2]"
  const td = "border-b border-[#eceef3] px-3 py-2"
  return (
    <div className="overflow-x-auto rounded-lg border border-[#eceef3]">
      <table className="w-full min-w-[620px] border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={th}>{t("Документ")}</th>
            <th className={th}>{t("Склад")}</th>
            <th className={th}>{t("Дата")}</th>
            <th className={`${th} text-right`}>{t("Количество")}</th>
            {showCost && <th className={`${th} text-right`}>{t("Себестоимость")}</th>}
            <th className={`${th} text-right`}>{t("Остаток")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.docType}-${row.docId}-${row.kind}-${index}`} className="hover:bg-[#f9faff]">
              <td className={td}>
                <DocumentLink docType={row.docType} docId={row.docId} />
              </td>
              <td className={td}>{row.warehouse}</td>
              <td className={`${td} whitespace-nowrap`}>{docDate(row.day, language)}</td>
              <td className={`${td} text-right font-semibold ${row.qty < 0 ? "text-[#e05260]" : "text-[#2e9e6a]"}`}>{formatMoney(row.qty, 3)}</td>
              {showCost && <td className={`${td} text-right`}>{fmtCost(row.cost)}</td>}
              <td className={`${td} text-right ${row.balanceAfter < 0 ? "text-[#e05260]" : ""}`}>{formatMoney(row.balanceAfter, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function NetCostDetailPanel({
  id,
  onClose,
}: {
  id: number
  /** Kept for the callers; the reference card has no edit / delete icons. */
  canEdit?: boolean
  onClose: () => void
  onEdit?: (detail: NetCostDetail) => void
  onDelete?: (detail: NetCostDetail) => void
}) {
  const { t, language } = useLanguage()
  const { data, error, loading, reload } = useCashJson<NetCostDetail>(`${NET_COST_API}/${id}`)
  const [factOpen, setFactOpen] = useState(false)

  if (loading && !data) return <LoadingBlock className="py-10" />
  if (error || !data) return <ErrorBlock error={error || "Себестоимость не найдена"} onRetry={reload} />

  const source = data.sourceType === "manual" ? null : data.sourceType
  // The reference card: 1270px wide (15px beyond the list), 66px title block, then three columns of 25px lines.
  return (
    <div className="-mx-[15px] mb-[20px] mt-[20px] bg-white text-[13px] text-[#333] [box-shadow:0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div role="button" tabIndex={0} onClick={onClose} onKeyDown={(event) => event.key === "Enter" && onClose()} className="h-[66px] w-full cursor-pointer border-b border-[#efefef] px-[30px] pt-[13.5px] text-left">
        <span className="block text-[16px] font-bold leading-[18.4px]">
          {t("Себестоимость")} №{data.id}
        </span>
        <span className="mt-[4.6px] block truncate text-[13px] font-bold leading-[15px] text-[#666]">{data.itemName}</span>
      </div>

      <div className="flex h-[196px] pl-[30px] pr-[30px]">
        <ul className="w-[403px] shrink-0 pt-[40px]">
          {source ? (
            <li className="leading-[25px]">
              <span>{t(NET_COST_SOURCE_LABELS[source] ?? source)} №: </span>
              <DocumentLink docType={source} docId={data.sourceId} />
            </li>
          ) : (
            <li className="leading-[25px]">Произвольная себестоимость</li>
          )}
          <Item label={t("Склад")}>{data.stock || t("Не указано")}</Item>
          {data.warehouse && data.warehouse !== data.stock && <Item label={t("Склад документа")}>{data.warehouse}</Item>}
          <Item label={t("Дата")}>{recordDate(data.date, language)}</Item>
          {!data.isManual && <Item label={t("Количество")}>{formatMoney(data.qty, 3)}</Item>}
          <Item label="Уср. Себестоимость">{fmtCost(data.cost)}</Item>
          <Item label={t("Себестоимость")}>{fmtCost(data.realCost)}</Item>
          {data.comment && <Item label={t("Комментарий")}>{data.comment}</Item>}
        </ul>
        <ul className="w-[342.5px] shrink-0 pt-[40px]">
          {data.checkData.map((check) => (
            <li key={check.key} className="flex h-[25px] items-center leading-[25px]">
              {!check.isCorrect && check.key === "is_negative_balance_correct" && data.negativeTransactions.length ? (
                <button type="button" onClick={() => setFactOpen(true)} className="text-left font-semibold text-[#4f71dc] hover:underline">
                  {check.name}:
                </button>
              ) : (
                <span>{check.name}:</span>
              )}
              <span className="ml-[3.3px] flex h-5 w-5 items-center justify-center [&_svg]:h-5 [&_svg]:w-5">
                <CheckIcon ok={check.isCorrect} />
              </span>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 pt-[26px]">
          <p className="h-[25px] font-bold leading-[25px]">{t("Характеристика")}:</p>
          <ul className="mt-[5.3px]">
            <Item label="Рассчитанный баланс">{formatMoney(data.balance, 3)}</Item>
            <Item label="Сумма переоценки">{data.revaluation === null ? "0" : fmtCost(data.revaluation)}</Item>
            <Item label="Общая сумма переоценки">{data.totalRevaluation === null ? "0" : fmtSum(data.totalRevaluation)}</Item>
            <Item label="Последнее время проверки">{data.lastCheckTime ? docDate(data.lastCheckTime, language, true) : "—"}</Item>
          </ul>
        </div>
      </div>

      {factOpen && (
        <CashModal title={t("Причины отрицательного баланса")} onClose={() => setFactOpen(false)} size="lg">
          <DocumentsTable rows={data.negativeTransactions} showCost={false} />
        </CashModal>
      )}
    </div>
  )
}
