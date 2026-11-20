"use client"

import { Check, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { createPortal } from "react-dom"

import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { roundAmount } from "@/lib/amount-precision"
import { useAppCurrencyInfo } from "@/lib/app-currency-context"
import { convertAmount, currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

import { orderListPrice, type OrderListPriceEntry, type OrderPriceList } from "./order-list-price"
import { RELEASED_STATUSES, type Order } from "./orders-data"
import { DOTTED_LINE, ReturnConfirmDialog, returnNumber, type ReturnPreviewLine } from "./return-confirm-dialog"
import { ReturnExcelImport, type ImportedReturnLine } from "./return-excel-import"
import type { ClientReturnRow } from "./returns-view"

// «ДОБАВЛЕНИЕ ВОЗВРАТА» / «ИЗМЕНЕНИЕ ВОЗВРАТА №N»: Linko's one ReturnCreateForm (#/return?openCreateDialog=true and
// #/return/{id}?openUpdateDialog=true).
// - «Возврат по конкретному клиенту»: the client, then «Возврат по конкретному заказу» and its order (choosing an
//   order puts all of its returnable lines in the list); «+ добавить товар» finds lines of the client's orders.
// - «Возврат по всем заказам»: an order of any client and its lines.
// - «Возврат по старой базе»: catalog products of a client at the price list's price (or one typed with «Указать
//   стоимость в ручную»), with the payment type, currency and price list of the return; «Импортировать c Excel»
//   replaces the list with the rows of a filled template (return-excel-import.tsx).
// An edit opens in the return's own mode (an order → «по всем заказам», no order and order lines → «по конкретному
// клиенту», catalog lines → «по старой базе») with the radios locked; the client and the order can still change
// (a new order replaces the lines). An accepted return is edited as Linko's editOnlyCost: the warehouse and the
// order are locked, nothing is added or removed, ✎ changes quantities and prices (the server checks the stock).
// «Далее» asks the server for the lines it would save (POST /api/client-returns/preview: its errors show under the
// fields), «Подтверждение возврата» lists them and «Оформить возврат» saves (POST / PUT /api/client-returns).

type Mode = "client" | "orders" | "old"
type ClientRow = { id: number; name: string }
type ProductRow = { id: number; name: string; unit?: string; deleted?: boolean; priceLists?: OrderListPriceEntry[]; boxAmount?: number; boxUnit?: string; barcode?: string; article?: string }
type Returnable = {
  orderItemId: number
  orderId: number
  orderCreatedAt: string
  productId: number | null
  productName: string
  unit: string
  ordered: number
  returned: number
  available: number
  price: number
  currency: string
  isBonus?: boolean
  /** Linko's id of a copied order line («(N)»), else orderItemId. */
  orderLineId?: number
}
type Line = {
  /** Unique per row: a stored line by its own id (two lines may name one order line), a new one by a counter. */
  key: string
  /** The edited return's own line (sent back as `id`, so the server updates that very line). */
  storedId?: number
  orderItemId?: number
  orderId?: number
  orderCreatedAt?: string
  productId?: number | null
  productName: string
  unit: string
  quantity: number
  /** The line's own price: the edited return's stored one, the order line's net price or the price list's. */
  basePrice: number
  /** A price typed with «Указать стоимость в ручную» (✎ or the add row). */
  manualPrice?: number
  /** A line of the edited return as it is stored: its price is kept unless another one is typed. */
  stored?: boolean
  isBonus?: boolean
  /** «(N)» of «Заказ: … (N)»: a copied line's Linko order line id (none when Linko has none), else the order line. */
  lineId?: number | null
  /** «Акция: <name>» of a copied line. */
  promotion?: string
  currency: string
  /** The product's box (Linko's «Группа»): units per box and the box's name. */
  perBox: number
  boxUnit: string
  /** The line's boxes as Linko keeps them: to the decimals of Настройки → Округление сумм (its rounding takes the
   * account's ROUND_AMOUNT_FOR_CURRENCY over BOX_ROUND), the lines an order brings to 3 (toFixed(3)); 0 = none shown. */
  box?: number
}
type Option = { value: string; label: string; text?: string }
/** A line of the edited return with what was copied from Linko with it (GET /api/client-returns/[id]). */
type EditItem = NonNullable<ClientReturnRow["items"]>[number] & { orderLineId?: number | null; isBonus?: boolean; promotion?: string }
type Refusal = { error?: string; field?: string; fields?: Record<string, string>; shortages?: Array<{ product: string; unit: string; required: number; available: number }>; warehouse?: string }
type FieldName = "date" | "client" | "order" | "warehouse" | "deliverer" | "agent" | "comment" | "paymentType" | "currency" | "priceList" | "products"

const PAYMENT_TYPES = [
  { key: "cash", label: "Наличные" },
  { key: "bank", label: "Перечисление" },
]
const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const CANCELLED = "Отменен"
// Server fields → the form field that shows the message.
const FIELD_OF: Record<string, FieldName> = {
  returnDate: "date",
  client: "client",
  clientId: "client",
  orderId: "order",
  warehouse: "warehouse",
  deliverer: "deliverer",
  agent: "agent",
  comment: "comment",
  paymentType: "paymentType",
  currency: "currency",
  priceList: "priceList",
  items: "products",
  quantity: "products",
  price: "products",
  productId: "products",
  productName: "products",
  orderItemId: "products",
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url)
    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

/** The local day of a UTC moment ("2026-05-07 19:52:33" → "08 мая 2026"), as Linko prints an order's date. */
function orderDay(value: string | undefined) {
  if (!value) return ""
  const date = new Date(/[zZ]$/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getDate()).padStart(2, "0")} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

const round3 = (value: number) => Math.round(value * 1000) / 1000
/** Linko's round(value, BOX_ROUND = 3): the decimals of Настройки → Округление сумм override BOX_ROUND when set. */
const round5 = (value: number) => roundAmount(value, 3)
/** A typed number: Linko drops the spaces of «10 000» and reads a comma as the decimal point. */
const parseNumber = (text: string) => Number(text.replace(/[\s  ]/g, "").replace(",", "."))

const PENCIL = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const TRASH = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
const PLUS = "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"
const BOX_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const BOX_CHECKED = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

/** The form's checkbox as Linko draws it: an empty box #333, a checked one #5d6474. */
function FormCheckbox({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path d={checked ? BOX_CHECKED : BOX_EMPTY} fill={checked ? "#5d6474" : "#333"} />
      </svg>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
    </span>
  )
}

/** Linko's react-select: small label above once filled (red * when required), × clears, ▾ opens, typing filters;
 * `searchOnly` opens the menu only once something is typed (the product picker). Disabled: grey, no ×. */
function SearchSelect({
  label,
  required,
  value,
  options,
  onChange,
  onClear,
  disabled,
  error,
  searchOnly,
  limit = 200,
  fallbackLabel,
}: {
  label: string
  required?: boolean
  value: string
  options: Option[]
  onChange: (value: string) => void
  onClear?: () => void
  disabled?: boolean
  error?: string
  searchOnly?: boolean
  limit?: number
  /** The chosen value's text while the options are not loaded yet. */
  fallbackLabel?: string
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) ?? (value ? { value, label: fallbackLabel ?? value } : undefined)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const needle = search.trim().toLocaleLowerCase("ru")
  const shown = options.filter((option) => !needle || `${option.label}\n${option.text ?? ""}`.toLocaleLowerCase("ru").includes(needle)).slice(0, limit)
  const menuOpen = open && (!searchOnly || Boolean(needle))
  const floating = open || Boolean(selected)
  const pick = (option: Option) => {
    onChange(option.value)
    setOpen(false)
    setSearch("")
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, Math.max(shown.length - 1, 0)))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (menuOpen && shown[active]) pick(shown[active])
    } else if (event.key === "Escape") {
      // Closes the menu only, not the form.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    } else if (event.key === "Tab") {
      setOpen(false)
    }
  }
  const line = error ? "border-b-2 border-[#f44336]" : open ? "border-b border-[#374557]" : "border-b border-[#e0e0e0]"
  return (
    // Linko's field from the small label's top: the value's middle 35 px down, the line 47 px, the next label 62 px.
    <div ref={rootRef} className="relative pb-[3.7px] pt-[10.3px]">
      <span className={`block h-[13px] text-[9.75px] font-semibold leading-[12.2px] text-black ${floating ? "" : "invisible"}`}>
        {label}
        {required && <span className="font-normal text-[#e57373]"> *</span>}
      </span>
      <div className={`relative flex h-[35px] w-full items-center pr-14 pt-[10px] text-[13px] font-semibold text-[#333] ${line} ${disabled ? "bg-[#f5f5f5]" : ""}`}>
        {open ? (
          <input
            autoFocus
            value={search}
            onChange={(event) => (setSearch(event.target.value), setActive(0))}
            onKeyDown={onKeyDown}
            placeholder={selected?.label ?? ""}
            aria-label={label}
            className="h-full w-full bg-transparent outline-none placeholder:text-[#999]"
          />
        ) : (
          <button type="button" disabled={disabled} onClick={() => (setSearch(""), setActive(0), setOpen(true))} className="flex h-full w-full items-center text-left disabled:cursor-default">
            {selected ? (
              <span className="truncate">{selected.label}</span>
            ) : (
              <span className="font-semibold text-black">
                {label}
                {required && <span className="text-red-500"> *</span>}
              </span>
            )}
          </button>
        )}
        {/* Linko: the × 13.8 px and the caret 21.3 px under the field's top, whether or not the × is there. */}
        <span className="pointer-events-none absolute right-0 top-[13.8px] flex items-start text-[#999]">
          {selected && onClear && !disabled && (
            <span role="button" aria-label={t("Очистить")} onClick={() => (onClear(), setOpen(false))} className="pointer-events-auto mr-[8.4px] cursor-pointer text-[18px] leading-[18px] hover:text-slate-700">
              ×
            </span>
          )}
          <svg viewBox="0 0 10 7" className="mr-[10px] mt-[7.5px] h-[7px] w-[10px]" aria-hidden>
            <path d={open ? "M0 7h10L5 0z" : "M0 0h10L5 7z"} fill={disabled ? "#ccc" : "#999"} />
          </svg>
        </span>
      </div>
      {error && <span className="block pt-[2px] text-[12px] leading-[15px] text-[#f44336]">{error}</span>}
      {menuOpen && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-60 overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-[13px] font-semibold text-slate-400">{t("Ничего не найдено")}</li>
          ) : (
            shown.map((option, index) => (
              <li key={option.value}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(option)}
                  className={`block w-full whitespace-pre-line px-3 py-2 text-left text-[13px] font-semibold ${option.value === value || index === active ? "bg-[#e3effd] text-slate-800" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  {option.text ?? option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

/** Linko's text field of the add row: the label is a bold placeholder while empty and floats above once filled. */
function BandInput({ label, value, onChange, onEnter, disabled }: { label: string; value: string; onChange: (value: string) => void; onEnter: () => void; disabled?: boolean }) {
  return (
    <div className="min-w-0">
      <span className={`block h-[13px] text-[9.75px] font-semibold leading-[12.2px] text-black ${value === "" ? "invisible" : ""}`}>{label}</span>
      <input
        inputMode="decimal"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            onEnter()
          }
        }}
        placeholder={label}
        aria-label={label}
        className="h-[34px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold outline-none placeholder:font-semibold placeholder:text-black disabled:opacity-50"
      />
    </div>
  )
}

/** «Оставить комментарий...»: Linko's multi-line text field (1 to 6 rows) with a floating label. */
/** "2026-05-07" → «7 мая 2026 г.», as Linko's date field prints a day (the shared DateField's format). */
function formatDateWords(value: string) {
  return value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : ""
}

const DATE_RANGE_ICON = "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"

/** «Дата возврата» in Linko's geometry (its MUI date field): empty, the label (13 px, regular) stands on the line like a
 * placeholder; with a day, the label rises (9.75 px) and the day sits 6 px above the line («7 мая 2026 г.»). The 20 px
 * calendar is at the right end and the underline 44 px under the block's top; the block keeps the height of the shared
 * DateField, so the fields under it stay put. */
function ReturnDateField({ label, required, value, onChange }: { label: string; required?: boolean; value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  return (
    <div className="mt-[8px] pb-[7.7px]">
      <button
        type="button"
        aria-label={label}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setAnchor({ left: rect.left, top: rect.bottom + 9 })
        }}
        className="relative block h-[44.8px] w-full cursor-pointer border-b border-[#e0e0e0] text-left"
      >
        {value ? (
          <>
            <span className="absolute left-0 top-0 h-[13px] text-[9.75px] font-semibold leading-[12.2px] text-black">
              {label}
              {required && <span className="text-[#e57373]"> *</span>}
            </span>
            <span className="absolute left-0 top-[25.8px] text-[13px] leading-[19.5px] text-[#333]">{t(formatDateWords(value))}</span>
          </>
        ) : (
          <span className="absolute left-0 top-[22.3px] text-[13px] font-normal leading-[16px] text-black">
            {label}
            {required && <span className="text-[#e57373]"> *</span>}
          </span>
        )}
        <svg viewBox="0 0 24 24" className="absolute right-0 top-[21.8px] h-[20px] w-[20px] fill-[#ccc]" aria-hidden>
          <path d={DATE_RANGE_ICON} />
        </svg>
      </button>
      {anchor && (
        <DatePickerDialog
          anchor={anchor}
          value={value}
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

function CommentField({ label, value, onChange, error }: { label: string; value: string; onChange: (value: string) => void; error?: string }) {
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  const rows = Math.min(6, Math.max(1, value.split("\n").length))
  return (
    <div className="relative mt-[22px]">
      {/* Linko's risen label sits 3 px nearer the text than the other fields' labels. */}
      <span className={`relative top-[3px] block h-[13px] text-[9.75px] font-semibold leading-[12.2px] text-black ${floating ? "" : "invisible"}`}>{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={floating ? "" : label}
        aria-label={label}
        className={`block w-full resize-none bg-transparent py-[6px] text-[13px] font-semibold leading-[20px] text-[#333] outline-none placeholder:font-semibold placeholder:text-black ${error ? "border-b-2 border-[#f44336]" : focused ? "border-b-2 border-[#374557]" : "border-b border-[#e0e0e0]"}`}
      />
      {error && <span className="block pt-[2px] text-[12px] leading-[15px] text-[#f44336]">{error}</span>}
    </div>
  )
}

/** Full-screen «Добавление возврата» (or, with `edit`, «Изменение возврата №N»). */
export function AddReturnDialog({
  initialOrderId,
  initialWarehouseId,
  initialDelivererId,
  edit,
  onClose,
  onSaved,
}: {
  initialOrderId?: number
  /** The order card's «Частичный возврат» (Linko's ?s= / ?d=): the order's warehouse and delivery man come chosen. */
  initialWarehouseId?: number
  initialDelivererId?: number
  edit?: ClientReturnRow & { priceList?: string }
  onClose: () => void
  onSaved: (saved: ClientReturnRow) => void
}) {
  const { t } = useLanguage()
  const app = useAppCurrencyInfo()
  const initialMode: Mode = !edit ? "client" : edit.orderId ? "orders" : edit.fromOrder ? "client" : "old"
  // Linko's editOnlyCost: an accepted return.
  const costOnly = edit?.status === "accepted"
  const [mode, setMode] = useState<Mode>(initialMode)
  // Like Linko: no return day until one is picked (an edit keeps its own).
  const [date, setDate] = useState(edit ? edit.returnDate.slice(0, 10) : "")
  const [clientId, setClientId] = useState(edit?.clientId ? String(edit.clientId) : "")
  // «Возврат по конкретному заказу»: unchecked when an edit opens, checked once a client is chosen.
  const [byOrder, setByOrder] = useState(!edit)
  const [orderId, setOrderId] = useState(edit?.orderId ? String(edit.orderId) : initialOrderId ? String(initialOrderId) : "")
  const [warehouse, setWarehouse] = useState(edit?.warehouse ?? "")
  const [deliverer, setDeliverer] = useState(edit?.deliverer ?? "")
  const [agent, setAgent] = useState(edit?.agent ?? "")
  const [comment, setComment] = useState(edit?.comment ?? "")
  // Linko's initial «Указать стоимость в ручную»: checked for an edited client return only.
  const [manual, setManual] = useState(initialMode === "client" && Boolean(edit))
  const [currency, setCurrency] = useState(edit && initialMode === "old" ? edit.currency : "")
  const [paymentType, setPaymentType] = useState(edit?.paymentType ?? "")
  const [priceList, setPriceList] = useState(edit?.priceList ?? "")
  const [clients, setClients] = useState<ClientRow[]>([])
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [people, setPeople] = useState<{ agents: string[]; deliverers: string[] }>({ agents: [], deliverers: [] })
  const [currencies, setCurrencies] = useState<string[]>([])
  const [baseCurrency, setBaseCurrency] = useState("")
  // Units of the base currency per unit of each currency (the currencies' current rates).
  const [rates, setRates] = useState<Record<string, number>>({})
  const [priceLists, setPriceLists] = useState<OrderPriceList[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [returnable, setReturnable] = useState<Returnable[]>([])
  const [lines, setLines] = useState<Line[]>(() =>
    ((edit?.items ?? []) as EditItem[]).map((item) => ({
      key: `r:${item.id}`,
      storedId: item.id,
      orderItemId: item.orderItemId ?? undefined,
      orderId: item.orderItemId ? (item.orderId ?? undefined) : undefined,
      orderCreatedAt: item.orderItemId ? (item.orderCreatedAt ?? undefined) : undefined,
      productId: item.productId,
      productName: item.productName,
      unit: item.unit,
      quantity: item.quantity,
      basePrice: item.price,
      stored: true,
      isBonus: item.isBonus,
      lineId: item.orderLineId === undefined ? item.orderItemId : item.orderLineId,
      promotion: item.promotion || undefined,
      currency: edit?.currency ?? "",
      perBox: Number(item.boxAmount) || 0,
      boxUnit: item.boxUnit ?? "",
      box: Number(item.boxAmount) ? round5(item.quantity / Number(item.boxAmount)) : undefined,
    })),
  )
  // Keys of the lines added in the form.
  const keySeq = useRef(0)
  const newKey = () => `n:${++keySeq.current}`
  const [editing, setEditing] = useState<{ key: string; quantity: string; price: string; box: string } | null>(null)
  const [adding, setAdding] = useState(false)
  // «Импортировать c Excel» of «по старой базе»: its «1. Загрузить шаблон / 2. Заполните excel и загрузите» row.
  const [excelOpen, setExcelOpen] = useState(false)
  const [pick, setPick] = useState({ value: "", quantity: "", price: "", box: "" })
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ReturnPreviewLine[] | null>(null)
  const [saveError, setSaveError] = useState("")
  const orderLoad = useRef(0)

  useEffect(() => {
    void getJson<ClientRow[]>("/api/clients?balances=0").then((rows) => setClients((rows ?? []).map((row) => ({ id: row.id, name: row.name }))))
    void getJson<Array<{ id?: number; name: string; active?: boolean }>>("/api/warehouses").then((rows) => {
      setWarehouses((rows ?? []).filter((row) => row.active !== false).map((row) => row.name))
      const stock = !edit && initialWarehouseId ? (rows ?? []).find((row) => row.id === initialWarehouseId) : undefined
      if (stock) setWarehouse((current) => current || stock.name)
    })
    // Linko: Доставщик = users of the delivery group, Ответственный агент = every user (the order form's lists).
    void getJson<{ agents?: string[]; deliverers?: string[] }>("/api/orders/form-options").then((data) => setPeople({ agents: data?.agents ?? [], deliverers: data?.deliverers ?? [] }))
    if (!edit && initialDelivererId) {
      void getJson<Array<{ id?: number; firstName?: string; lastName?: string; name?: string }>>("/api/employees").then((rows) => {
        const man = (rows ?? []).find((row) => row.id === initialDelivererId)
        const name = man ? `${man.firstName ?? ""} ${man.lastName ?? ""}`.trim() || man.name || "" : ""
        if (name) setDeliverer((current) => current || name)
      })
    }
    void getJson<Array<{ code: string; isBase?: boolean; rate?: number }>>("/api/currencies").then((rows) => {
      setCurrencies((rows ?? []).map((row) => row.code))
      setBaseCurrency((rows ?? []).find((row) => row.isBase)?.code ?? rows?.[0]?.code ?? "")
      setRates(Object.fromEntries((rows ?? []).map((row) => [row.code, Number(row.rate) || 0])))
    })
    void getJson<OrderPriceList[]>("/api/price-lists?active=all").then((rows) => setPriceLists(Array.isArray(rows) ? rows : []))
    void getJson<ProductRow[]>("/api/products").then((rows) => setProducts((rows ?? []).filter((row) => !row.deleted)))
    void getJson<Order[]>("/api/orders?balances=0").then((rows) => setOrders(rows ?? []))
    // Linko's componentDidMount: an order chosen up front (the order card's «Частичный возврат») brings its lines.
    if (!edit && initialOrderId) void loadOrderLines(initialOrderId)
    // The lists load once; the initial warehouse / delivery man / order are read with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc closes «Подтверждение возврата» only: the form itself (a page in Linko) closes with its X.
  useEffect(() => {
    if (!preview) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setPreview(null)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [preview])

  const except = edit ? `&except=${edit.id}` : ""
  const order = orders.find((row) => String(row.id) === orderId)
  // The order the lines come from: «по всем заказам», or a client's with «Возврат по конкретному заказу».
  const lineOrderId = mode === "orders" || (mode === "client" && byOrder) ? orderId : ""
  const client = clients.find((row) => String(row.id) === clientId)
  const productById = useMemo(() => new Map(products.map((row) => [row.id, row])), [products])
  // What the edited return itself holds of each order line (Linko's «Продажи» counts it as returned).
  const ownQty = useMemo(() => {
    const own = new Map<number, number>()
    for (const item of edit?.items ?? []) if (item.orderItemId) own.set(item.orderItemId, (own.get(item.orderItemId) ?? 0) + item.quantity)
    return own
  }, [edit])

  // An order chosen up front brings its client.
  useEffect(() => {
    if (!order || edit || mode !== "client" || clientId) return
    if (order.clientId) setClientId(String(order.clientId))
    else {
      const owner = clients.find((row) => row.name === order.client)
      if (owner) setClientId(String(owner.id))
    }
  }, [order, clients, edit, mode, clientId])

  // The lines «+ добавить товар» offers: the chosen order's, else every returnable line of the client.
  useEffect(() => {
    let cancelled = false
    const url = mode === "old" ? "" : lineOrderId ? `/api/client-returns/returnable?orderId=${lineOrderId}${except}` : mode === "client" && clientId ? `/api/client-returns/returnable?clientId=${clientId}${except}` : ""
    if (!url) {
      setReturnable([])
      return
    }
    const status = lineOrderId ? orders.find((row) => String(row.id) === lineOrderId)?.status : undefined
    void getJson<Returnable[]>(url).then((rows) => {
      // Nothing to return of an order that was not shipped (Linko's for_return answers an empty list).
      if (!cancelled) setReturnable(status && !RELEASED_STATUSES.includes(status) ? [] : (rows ?? []))
    })
    return () => {
      cancelled = true
    }
  }, [mode, lineOrderId, clientId, except, orders])

  const bonusLines = useMemo(() => new Set(returnable.filter((row) => row.isBonus).map((row) => row.orderItemId)), [returnable])
  const shownCurrency = mode === "old" ? currency || edit?.currency || currencies[0] || "" : ""
  const boxOf = (line: Pick<Line, "perBox" | "boxUnit" | "productId" | "box">) => {
    // box 0: a line kept without boxes (Linko's imported lines): no «Группа» for it.
    const product = line.productId && line.box !== 0 ? productById.get(line.productId) : undefined
    const perBox = line.perBox || Number(product?.boxAmount) || 0
    return { perBox, unit: line.boxUnit || product?.boxUnit || "" }
  }
  const priceOf = (line: Line) => (manual && line.manualPrice !== undefined ? line.manualPrice : line.basePrice)
  // Linko adds its main currency (PRIMARY_CURRENCY) to «Общая стоимость» whatever the lines' one; here the lines' own.
  const totalCurrency = lines[0]?.currency || shownCurrency || edit?.currency || baseCurrency
  const total = lines.reduce((sum, line) => sum + line.quantity * priceOf(line), 0)
  // Linko: the whole units of every line («ед»), and the boxes of the lines that have them («групп»).
  const wholeUnits = lines.reduce((sum, line) => sum + Math.trunc(line.quantity), 0)
  /** A line's boxes (its «Группа»): as kept with the line, else worked out like a line added in the form. */
  const lineBoxes = (line: Line) => line.box ?? (boxOf(line).perBox ? round5(line.quantity / boxOf(line).perBox) : 0)
  // Linko sums the lines' boxes as they are (the float noise of the sum dropped here).
  const groups = round5(lines.reduce((sum, line) => sum + lineBoxes(line), 0))
  const hasGroups = lines.some((line) => boxOf(line).perBox > 0)
  /** A catalog product's price in the return's price list and currency. Linko converts a price of another currency at
   * the current rate and keeps every decimal (1 SUM → 0,00008 USD). */
  const priceOfProduct = (product: ProductRow) => {
    const nonCash = paymentType === "bank"
    const same = orderListPrice(product.priceLists, { priceList, lists: priceLists, orderCurrency: shownCurrency, nonCash })
    if (same !== null) return same
    for (const from of currencies) {
      const value = orderListPrice(product.priceLists, { priceList, lists: priceLists, orderCurrency: from, nonCash })
      if (value === null) continue
      const converted = convertAmount(value, from, shownCurrency, app.code ? app.rates : rates)
      return converted !== null && converted > 0 ? Number(converted.toPrecision(12)) : 0
    }
    return 0
  }

  const clearError = (field: FieldName) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))

  const options = {
    clients: clients.map((row) => ({ value: String(row.id), label: row.name })),
    // Linko: «по всем заказам» lists the orders of every client but the cancelled ones, a client's order every one of
    // its orders; newest first, by 100: «Заказ №1575 / Клиент: Магазин 1 / Номер договора: -».
    orders: orders
      .filter((row) => (mode === "orders" ? row.status !== CANCELLED : Boolean(client) && (row.clientId ? row.clientId === client!.id : row.client === client!.name)))
      .sort((a, b) => b.id - a.id)
      .map((row) => ({
        value: String(row.id),
        label: `${t("Заказ")} №${row.id}`,
        text: `${t("Заказ")} №${row.id}\n${t("Клиент:")} ${row.client}\n${t("Номер договора")}: ${row.contract || "-"}`,
      })),
    warehouses: [...new Set([...warehouses, ...(edit?.warehouse ? [edit.warehouse] : [])])].map((name) => ({ value: name, label: name })),
    deliverers: [...new Set([...people.deliverers, ...(edit?.deliverer ? [edit.deliverer] : [])])].map((name) => ({ value: name, label: name })),
    agents: [...new Set([...people.agents, ...(edit?.agent ? [edit.agent] : [])])].map((name) => ({ value: name, label: name })),
    currencies: currencies.map((code) => ({ value: code, label: currencyLabel(code) })),
    priceLists: priceLists.map((row) => ({ value: row.name, label: row.name })),
    paymentTypes: PAYMENT_TYPES.map((item) => ({ value: item.key, label: t(item.label) })),
    // «+ добавить товар» (Linko's for_return): «sndwch / Продажи 9 / Заказ: 1575 (1295)» for a client, without
    // «Продажи» for an order; the catalog for «по старой базе». Lines already in the list are offered too.
    picks:
      mode === "old"
        ? products.map((row) => ({ value: `p:${row.id}`, label: row.name }))
        : returnable
            .filter((row) => row.available > 0)
            .map((row) => ({
              value: `oi:${row.orderItemId}`,
              label: row.productName,
              text:
                mode === "client"
                  ? `${row.productName}\n${t("Продажи")} ${returnNumber(Math.max(0, row.available - (ownQty.get(row.orderItemId) ?? 0)))}\n${t("Заказ")}: ${row.orderId} (${row.orderLineId ?? row.orderItemId})`
                  : `${row.productName}\n${t("Заказ")}: ${row.orderId} (${row.orderLineId ?? row.orderItemId})`,
            })),
  }

  const lineFrom = (row: Returnable, quantity: number, box?: number): Line => {
    const product = row.productId ? productById.get(row.productId) : undefined
    const perBox = Number(product?.boxAmount) || 0
    return {
      key: newKey(),
      orderItemId: row.orderItemId,
      orderId: row.orderId,
      orderCreatedAt: row.orderCreatedAt,
      productId: row.productId,
      productName: row.productName,
      unit: row.unit,
      quantity,
      basePrice: row.price,
      isBonus: row.isBonus,
      lineId: row.orderLineId ?? row.orderItemId,
      currency: row.currency,
      perBox,
      boxUnit: product?.boxUnit ?? "",
      // Linko's order lines: toFixed(3) of the boxes.
      box: box ?? (perBox ? round3(quantity / perBox) : undefined),
    }
  }

  /** Linko's order customOnChange: the order's returnable lines REPLACE the list, each with what is left of it. */
  async function loadOrderLines(id: number) {
    const ticket = ++orderLoad.current
    const rows = await getJson<Returnable[]>(`/api/client-returns/returnable?orderId=${id}${except}`)
    if (ticket !== orderLoad.current) return
    if (!rows) return setError(t("Ошибка при выборе заказа"))
    // Linko's for_return gives nothing of an order that was not shipped (a cancelled one, one still in work).
    const status = orders.find((row) => row.id === id)?.status
    const shipped = !status || RELEASED_STATUSES.includes(status)
    // Each line at Linko's remain_amount: what the edited return itself holds of it counts as returned too (as its
    // «Продажи» in the picker).
    const left = rows.map((row) => ({ row, quantity: Math.max(0, Math.round((row.available - (ownQty.get(row.orderItemId) ?? 0)) * 1e6) / 1e6) }))
    setLines(shipped ? left.filter((entry) => entry.quantity > 0).map((entry) => lineFrom(entry.row, entry.quantity)) : [])
    setEditing(null)
    clearError("products")
  }

  function chooseOrder(value: string) {
    setOrderId(value)
    clearError("order")
    setError("")
    if (value) void loadOrderLines(Number(value))
  }

  /** × of «Заказ»: the lines stay, the add row closes (no client or order left to find lines of). */
  function clearOrder() {
    orderLoad.current++
    setOrderId("")
    if (mode === "orders") setAdding(false)
  }

  function changeMode(next: Mode) {
    if (next === mode || edit) return
    setMode(next)
    setLines([])
    setOrderId("")
    setAdding(false)
    setEditing(null)
    if (next === "orders") setClientId("")
    setErrors({})
    setError("")
  }

  /** Linko's client customOnChange: no order and no lines, then «Возврат по конкретному заказу» checked. */
  function chooseClient(value: string) {
    orderLoad.current++
    setClientId(value)
    setOrderId("")
    setLines([])
    setAdding(false)
    setEditing(null)
    setByOrder(true)
    clearError("client")
  }

  function resetPick() {
    setPick({ value: "", quantity: "", price: "", box: "" })
  }

  /** The picked product's box, for the group field of the add row. */
  const pickedBox = (() => {
    if (!pick.value) return { perBox: 0, unit: "", measure: "" }
    if (pick.value.startsWith("oi:")) {
      const row = returnable.find((entry) => `oi:${entry.orderItemId}` === pick.value)
      const product = row?.productId ? productById.get(row.productId) : undefined
      return { perBox: Number(product?.boxAmount) || 0, unit: product?.boxUnit ?? "", measure: row?.unit ?? "" }
    }
    const product = products.find((entry) => `p:${entry.id}` === pick.value)
    return { perBox: Number(product?.boxAmount) || 0, unit: product?.boxUnit ?? "", measure: product?.unit ?? "" }
  })()

  /** Linko's handleAdd: a product and an amount; a line already listed is not added again (the fields reset either way);
   * a new line goes to the top, the add row stays open. */
  function applyPick() {
    const quantity = parseNumber(pick.quantity)
    if (!pick.value || !quantity || Number.isNaN(quantity)) return
    const typedPrice = pick.price.trim() === "" ? undefined : parseNumber(pick.price)
    const manualPrice = manual && typedPrice !== undefined && typedPrice > 0 ? typedPrice : undefined
    // Linko keeps the group field's value as the line's boxes (typed, or worked out from the amount).
    const typedBox = pick.box.trim() === "" ? undefined : parseNumber(pick.box)
    const box = typedBox !== undefined && Number.isFinite(typedBox) ? typedBox : undefined
    let line: Line | null = null
    if (pick.value.startsWith("oi:")) {
      const row = returnable.find((entry) => `oi:${entry.orderItemId}` === pick.value)
      const perBox = row?.productId ? Number(productById.get(row.productId)?.boxAmount) || 0 : 0
      if (row) line = { ...lineFrom(row, quantity, box ?? (perBox ? round5(quantity / perBox) : undefined)), manualPrice }
    } else {
      const product = products.find((entry) => `p:${entry.id}` === pick.value)
      if (product) {
        if (!manualPrice && !priceList) {
          setError(t("Выберите прайс-лист"))
          return
        }
        const perBox = Number(product.boxAmount) || 0
        line = {
          key: newKey(),
          productId: product.id,
          productName: product.name,
          unit: product.unit || "шт.",
          quantity,
          basePrice: priceOfProduct(product),
          manualPrice,
          currency: shownCurrency,
          perBox,
          boxUnit: product.boxUnit ?? "",
          box: box ?? (perBox ? round5(quantity / perBox) : undefined),
        }
      }
    }
    resetPick()
    if (!line) return
    const same = (entry: Line) => (line!.orderItemId ? entry.orderItemId === line!.orderItemId : !entry.orderItemId && entry.productId === line!.productId)
    if (lines.some(same)) return
    setLines((current) => [line!, ...current])
    clearError("products")
    setError("")
  }

  /** «Импорт с Excel»: the file's rows REPLACE the list (Linko's import_excel answer), each at its price list's price
   * and with the file's «Цена» as its typed price. */
  function importLines(rows: ImportedReturnLine[]) {
    setLines(
      rows.map(({ product: row, quantity, price }) => {
        const product = productById.get(row.id)
        return {
          key: newKey(),
          productId: row.id,
          productName: row.name,
          unit: row.unit || "шт.",
          quantity,
          basePrice: product ? priceOfProduct(product) : 0,
          manualPrice: price,
          currency: shownCurrency,
          // Linko's imported lines come without boxes (no «Группа»).
          perBox: 0,
          boxUnit: "",
          box: 0,
        }
      }),
    )
    setEditing(null)
    clearError("products")
    setError("")
  }

  /** ✓ of a line in edit: the amount when above 0 and changed, the price when above 0; no messages (Linko). */
  function applyEditing() {
    if (!editing) return
    const quantity = parseNumber(editing.quantity)
    const price = parseNumber(editing.price)
    const box = parseNumber(editing.box)
    setLines((current) =>
      current.map((line) => {
        if (line.key !== editing.key) return line
        let next = line
        if (quantity > 0 && quantity !== line.quantity) next = { ...next, quantity }
        if (manual && price > 0) next = { ...next, manualPrice: price }
        // The group field (filled by typing either field) becomes the line's boxes.
        if (editing.box.trim() !== "" && Number.isFinite(box)) next = { ...next, box }
        return next
      }),
    )
    setEditing(null)
    clearError("products")
  }

  /** The form as Linko's serializer sends it (also to the preview). */
  function body(forPreview: boolean) {
    const chosenOrder = lineOrderId ? Number(lineOrderId) : null
    // «по всем заказам» has no client field: the chosen order's client, else (order cleared) the edited return's.
    const clientOf = mode === "orders" ? (order ? (order.clientId ?? undefined) : (edit?.clientId ?? undefined)) : clientId ? Number(clientId) : undefined
    const items = lines.map((line) => {
      // A manual price goes on every line; else the stored price of an edited line stays, a new order line takes the
      // order's price on the server, a catalog line the price list's.
      const price = manual ? priceOf(line) : line.stored || !line.orderItemId ? line.basePrice : undefined
      // A stored line names itself (Linko's `id`): the server updates that very line.
      const own = line.storedId ? { id: line.storedId } : {}
      return line.orderItemId
        ? { ...own, orderItemId: line.orderItemId, quantity: line.quantity, ...(price !== undefined ? { price } : {}) }
        : { ...own, productId: line.productId ?? undefined, productName: line.productName, quantity: line.quantity, price: price ?? line.basePrice }
    })
    return {
      ...(forPreview ? { kind: mode, ...(edit ? { returnId: edit.id } : {}) } : {}),
      clientId: clientOf,
      client: mode === "orders" && order && !order.clientId ? order.client : undefined,
      // null: no order (a client return keeps none even when its lines are of one order, as in Linko).
      orderId: chosenOrder,
      warehouse,
      // An edit keeps the stored return moment (Linko's time of a copied return) unless another day is picked.
      returnDate: forPreview ? date || undefined : edit && date === edit.returnDate.slice(0, 10) ? undefined : date || undefined,
      currency: mode === "old" ? shownCurrency || undefined : undefined,
      paymentType: mode === "old" ? (paymentType === "cash" || paymentType === "bank" ? paymentType : undefined) : undefined,
      priceList: mode === "old" ? priceList : undefined,
      deliverer,
      agent,
      comment: comment.trim(),
      items,
      ...(!forPreview && !edit ? { accept: false } : {}),
    }
  }

  /** A refused preview or save: each field the server names shows its message, product errors go above the list,
   * anything else to the footer. */
  function showRefusal(refusal: Refusal | null, fallback: string) {
    const shortage = refusal?.shortages?.length
      ? `${t("Недостаточно товара на складе")} «${refusal.warehouse ?? warehouse}»: ${refusal.shortages
          .slice(0, 5)
          .map((line) => `${line.product} — ${t("доступно")} ${returnNumber(line.available)} ${line.unit}, ${t("требуется")} ${returnNumber(line.required)} ${line.unit}`)
          .join("; ")}`
      : ""
    const text = shortage || t(refusal?.error || fallback)
    const next: Partial<Record<FieldName, string>> = {}
    for (const [name, message] of Object.entries(refusal?.fields ?? {})) {
      const field = FIELD_OF[name]
      if (field) next[field] = t(message)
    }
    const named = refusal?.field ? FIELD_OF[refusal.field] : undefined
    // «по всем заказам» has no client field: its client is the order's.
    const field = named === "client" && mode === "orders" ? "order" : shortage ? "products" : named
    if (field && !next[field]) next[field] = text
    if (next.client && mode === "orders") next.order = next.client
    if (Object.keys(next).length) setErrors(next)
    else setError(text)
  }

  /** «Далее»: the server's preview of the lines, then «Подтверждение возврата». */
  async function next() {
    setErrors({})
    setError("")
    setSaveError("")
    setBusy(true)
    try {
      const response = await fetch("/api/client-returns/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(true)) })
      const answer = (await response.json().catch(() => null)) as unknown
      if (!response.ok || !Array.isArray(answer)) return showRefusal(answer as Refusal | null, "Не удалось сохранить изменения на сервере")
      setPreview(answer as ReturnPreviewLine[])
    } catch {
      setError(t("Не удалось сохранить изменения на сервере"))
    } finally {
      setBusy(false)
    }
  }

  /** «Оформить возврат». */
  async function save() {
    setSaveError("")
    setBusy(true)
    try {
      const response = await fetch(edit ? `/api/client-returns/${edit.id}` : "/api/client-returns", {
        method: edit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body(false)),
      })
      const answer = (await response.json().catch(() => null)) as (ClientReturnRow & Refusal) | null
      if (!response.ok || !answer || !answer.id) {
        setPreview(null)
        return showRefusal(answer, "Не удалось сохранить изменения на сервере")
      }
      setPreview(null)
      onSaved(answer)
    } catch {
      setSaveError(t("Не удалось сохранить изменения на сервере"))
    } finally {
      setBusy(false)
    }
  }

  const modes: { key: Mode; label: string }[] = [
    { key: "client", label: t("Возврат по конкретному клиенту") },
    { key: "orders", label: t("Возврат по всем заказам") },
    { key: "old", label: t("Возврат по старой базе") },
  ]
  // Linko: «+ добавить товар» needs a client or an order; its tooltip asks for a client whenever there is none.
  const hasClient = mode !== "orders" && Boolean(clientId)
  const canAdd = hasClient || Boolean(orderId)
  const unitText = (unit: string) => (unit ? t(unit) : "")

  return createPortal(
    <div className="fixed inset-0 z-[110] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <header className="flex h-[59px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[28px]">
        <h2 className="text-[13px] font-bold uppercase">{edit ? `${t("Изменение возврата")} №${edit.id}` : t("Добавление возврата")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-600">
          <X className="h-6 w-6" />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[30%_minmax(0,70%)]">
        <aside className="overflow-y-auto border-r border-[#efefef] px-[30px] pb-[16px] pt-[31px]">
          {/* Linko's radios: a 24 px icon box (a 20 px ring, a 10 px dot), the text 16 px after it, 34 px apart. */}
          <div className="space-y-[10px]">
            {modes.map((item) => {
              const on = mode === item.key
              // Locked in an edit: drawn grey, the chosen one too (Linko's disabled radios).
              const ring = edit ? "border-[#c4c4c4]" : on ? "border-[#5d6474]" : "border-[#333]"
              return (
                <label key={item.key} className={`flex h-[24px] items-center gap-[16px] text-[13px] text-black ${edit ? "cursor-default" : "cursor-pointer"}`}>
                  <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center">
                    <span className={`flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 ${ring}`}>{on && <span className={`h-[10px] w-[10px] rounded-full ${edit ? "bg-[#c4c4c4]" : "bg-[#5d6474]"}`} />}</span>
                  </span>
                  <input type="radio" name="return-mode" disabled={Boolean(edit)} checked={on} onChange={() => changeMode(item.key)} className="sr-only" />
                  {item.label}
                </label>
              )
            })}
          </div>
          <p className="mb-[2px] mt-[19px] text-[13px] font-semibold">{t("Детали")}</p>
          <div className="-mt-[8px]">
            <ReturnDateField label={t("Дата возврата")} required value={date} onChange={(value) => (setDate(value), clearError("date"))} />
          </div>
          {errors.date && <span className="-mt-[10px] block text-[12px] leading-[15px] text-[#f44336]">{errors.date}</span>}
          {mode === "orders" && (
            <SearchSelect
              label={t("Заказ")}
              // An accepted return keeps its order (a new one would replace its lines).
              disabled={costOnly}
              value={orderId}
              options={options.orders}
              limit={100}
              fallbackLabel={orderId ? `${t("Заказ")} №${orderId}` : undefined}
              onChange={chooseOrder}
              onClear={clearOrder}
              error={errors.order}
            />
          )}
          {mode !== "orders" && (
            <SearchSelect
              label={t("Клиент")}
              required
              disabled={costOnly}
              value={clientId}
              options={options.clients}
              fallbackLabel={edit?.client}
              onChange={chooseClient}
              onClear={() => chooseClient("")}
              error={errors.client}
            />
          )}
          {mode === "old" && <SearchSelect label={t("Тип оплаты")} value={paymentType} options={options.paymentTypes} onChange={(value) => (setPaymentType(value), clearError("paymentType"))} onClear={() => setPaymentType("")} error={errors.paymentType} />}
          <SearchSelect label={t("Склад")} required disabled={costOnly} value={warehouse} options={options.warehouses} onChange={(value) => (setWarehouse(value), clearError("warehouse"))} onClear={() => setWarehouse("")} error={errors.warehouse} />
          {mode === "old" && (
            <>
              <SearchSelect label={t("Валюта")} disabled={costOnly} value={currency} options={options.currencies} fallbackLabel={currency ? currencyLabel(currency) : undefined} onChange={(value) => (setCurrency(value), clearError("currency"))} onClear={() => setCurrency("")} error={errors.currency} />
              <SearchSelect label={t("Прайс лист")} value={priceList} options={options.priceLists} onChange={(value) => (setPriceList(value), clearError("priceList"))} onClear={() => setPriceList("")} error={errors.priceList} />
            </>
          )}
          <SearchSelect label={t("Доставщик")} required={mode !== "old"} value={deliverer} options={options.deliverers} onChange={(value) => (setDeliverer(value), clearError("deliverer"))} onClear={() => setDeliverer("")} error={errors.deliverer} />
          <SearchSelect label={t("Ответственный агент")} value={agent} options={options.agents} onChange={(value) => (setAgent(value), clearError("agent"))} onClear={() => setAgent("")} error={errors.agent} />
          <CommentField label={`${t("Оставить комментарий")}...`} value={comment} onChange={(value) => (setComment(value), clearError("comment"))} error={errors.comment} />
          {mode === "client" && clientId && (
            <>
              <label className={`mt-[30px] flex items-center gap-[8px] text-[13px] font-semibold ${costOnly ? "opacity-60" : "cursor-pointer"}`}>
                <FormCheckbox checked={byOrder} onChange={(value) => !costOnly && setByOrder(value)} />
                {t("Возврат по конкретному заказу")}
              </label>
              {byOrder && (
                <SearchSelect
                  label={t("Заказ")}
                  disabled={costOnly}
                  value={orderId}
                  options={options.orders}
                  limit={100}
                  fallbackLabel={orderId ? `${t("Заказ")} №${orderId}` : undefined}
                  onChange={chooseOrder}
                  onClear={clearOrder}
                  error={errors.order}
                />
              )}
            </>
          )}
          <label className={`${mode === "client" && clientId ? "mt-[20px]" : "mt-[30px]"} flex cursor-pointer items-center gap-[8px] text-[13px] font-semibold`}>
            <FormCheckbox checked={manual} onChange={(value) => setManual(value)} />
            {t("Указать стоимость в ручную")}
          </label>
        </aside>
        <main className="relative min-w-0 overflow-y-auto px-[30px] pb-[12px] pt-[11px]">
          {/* Linko: 20px padding, then the 40px header pulled up by 10px (the form's header is 1px lower there). */}
          <div className="flex h-[40px] items-center justify-between">
            <span className="text-[13px] font-semibold">{t("Список товаров")}</span>
            {/* An accepted return gets no new lines (Linko hides the buttons). */}
            {!costOnly && (
              <span className="flex items-center">
              <span className="group relative flex items-center">
                {/* Linko keeps the link black (regular weight) without a client too: it only shows its tooltip then. */}
                <button
                  type="button"
                  aria-disabled={!canAdd}
                  onClick={() => canAdd && (setAdding((open) => !open), resetPick())}
                  className={`px-[16px] py-[9px] text-[13px] font-normal text-black ${canAdd ? "" : "cursor-default"}`}
                >
                  + {t("добавить товар")}
                </button>
                {/* Linko's tooltip: under the button, or left of it when the long text does not fit there. */}
                <span
                  className={`pointer-events-none absolute z-30 hidden whitespace-nowrap rounded-[2px] bg-[#3c4043] px-[20px] py-[7px] text-[13px] font-semibold text-white group-hover:block ${hasClient ? "right-0 top-[calc(100%+4px)]" : "right-[calc(100%+16px)] top-1/2 -translate-y-1/2"}`}
                >
                  {hasClient ? t("добавить товар") : t("Пожалуйста, выберите клиента перед добавлением продуктов")}
                </span>
              </span>
              {mode === "old" && (
                <button type="button" onClick={() => setExcelOpen((open) => !open)} className="h-9 px-[16px] text-[13px] font-medium lowercase text-[#333] hover:bg-black/[0.04]">
                  {t("Импортировать c Excel")}
                </button>
              )}
              </span>
            )}
          </div>
          {mode === "old" && excelOpen && !costOnly && <ReturnExcelImport products={products} priceOf={(product) => priceOfProduct(product)} onImported={importLines} />}
          {adding && canAdd && !costOnly && (
            <div className="-mx-[30px] mt-[5px] grid grid-cols-12 items-end gap-x-[16px] bg-[#f1f5f8] px-[18px] pb-[12px] pt-[4px]">
              <div className={pickedBox.perBox && manual ? "col-span-3" : pickedBox.perBox || manual ? "col-span-5" : "col-span-7"}>
                <SearchSelect
                  label={t("Наименование")}
                  searchOnly
                  limit={50}
                  value={pick.value}
                  options={options.picks}
                  onChange={(value) => setPick({ value, quantity: "", price: "", box: "" })}
                  onClear={resetPick}
                />
              </div>
              {pickedBox.perBox > 0 && (
                <div className="col-span-2">
                  <BandInput
                    label={`${pickedBox.unit || t("Группа")} (${returnNumber(pickedBox.perBox, unitText(pickedBox.measure))})`}
                    value={pick.box}
                    onChange={(value) => setPick({ ...pick, box: value, quantity: value.trim() === "" ? pick.quantity : String(round5(parseNumber(value) * pickedBox.perBox)) })}
                    onEnter={applyPick}
                  />
                </div>
              )}
              <div className="col-span-2">
                <BandInput
                  label={t("Кол-во")}
                  value={pick.quantity}
                  onChange={(value) => setPick({ ...pick, quantity: value, box: pickedBox.perBox && value.trim() !== "" ? String(round5(parseNumber(value) / pickedBox.perBox)) : pick.box })}
                  onEnter={applyPick}
                />
              </div>
              <div className="col-span-1 pb-[9px] text-[13px]">{unitText(pickedBox.measure)}</div>
              {manual && (
                <div className="col-span-3">
                  <BandInput label={t("Цена")} value={pick.price} onChange={(value) => setPick({ ...pick, price: value })} onEnter={applyPick} />
                </div>
              )}
              <div className="col-span-1 flex items-center self-center">
                <button type="button" onClick={applyPick} title={t("Применить")} aria-label={t("Применить")} className="flex h-[40px] w-[40px] items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[rgb(79,113,220)]" aria-hidden>
                    <path d={PLUS} />
                  </svg>
                </button>
              </div>
            </div>
          )}
          {errors.products && <div className="mt-[10px] rounded-[2px] bg-[#ffebee] px-[15px] py-[10px] text-center text-[13px] text-[#f44336]">{errors.products}</div>}
          {lines.length === 0 ? (
            <div className="flex h-[608px] flex-col items-center justify-center text-center text-[13px] leading-[16px] text-[#adadad]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/empty-basket.svg" alt="" className="mb-[20px] mt-[25px] w-[70px]" />
              {edit ? (
                <p>{t("Список возвращаемого товара пуст")}.</p>
              ) : currency && clientId ? (
                <p>
                  {t("Вы еще не выбрали ни одного товара")}. <br />{" "}
                  <button type="button" onClick={() => setAdding((open) => !open)} className="text-[#129fdd] hover:underline">
                    {t("Добавить")}
                  </button>{" "}
                  {t("товар")}?
                </p>
              ) : (
                <p className="max-w-[170px]">{t("Для добавления товаров выберите клиента.")}</p>
              )}
            </div>
          ) : (
            <table className="mt-[20px] w-full table-fixed text-left">
              <thead>
                <tr className="text-[12px] leading-[15px]">
                  <th className="w-[40%] px-[5px] font-semibold">{t("Наименование")}</th>
                  {hasGroups && <th className="px-[5px] font-semibold">{t("Группа")}</th>}
                  <th className="px-[5px] font-semibold">{t("Кол-во")}</th>
                  {manual && <th className="px-[5px] font-semibold">{t("Цена")}</th>}
                  <th />
                </tr>
              </thead>
              <tbody className="leading-[16.25px]">
                {lines.map((line) => {
                  const open = editing?.key === line.key
                  const box = boxOf(line)
                  const boxes = lineBoxes(line)
                  // Linko names the currency of a stored line only (an order's lines and new ones come without one).
                  const priceText = line.stored ? returnNumber(priceOf(line), currencyLabel(line.currency || shownCurrency || edit?.currency || "")) : returnNumber(priceOf(line))
                  return (
                    <tr key={line.key} className={`align-middle ${open ? "" : DOTTED_LINE}`}>
                      <td className="px-[5px] py-[10px]">
                        {open ? (
                          line.productName
                        ) : (
                          <>
                            <span className="block text-[14px] font-semibold leading-[17.5px]">{line.productName}</span>
                            {line.orderId ? (
                              <span className="block">
                                {t("Заказ")}: {line.orderId} {line.orderCreatedAt ? `${t("от")} ${t(orderDay(line.orderCreatedAt))}` : ""}
                                {(line.lineId === undefined ? line.orderItemId : line.lineId) ? <span className="text-[12px] leading-[15px]"> ({line.lineId === undefined ? line.orderItemId : line.lineId})</span> : null}
                              </span>
                            ) : null}
                            {(line.isBonus ?? (line.orderItemId ? bonusLines.has(line.orderItemId) : false)) && <span className="block text-[rgb(113,206,135)]">{t("Бонус")}</span>}
                            {line.promotion && (
                              <span className="block">
                                {t("Акция")}: {line.promotion}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      {hasGroups && (
                        <td className="px-[5px] py-[10px]">
                          {open ? (
                            box.perBox ? (
                              <input
                                inputMode="decimal"
                                value={editing.box}
                                placeholder={`${boxes} ${box.unit}`.trim()}
                                onChange={(event) => {
                                  const value = event.target.value
                                  setEditing({ ...editing, box: value, quantity: value.trim() === "" ? editing.quantity : String(round5(parseNumber(value) * box.perBox)) })
                                }}
                                onKeyDown={(event) => event.key === "Enter" && applyEditing()}
                                className="h-[34px] w-full border-b border-[#e0e0e0] bg-transparent outline-none placeholder:text-[#999]"
                              />
                            ) : null
                          ) : boxes ? (
                            `${returnNumber(boxes)} ${box.unit} (${returnNumber(box.perBox)})`
                          ) : null}
                        </td>
                      )}
                      <td className="px-[5px] py-[10px]">
                        {open ? (
                          <input
                            autoFocus
                            inputMode="decimal"
                            value={editing.quantity}
                            placeholder={`${line.quantity} ${unitText(line.unit)}`}
                            onChange={(event) => {
                              const value = event.target.value
                              setEditing({ ...editing, quantity: value, box: box.perBox && value.trim() !== "" ? String(round5(parseNumber(value) / box.perBox)) : editing.box })
                            }}
                            onKeyDown={(event) => event.key === "Enter" && applyEditing()}
                            className="h-[34px] w-full border-b border-[#e0e0e0] bg-transparent outline-none placeholder:text-[#999]"
                          />
                        ) : (
                          `${line.quantity} ${unitText(line.unit)}`
                        )}
                      </td>
                      {manual && (
                        <td className="px-[5px] py-[10px]">
                          {open ? (
                            <input
                              inputMode="decimal"
                              value={editing.price}
                              placeholder={priceText}
                              onChange={(event) => setEditing({ ...editing, price: event.target.value })}
                              onKeyDown={(event) => event.key === "Enter" && applyEditing()}
                              className="h-[34px] w-full border-b border-[#e0e0e0] bg-transparent outline-none placeholder:text-[#999]"
                            />
                          ) : (
                            priceText
                          )}
                        </td>
                      )}
                      <td className="px-[5px] py-[10px] text-right">
                        {open ? (
                          <button type="button" onClick={applyEditing} aria-label={t("Применить")} className="inline-flex h-[40px] w-[40px] items-center justify-center text-[rgb(79,113,220)]">
                            <Check className="h-6 w-6" />
                          </button>
                        ) : (
                          <span className="inline-flex items-center">
                            <button type="button" onClick={() => setEditing({ key: line.key, quantity: "", price: "", box: "" })} aria-label={t("Изменить")} className="flex h-[40px] w-[40px] items-center justify-center">
                              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden>
                                <path d={PENCIL} />
                              </svg>
                            </button>
                            <button
                              type="button"
                              disabled={costOnly}
                              onClick={() => (setLines((current) => current.filter((entry) => entry.key !== line.key)), clearError("products"))}
                              aria-label={t("Удалить")}
                              className="group/trash flex h-[40px] w-[40px] items-center justify-center"
                            >
                              <svg viewBox="0 0 24 24" className={`h-[22px] w-[22px] ${costOnly ? "fill-[#ccc]" : "fill-[#666]"}`} aria-hidden>
                                <path d={TRASH} />
                              </svg>
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </main>
      </div>
      <footer className="flex h-[56px] shrink-0 items-center justify-between border-t border-[#efefef] px-[10px]">
        <span className="flex items-center gap-[20px] text-[14px]">
          <span>
            {t("Общая стоимость:")} <span className="mr-[6px] text-[16px] font-semibold text-[#129fdd]">{returnNumber(total, totalCurrency ? currencyLabel(totalCurrency) : "")}</span>
          </span>
          <span>
            {t("Общее кол-во:")}{" "}
            <span className="mr-[6px] text-[16px] font-semibold text-[#129fdd]">
              {returnNumber(wholeUnits, t("ед"))} {groups ? `(${groups} ${t("групп")})` : ""}
            </span>
          </span>
        </span>
        <div className="flex items-center gap-6 pr-[10px]">
          {error && <span className="text-[13px] text-[#f44336]">{error}</span>}
          <button type="button" disabled={busy} onClick={() => void next()} className="h-9 min-w-[88px] px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-black/[0.04] disabled:opacity-50">
            {t("Далее")}
          </button>
        </div>
      </footer>
      {preview && <ReturnConfirmDialog lines={preview} saving={busy} error={saveError} onClose={() => setPreview(null)} onSubmit={() => void save()} />}
    </div>,
    document.body,
  )
}
