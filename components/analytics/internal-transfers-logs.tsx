"use client"

import { useMemo, useState } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/analytics/cash-management-shared"
import { TransferStatusLabel, docDate, formatQty, formatSum } from "@/components/analytics/internal-transfers-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { TRANSFER_LOG_COLORS, TRANSFER_LOG_LABELS, type TransferLog, type TransferLogAction, type TransferStatus } from "@/lib/internal-transfers-types"

// "Логи" tab of a transfer as Linko draws it (its StockTransferLogs): newest first, one 75 px box per action
// (#FBFBFB, 1 px #E5E8F1 border, radius 10, padding 20) with «Передача: <action chip>» and «Статус: <icon> <status>» on
// the left and «Кем», «Со склада», «На склад», «Когда» on the right; a comment goes under its box. Linko's button
// «Детали изменений товаров» needs its API 150 (the account runs 147), so it is not shown; ProductChangesDialog below
// keeps that view for when it is.

// Linko's status icons of a log entry (Material access_time, store, local_shipping, assignment_turned_in, block).
const LOG_STATUS: Record<TransferStatus, { label: string; color: string; path: string }> = {
  ожидает: { label: "Ожидает", color: "#f0ad4e", path: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" },
  потвержден: { label: "Потвержден", color: "#f0ad4e", path: "M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z" },
  "в пути": { label: "В пути", color: "#f0ad4e", path: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" },
  принят: { label: "Принят", color: "#81c784", path: "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" },
  отменен: { label: "Отменен", color: "#e57373", path: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM4 12c0-4.4 3.6-8 8-8 1.8 0 3.5.6 4.9 1.7L5.7 16.9C4.6 15.5 4 13.8 4 12zm8 8c-1.8 0-3.5-.6-4.9-1.7L18.3 7.1C19.4 8.5 20 10.2 20 12c0 4.4-3.6 8-8 8z" },
}

/** Linko's action chip: an outer and an inner 1×7 px padded span, the inner one with the coloured 1 px border and a
 * 15 px radius. «approved» has no chip in Linko («Не установлен» as plain text). */
function ActionBadge({ action }: { action: TransferLogAction }) {
  const { t } = useLanguage()
  const color = action === "approved" ? null : TRANSFER_LOG_COLORS[action]
  return (
    <span className="whitespace-nowrap px-[7px] py-px">
      {color ? (
        <span className="whitespace-nowrap rounded-[15px] border px-[7px] py-px" style={{ color, borderColor: color }}>
          {t(TRANSFER_LOG_LABELS[action])}
        </span>
      ) : (
        t("Не установлен")
      )}
    </span>
  )
}

const NBSP = "\u00a0"

export function TransferLogsPanel({ id }: { id: number }) {
  const { t, language } = useLanguage()
  const logs = useCashJson<TransferLog[]>(`/api/internal-transfers/${id}/logs`)
  if (logs.loading && !logs.data) return <LoadingBlock className="py-10" />
  if (logs.error && !logs.data) return <ErrorBlock error={logs.error} onRetry={logs.reload} />
  const rows = [...(logs.data ?? [])].reverse()
  if (!rows.length) return <p className="mt-[50px] text-center text-[13px]">{t("Ничего не найдено")}</p>
  return (
    <div className="flex w-full flex-col gap-[20px] pt-[25px] text-[13px] text-[#333]">
      {rows.map((log) => {
        const status = LOG_STATUS[log.status] ?? LOG_STATUS["отменен"]
        return (
          <div key={log.id}>
            <div className="mb-[10px] flex justify-between rounded-[10px] border border-[#E5E8F1] bg-[#FBFBFB] p-[20px]">
              <div className="flex">
                <div className="flex items-center">
                  {/* Linko's flex items drop the space after the colon on this side. */}
                  <span className="font-semibold">{t("Передача")}:</span>
                  <ActionBadge action={log.action} />
                </div>
                <div className="ml-[10px] flex items-center">
                  <span className="font-semibold">{t("Статус:")}</span>
                  <div className="flex items-center">
                    <span className="flex h-[33px] w-[33px] items-center justify-center" aria-hidden>
                      <svg viewBox="0 0 24 24" className="h-[23px] w-[23px]" style={{ fill: status.color }}>
                        <path d={status.path} />
                      </svg>
                    </span>
                    <span>{t(status.label)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center">
                <div>
                  <span className="font-semibold">
                    {t("Кем")}:{NBSP}
                  </span>
                  {log.userName}
                </div>
                <div className="ml-[20px] flex items-center">
                  <span className="font-semibold">
                    {t("Со склада")}:{NBSP}
                  </span>
                  <span data-no-translate>{log.fromWarehouse}</span>
                </div>
                <div className="ml-[20px] flex items-center">
                  <span className="font-semibold">
                    {t("На склад")}:{NBSP}
                  </span>
                  <span data-no-translate>{log.toWarehouse}</span>
                </div>
                <div className="ml-[20px] flex items-center">
                  <span className="font-semibold">{t("Когда")}:</span>
                  <p className="ml-[5px] leading-[2]">{docDate(log.createdAt, language, true)}</p>
                </div>
              </div>
            </div>
            {log.comment && (
              <div className="flex items-center">
                <span className="mr-[5px] font-semibold">{t("Комментарий")}: </span>
                <p className="leading-[2]">{log.comment}</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

type Metric = "quantity" | "price" | "sum"

export function ProductChangesDialog({ logs, onClose }: { logs: TransferLog[]; onClose: () => void }) {
  const { t, language } = useLanguage()
  const [shown, setShown] = useState<Record<Metric, boolean>>({ quantity: true, price: false, sum: false })
  const products = useMemo(() => {
    const seen = new Map<string, { name: string; unit: string }>()
    for (const log of logs) for (const item of log.items) if (!seen.has(item.key || item.product)) seen.set(item.key || item.product, { name: item.product, unit: item.unit })
    return [...seen.entries()]
  }, [logs])
  const cell = (log: TransferLog, key: string) => log.items.find((item) => (item.key || item.product) === key)
  const metrics = (["quantity", "price", "sum"] as Metric[]).filter((metric) => shown[metric])
  const labels: Record<Metric, string> = { quantity: "Количество", price: "Цена", sum: "Сумма" }
  const value = (log: TransferLog, key: string, metric: Metric) => {
    const item = cell(log, key)
    if (!item) return null
    return metric === "quantity" ? item.quantity : metric === "price" ? item.price : item.quantity * item.price
  }
  return (
    <CashModal
      title={t("Детали изменений товаров")}
      onClose={onClose}
      size="full"
      zIndex={150}
      headerExtra={
        <span className="flex flex-wrap gap-3 text-[13px] font-normal normal-case">
          {(Object.keys(labels) as Metric[]).map((metric) => (
            <label key={metric} className="flex items-center gap-1.5">
              <input type="checkbox" checked={shown[metric]} onChange={(event) => setShown((current) => ({ ...current, [metric]: event.target.checked }))} className="h-4 w-4 accent-[rgb(79,113,220)]" />
              {t(labels[metric])}
            </label>
          ))}
        </span>
      }
    >
      {products.length ? (
        <div className="overflow-auto">
          <table className="min-w-full border-collapse text-[13px]">
            <thead>
              <tr className="align-top">
                <th className="sticky left-0 z-[1] min-w-[200px] border-b border-r border-[#e1e5eb] bg-white p-2 text-left">{t("Продукты")}</th>
                {logs.map((log) => (
                  <th key={log.id} className="min-w-[180px] border-b border-r border-[#e1e5eb] p-2 text-left font-normal">
                    <div className="text-[#586174]">{t("Время изменений")}: {docDate(log.createdAt, language, true)}</div>
                    <div>
                      {t("Действие")}: <b>{t(log.action === "accepted" ? "Принят на склад" : (TRANSFER_LOG_LABELS[log.action] ?? "Не установлен"))}</b>
                    </div>
                    <div className="flex items-center gap-1">
                      {t("Статус")}: <TransferStatusLabel status={log.status} title />
                    </div>
                    <div>
                      {t("Изменил")}: {log.userName || "—"}
                    </div>
                    <div className="text-[#586174]">
                      {log.fromWarehouse} → {log.toWarehouse}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map(([key, product]) => (
                <tr key={key}>
                  <td className="sticky left-0 border-b border-r border-[#e1e5eb] bg-white p-2 font-semibold">{product.name}</td>
                  {logs.map((log, index) => (
                    <td key={log.id} className="border-b border-r border-[#e1e5eb] p-2">
                      {metrics.map((metric) => {
                        const current = value(log, key, metric)
                        const previous = index ? value(logs[index - 1], key, metric) : current
                        let color: string | undefined
                        if (current === null) color = "#9aa3b6"
                        else if (index > 0 && (previous === null || current > previous)) color = "#3aa76d"
                        else if (index > 0 && previous !== null && current < previous) color = "#e57373"
                        return (
                          <div key={metric} style={{ color }}>
                            {metrics.length > 1 && <span className="text-[#9aa3b6]">{t(labels[metric])}: </span>}
                            {current === null ? "—" : metric === "quantity" ? formatQty(current, product.unit) : formatSum(current, log.currency)}
                          </div>
                        )
                      })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyBlock text="Нет данных по истории" />
      )}
    </CashModal>
  )
}
