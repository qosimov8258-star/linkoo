"use client"

import { useEffect } from "react"
import { Printer, X } from "lucide-react"

import { docDate, formatQty, unitTotals } from "@/components/analytics/internal-transfers-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import type { Transfer, TransferWarehouse } from "@/lib/internal-transfers-types"

// "Накладные по передачам" (demo c7 module 4645, printed with window.print):
// one "Накладная № N" per transfer — Добавлено, От кого / Адрес, Кому / Адрес,
// № | Наименование | Кол-во | Ед. изм., Итого (per unit), "Отпустил" (source warehouse
// manager) and "Получил" (target warehouse manager). Every invoice starts a page.

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .transfer-print, .transfer-print * { visibility: visible !important; }
  .transfer-print { position: absolute !important; inset: 0 auto auto 0 !important; width: 100% !important; overflow: visible !important; background: #fff !important; }
  .transfer-print .no-print { display: none !important; }
  .transfer-print .print-page { break-after: page; box-shadow: none !important; margin: 0 !important; }
  .transfer-print .print-page:last-child { break-after: auto; }
}`

export function TransferInvoices({ transfers, warehouses, onClose }: { transfers: Transfer[]; warehouses: TransferWarehouse[]; onClose: () => void }) {
  const { t, language } = useLanguage()
  const byName = new Map(warehouses.map((warehouse) => [warehouse.name.trim().toLowerCase(), warehouse]))
  const info = (name: string) => byName.get(name.trim().toLowerCase())

  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 300)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  return (
    <div className="transfer-print fixed inset-0 z-[200] overflow-auto bg-[#f1f4f8] text-[14px] text-[#17233b]" role="dialog" aria-modal="true">
      <style>{PRINT_CSS}</style>
      <div className="no-print sticky top-0 z-[1] flex items-center justify-between gap-3 border-b border-[#e1e5eb] bg-white px-4 py-3 md:px-8">
        <span className="font-bold uppercase">
          {t("Накладные по передачам")} ({transfers.length})
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-2 rounded-md bg-[rgb(79,113,220)] px-4 font-semibold text-white">
            <Printer className="h-4 w-4" /> {t("Печать")}
          </button>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-9 w-9 items-center justify-center rounded-full text-[#666] hover:bg-[#f2f5f8]">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      {transfers.map((transfer) => {
        const fromInfo = info(transfer.fromWarehouse)
        const toInfo = info(transfer.toWarehouse)
        // "Итого" per unit (one line each): kilograms, pieces and litres are never added up.
        const totals = unitTotals(transfer.items.map((item) => ({ qty: item.quantity, unit: item.unit })))
        return (
          <section key={transfer.id} className="print-page mx-auto my-6 max-w-[820px] bg-white p-8 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#17233b] pb-3">
              <span className="text-[20px] font-bold">
                {t("Накладная")} № {transfer.id}
              </span>
              {transfer.organization && <span className="text-[18px] font-semibold">{transfer.organization}</span>}
              <span>
                {t("Добавлено")}: {docDate(transfer.createdAt, language) || t("Не указано")}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                [t("От кого"), transfer.fromWarehouse, fromInfo?.address],
                [t("Кому"), transfer.toWarehouse, toInfo?.address],
              ].map(([label, name, address]) => (
                <dl key={label} className="grid grid-cols-[auto_1fr] gap-x-3 leading-[25px]">
                  <dt className="font-bold">{label}:</dt>
                  <dd>{name}</dd>
                  <dt className="font-bold">{t("Адрес")}:</dt>
                  <dd>{address || "—"}</dd>
                </dl>
              ))}
            </div>
            <table className="mt-5 w-full border-collapse">
              <thead>
                <tr className="border-b border-[#17233b] text-left">
                  <th className="w-12 py-2">№</th>
                  <th className="py-2">{t("Наименование")}</th>
                  <th className="py-2 text-right">{t("Кол-во")}</th>
                  <th className="py-2 pl-4">{t("Ед. изм.")}</th>
                </tr>
              </thead>
              <tbody>
                {transfer.items.map((item, index) => (
                  <tr key={item.id} className="border-b border-[#e1e5eb]">
                    <td className="py-1.5">{index + 1}</td>
                    <td className="py-1.5">{item.product}</td>
                    <td className="py-1.5 text-right">{formatQty(item.quantity)}</td>
                    <td className="py-1.5 pl-4">{item.unit}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {(totals.length ? totals : [{ unit: "", qty: 0 }]).map((total, index) => (
                  <tr key={`${index}-${total.unit}`} className="font-bold">
                    <td className={index ? "pt-0.5" : "pt-2"} colSpan={2}>
                      {index === 0 && `${t("Итого")}:`}
                    </td>
                    <td className={`${index ? "pt-0.5" : "pt-2"} text-right`}>{formatQty(total.qty)}</td>
                    <td className={`${index ? "pt-0.5" : "pt-2"} pl-4`}>{total.unit}</td>
                  </tr>
                ))}
              </tfoot>
            </table>
            <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
              {[
                [t("Отпустил"), fromInfo?.manager],
                [t("Получил"), toInfo?.manager],
              ].map(([label, manager]) => (
                <div key={label}>
                  <div className="flex items-end gap-2">
                    <span className="font-bold">{label}:</span>
                    <span className="h-5 flex-1 border-b border-[#17233b]" />
                  </div>
                  <div className="ml-5 mt-1 text-[13px] text-[#586174]">({manager || "____________"})</div>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
