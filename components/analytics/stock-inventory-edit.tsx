"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { X } from "lucide-react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { mutationError } from "@/components/analytics/cash-management-shared"
import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { InventorySelect, type InventoryOption } from "@/components/analytics/stock-inventory-select"
import { formatQty } from "@/components/analytics/stock-inventory-shared"
import { RefTip } from "@/components/ref/ref-tip"
import { formatMoney } from "@/lib/finance/currency"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  STOCK_INVENTORY_TYPES,
  STOCK_INVENTORY_TYPE_LABELS,
  type StockInventoryDetail,
  type StockInventoryOptions,
  type StockInventoryProductOption,
} from "@/lib/stock-inventories-types"

// Linko's inventory «ИЗМЕНЕНИЕ» (chunk 0 modules 4763–4765, ?openUpdateDialog=true): a full-screen white page.
// Left (20%): «Тип инвентаризации» (both radios disabled), «Склад» * (searchable; a change keeps the lines), «Дата
// создания» * (calendar, both types), and for «На определенную дату» the «Время инвентаризации» radios with their hints.
// Right (80%): «Список товаров» with «добавить товар», which toggles the grey add row (Наименование over every
// warehouse's balance in Linko's order, «Серия» for products that keep series (those with a balance in the chosen
// warehouse), «Кол-во», +: the line goes on top, the row stays open); the lines: «N. name» | Серия (select of the
// product's series, disabled when it keeps none) | Кол-во (free text) | Вес | Вес нетто (a stored line: the weights
// saved with it; a new one: one unit's weight × Кол-во) | 🗑; with no lines Linko's empty basket. The right part is at
// most 694px tall and scrolls, as Linko's. Footer: «Общее кол-во: N ед» (Σ whole units) and
// СОХРАНИТЬ → PUT /api/stock/inventories/<id> {warehouse, invDate, forDayEnd, items: [{key, amount, seriesId}]} (no
// comment: it is entered when confirming). Only ✕ closes it.

// Linko's text ends with a space, which the dictionaries' key leaves out.
const START_HINT = "На начало дня- Инвентаризация будет сделана относительно остатков на начало выбранного дня . Изменения внесенные по инвентаризации запишутся на конец предыдущего дня"
const END_HINT = "На конец дня- Инвентаризация будет сделана относительно остатков на конец выбранного дня . Изменения внесутся на конец того дня который вы выбрали и с этим остатком начнется следующий календарный день"

type ProductOption = InventoryOption<StockInventoryProductOption>

type EditLine = {
  uid: number
  key: string
  name: string
  productId: number | null
  trackExpiry: boolean
  /** As typed (Linko's field takes any text). */
  amount: string
  /** id: a stock_series id; a "text:" id is a stored series name with no catalog id (kept as it is). */
  series: InventoryOption | null
  /** Weight / net weight of one unit (lines added now: Вес = weight × Кол-во). */
  weight: number
  netWeight: number
  /** A stored line's saved weights (Linko's total_weight / total_weight_netto), shown as they are; null for new lines. */
  stored: { weight: number; netto: number } | null
}

let uids = 0

const WAREHOUSE_ORDER = new Intl.Collator("en", { ignorePunctuation: true })

const DOTS: CSSProperties = { backgroundImage: "linear-gradient(to right, #d9e0e5 2px, transparent 2px)", backgroundSize: "8px 2px", backgroundRepeat: "repeat-x" }

/** lodash toInteger: whole units, anything that is not a number counts 0 ("10,5" and "10a" included). */
function wholeUnits(value: string): number {
  const number = Number(value.trim())
  return Number.isFinite(number) ? Math.trunc(number) : 0
}

/** Linko's numeric normalizer of the add row's «Кол-во»: digits and one decimal point (a comma becomes a point). */
function numeric(value: string): string {
  const clean = value.replace(",", ".").replace(/[^\d.]/g, "")
  const dot = clean.indexOf(".")
  return dot < 0 ? clean : `${clean.slice(0, dot + 1)}${clean.slice(dot + 1).replace(/\./g, "")}`
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" })
    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

/** «Наименование» options: Linko's all_balances/?search&page_size=50, «title (balance)». */
async function loadProducts(search: string): Promise<ProductOption[]> {
  const body = await getJson<{ results: StockInventoryProductOption[] }>(`/api/stock/inventories/products?${new URLSearchParams({ search, pageSize: "50" })}`)
  return (body?.results ?? []).map((row) => ({ id: row.key, text: `${row.name} (${formatMoney(row.balance, 5)})`, data: row }))
}

// One loader per product: an open select reloads its options only when its loader changes.
const seriesLoaders = new Map<number, (search: string) => Promise<InventoryOption[]>>()
const NO_OPTIONS = async (): Promise<InventoryOption[]> => []
export function seriesLoader(productId: number | null): (search: string) => Promise<InventoryOption[]> {
  if (!productId) return NO_OPTIONS
  let loader = seriesLoaders.get(productId)
  if (!loader) {
    loader = async (search: string) => {
      const body = await getJson<{ results: Array<{ id: number; displayName: string }> }>(`/api/stock/series?${new URLSearchParams({ product: String(productId), search, pageSize: "50" })}`)
      return (body?.results ?? []).map((row) => ({ id: row.id, text: row.displayName }))
    }
    seriesLoaders.set(productId, loader)
  }
  return loader
}

// The add row's «Серия»: Linko's stock/series_balance/?product=&stock= — only the series with a balance in the chosen
// warehouse (an empty list reads «Не найдено»). One loader per product and warehouse, as above.
const balanceLoaders = new Map<string, (search: string) => Promise<InventoryOption[]>>()
export function balanceSeriesLoader(productId: number | null, warehouse: string): (search: string) => Promise<InventoryOption[]> {
  if (!productId || !warehouse) return NO_OPTIONS
  const key = `${productId}|${warehouse}`
  let loader = balanceLoaders.get(key)
  if (!loader) {
    loader = async (search: string) => {
      const query = new URLSearchParams({ product: String(productId), warehouse, search, pageSize: "50" })
      const body = await getJson<{ results: Array<{ id: number; displayName: string }> }>(`/api/stock/series-balance?${query}`)
      return (body?.results ?? []).map((row) => ({ id: row.id, text: row.displayName }))
    }
    balanceLoaders.set(key, loader)
  }
  return loader
}

export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" style={{ width: size, height: size }} className="animate-spin" aria-hidden>
      <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" fill="none" stroke="#129fdd" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Material radio row (34px, 24px mark, 13px label). Linko's type radios are disabled: a grey mark, the label stays black. */
function Radio({ checked, disabled, label, hint, onChange }: { checked: boolean; disabled?: boolean; label: string; hint?: string; onChange?: () => void }) {
  return (
    <div className="flex h-[34px] items-center">
      <label className={`flex min-w-0 flex-1 items-center text-[13px] text-black ${disabled ? "cursor-default" : "cursor-pointer"}`}>
        <input type="radio" checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill={disabled ? "rgba(0,0,0,0.3)" : checked ? "#5d6474" : "#333"} aria-hidden>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
          {checked && <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z" />}
        </svg>
        <span className="ml-4 truncate">{label}</span>
      </label>
      {hint && (
        <RefTip text={hint} side="right">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#4f71dc]" aria-hidden>
            <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
        </RefTip>
      )}
    </div>
  )
}

/** «Дата создания» *: the date on the line («14 мая 2026 г.»), a grey calendar mark; a click opens the calendar under it.
 * With no date the label sits on the line as the placeholder (13px), as Linko's empty DateField. */
export function DateInput({ label, value, error, onChange, className = "mt-[15px]" }: { label: string; value: string; error?: string; onChange: (value: string) => void; className?: string }) {
  const { language } = useLanguage()
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  // ru: Linko's Intl ru {day: numeric, month: long, year: numeric} («1 ноября 2026 г.»).
  const shown = !value ? "" : language === "ru" ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`)) : formatDateText(value, language)
  return (
    <div className={`relative h-[45px] ${className}`}>
      <span className={`pointer-events-none absolute left-0 leading-[12px] text-black ${value ? "top-[-6px] text-[10px] font-semibold" : "top-[17px] text-[13px]"}`}>
        {label}
        <span className="text-[#e57373]"> *</span>
      </span>
      <span data-no-translate className="pointer-events-none absolute left-0 right-[26px] top-[20px] truncate text-[13px] leading-[16px] text-black">
        {shown}
      </span>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-[14px] h-5 w-5 fill-[#ccc]" aria-hidden>
        <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" />
      </svg>
      <span className={`pointer-events-none absolute inset-x-0 top-[36px] h-px ${error ? "bg-[#f44336]" : "bg-[#e0e0e0]"}`} />
      <button
        type="button"
        aria-label={label}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          setAnchor({ left: box.left, top: box.bottom + 4 })
        }}
        className="absolute inset-x-0 top-0 h-[37px] cursor-pointer"
      />
      {error && <div className="absolute left-0 top-[40px] text-[12px] leading-[12px] text-[#f44336]">{error}</div>}
      {anchor && (
        <DatePickerDialog
          value={value}
          anchor={anchor}
          onCancel={() => setAnchor(null)}
          onPick={(next) => {
            onChange(next)
            setAnchor(null)
          }}
        />
      )}
    </div>
  )
}

/** The add row's «Кол-во»: Linko's text field, the bold label on the line floats up once there is text or focus. */
export function AmountField({ value, onChange, onEnter, label }: { value: string; onChange: (value: string) => void; onEnter: () => void; label: string }) {
  const [focused, setFocused] = useState(false)
  const floated = focused || value !== ""
  return (
    <div className="group relative h-[45px]">
      <span className={`pointer-events-none absolute left-0 font-semibold text-black transition-all ${floated ? "top-[-4px] text-[10px] leading-[12px]" : "top-[13px] text-[13px] leading-[18px]"}`}>{label}</span>
      <input
        value={value}
        inputMode="decimal"
        aria-label={label}
        onChange={(event) => onChange(numeric(event.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            onEnter()
          }
        }}
        className="absolute inset-x-0 top-[13px] h-[18px] bg-transparent text-[13px] font-semibold text-black outline-none"
      />
      <span className="pointer-events-none absolute inset-x-0 top-[36px] h-px bg-[#e0e0e0]">
        <span className="absolute inset-x-0 -top-px h-[2px] origin-center scale-x-0 bg-[#5d6474] transition-[scale] duration-[450ms] group-focus-within:scale-x-100" />
      </span>
    </div>
  )
}

function EditForm({
  detail,
  options,
  onClose,
  onSaved,
}: {
  detail: StockInventoryDetail
  options: StockInventoryOptions | null
  onClose: () => void
  onSaved: (detail: StockInventoryDetail) => void
}) {
  const { t } = useLanguage()
  const [warehouse, setWarehouse] = useState<InventoryOption | null>(detail.warehouse ? { id: detail.warehouse, text: detail.warehouse } : null)
  const [invDate, setInvDate] = useState(detail.invDate)
  const [forDayEnd, setForDayEnd] = useState(detail.forDayEnd)
  const [lines, setLines] = useState<EditLine[]>(() =>
    detail.items.map((item) => ({
      uid: ++uids,
      key: item.key,
      name: item.name,
      productId: item.productId,
      trackExpiry: item.trackExpiry,
      amount: String(item.amount),
      series: item.seriesId ? { id: item.seriesId, text: item.series } : item.series ? { id: `text:${item.series}`, text: item.series } : null,
      weight: 0,
      netWeight: 0,
      stored: { weight: item.totalWeight, netto: item.totalWeightNetto },
    })),
  )
  const [adding, setAdding] = useState(false)
  const [addProduct, setAddProduct] = useState<ProductOption | null>(null)
  const [addSeries, setAddSeries] = useState<InventoryOption | null>(null)
  const [addAmount, setAddAmount] = useState("")
  // Linko's 300ms spinners: over the list after a warehouse change, over «Серия» after a product change.
  const [listBusy, setListBusy] = useState(false)
  const [seriesBusy, setSeriesBusy] = useState(false)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), [])
  const flash = (set: (value: boolean) => void) => {
    set(true)
    timers.current.push(window.setTimeout(() => set(false), 300))
  }
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ warehouse?: string; invDate?: string; list?: string }>({})

  // «Склад»: Linko lists every warehouse (stock/stock/?search&page_size=50 answers all of them) in its server's order —
  // digits, then Latin, then Cyrillic, case, spaces and punctuation ignored; a count may use the active ones plus its own.
  const warehouses = useMemo(
    () => [...new Set([...(options?.activeWarehouses ?? options?.warehouses ?? []), ...(detail.warehouse ? [detail.warehouse] : [])])].sort(WAREHOUSE_ORDER.compare),
    [options, detail.warehouse],
  )
  const loadWarehouses = useCallback(
    async (search: string) => {
      const needle = search.trim().toLowerCase()
      return warehouses.filter((name) => !needle || name.toLowerCase().includes(needle)).map((name) => ({ id: name, text: name }))
    },
    [warehouses],
  )

  const addLine = () => {
    const product = addProduct?.data
    if (!product) return
    const amount = Number(addAmount || 0)
    if (!(amount >= 0)) return
    setLines((current) => [
      {
        uid: ++uids,
        key: product.key,
        name: product.name,
        productId: product.productId,
        trackExpiry: product.trackExpiry,
        amount: addAmount,
        series: product.trackExpiry ? addSeries : null,
        weight: product.weight,
        netWeight: product.netWeight,
        stored: null,
      },
      ...current,
    ])
    setAddProduct(null)
    setAddSeries(null)
    setAddAmount("")
    setErrors((current) => ({ ...current, list: undefined }))
  }

  const total = lines.reduce((sum, line) => sum + wholeUnits(line.amount), 0)

  const submit = async () => {
    const required = t("Это поле обязательно к заполнению")
    const header = { warehouse: warehouse ? undefined : required, invDate: invDate ? undefined : required }
    if (header.warehouse || header.invDate) return setErrors(header)
    setBusy(true)
    setErrors({})
    const body = {
      type: detail.type,
      warehouse: String(warehouse?.id ?? ""),
      invDate,
      forDayEnd,
      items: lines.map((line) => {
        const id = line.series?.id
        // A stored series name without a catalog id goes back as its text (the server keeps it).
        if (typeof id === "string") return { key: line.key, amount: line.amount, series: line.series?.text ?? "" }
        return { key: line.key, amount: line.amount, seriesId: typeof id === "number" ? id : null }
      }),
    }
    const result = await cashMutate<StockInventoryDetail>("PUT", `/api/stock/inventories/${detail.id}`, body)
    setBusy(false)
    if (result.ok) return onSaved(result.data)
    const message = mutationError(result, t)
    if (result.field === "warehouse") return setErrors({ warehouse: message })
    if (result.field === "invDate") return setErrors({ invDate: message })
    const index = /^items\.(\d+)\./.exec(result.field ?? "")?.[1]
    const line = index === undefined ? null : lines[Number(index)]
    setErrors({ list: `${message}${line ? `: ${Number(index) + 1}. ${line.name}` : ""}` })
  }

  const custom = detail.type === "custom_date"
  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy) void submit()
      }}
    >
      <div className="flex h-[60px] shrink-0 items-center border-b border-[#efefef] pl-[30px] pr-[15px]">
        <h2 className="min-w-0 flex-1 text-[13px] font-bold uppercase text-[#333]">{t("Изменение")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#333]">
          <X className="h-6 w-6" strokeWidth={1.6} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Not scrolling: the hints of «Время инвентаризации» open to the right, over the list. */}
        <div className="relative z-[6] w-[20%] min-w-[260px] shrink-0 border-r border-[#efefef] px-[30px] py-[20px]">
          <div className="text-[13px] leading-4 text-[#333]">{t("Тип инвентаризации")}</div>
          {STOCK_INVENTORY_TYPES.map((value) => (
            <Radio key={value} checked={detail.type === value} disabled label={t(STOCK_INVENTORY_TYPE_LABELS[value])} />
          ))}
          <InventorySelect
            className="mt-[5px]"
            label={t("Склад")}
            fixedLabel
            required
            value={warehouse}
            load={loadWarehouses}
            error={errors.warehouse}
            onChange={(next) => {
              setWarehouse(next)
              setErrors((current) => ({ ...current, warehouse: undefined }))
              // Linko keeps the lines; the add row's product goes.
              setAddProduct(null)
              setAddSeries(null)
              flash(setListBusy)
            }}
          />
          <DateInput
            label={t("Дата создания")}
            value={invDate}
            error={errors.invDate}
            onChange={(value) => {
              setInvDate(value)
              setErrors((current) => ({ ...current, invDate: undefined }))
            }}
          />
          {custom && (
            <>
              <div className="mt-[27px] text-[13px] leading-4 text-[#333]">{t("Время инвентаризации")}</div>
              <Radio checked={!forDayEnd} label={t("На начало дня")} hint={t(START_HINT)} onChange={() => setForDayEnd(false)} />
              <Radio checked={forDayEnd} label={t("На конец дня")} hint={t(END_HINT)} onChange={() => setForDayEnd(true)} />
            </>
          )}
        </div>

        <div className="relative max-h-[694px] min-w-0 flex-1 overflow-y-auto px-[30px] pb-[20px] pt-[10px]">
          <div className="flex h-[36px] items-center justify-between">
            <strong className="text-[13px] font-semibold text-[#333]">{t("Список товаров")}</strong>
            <button type="button" onClick={() => setAdding((open) => !open)} className="h-[36px] rounded-[2px] px-[16px] text-[13px] text-black hover:bg-[rgba(153,153,153,0.2)]">
              {t("добавить товар")}
            </button>
          </div>

          {adding && (
            <div className="-mx-[30px] mt-[5px] grid h-[87px] grid-cols-12 bg-[#f1f5f8] px-[10px]">
              <div className={`${addProduct?.data?.trackExpiry ? "col-span-4" : "col-span-6"} px-[8px] pt-[15px]`}>
                <InventorySelect<StockInventoryProductOption>
                  label={t("Наименование")}
                  value={addProduct}
                  load={loadProducts}
                  onChange={(next) => {
                    setAddProduct(next)
                    setAddSeries(null)
                    flash(setSeriesBusy)
                  }}
                />
              </div>
              {addProduct?.data?.trackExpiry && (
                <div className="col-span-3 px-[8px] pt-[15px]">
                  {seriesBusy ? (
                    <div className="flex h-[54px] items-end pb-[8px]">
                      <Spinner size={20} />
                    </div>
                  ) : (
                    <InventorySelect
                      label={t("Серия")}
                      value={addSeries}
                      load={balanceSeriesLoader(addProduct.data.productId, String(warehouse?.id ?? ""))}
                      onChange={setAddSeries}
                    />
                  )}
                </div>
              )}
              <div className="col-span-2 px-[8px] pt-[32px]">
                <AmountField label={t("Кол-во")} value={addAmount} onChange={setAddAmount} onEnter={addLine} />
              </div>
              <div className="col-span-1" />
              <div className="col-span-1 px-[8px] pt-[29px]">
                <button type="button" onClick={addLine} aria-label={t("Добавить")} className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-black/5">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[rgb(79,113,220)]" aria-hidden>
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {errors.list && <div className="mt-[10px] rounded-[2px] bg-[#ffebee] px-[15px] py-[10px] text-center text-[13px] text-[#f44336]">{errors.list}</div>}

          {lines.length ? (
            <div className="mt-[20px]">
              <div className="-mx-[8px] grid grid-cols-12 text-[13px] leading-4 text-[#333]">
                <div className="col-span-4 px-[8px]">{t("Наименование")}</div>
                <div className="col-span-3 px-[8px]">{t("Серия")}</div>
                <div className="col-span-2 px-[8px]">{t("Кол-во")}</div>
                <div className="col-span-1 px-[8px]">{t("Вес")}</div>
                <div className="col-span-1 px-[8px]">{t("Вес нетто")}</div>
                <div className="col-span-1" />
              </div>
              {lines.map((line, index) => {
                const amount = Number(line.amount.trim()) || 0
                return (
                  <div key={line.uid} className="relative -mx-[8px] grid min-h-[92px] grid-cols-12 items-center text-[13px] leading-4 text-[#333]">
                    <div className="col-span-4 break-words px-[8px]">
                      {index + 1}. {line.name}
                    </div>
                    <div className="col-span-3 px-[8px]">
                      <InventorySelect
                        ariaLabel={`${t("Серия")}: ${line.name}`}
                        value={line.trackExpiry ? line.series : null}
                        disabled={!line.trackExpiry}
                        load={seriesLoader(line.productId)}
                        onChange={(next) => setLines((current) => current.map((item) => (item.uid === line.uid ? { ...item, series: next } : item)))}
                      />
                    </div>
                    <div className="col-span-2 px-[8px]">
                      <div className="group relative mt-[7px] h-[45px]">
                        <input
                          value={line.amount}
                          aria-label={`${t("Кол-во")}: ${line.name}`}
                          onChange={(event) => {
                            const value = event.target.value
                            setLines((current) => current.map((item) => (item.uid === line.uid ? { ...item, amount: value } : item)))
                          }}
                          className="absolute inset-x-0 top-[14px] h-[18px] bg-transparent text-[13px] text-black outline-none"
                        />
                        <span className="pointer-events-none absolute inset-x-0 top-[36px] h-px bg-[#e0e0e0]">
                          <span className="absolute inset-x-0 -top-px h-[2px] origin-center scale-x-0 bg-[#5d6474] transition-[scale] duration-[450ms] group-focus-within:scale-x-100" />
                        </span>
                      </div>
                    </div>
                    <div className="col-span-1 px-[8px]">{formatQty(line.stored ? line.stored.weight : line.weight * amount)}</div>
                    <div className="col-span-1 px-[8px]">{formatQty(line.stored ? line.stored.netto : line.netWeight * amount)}</div>
                    <div className="col-span-1 px-[8px]">
                      <button
                        type="button"
                        onClick={() => setLines((current) => current.filter((item) => item.uid !== line.uid))}
                        aria-label={t("Удалить")}
                        className="flex h-10 w-10 items-center justify-center rounded-full text-[#666] hover:bg-black/5"
                      >
                        <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current" aria-hidden>
                          <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                        </svg>
                      </button>
                    </div>
                    <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]" style={DOTS} />
                  </div>
                )
              })}
            </div>
          ) : (
            <div className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center justify-center text-center text-[13px] leading-4 text-[#adadad] ${adding ? "top-[198px]" : "top-[46px]"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/empty-basket.svg" alt="" className="h-[70px] w-[70px]" />
              <div className="mt-[22px]">
                {t("Вы еще не выбрали ни одного товара.")}
                <br />
                <button type="button" onClick={() => setAdding(true)} className="pointer-events-auto text-[#129fdd]">
                  {t("Добавить")}
                </button>{" "}
                {t("товар?")}
              </div>
            </div>
          )}

          {listBusy && (
            <div className="absolute inset-0 z-[5] flex items-center justify-center bg-white/70">
              <Spinner />
            </div>
          )}
        </div>
      </div>

      <div className="flex h-[57px] shrink-0 items-center justify-between border-t border-[#efefef] pl-[10px] pr-[3px]">
        <span className="text-[14px] text-black">
          {t("Общее кол-во:")} <b className="text-[16px] font-semibold text-[#129fdd]">{formatMoney(total, 0)} {t("ед")}</b>
        </span>
        <button type="submit" disabled={busy} className="h-9 px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#129fdd]/10 disabled:opacity-50">
          {t("Сохранить")}
        </button>
      </div>
      {busy && (
        <div className="fixed inset-0 z-[1302] flex items-center justify-center bg-white/40">
          <Spinner />
        </div>
      )}
    </form>
  )
}

/** The full-screen «ИЗМЕНЕНИЕ» of inventory `id` (pending only): a white page with a spinner while the document loads. */
export function InventoryEditDialog({
  id,
  options,
  onClose,
  onSaved,
}: {
  id: number
  options: StockInventoryOptions | null
  onClose: () => void
  onSaved: (detail: StockInventoryDetail) => void
}) {
  const detail = useCashJson<StockInventoryDetail>(`/api/stock/inventories/${id}`)
  const data = detail.data
  const editable = data?.status === "pending"
  // Only a pending inventory can be changed (the server refuses the others): a link to another one just closes.
  useEffect(() => {
    if ((data && !editable) || (!detail.loading && detail.error && !data)) onClose()
  }, [data, editable, detail.loading, detail.error, onClose])
  return (
    <div className="fixed inset-0 z-[1301] bg-white font-sans text-[13px] text-black">
      {data && editable ? (
        <EditForm key={data.id} detail={data} options={options} onClose={onClose} onSaved={onSaved} />
      ) : (
        <div className="flex h-full items-center justify-center">
          <Spinner size={40} />
        </div>
      )}
    </div>
  )
}
