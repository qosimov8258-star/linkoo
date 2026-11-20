"use client"

import { X } from "lucide-react"
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { createPortal } from "react-dom"

import { FormField, SearchSelect } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

import { num } from "./supplier-return-card"
import { currencyChoices, useCurrencyCodes } from "./supplier-incoming-dialogs"
import type { Supplier } from "./suppliers-data"

// «Добавить запас» of a supplier card (Linko's ProviderReserveForm, ?providerReserveOpen=true): a 1200 px dialog that edits
// the supplier's whole reserve. «Список товаров» with «Указать стоимость в ручную» (on when the stored lines were priced
// by hand); the grey bar adds a line (Наименование, Кол-во and, by hand, Цена and Валюта; ✓ or Enter in a number field);
// the table lists Наименование, Кол-во with the unit, Цена, Валюта and a delete mark per line. «Сохранить» replaces the
// reserve (PUT /api/suppliers/<id>/reserve); without a hand price each line takes the product's cost.

type Line = { key: number; productId: number | null; product: string; unit: string; qty: number; price: number; currency: string }
type ProductOption = { id: number; name: string; unit: string }

const CHECK = "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
const DELETE_FOREVER = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"
const BOX_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const BOX_CHECKED = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

const parseNumber = (text: string) => {
  const value = Number(text.replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(value) ? value : NaN
}

export function SupplierReserveDialog({ supplier, onClose, onSaved }: { supplier: Supplier; onClose: () => void; onSaved: (supplier: Supplier) => void }) {
  const { t } = useLanguage()
  const currencies = useCurrencyCodes()
  const [products, setProducts] = useState<ProductOption[]>([])
  const [manual, setManual] = useState(() => Boolean(supplier.products[0]?.manual))
  const [lines, setLines] = useState<Line[]>(() =>
    supplier.products.map((item, index) => ({ key: index + 1, productId: item.productId ?? null, product: item.product, unit: item.unit ?? "", qty: item.qty, price: item.price, currency: item.currency || "SUM" })),
  )
  const [draft, setDraft] = useState({ productId: "", qty: "", price: "", currency: "" })
  const [mounted, setMounted] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/products")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: Array<{ id: number; name: string; unit?: string; deleted?: boolean }>) => {
        if (!cancelled) setProducts(rows.filter((row) => !row.deleted).map((row) => ({ id: row.id, name: row.name, unit: row.unit ?? "" })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !event.defaultPrevented && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const options = useMemo(() => products.map((product) => ({ value: String(product.id), label: product.name })), [products])

  function addLine() {
    const product = products.find((item) => String(item.id) === draft.productId)
    const qty = parseNumber(draft.qty)
    if (!product) return notify(t("Выберите товар"))
    if (!Number.isFinite(qty) || qty <= 0) return notify(t("Количество должно быть больше 0"))
    const price = manual ? parseNumber(draft.price || "0") : 0
    if (manual && (!Number.isFinite(price) || price < 0)) return notify(t("Цена должна быть числом"))
    const currency = manual ? draft.currency || currencies.base || "SUM" : currencies.base || "SUM"
    setLines((current) => {
      // The same product again replaces its line, as Linko's list keeps one line per product.
      const rest = current.filter((line) => line.productId !== product.id)
      return [{ key: Math.max(0, ...current.map((line) => line.key)) + 1, productId: product.id, product: product.name, unit: product.unit, qty, price, currency }, ...rest]
    })
    setDraft({ productId: "", qty: "", price: "", currency: draft.currency })
  }

  const onEnter = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    addLine()
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const response = await fetch(`/api/suppliers/${supplier.id}/reserve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual, products: lines.map(({ productId, product, unit, qty, price, currency }) => ({ productId, product, unit, qty, price, currency })) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        notify(data.error ? t(data.error) : t("Не удалось сохранить"))
        return
      }
      onSaved(data as Supplier)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  if (!mounted) return null
  // Linko's columns: Наименование 294 px, Кол-во 174, Цена 228, Валюта the rest, the delete mark 48.
  const cols = "grid-cols-[294px_174px_228px_minmax(0,1fr)_48px]"
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/[0.54] py-[64px]">
      <div role="dialog" aria-modal="true" className="relative w-[1200px] max-w-[calc(100vw-32px)] bg-white text-[13px] text-[#333] shadow-[0_11px_15px_-7px_rgba(0,0,0,0.2),0_24px_38px_3px_rgba(0,0,0,0.14),0_9px_46px_8px_rgba(0,0,0,0.12)]">
        <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <span className="font-bold uppercase text-[#333]">{t("Добавить запас")}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#666]">
            <X className="h-6 w-6" strokeWidth={1.6} />
          </button>
        </div>
        <div className="min-h-[500px]">
          {/* Linko's 80 px row: «Список товаров» and the 241 px checkbox whose label wraps onto two lines. */}
          <div className="flex h-[80px] items-center justify-between px-[30px]">
            <strong className="font-semibold text-black">{t("Список товаров")}</strong>
            <button type="button" role="checkbox" aria-checked={manual} onClick={() => setManual((value) => !value)} className="flex w-[241px] items-start gap-[4px] text-left font-semibold">
              <svg viewBox="0 0 24 24" className={`h-6 w-6 shrink-0 ${manual ? "fill-[#5d6474]" : "fill-[#333]"}`} aria-hidden>
                <path d={manual ? BOX_CHECKED : BOX_EMPTY} />
              </svg>
              <span className="max-w-[150px] pt-[3px] leading-[20px]">{t("Указать стоимость в ручную")}</span>
            </button>
          </div>
          <div className="flex h-[76px] items-end gap-[20px] bg-[#f1f5f8] px-[38px] pb-[14px]">
            <div className="min-w-0 flex-[3.5]">
              <FormField label={t("Наименование")} semibold>
                <SearchSelect variant="underline" value={draft.productId} options={options} onChange={(productId) => setDraft((current) => ({ ...current, productId }))} />
              </FormField>
            </div>
            <div className="min-w-0 flex-[1.5]">
              <FormField label={t("Кол-во")} semibold>
                <input inputMode="decimal" value={draft.qty} onKeyDown={onEnter} onChange={(event) => setDraft((current) => ({ ...current, qty: event.target.value }))} className="block h-[30px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold outline-none" />
              </FormField>
            </div>
            {manual && (
              <>
                <div className="min-w-0 flex-[2]">
                  <FormField label={t("Цена")} semibold>
                    <input inputMode="decimal" value={draft.price} onKeyDown={onEnter} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} className="block h-[30px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold outline-none" />
                  </FormField>
                </div>
                <div className="min-w-0 flex-[1.5]">
                  <FormField label={t("Валюта")} semibold>
                    <SearchSelect
                      variant="underline"
                      allowClear={false}
                      value={draft.currency}
                      options={currencyChoices(currencies.codes, currencies.base, draft.currency).map((code) => ({ value: code, label: code }))}
                      onChange={(currency) => setDraft((current) => ({ ...current, currency }))}
                    />
                  </FormField>
                </div>
              </>
            )}
            <button type="button" aria-label={t("Добавить")} onClick={addLine} className="mb-[4px] flex h-6 w-6 shrink-0 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#1E4A9A]" aria-hidden>
                <path d={CHECK} />
              </svg>
            </button>
          </div>
          <div className="px-[30px] pb-[20px] pt-[18px]">
            <div className={`grid ${cols} h-[50px] items-center border-b border-dotted border-[#cfd6dc] font-semibold`}>
              <span>{t("Наименование")}</span>
              <span>{t("Кол-во")}</span>
              <span>{t("Цена")}</span>
              <span>{t("Валюта")}</span>
              <span />
            </div>
            {lines.map((line) => (
              <div key={line.key} className={`grid ${cols} h-[50px] items-center border-b border-dotted border-[#cfd6dc]`}>
                <span className="truncate pl-[5px]">{line.product}</span>
                {/* Linko's values sit off its headers: Кол-во 4 px and Цена 7 px to the left, Валюта 27 px to the right. */}
                <span className="-ml-[4px]">
                  {line.qty} {line.unit}
                </span>
                <span className="-ml-[7px]">{manual || line.price ? num(line.price) : ""}</span>
                <span className="pl-[26px]">{manual || line.price ? line.currency : ""}</span>
                <button type="button" aria-label={t("Удалить")} title={t("Удалить")} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} className="flex h-12 w-12 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]" aria-hidden>
                    <path d={DELETE_FOREVER} />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="relative border-t border-[#efefef] p-[10px] text-right">
          <button type="button" disabled={saving} onClick={() => void save()} className="h-9 px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:opacity-80 disabled:opacity-40">
            {t("Сохранить")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
