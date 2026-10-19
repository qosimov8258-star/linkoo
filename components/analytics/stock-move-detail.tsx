"use client"

import { useEffect } from "react"
import Link from "next/link"
import { CircleAlert, Loader2, X } from "lucide-react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatDotDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { MOVE_COLUMNS_OTHERS, MOVE_DOC_TYPES, MOVE_KIND_LABELS, shownMoveValue, type MoveNumbers } from "@/lib/stock-movement-columns"
import type { MoveItemDetail } from "@/lib/stock-movement-report"
import type { StockMoveKind } from "@/lib/stock/types"

// Item detail of "Остаток на определенную дату" (row click; the demo opens the
// stock history of the item): the period's numbers by movement kind, the
// per-warehouse begin / in / out / end and the source documents. A kind card
// (or a table cell of the report) filters the documents by that kind.

const income = (n: MoveNumbers) => n.supply + n.return + n.other_in
const outcome = (n: MoveNumbers) => -(n.supply_return + n.order + n.writeoff + n.other_out)
const qtyText = (value: number) => (value ? formatMoney(value, 3) : "0")

export function StockMoveDetail({ url, kind, onKindChange, onClose }: { url: string | null; kind: string; onKindChange: (kind: string) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const detail = useCashJson<MoveItemDetail>(url)
  useEffect(() => {
    if (!url) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [url, onClose])
  if (!url) return null
  const data = detail.data
  const money = Boolean(data?.total.value)
  const currency = data ? currencyLabel(data.currency) : ""
  const documents = (data?.documents ?? []).filter((document) => !kind || document.kind === kind)
  const unit = data?.item.unit ? t(data.item.unit) : ""
  const cards = MOVE_COLUMNS_OTHERS
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 px-2 py-8" onClick={onClose}>
      <div className="w-full max-w-[1100px] rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-[#e1e5eb] px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#17233b]">{data?.item.name ?? t("Загрузка...")}</h2>
            {data && (
              <p className="mt-1 text-[13px] text-[#586174]">
                {[data.item.article, unit, data.item.type, data.item.brand].filter(Boolean).join(" · ")}
                {" · "}
                {formatDotDate(data.from)} - {formatDotDate(data.to)}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!data && detail.loading && (
          <div className="flex items-center justify-center gap-2 py-20 text-[#586174]">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
          </div>
        )}
        {detail.error && !detail.loading && (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-[#586174]">
            <CircleAlert className="h-8 w-8 text-[#e57373]" />
            <p>
              {t("Не удалось выполнить запрос")}: {t(detail.error)}
            </p>
          </div>
        )}

        {data && (
          <div className={`flex flex-col gap-6 px-6 py-5 ${detail.loading ? "opacity-60" : ""}`}>
            <section>
              <h3 className="mb-2 font-semibold text-[#17233b]">{t("По видам движения")}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {cards.map((column) => {
                  const selectable = column.field !== "begin" && column.field !== "end"
                  const active = selectable && kind === column.field
                  const qty = shownMoveValue(column, data.total.qty[column.field])
                  const content = (
                    <>
                      <span className="block text-[12px] text-[#666]">{t(column.label)}</span>
                      <span className="block font-semibold text-[#17233b]">
                        {qtyText(qty)} {unit}
                      </span>
                      {money && (
                        <span className="block text-[12px] text-[#586174]">
                          {formatMoney(shownMoveValue(column, data.total.value?.[column.field] ?? 0), 2)} {currency}
                        </span>
                      )}
                    </>
                  )
                  return selectable ? (
                    <button
                      key={column.field}
                      type="button"
                      onClick={() => onKindChange(active ? "" : column.field)}
                      className={`rounded-md border px-3 py-2 text-left ${active ? "border-[#4f70e7] bg-[#eef2fd]" : "border-[#e5e5e5] hover:bg-[#f7f7f7]"}`}
                    >
                      {content}
                    </button>
                  ) : (
                    <div key={column.field} className="rounded-md border border-[#e5e5e5] bg-[#f7f7f7] px-3 py-2">
                      {content}
                    </div>
                  )
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-2 font-semibold text-[#17233b]">{t("По складам")}</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[14px]">
                  <thead>
                    <tr className="bg-[#edf2f7] text-left text-[#253653]">
                      <th className="px-3 py-2 font-semibold">{t("Склад")}</th>
                      <th className="px-3 py-2 font-semibold">{t("Остаток на начало периода")}</th>
                      <th className="px-3 py-2 font-semibold">{t("Приход")}</th>
                      <th className="px-3 py-2 font-semibold">{t("Расход")}</th>
                      <th className="px-3 py-2 font-semibold">{t("Остаток на конец")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.warehouses, ...(data.warehouses.length > 1 ? [{ ...data.total, key: "__total", name: t("Итого") }] : [])].map((row) => (
                      <tr key={row.key || "—"} className={`border-b border-[#efefef] ${row.key === "__total" ? "font-semibold" : ""}`}>
                        <td className="px-3 py-2">{row.name || t("Не указано")}</td>
                        <td className="px-3 py-2">{qtyText(row.qty.begin)}</td>
                        <td className="px-3 py-2 text-[#48a34b]">{qtyText(income(row.qty))}</td>
                        <td className="px-3 py-2 text-[#E27676]">{qtyText(outcome(row.qty))}</td>
                        <td className="px-3 py-2">{qtyText(row.qty.end)}</td>
                      </tr>
                    ))}
                    {!data.warehouses.length && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-[#9aa3b6]">
                          {t("Нет движений")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h3 className="font-semibold text-[#17233b]">{t("Документы за период")}</h3>
                {kind && (
                  <span className="flex items-center gap-2 rounded-full border border-[#4f70e7] px-3 py-0.5 text-[13px] text-[#4f70e7]">
                    {t(MOVE_KIND_LABELS[kind as StockMoveKind] ?? kind)}
                    <button type="button" onClick={() => onKindChange("")} aria-label={t("Очистить")}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full border-collapse text-[14px]">
                  <thead className="sticky top-0">
                    <tr className="bg-[#edf2f7] text-left text-[#253653]">
                      <th className="px-3 py-2 font-semibold">{t("Дата")}</th>
                      <th className="px-3 py-2 font-semibold">{t("Документ")}</th>
                      <th className="px-3 py-2 font-semibold">{t("Склад")}</th>
                      <th className="px-3 py-2 font-semibold">{t("Тип движения")}</th>
                      <th className="px-3 py-2 font-semibold">{t("Кол-во")}</th>
                      {money && <th className="px-3 py-2 font-semibold">{t("Стоимость")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => {
                      const source = MOVE_DOC_TYPES[document.docType]
                      const label = `${source ? t(source.label) : document.docType} №${document.docId}`
                      return (
                        <tr key={`${document.docType}.${document.docId}.${document.kind}.${document.warehouse}.${document.day}`} className="border-b border-[#efefef]">
                          <td className="whitespace-nowrap px-3 py-2">{formatDotDate(document.day)}</td>
                          <td className="px-3 py-2">
                            {source ? (
                              <Link href={source.href} className="text-[#4f71dc] hover:underline">
                                {label}
                              </Link>
                            ) : (
                              label
                            )}
                          </td>
                          <td className="px-3 py-2">{document.warehouse || t("Не указано")}</td>
                          <td className="px-3 py-2">{t(MOVE_KIND_LABELS[document.kind] ?? document.kind)}</td>
                          <td className={`whitespace-nowrap px-3 py-2 font-semibold ${document.qty < 0 ? "text-[#E27676]" : "text-[#48a34b]"}`}>
                            {document.qty > 0 ? "+" : ""}
                            {qtyText(document.qty)} {unit}
                          </td>
                          {money && (
                            <td className="whitespace-nowrap px-3 py-2">
                              {formatMoney(document.value ?? 0, 2)} {currency}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                    {!documents.length && (
                      <tr>
                        <td colSpan={money ? 6 : 5} className="px-3 py-6 text-center text-[#9aa3b6]">
                          {t("Нет документов за период")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {data.documentsTruncated && <p className="mt-2 text-[13px] text-[#b7791f]">{t("Показаны последние 500 документов")}</p>}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
