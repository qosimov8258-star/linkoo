"use client"

import { useEffect, useState, type ReactNode } from "react"
import { X } from "lucide-react"

import { qtyWithUnit } from "@/components/analytics/stock-level-state"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatDotDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockItemDetail } from "@/lib/stock/level-types"

// Item detail of "Остаток" (demo m3870 dialog: Код | Дата приемки | Кол-во |
// Статус): ours shows the per-warehouse breakdown and the latest receipts
// (supplies, production output, accepted transfers, inventory surplus), each
// with its acceptance day and Брак / OK. Plus the "Проверить себестоимость"
// dialog (m3872) with the server's text.

const DOC_LABELS: Record<string, string> = {
  supplier_incomings: "Поставка",
  production_movements: "Производство",
  internal_transfers: "Внутреннее перемещение",
  stock_inventories: "Инвентаризация",
  supplier_returns: "Возврат поставщику",
  write_offs: "Списание",
  orders: "Заказ",
}

function useJson<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string }>({ url: null, data: null, error: "" })
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error((body as { error?: string } | null)?.error || `HTTP ${response.status}`)
        setState({ url, data: body as T, error: "" })
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setState({ url, data: null, error: reason instanceof Error ? reason.message : String(reason) })
      })
    return () => controller.abort()
  }, [url])
  const ready = state.url === url
  return { data: ready ? state.data : null, error: ready ? state.error : "", loading: Boolean(url) && !ready }
}

function Modal({ title, onClose, width = "max-w-[860px]", children }: { title: string; onClose: () => void; width?: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 py-10" onClick={onClose}>
      <div className={`w-full ${width} rounded-lg bg-white shadow-xl`} onClick={(event) => event.stopPropagation()}>
        <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-6 pr-3">
          <h2 className="truncate font-bold uppercase text-[#333]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="p-2 text-[#666]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function StockItemDialog({ itemKey, scope, fallbackName, onClose }: { itemKey: string; scope: string; fallbackName: string; onClose: () => void }) {
  const { t } = useLanguage()
  const url = `/api/stock/balances/${encodeURIComponent(itemKey)}${scope ? `?${scope}` : ""}`
  const { data, error, loading } = useJson<StockItemDetail>(url)
  const unit = data?.unit ?? ""
  const money = (value: number) => `${formatMoney(value, 2)} ${currencyLabel(data?.baseCurrency ?? "SUM")}`
  const th = "border-b border-[#efefef] px-3 py-2 text-left font-semibold text-[#586174]"
  const td = "border-b border-[#f3f4f6] px-3 py-2"
  return (
    <Modal title={data?.name ?? fallbackName} onClose={onClose}>
      {loading && <p className="p-10 text-center text-[#8b95a5]">{t("Загрузка...")}</p>}
      {error && <p className="p-10 text-center text-[#e5484d]">{t(error)}</p>}
      {data && (
        <div className="max-h-[75vh] overflow-y-auto px-6 pb-6">
          <div className="grid grid-cols-2 gap-3 py-4 text-[14px] md:grid-cols-6">
            {(
              [
                ["Всего", qtyWithUnit(data.total.total, unit, t)],
                ["Забронировано", qtyWithUnit(data.total.reserved, unit, t)],
                ["В пути", qtyWithUnit(data.total.transit, unit, t)],
                ["Брак", qtyWithUnit(data.total.defects, unit, t)],
                ["Доступно", qtyWithUnit(data.total.available, unit, t)],
                ["Себестоимость", money(data.cost)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <p className="text-[#586174]">{t(label)}</p>
                <p className="font-semibold text-[#17233b]">{value}</p>
              </div>
            ))}
          </div>

          <h3 className="mb-1 mt-2 font-semibold text-[#17233b]">{t("Склады")}</h3>
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr>
                {["Склад", "Всего", "Забронировано", "В пути", "Брак", "Доступно", "Сумма"].map((label) => (
                  <th key={label} className={`${th} ${label === "Склад" ? "" : "text-right"}`}>
                    {t(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.warehouses.map((line) => (
                <tr key={line.warehouse}>
                  <td className={td}>
                    {line.warehouse}
                    {line.branch && <span className="ml-2 text-xs text-[#7a8599]">{line.branch}</span>}
                  </td>
                  <td className={`${td} text-right font-semibold`}>{qtyWithUnit(line.total, unit, t)}</td>
                  <td className={`${td} text-right`}>{qtyWithUnit(line.reserved, unit, t)}</td>
                  <td className={`${td} text-right text-[#f0ad4e]`}>{qtyWithUnit(line.transit, unit, t)}</td>
                  <td className={`${td} text-right`}>{qtyWithUnit(line.defects, unit, t)}</td>
                  <td className={`${td} text-right`}>{qtyWithUnit(line.available, unit, t)}</td>
                  <td className={`${td} text-right`}>{money(line.value)}</td>
                </tr>
              ))}
              {!data.warehouses.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-[#8b95a5]">
                    {t("Нет данных")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <h3 className="mb-1 mt-6 font-semibold text-[#17233b]">{t("Последние поступления")}</h3>
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr>
                {["Код", "Дата приемки", "Склад", "Кол-во", "Себестоимость", "Статус"].map((label) => (
                  <th key={label} className={`${th} ${label === "Кол-во" || label === "Себестоимость" ? "text-right" : ""}`}>
                    {t(label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.receipts.map((receipt, index) => (
                <tr key={`${receipt.docType}-${receipt.docId}-${index}`}>
                  <td className={td}>
                    {t(DOC_LABELS[receipt.docType] ?? receipt.docType)} №{receipt.docId}
                  </td>
                  <td className={td}>{receipt.day === "1970-01-01" ? "-" : formatDotDate(receipt.day)}</td>
                  <td className={td}>{receipt.warehouse}</td>
                  <td className={`${td} text-right`}>{qtyWithUnit(receipt.qty, unit, t)}</td>
                  <td className={`${td} text-right`}>{receipt.unitCost ? money(receipt.unitCost) : "-"}</td>
                  <td className={`${td} ${receipt.isDefect ? "text-[#e57373]" : "text-[#3aa76d]"}`}>{receipt.isDefect ? t("Брак") : "OK"}</td>
                </tr>
              ))}
              {!data.receipts.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-[#8b95a5]">
                    {t("Нет данных")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

export function CheckNetCostDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const { data, error, loading } = useJson<{ text: string; text_color: string }>("/api/stock/balances/check-net-cost")
  return (
    <Modal title={t("Проверить себестоимость")} onClose={onClose} width="max-w-[520px]">
      <div className="px-6 py-8 text-center">
        {loading && <p className="text-[#8b95a5]">{t("Загрузка...")}</p>}
        {error && <p className="text-[#e5484d]">{t(error)}</p>}
        {data && <p style={{ color: data.text_color }}>{t(data.text)}</p>}
      </div>
      <div className="flex justify-end border-t border-[#efefef] px-6 py-4">
        <button type="button" onClick={onClose} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white">
          {t("Ок")}
        </button>
      </div>
    </Modal>
  )
}
