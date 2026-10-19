"use client"

import { useMemo, useState } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/analytics/cash-management-shared"
import { TransferStatusLabel, docDate, formatQty, formatSum } from "@/components/analytics/internal-transfers-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { TRANSFER_LOG_COLORS, TRANSFER_LOG_LABELS, type TransferLog, type TransferLogAction } from "@/lib/internal-transfers-types"

// "Логи" tab of a transfer (demo c7 module 4640): one block per action —
// "Передача: <action>", "Статус: …", Кем, Со склада, На склад, Когда and the
// comment — and "Детали изменений товаров" (module 4641): every product's
// quantity / price / sum after each action, changed cells highlighted.

function ActionBadge({ action }: { action: TransferLogAction }) {
  const { t } = useLanguage()
  const color = TRANSFER_LOG_COLORS[action] ?? "#64b5f6"
  return (
    <span className="rounded-full border px-2.5 py-0.5 text-[12px] font-semibold" style={{ color, borderColor: color }}>
      {t(TRANSFER_LOG_LABELS[action] ?? "Не установлен")}
    </span>
  )
}

export function TransferLogsPanel({ id }: { id: number }) {
  const { t, language } = useLanguage()
  const logs = useCashJson<TransferLog[]>(`/api/internal-transfers/${id}/logs`)
  const [details, setDetails] = useState(false)
  if (logs.loading && !logs.data) return <LoadingBlock className="py-10" />
  if (logs.error && !logs.data) return <ErrorBlock error={logs.error} onRetry={logs.reload} />
  const rows = [...(logs.data ?? [])].reverse()
  if (!rows.length) return <EmptyBlock text="Ничего не найдено" className="py-10" />
  return (
    <div className="py-3">
      <div className="mb-3 flex justify-end">
        <button type="button" onClick={() => setDetails(true)} className="inline-flex h-[30px] items-center rounded-sm bg-[rgb(79,113,220)] px-3 text-[13px] font-semibold text-white hover:brightness-95">
          {t("Детали изменений товаров")}
        </button>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((log) => (
          <li key={log.id} className="rounded-md border border-[#e1e5eb] px-4 py-3 leading-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <b>{t("Передача")}:</b> <ActionBadge action={log.action} />
              </span>
              <span className="flex items-center gap-2">
                <b>{t("Статус: ")}</b> <TransferStatusLabel status={log.status} title />
              </span>
            </div>
            <div className="flex flex-wrap gap-x-6 text-[13px]">
              <span>
                <b>{t("Кем")}:</b> {log.userName || t("Не указано")}
              </span>
              <span>
                <b>{t("Со склада")}:</b> {log.fromWarehouse}
              </span>
              <span>
                <b>{t("На склад")}:</b> {log.toWarehouse}
              </span>
              <span>
                <b>{t("Когда")}:</b> {docDate(log.createdAt, language, true)}
              </span>
            </div>
            {log.comment && (
              <div className="text-[13px]">
                <b>{t("Комментарий")}:</b> {log.comment}
              </div>
            )}
          </li>
        ))}
      </ul>
      {details && <ProductChangesDialog logs={logs.data ?? []} onClose={() => setDetails(false)} />}
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
