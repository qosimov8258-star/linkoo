"use client"

import { useEffect, useMemo, useState } from "react"

import { amountDigits } from "@/lib/amount-precision"
import { useLanguage } from "@/lib/i18n/language-context"

import { pushParams } from "./supplier-returns-url"

// «+ добавить из списка» of the supplier return form: Linko's «ДОБАВЛЕНИЕ ПРОДУКТОВ» (full screen, &pdPageSize=25 with
// &pdPage / &pdSearch in the address). «Фильтр по типу», «Поиск товаров...», the page size and «1 - 25 из N» with the
// arrows; the columns Наименование / Кол-во (input + unit) / Цена (input, the price list's price) / Код / Доступно (what
// is available in every warehouse: the balance less the reserved goods); «СОХРАНИТЬ» adds every row with a quantity and a price (a price of 0 only when typed, as
// Linko drops the 0 it fills in itself) to the top of the list, replacing the lines of the same products. A new «Фильтр по
// типу» while rows are typed asks «Сохранить текущие товары?» first (Linko's openAddProductConfirm): «Сохранить» moves
// them to the return, «Нет» drops them. The «Код» column shows the product's own code (Linko's column reads a key its
// list never sends, so it prints «-» on every row). Escape does nothing; only the X closes the list.

export type PickerProduct = { key: string; productId: number; name: string; unit: string; type: string; code: string; balance: number; available: number; price: number }
export type PickedLine = { product: PickerProduct; qty: number; price: number }

type RowState = { qty: string; price: string; typed: boolean }

const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
const SEARCH = "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
const PREV = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z"
const NEXT = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-12v8l5-4-5-4z"
// Linko's grid: Наименование 4, Кол-во 2, Цена 2, Код 2, Доступно 2.
const GRID = "grid-cols-[minmax(0,4fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)]"

const parseNumber = (text: string) => Number(text.replace(/[\s ]/g, "").replace(",", "."))
const fmt = (value: number) => (Number.isFinite(value) ? value : 0).toLocaleString("ru-RU", { maximumFractionDigits: amountDigits(3) })

function positive(value: string | null, fallback: number) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

export function SupplierReturnPicker({
  priceList,
  onClose,
  onSave,
  onKeep,
}: {
  priceList: string
  onClose: () => void
  /** «СОХРАНИТЬ»: the picked lines go to the return and the list closes. */
  onSave: (lines: PickedLine[]) => void
  /** «Сохранить» of «Сохранить текущие товары?»: the picked lines go to the return and the list stays open. */
  onKeep: (lines: PickedLine[]) => void
}) {
  const { t } = useLanguage()
  const [products, setProducts] = useState<PickerProduct[] | null>(null)
  const [type, setType] = useState("")
  const [query, setQuery] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("pdSearch") ?? ""))
  const [page, setPage] = useState(() => (typeof window === "undefined" ? 1 : positive(new URLSearchParams(window.location.search).get("pdPage"), 1)))
  const [pageSize, setPageSize] = useState(() => (typeof window === "undefined" ? 25 : Math.min(500, positive(new URLSearchParams(window.location.search).get("pdPageSize"), 25))))
  const [rows, setRows] = useState<Record<string, RowState>>({})
  /** A «Фильтр по типу» change waiting for «Сохранить текущие товары?» (rows were typed). */
  const [pendingType, setPendingType] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/supplier-returns/products?priceList=${encodeURIComponent(priceList)}`)
      .then((response) => (response.ok ? response.json() : { rows: [] }))
      .then((data: { rows?: PickerProduct[] }) => alive && setProducts(data.rows ?? []))
      .catch(() => alive && setProducts([]))
    return () => {
      alive = false
    }
  }, [priceList])

  // Escape does nothing here either (Linko's dialog ignores it): only the X closes the list.

  const types = useMemo(() => [...new Set((products ?? []).map((item) => item.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")), [products])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return (products ?? []).filter((item) => (!type || item.type === type) && (!term || item.name.toLowerCase().includes(term) || item.code.toLowerCase().includes(term)))
  }, [products, type, query])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)

  // The price as Linko prefills it: the raw number of the price list («8800»), not grouped.
  const stateOf = (item: PickerProduct): RowState => rows[item.key] ?? { qty: "", price: String(Number(item.price) || 0), typed: false }
  const patch = (item: PickerProduct, next: Partial<RowState>) => setRows((all) => ({ ...all, [item.key]: { ...stateOf(item), ...next } }))
  const goPage = (next: number) => {
    setPage(next)
    pushParams({ pdPage: String(next) }, true)
  }

  /** Rows with a typed quantity or price (Linko asks before a new type replaces them). */
  const typedRows = Object.values(rows).some((state) => parseNumber(state.qty) > 0 || (state.typed && parseNumber(state.price) > 0))

  function applyType(next: string) {
    setType(next)
    goPage(1)
  }

  /** «Нет» drops the typed rows, «Сохранить» moves them to the return first; either way the new type applies. */
  function answerType(keep: boolean) {
    if (pendingType === null) return
    if (keep) onKeep(pickedLines())
    setRows({})
    applyType(pendingType)
    setPendingType(null)
  }

  function save() {
    onSave(pickedLines())
  }

  function pickedLines(): PickedLine[] {
    const byKey = new Map((products ?? []).map((item) => [item.key, item]))
    const picked: PickedLine[] = []
    for (const [key, state] of Object.entries(rows)) {
      const product = byKey.get(key)
      const qty = parseNumber(state.qty)
      const price = parseNumber(state.price)
      if (!product || !(qty > 0) || !Number.isFinite(price) || price < 0) continue
      if (price === 0 && !state.typed) continue
      picked.push({ product, qty, price })
    }
    return picked
  }

  const field = "h-[40px] min-w-0 flex-1 rounded-[2px] bg-[#f0f4f7] px-[10px] text-right text-[13px] text-[#333] outline-none"
  return (
    <div className="fixed inset-0 z-[1500] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <div className="flex h-[48px] shrink-0 items-center justify-between border-b border-[#e0e0e0] pl-[30px] pr-[22px]">
        <span className="text-[13px] font-bold uppercase">{t("Добавление продуктов")}</span>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-6 w-6 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden>
            <path d={CLOSE} />
          </svg>
        </button>
      </div>

      <div className="relative flex h-[56px] shrink-0 items-center border-b border-[#e0e0e0] px-[30px]">
        <label className="relative flex h-[33px] w-[218px] items-end border-b border-[#e0e0e0] pb-[6px]">
          <span className="text-[13px] font-semibold text-black">{type || t("Фильтр по типу")}</span>
          <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[9px] top-[16px] h-[5px] w-[10px]" aria-hidden>
            <path d="M0 0h10L5 5z" fill="#999" fillOpacity={0.7} />
          </svg>
          <select
            aria-label={t("Фильтр по типу")}
            value={type}
            onChange={(event) => {
              if (typedRows) setPendingType(event.target.value)
              else applyType(event.target.value)
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            <option value="" />
            {types.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="absolute left-1/2 top-[7px] h-[42px] w-[280px] -translate-x-1/2 rounded-[2px] bg-[#f0f4f7]">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
              pushParams({ pdSearch: event.target.value || null, pdPage: null }, true)
            }}
            placeholder={`${t("Поиск товаров")}...`}
            className="h-full w-full bg-transparent pl-[11px] pr-[40px] text-[13px] text-[#333] outline-none placeholder:text-[#bdbdbd]"
          />
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-[11px] top-[9px] h-6 w-6 fill-[#bdbdbd]" aria-hidden>
            <path d={SEARCH} />
          </svg>
        </div>
        <div className="ml-auto flex items-center">
          <label className="relative mr-[30px] flex w-[40px] items-center">
            <span>{pageSize}</span>
            <svg viewBox="0 0 10 5" className="ml-[8px] h-[5px] w-[10px]" aria-hidden>
              <path d="M0 0h10L5 5z" fill="#ccc" />
            </svg>
            <select
              aria-label={t("Строк на странице")}
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
                pushParams({ pdPageSize: event.target.value, pdPage: null }, true)
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span className="leading-[20px]">
            {filtered.length === 0 ? "0 - 0" : `${(current - 1) * pageSize + 1} - ${Math.min(current * pageSize, filtered.length)}`} {t("из")} {filtered.length}
          </span>
          <button type="button" disabled={current <= 1} onClick={() => goPage(current - 1)} aria-label={t("Назад")} className="ml-[10px] h-6 w-6 disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#999]" aria-hidden>
              <path d={PREV} />
            </svg>
          </button>
          <button type="button" disabled={current >= pages} onClick={() => goPage(current + 1)} aria-label={t("Вперед")} className="ml-[5px] h-6 w-6 disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden>
              <path d={NEXT} />
            </svg>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`sticky top-0 z-10 grid h-[50px] ${GRID} items-center border-b border-[#e0e0e0] bg-white px-[30px] font-semibold`}>
          <span>{t("Наименование")}</span>
          <span>{t("Кол-во")}</span>
          <span>{t("Цена")}</span>
          <span className="text-center">{t("Код")}</span>
          <span>{t("Доступно")}</span>
        </div>
        {products === null && <div className="px-[30px] py-6 text-[#999]">{t("Загрузка...")}</div>}
        {visible.map((item, index) => {
          const state = stateOf(item)
          return (
            <div key={item.key} className={`grid min-h-[53px] ${GRID} items-center px-[30px] ${index % 2 === 0 ? "bg-[#f7f9fb]" : ""}`}>
              <span className="truncate pr-[8px]" data-no-translate>
                {item.name}
              </span>
              <div className="flex items-center pr-[8px]">
                <input aria-label={t("Кол-во")} value={state.qty} onChange={(event) => patch(item, { qty: event.target.value.replace(/[^\d.,\s]/g, "") })} inputMode="decimal" className={field} />
                <span className="ml-[10px] shrink-0">{item.unit ? t(item.unit) : ""}</span>
              </div>
              <div className="flex items-center pr-[8px]">
                <input aria-label={t("Цена")} value={state.price} onChange={(event) => patch(item, { price: event.target.value.replace(/[^\d.,\s]/g, ""), typed: true })} inputMode="decimal" className={field} />
              </div>
              <span className="text-center">{item.code || "-"}</span>
              <span>
                {fmt(item.available)} {item.unit ? t(item.unit) : ""}
              </span>
            </div>
          )
        })}
      </div>

      <footer className="flex h-[52px] shrink-0 items-center justify-end border-t border-[#e0e0e0] pr-[16px]">
        <button type="button" onClick={save} className="h-9 px-[16px] text-[13px] font-semibold uppercase text-[#129fdd]">
          {t("Сохранить")}
        </button>
      </footer>

      {pendingType !== null && (
        // Linko's «Сохранить текущие товары?»: a 500px card over the dimmed list, «Нет» / «Сохранить».
        <div role="alertdialog" aria-modal="true" className="absolute inset-0 z-[20] flex items-center justify-center bg-black/30">
          <div className="w-[500px] max-w-[calc(100vw-32px)] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
            <header className="px-[30px] py-[24px] text-[13px] text-[#333]">{t("Сохранить текущие товары")}?</header>
            <div className="p-[8px] text-right">
              <button type="button" onClick={() => answerType(false)} className="h-9 min-w-[88px] px-[16px] text-[14px] font-semibold uppercase text-[#1E4A9A] hover:bg-black/[0.04]">
                {t("Нет")}
              </button>
              <button type="button" onClick={() => answerType(true)} className="h-9 min-w-[88px] px-[16px] text-[14px] font-semibold uppercase text-[#1E4A9A] hover:bg-black/[0.04]">
                {t("Сохранить")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
