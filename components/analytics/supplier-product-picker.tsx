"use client"

import { useEffect, useMemo, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

/**
 * The reference's "ДОБАВЛЕНИЕ ПРОДУКТОВ" (the supply form's "добавить из списка"): the whole product catalogue with
 * a quantity (in boxes or units) and a price input per row; saving adds every row with a quantity to the supply.
 */

type PickerProduct = { name: string; unit: string; type: string; brand: string; barcode: string; cost: number; boxUnit: string; boxAmount: number }
type RowState = { box: string; qty: string; price: string }

const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
const SEARCH = "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
const PREV = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z"
const NEXT = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-12v8l5-4-5-4z"

/** The reference grid: 12 units = Наименование 2, Группа 2, Кол-во 2, Цена 2, Сумма 1, Код 2, В наличии 1. */
const GRID = "grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]"

const number = (value: string) => Number(value.replace(/\s/g, "").replace(",", ".")) || 0
const fmt = (value: number, digits = 3) => (Math.round(value * 10 ** digits) / 10 ** digits).toLocaleString("ru-RU", { maximumFractionDigits: digits })

function group(value: string) {
  const clean = value.replace(/[^\d.,]/g, "")
  const [integer, ...rest] = clean.split(/[.,]/)
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return rest.length ? `${grouped},${rest.join("")}` : clean.match(/[.,]$/) ? `${grouped},` : grouped
}

function HeaderSelect({ left, width, label, value, options, onChange }: { left: number | string; width: number; label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div style={{ left, width }} className="absolute top-[26px] h-[33px]">
      <span className="pointer-events-none absolute left-0 top-[8px] text-[13px] font-semibold uppercase leading-[18px] text-black">{value || label}</span>
      <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[9px] top-[16px] h-[5px] w-[10px]" aria-hidden>
        <path d="M0 0h10L5 5z" fill="#999" fillOpacity={0.7} />
      </svg>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
        <option value="" />
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span className="absolute inset-x-0 bottom-0 h-px bg-[#e0e0e0]" />
    </div>
  )
}

export function SupplierProductPicker({
  currency,
  stock,
  initial,
  onClose,
  onSave,
}: {
  currency: string
  stock: Record<string, { stock: number; barcode: string }>
  initial: { product: string; qty: number; cost: number }[]
  onClose: () => void
  onSave: (items: { product: string; qty: number; cost: number }[]) => void
}) {
  const { t } = useLanguage()
  const [products, setProducts] = useState<PickerProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState("")
  const [brand, setBrand] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  // The reference lists the catalogue in its own "all balances" sequence (product_reference_order).
  const [order, setOrder] = useState<Map<string, { seq: number; price: number | null }>>(new Map())

  useEffect(() => {
    let cancelled = false
    void fetch("/api/products/reference-order")
      .then((response) => (response.ok ? response.json() : []))
      .then((entries: { name: string; price: number | null }[]) => {
        if (!cancelled) setOrder(new Map(entries.map((entry, index) => [entry.name, { seq: index, price: entry.price }])))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetch("/api/products")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: { name: string; unit: string; type: string; brand: string; barcode: string; cost: number; boxUnit?: string; boxAmount?: number; deleted?: boolean; isInventory?: boolean }[]) => {
        if (cancelled) return
        setProducts(
          data
            .filter((item) => !item.deleted && !item.isInventory)
            .map((item) => ({ name: item.name, unit: item.unit, type: item.type, brand: item.brand, barcode: item.barcode, cost: item.cost ?? 0, boxUnit: item.boxUnit ?? "", boxAmount: item.boxAmount ?? 0 }))
,
        )
        const start: Record<string, RowState> = {}
        for (const item of initial) start[item.product] = { box: "", qty: group(String(item.qty).replace(".", ",")), price: group(String(item.cost).replace(".", ",")) }
        setRows(start)
        setLoading(false)
      })
      .catch(() => setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const typeOptions = useMemo(() => Array.from(new Set(products.map((item) => item.type).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru")), [products])
  const brandOptions = useMemo(() => Array.from(new Set(products.map((item) => item.brand).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru")), [products])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    const list = products.filter((item) => (!type || item.type === type) && (!brand || item.brand === brand) && (!term || item.name.toLowerCase().includes(term) || item.barcode.toLowerCase().includes(term)))
    if (order.size === 0) return list
    return [...list].sort((a, b) => (order.get(a.name)?.seq ?? Infinity) - (order.get(b.name)?.seq ?? Infinity))
  }, [products, type, brand, query, order])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)

  const stateOf = (item: PickerProduct): RowState => rows[item.name] ?? { box: "", qty: "", price: group(String(order.get(item.name)?.price ?? 0).replace(".", ",")) }
  const patch = (item: PickerProduct, next: Partial<RowState>) => setRows((all) => ({ ...all, [item.name]: { ...stateOf(item), ...next } }))

  const chosen = products.flatMap((item) => {
    const state = rows[item.name]
    const qty = state ? number(state.qty) : 0
    return qty > 0 ? [{ item, qty, price: number(state.price) }] : []
  })
  const total = chosen.reduce((sum, row) => sum + row.qty * row.price, 0)
  const totalQty = chosen.reduce((sum, row) => sum + row.qty, 0)

  return (
    <div className="fixed inset-0 z-[1500] flex flex-col bg-white text-[13px] text-[#333]">
      <div className="relative h-[68px] shrink-0 border-b border-[#e0e0e0]">
        <span className="absolute left-[30px] top-[25px] text-[13px] font-bold uppercase leading-[16px] text-[#333]">{t("Добавление продуктов")}</span>
        <HeaderSelect left="calc(50% - 287px)" width={227} label={t("Тип товара")} value={type} options={typeOptions} onChange={(value) => { setType(value); setPage(1) }} />
        <HeaderSelect left="calc(50% - 47px)" width={230} label={t("Бренд")} value={brand} options={brandOptions} onChange={(value) => { setBrand(value); setPage(1) }} />
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="absolute right-[22px] top-[22px] h-6 w-6">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
            <path d={CLOSE} />
          </svg>
        </button>
      </div>

      <div className="relative h-[56px] shrink-0 border-b border-[#e0e0e0]">
        <div className="absolute left-[30px] top-[15px] flex items-center">
          <label className="relative flex w-[67px] items-center">
            <span className="text-[13px]">{pageSize}</span>
            <svg viewBox="0 0 10 5" className="ml-[8px] h-[5px] w-[10px]" aria-hidden>
              <path d="M0 0h10L5 5z" fill="#ccc" />
            </svg>
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="absolute inset-0 cursor-pointer opacity-0">
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <span className="text-[13px] leading-[20px]">{filtered.length === 0 ? "0 - 0" : `${(current - 1) * pageSize + 1} - ${Math.min(current * pageSize, filtered.length)}`} {t("из")} {filtered.length}</span>
          <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="prev" className="ml-[10px] h-6 w-6 disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#999]">
              <path d={PREV} />
            </svg>
          </button>
          <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="next" className="ml-[5px] h-6 w-6 disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
              <path d={NEXT} />
            </svg>
          </button>
        </div>
        <div className="absolute left-1/2 top-[7px] h-[42px] w-[280px] -translate-x-1/2 rounded-[2px] bg-[#f0f4f7]">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={`${t("Поиск товаров")}...`} className="h-full w-full bg-transparent pl-[11px] pr-[40px] text-[13px] text-[#333] outline-none placeholder:text-[#bdbdbd]" />
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-[11px] top-[9px] h-6 w-6 fill-[#bdbdbd]">
            <path d={SEARCH} />
          </svg>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`sticky top-0 z-10 grid h-[49px] pt-[2px] ${GRID} items-center border-b border-[#e0e0e0] bg-white px-[30px] font-semibold`}>
          <span>{t("Наименование")}</span>
          <span className="pr-[8px] text-right">{t("Группа")}</span>
          <span className="pr-[8px] text-right">{t("Кол-во")}</span>
          <span className="pr-[8px] text-right">{t("Цена")}</span>
          <span className="pr-[8px] text-right">{t("Сумма")}</span>
          <span className="pr-[8px] text-right">{t("Код")}</span>
          <span className="text-right">{t("В наличии")}</span>
        </div>
        {loading && <div className="px-[30px] py-6 text-[#999]">{t("Загрузка…")}</div>}
        {visible.map((item, index) => {
          const state = stateOf(item)
          const qty = number(state.qty)
          const price = number(state.price)
          const info = stock[item.name]
          const field = "h-[40px] min-w-0 flex-1 rounded-[2px] bg-[#f0f4f7] px-[10px] text-right text-[13px] text-[#333] outline-none"
          return (
            <div key={item.name} className={`grid min-h-[53px] ${GRID} items-center px-[30px] ${index % 2 === 1 ? "bg-[#f7f9fb]" : ""}`}>
              <span className="truncate pr-[8px] leading-[16px]">{item.name}</span>
              <div className="flex items-center pl-[9px] pr-[8px]">
                {item.boxAmount > 0 && item.boxUnit && (
                  <>
                    <input
                      value={state.box}
                      onChange={(event) => {
                        const grouped = group(event.target.value)
                        const boxes = number(grouped)
                        patch(item, { box: grouped, qty: boxes > 0 ? group(String(Math.round(boxes * item.boxAmount * 1000) / 1000).replace(".", ",")) : "" })
                      }}
                      inputMode="decimal"
                      className={field}
                    />
                    <span className="ml-[11px] shrink-0 text-right leading-[16px]">
                      {`${item.boxUnit} (${item.boxAmount} ${item.unit})`}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center pl-[9px] pr-[8px]">
                <input
                  value={state.qty}
                  onChange={(event) => {
                    const grouped = group(event.target.value)
                    const value = number(grouped)
                    patch(item, { qty: grouped, box: item.boxAmount > 0 && value > 0 ? fmt(value / item.boxAmount).replace(/\s/g, "") : "" })
                  }}
                  inputMode="decimal"
                  className={field}
                />
                <span className="ml-[11px] shrink-0 leading-[16px]">{item.unit}</span>
              </div>
              <div className="flex items-center pl-[9px] pr-[8px]">
                <input value={state.price} onChange={(event) => patch(item, { price: group(event.target.value) })} inputMode="decimal" className={field} />
                <span className="ml-[11px] shrink-0 leading-[16px]">{currency}</span>
              </div>
              <span className="pr-[8px] text-right font-semibold leading-[16px]">
                {fmt(qty * price)} {currency}
              </span>
              <span className="pr-[8px] text-right leading-[16px]">-</span>
              <span className="text-right leading-[16px]">{info ? `${info.stock.toLocaleString("ru-RU")} ${item.unit}` : `0 ${item.unit}`}</span>
            </div>
          )
        })}
        <div className="h-[60px]" />
      </div>

      <footer className="flex h-[57px] shrink-0 items-center justify-between border-t border-[#e0e0e0]">
        <div className="pb-[5px] pl-[30px] text-[16px] text-black">
          {t("Общая сумма")}: <b>{fmt(total)}</b>
          <span className="ml-[26px]">
            {t("Общее кол-во")} <b>{fmt(totalQty)} {t("ед")}</b>
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            onSave(chosen.map((row) => ({ product: row.item.name, qty: row.qty, cost: row.price })))
            onClose()
          }}
          className="mr-[10px] h-9 px-[16px] pb-[5px] text-[13px] font-semibold uppercase text-[#129fdd]"
        >
          {t("Сохранить")}
        </button>
      </footer>
    </div>
  )
}
