"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { formatQty } from "@/components/analytics/stock-level-state"
import { useLanguage } from "@/lib/i18n/language-context"
import type { StockReservedDoc } from "@/lib/stock/reserved"

// «Забронировано» of Остаток (Linko: the reserved count opens a 700px dialog, ?dynamicList=<product id>): the product's
// name, the pager «1 - N из N» (25 a page), then «№ заказа | Склад | Кол-во» with one dotted row per document line —
// «Заказ № N» / «Передача на склад № N» open the document in a new tab, the quantity as «N ед.».

const PAGE_SIZE = 25
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
const PREV = "M22,12A10,10 0 0,0 12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12M20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12M14,7L9,12L14,17V7Z"
const NEXT = "M2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2A10,10 0 0,0 2,12M4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12M10,17L15,12L10,7V17Z"

function docLink(doc: StockReservedDoc): { href: string; label: string } {
  return doc.docType === "transfer"
    ? { href: `/analytics/internal-transfers?id=${doc.docId}`, label: "Передача на склад" }
    : { href: `/analytics/sales/${doc.docId}`, label: "Заказ" }
}

export function StockReservedDialog({ itemKey, name, warehouses, onClose }: { itemKey: string; name: string; warehouses: string[]; onClose: () => void }) {
  const { t } = useLanguage()
  const params = new URLSearchParams({ key: itemKey })
  for (const warehouse of warehouses) params.append("warehouse", warehouse)
  const { data, loading, error } = useCashJson<{ rows: StockReservedDoc[] }>(`/api/stock/reserved?${params.toString()}`)
  const rows = data?.rows ?? []
  const [page, setPage] = useState(1)
  const lastPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, lastPage)
  const shown = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => dialogRef.current?.focus(), [])

  const arrow = (path: string, disabled: boolean, onClick: () => void, label: string) => (
    <button type="button" disabled={disabled} onClick={onClick} aria-label={t(label)} className="flex h-[24px] w-[24px] items-center justify-center disabled:cursor-not-allowed">
      <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6" style={{ fill: disabled ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.6)" }}>
        <path d={path} />
      </svg>
    </button>
  )
  const row = "grid grid-cols-3 items-center border-b border-dotted border-[#ccc] text-[13px] text-[#333]"
  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.54] px-4" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose()
        }}
        onClick={(event) => event.stopPropagation()}
        className={`max-h-[calc(100vh-64px)] overflow-y-auto bg-white outline-none [box-shadow:0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)] ${loading && !data ? "w-[400px]" : "w-[700px]"} max-w-full`}
      >
        {loading && !data ? (
          <div className="flex h-[120px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#9aa3b6]" aria-label={t("Загрузка...")} />
          </div>
        ) : (
          <>
            <div className="flex h-[59px] items-center justify-between border-b border-[#efefef] px-[30px]">
              <div className="truncate text-[13px] font-semibold uppercase text-[#333]">{name}</div>
              <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
                <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6 fill-[#666]">
                  <path d={CLOSE} />
                </svg>
              </button>
            </div>
            {error && !data ? (
              <p className="px-[30px] py-10 text-center text-[13px] text-[#e5484d]">{t(error)}</p>
            ) : !rows.length ? (
              <p className="px-[30px] py-10 text-center text-[13px] text-[#666]">{t("Забронированных товаров не найдено")}</p>
            ) : (
              <div className="px-[30px] pb-[6px]">
                <div className="-mx-[30px] flex h-[49px] items-center justify-end gap-[6px] border-b border-[#efefef] px-[30px] text-[13px] text-[#5d6474]">
                  <span className="mr-[6px]">
                    {(current - 1) * PAGE_SIZE + 1} - {Math.min(current * PAGE_SIZE, rows.length)} {t("из")} {rows.length}
                  </span>
                  {arrow(PREV, current <= 1, () => setPage(current - 1), "Назад")}
                  {arrow(NEXT, current >= lastPage, () => setPage(current + 1), "Вперед")}
                </div>
                <div className={`${row} h-[46px]`}>
                  <span>{t("№ заказа")}</span>
                  <span>{t("Склад")}</span>
                  <span className="text-right">{t("Кол-во")}</span>
                </div>
                {shown.map((doc, index) => {
                  const link = docLink(doc)
                  return (
                    <div key={`${doc.docType}-${doc.docId}-${index}`} className={`${row} min-h-[46px] last:border-b-0`}>
                      <span>
                        <a href={link.href} target="_blank" rel="noreferrer" className="text-[#129fdd] hover:underline">
                          {t(link.label)} № {doc.docId}
                        </a>
                      </span>
                      <span className="break-words py-[6px] pr-2">{doc.warehouse}</span>
                      <span className="text-right">
                        {formatQty(doc.qty)} {t("ед.")}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
