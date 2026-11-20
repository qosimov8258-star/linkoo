"use client"

import { Calendar, Check, ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react"
import { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { formatUnitTotals } from "@/components/analytics/internal-transfers-picker"
import { downloadExcelTable } from "@/lib/excel-export"
import { readExcelRows } from "@/lib/excel-import"
import { parseAnyDay } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

import { useAllowedProductIds, useAllowedRows } from "./allowed-products"
import { orderListPrice, type OrderPriceList } from "./order-list-price"
import { useAppCurrencyInfo } from "@/lib/app-currency-context"
import { orderApiErrorText, type AgentLimitExceeded, type Order, type ProductRestrictionRefusal } from "./orders-data"

type Option = { value: string; label: string }
type ShopRow = { id: number; name: string; agent?: string; deliverer?: string; zone?: string; type?: string }
type ProductRow = {
  id: number
  name: string
  type?: string
  brand?: string
  unit?: string
  article?: string
  orderNumber?: string
  boxAmount?: number
  boxUnit?: string
  canSell?: boolean
  deleted?: boolean
  priceLists?: { name: string; cash?: number; nonCash?: number; currency?: string; nonCashCurrency?: string }[]
}
type LineItem = { id?: number; productId?: number; productName: string; unit: string; quantity: number; unitPrice: number; discountPercent?: number; boxAmount?: number; boxUnit?: string }
/** GET /api/orders/defaults (lib/orders-repo.ts getOrderDefaults): only its organization is used. */
type OrderDefaults = { agent: string; priceList: string; warehouse: string; organization: string }
/** GET /api/orders/form-options (lib/order-create-options.ts). */
type FormOptions = { agents: string[]; deliverers: string[]; priceLists: string[]; defaults: { agent: string; priceList: string; warehouse: string } }
type CurrencyRow = { code: string; isBase?: boolean }
type Refusal = { error?: string; field?: string; agentLimit?: AgentLimitExceeded; productRestriction?: ProductRestrictionRefusal }

const paymentTypes = ["Наличные", "Перечисление"]
const deliveryTypes = ["Самовывоз", "Доставка"]
const NOT_SET = new Set(["", "не указано", "—", "-"])
/** Linko D.BOX_ROUND: boxes ↔ pieces are rounded to 3 decimals. */
const BOX_ROUND = 1000

export function toInputDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatDate(value: string) {
  if (!value) return ""
  return new Date(`${value}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
}

/** Linko's number format: up to `digits` decimals (3 by default, 8 for line prices and totals), plain spaces. */
function num(value: number, digits = 3) {
  return (Number.isFinite(value) ? value : 0).toLocaleString("ru-RU", { maximumFractionDigits: digits }).replace(/[  ]/g, " ")
}

/** "1,5" / "1 000" → 1.5 / 1000; NaN when not a number. */
function parseNum(value: string) {
  const text = value.replace(/[\s ]/g, "").replace(",", ".")
  return text === "" ? Number.NaN : Number(text)
}

const roundBox = (value: number) => Math.round(value * BOX_ROUND) / BOX_ROUND
const nameKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ")

/** Linko lists products by their «Порядковый номер» (products without one last), then by id. */
function byCatalogOrder(a: ProductRow, b: ProductRow) {
  const order = (row: ProductRow) => {
    const text = String(row.orderNumber ?? "").trim()
    const value = Number(text)
    return text !== "" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
  }
  const [left, right] = [order(a), order(b)]
  return left === right ? a.id - b.id : left < right ? -1 : 1
}

/** "Группа" cell of a line: whole boxes and the loose rest, "<boxes> <box unit> (+<rest>)" (Linko restAmount: the rest
 * without its unit, in a 12 px span 4 px after the boxes). */
function boxLabel(quantity: number, boxAmount: number | undefined, boxUnit: string | undefined, t: (text: string) => string): ReactNode {
  if (!boxAmount || boxAmount <= 0) return ""
  const boxes = Math.floor(roundBox(quantity / boxAmount))
  const rest = Math.round((quantity - boxes * boxAmount) * 10000) / 10000
  return (
    <>
      {num(boxes)} {t(boxUnit || "Группа")}
      {rest !== 0 && <span className="ml-[4px] text-[12px]">(+{num(rest)})</span>}
    </>
  )
}

/** The order's own payment type label ("cash" / "bank" of this API, or the reference's pay-type name). */
function editPaymentType(order: Order): string {
  if (order.payTypeName && paymentTypes.includes(order.payTypeName)) return order.payTypeName
  return order.paymentType === "bank" || order.payMethod === "bank" ? "Перечисление" : paymentTypes[0]
}

/** Server error fields (OrderError.field) → the form field that shows them. */
const FIELD_OF: Record<string, string> = {
  clientId: "client",
  client: "client",
  agent: "agent",
  organization: "organization",
  warehouse: "warehouse",
  currency: "currency",
  priceList: "priceList",
  deliveryMan: "deliverer",
  paymentDate: "paymentDate",
  paymentType: "paymentType",
  deliveryType: "deliveryType",
  productId: "products",
  productName: "products",
  items: "products",
}

/** Changing the organization of an order moves its payments that carry the old one
 * (PATCH /api/orders/[id], lib/orders-repo.ts moveLinkedOrganization). */
export function OrganizationMoveHint({ stored, chosen }: { stored: string; chosen: string }) {
  const { t } = useLanguage()
  if (!stored.trim() || !chosen.trim() || stored.trim().toLowerCase() === chosen.trim().toLowerCase()) return null
  return <span className="mt-1 block text-[12px] text-[#9aa3b6]">{t("Оплаты этого заказа перейдут в выбранную организацию")}</span>
}

export function AddOrderDialog({
  initialShopId,
  onClose,
  onCreated,
  edit,
  onSaved,
}: {
  initialShopId?: number
  onClose: () => void
  onCreated: (order: Order) => void
  /** Edit mode: the same form, prefilled from an existing order and its lines. */
  edit?: { order: Order; items: LineItem[] }
  onSaved?: (patch: Partial<Order>) => void
}) {
  const { t } = useLanguage()
  const app = useAppCurrencyInfo()
  const today = useMemo(() => new Date(), [])
  const tomorrow = useMemo(() => new Date(today.getTime() + 24 * 60 * 60 * 1000), [today])

  const [shops, setShops] = useState<ShopRow[] | null>(null)
  const [formOptions, setFormOptions] = useState<FormOptions | null>(null)
  const [warehouses, setWarehouses] = useState<string[] | null>(null)
  // Every list (archived ones too) with its currency: an entry without its own currency is in its list's currency.
  const [priceListCurrencies, setPriceListCurrencies] = useState<OrderPriceList[]>([])
  const [currencies, setCurrencies] = useState<CurrencyRow[] | null>(null)
  const [products, setProducts] = useState<ProductRow[] | null>(null)
  const [organizations, setOrganizations] = useState<string[] | null>(null)

  const [shopId, setShopId] = useState(initialShopId ? String(initialShopId) : "")
  const editing = edit?.order
  const isEdit = Boolean(editing)
  // Edit mode shows the order's own client right away; the directory (4k shops) loads in the background.
  const [editShopName, setEditShopName] = useState(editing ? editing.marketName || editing.client : "")
  // created_at is UTC: the creation day is the Tashkent day of it.
  const [date, setDate] = useState(editing?.createdAt ? (parseAnyDay(editing.createdAt, true) ?? editing.createdAt.slice(0, 10)) : toInputDate(today))
  const [prize, setPrize] = useState(false)
  const [paymentType, setPaymentType] = useState(editing ? editPaymentType(editing) : paymentTypes[0])
  const [currency, setCurrency] = useState(editing ? editing.currency || editing.amount.trim().split(/\s+/).pop() || "" : "")
  const [priceList, setPriceList] = useState(editing?.priceList ?? "")
  const [agent, setAgent] = useState(editing?.agent ?? "")
  // Ограничение продуктов: an agent with a product / type list is offered only those products.
  const allowedRows = useAllowedRows(products, useAllowedProductIds(agent))
  const sellable = useMemo(() => (allowedRows ? [...allowedRows].sort(byCatalogOrder) : null), [allowedRows])
  const [organization, setOrganization] = useState(editing?.organization ?? "")
  const [lastPayDate, setLastPayDate] = useState(editing ? editing.paymentDate || editing.dueDate || "" : toInputDate(tomorrow))
  const [terms, setTerms] = useState<"standard" | "consignment">(editing?.dealType === "consignment" || editing?.dealType === "1" ? "consignment" : "standard")
  // The order's warehouse reference (stock is reserved there); the reference's stock name only as a fallback.
  const [warehouse, setWarehouse] = useState(editing?.warehouse || editing?.stockName || "")
  const [deliveryType, setDeliveryType] = useState(editing?.deliveryType === "Самовывоз" || editing?.deliveryType === "self" ? "Самовывоз" : "Доставка")
  const [deliverer, setDeliverer] = useState(editing?.deliveryMan ?? "")
  const [deliveryDate, setDeliveryDate] = useState(editing ? parseAnyDay(editing.delivery) || editing.acceptedDate || "" : toInputDate(tomorrow))
  const [confirmed, setConfirmed] = useState(editing ? editing.status !== "Не подтвержден" : true)
  const [noBonus, setNoBonus] = useState(Boolean(initialShopId))
  const [autoDiscounts, setAutoDiscounts] = useState(false)
  const [comment, setComment] = useState(editing?.comment ?? "")

  const [items, setItems] = useState<LineItem[]>(edit?.items ?? [])
  const [inlineOpen, setInlineOpen] = useState(false)
  const [inline, setInline] = useState({ product: "", box: "", quantity: "", unitPrice: "" })
  const inlineProductRef = useRef<HTMLButtonElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  // changing the price list / currency / payment type asks before the line prices follow it (the reference shows the question in the products panel)
  const [pendingPricing, setPendingPricing] = useState<{ paymentType: string; currency: string; priceList: string } | null>(null)
  const [exitOpen, setExitOpen] = useState(false)
  // Linko's «Оформить заказ» opens ConfirmDialog type "submit" first; only its «Да» sends the form.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  // Linko marks each empty required field («Это поле обязательно к заполнению») instead of one footer message.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  // Hand-picked organization keeps its value; otherwise it follows the client / agent / warehouse.
  const touched = useRef({ organization: false, agent: Boolean(editing), priceList: Boolean(editing), warehouse: Boolean(editing) })
  const defaultsRequest = useRef(0)
  const required = t("Это поле обязательно к заполнению")

  const clearError = (...fields: string[]) => {
    setError("")
    setFieldErrors((current) => {
      if (!fields.some((field) => current[field])) return current
      const next = { ...current }
      for (const field of fields) delete next[field]
      return next
    })
  }

  /** The organization the server would give a new order of this client / agent / warehouse (GET /api/orders/defaults);
   * a hand-picked one is kept. Stale answers are dropped. */
  const followOrganizationNew = useCallback((next: { shopId: string; agent: string; warehouse: string }) => {
    if (touched.current.organization) return
    const request = ++defaultsRequest.current
    const params = new URLSearchParams()
    if (next.shopId) params.set("clientId", next.shopId)
    params.set("agent", next.agent)
    params.set("warehouse", next.warehouse)
    void fetch(`/api/orders/defaults?${params}`)
      .then((response) => (response.ok ? (response.json() as Promise<OrderDefaults>) : null))
      .catch(() => null)
      .then((defaults) => {
        if (!defaults || request !== defaultsRequest.current || touched.current.organization) return
        setOrganization(defaults.organization)
      })
  }, [])
  // Edit: the order's own client / agent / warehouse, against which a change is measured.
  const initialParty = { shopId: editing?.clientId ? String(editing.clientId) : "", agent: editing?.agent ?? "", warehouse: editing?.warehouse || editing?.stockName || "" }
  const partyOf = (change: { shopId?: string; agent?: string; warehouse?: string }) => ({ shopId: shopId || initialParty.shopId, agent, warehouse, ...change })
  const partyChanged = (() => {
    const party = partyOf({})
    return party.shopId !== initialParty.shopId || party.agent !== initialParty.agent || party.warehouse !== initialParty.warehouse
  })()

  /** Edit: the organization follows a new client / agent / warehouse (GET /api/orders/defaults) while it is
   * empty or still the default of the order's old ones and was not picked by hand — the rule PATCH
   * /api/orders/[id] applies on the server. Stale answers are dropped. */
  function followOrganization(change: { shopId?: string; agent?: string; warehouse?: string }) {
    if (!editing) {
      const party = partyOf(change)
      followOrganizationNew({ shopId: party.shopId, agent: party.agent, warehouse: party.warehouse })
      return
    }
    if (touched.current.organization) return
    const party = partyOf(change)
    const request = ++defaultsRequest.current
    const stored = editing.organization ?? ""
    if (party.shopId === initialParty.shopId && party.agent === initialParty.agent && party.warehouse === initialParty.warehouse) {
      setOrganization(stored)
      return
    }
    const load = (values: typeof party) => {
      const params = new URLSearchParams()
      if (values.shopId) params.set("clientId", values.shopId)
      if (values.agent) params.set("agent", values.agent)
      if (values.warehouse) params.set("warehouse", values.warehouse)
      return fetch(`/api/orders/defaults?${params}`)
        .then((response) => (response.ok ? (response.json() as Promise<OrderDefaults>) : null))
        .catch(() => null)
    }
    const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
    void Promise.all([stored.trim() ? load(initialParty) : Promise.resolve(null), load(party)]).then(([before, after]) => {
      if (request !== defaultsRequest.current || touched.current.organization || !after?.organization) return
      if (stored.trim() && !(before && sameName(before.organization, stored))) return
      setOrganization(after.organization)
    })
  }
  const [stock, setStock] = useState<Record<string, number>>({})
  const [rowEdit, setRowEdit] = useState<{ index: number; box: string; quantity: string; unitPrice: string } | null>(null)

  useEffect(() => {
    const load = (url: string) => fetch(url).then((response) => (response.ok ? response.json() : null)).catch(() => null)
    load("/api/clients?balances=0").then((rows: ShopRow[] | null) => setShops(Array.isArray(rows) ? rows : []))
    load("/api/orders/form-options").then((data: FormOptions | null) => setFormOptions(data ?? { agents: [], deliverers: [], priceLists: [], defaults: { agent: "", priceList: "", warehouse: "" } }))
    // Linko's «Склад» select: every warehouse by name (its collation: case and punctuation ignored).
    const byName = new Intl.Collator("en", { sensitivity: "base", ignorePunctuation: true })
    load("/api/warehouses").then((rows: { name: string }[] | null) =>
      setWarehouses((Array.isArray(rows) ? rows : []).map((row) => row.name).filter(Boolean).sort(byName.compare)),
    )
    load("/api/price-lists?active=all").then((rows: OrderPriceList[] | null) => setPriceListCurrencies(Array.isArray(rows) ? rows : []))
    load("/api/currencies").then((rows: CurrencyRow[] | null) => setCurrencies(Array.isArray(rows) ? rows : []))
    load("/api/organizations").then((rows: { name: string }[] | null) => setOrganizations((Array.isArray(rows) ? rows : []).map((row) => row.name).filter(Boolean)))
    // Only products that can be sold (the API refuses the others).
    load("/api/products").then((rows: ProductRow[] | null) => setProducts((Array.isArray(rows) ? rows : []).filter((row) => row.canSell !== false && !row.deleted)))
  }, [])

  // A new order starts like Linko's initialValues: the signed-in user as Агент, its first price list and its
  // first linked warehouse (GET /api/orders/form-options); the organization follows them.
  const defaultsApplied = useRef(false)
  useEffect(() => {
    if (isEdit || !formOptions || defaultsApplied.current) return
    defaultsApplied.current = true
    const next = {
      agent: touched.current.agent ? agent : formOptions.defaults.agent,
      priceList: touched.current.priceList ? priceList : formOptions.defaults.priceList,
      warehouse: touched.current.warehouse ? warehouse : formOptions.defaults.warehouse,
    }
    setAgent(next.agent)
    setPriceList(next.priceList)
    setWarehouse(next.warehouse)
    followOrganizationNew({ shopId, agent: next.agent, warehouse: next.warehouse })
  }, [isEdit, formOptions, agent, priceList, warehouse, shopId, followOrganizationNew])

  const shop = shops?.find((row) => String(row.id) === shopId)
  // Opened from a client card: that client's own deliverer is the default «Доставщик».
  const initialDelivererApplied = useRef(false)
  useEffect(() => {
    if (isEdit || !initialShopId || !shop || initialDelivererApplied.current) return
    initialDelivererApplied.current = true
    if (!NOT_SET.has(nameKey(shop.deliverer ?? ""))) setDeliverer((current) => current || shop.deliverer || "")
  }, [isEdit, initialShopId, shop])

  /** Linko's client select customOnChange: Агент = the client's responsible agent, Доставщик = its responsible
   * delivery man (both cleared when it has none); the warehouse is left alone. Mezon clients have no price list of
   * their own, so the chosen list stays. */
  function chooseShop(value: string) {
    clearError("client")
    setShopId(value)
    const row = shops?.find((item) => String(item.id) === value)
    const nextAgent = row && !NOT_SET.has(nameKey(row.agent ?? "")) ? (row.agent ?? "") : ""
    const nextDeliverer = row && !NOT_SET.has(nameKey(row.deliverer ?? "")) ? (row.deliverer ?? "") : ""
    setAgent(nextAgent)
    if (nextAgent) clearError("agent")
    setDeliverer(nextDeliverer)
    followOrganization({ shopId: value, agent: nextAgent })
  }

  function chooseAgent(value: string) {
    clearError("agent")
    touched.current.agent = true
    setAgent(value)
    followOrganization({ agent: value })
  }

  function chooseWarehouse(value: string) {
    clearError("warehouse")
    touched.current.warehouse = true
    setWarehouse(value)
    followOrganization({ warehouse: value })
  }

  function chooseOrganization(value: string) {
    clearError("organization")
    touched.current.organization = true
    setOrganization(value)
  }

  useEffect(() => {
    if (!editing || shopId || !shops) return
    const names = [editing.marketName, editing.client].filter(Boolean)
    const found = (editing.clientId ? shops.find((row) => row.id === editing.clientId) : undefined) ?? shops.find((row) => names.includes(row.name))
    if (found) setShopId(String(found.id))
  }, [editing, shopId, shops])

  // «Название клиента»: Linko's async select searches market/select (50 at a time, newest first).
  const shopOptions = useMemo(() => [...(shops ?? [])].sort((a, b) => b.id - a.id).map((row) => ({ value: String(row.id), label: row.name })), [shops])
  // «Прайс лист»: the user's own lists (Linko authConfirm.priceLists), plus the order's list when it is another one.
  const priceListOptions = useMemo(() => {
    if (!formOptions) return null
    const names = [...formOptions.priceLists]
    if (priceList && !names.includes(priceList)) names.push(priceList)
    return names
  }, [formOptions, priceList])
  const agentOptions = useMemo(() => (formOptions ? formOptions.agents.map((row) => ({ value: row, label: row })) : []), [formOptions])
  const delivererOptions = useMemo(() => (formOptions ? formOptions.deliverers.map((row) => ({ value: row, label: row })) : []), [formOptions])

  // Currency: the app currency when one is set (the API then lists only it), else the «Основная валюта» of Валюты
  // (Linko's PRIMARY_CURRENCY_ID).
  useEffect(() => {
    if (!currencies?.length || currency) return
    setCurrency((currencies.find((row) => row.isBase) ?? currencies[0]).code)
  }, [currencies, currency])

  // Esc asks for confirmation first; a second Esc leaves, Alt+Enter keeps working.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        if (pickerOpen) setPickerOpen(false)
        else if (confirmOpen) setConfirmOpen(false)
        else if (exitOpen) onClose()
        else setExitOpen(true)
      } else if (event.key === "Enter" && event.altKey && exitOpen) {
        event.preventDefault()
        setExitOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [exitOpen, pickerOpen, confirmOpen, onClose])

  // "На складе": what the chosen warehouse still has of each product (stock balances API).
  useEffect(() => {
    if (!warehouse) return
    let cancelled = false
    fetch(`/api/stock/balances?pageSize=0&warehouse=${encodeURIComponent(warehouse)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { rows?: { key?: string; name: string; available: number }[] } | null) => {
        if (cancelled || !data?.rows) return
        // By stock key ("product:<id>") first, the name only for lines without a product id.
        setStock(Object.fromEntries(data.rows.flatMap((row) => [[row.name, row.available], ...(row.key ? [[row.key, row.available]] : [])])))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [warehouse])

  const ready = Boolean(paymentType && currency && priceList)
  const stockOf = (item: { productId?: number; productName: string }): number | undefined => (item.productId ? stock[`product:${item.productId}`] : undefined) ?? stock[item.productName]
  const productStock = (product: ProductRow) => (warehouse ? (stockOf({ productId: product.id, productName: product.name }) ?? 0) : 0)
  const insufficient = items.some((item) => {
    const left = stockOf(item)
    return left !== undefined && left < item.quantity
  })
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  // Quantities are totalled per unit (never one sum over kg and pieces).
  const totalQty = formatUnitTotals(items.map((item) => ({ qty: item.quantity, unit: item.unit })), t)
  const productById = useMemo(() => new Map((products ?? []).map((row) => [row.id, row])), [products])
  const boxOf = (item: LineItem) => {
    if ((item.boxAmount ?? 0) > 0) return { amount: item.boxAmount!, unit: item.boxUnit ?? "" }
    const product = item.productId ? productById.get(item.productId) : undefined
    return product && (product.boxAmount ?? 0) > 0 ? { amount: product.boxAmount!, unit: product.boxUnit ?? "" } : null
  }
  // Linko shows «Группа» only while a line's product is sold in boxes.
  const hasBoxes = items.some((item) => boxOf(item) !== null)

  // A price list price is used only in the order currency (a SUM price is not a USD price): the same rule as the
  // order card's "+ добавить товар" row (order-list-price.ts), so both paths agree; otherwise the user types it.
  function priceOf(product: ProductRow, list = priceList, type = paymentType, inCurrency = currency) {
    return orderListPrice(product.priceLists, { priceList: list, lists: priceListCurrencies, orderCurrency: inCurrency, nonCash: type === "Перечисление", rates: app.code ? app.rates : undefined }) ?? 0
  }

  function changePricing(next: { paymentType?: string; currency?: string; priceList?: string }) {
    const nextType = next.paymentType ?? paymentType
    const nextList = next.priceList ?? priceList
    const nextCurrency = next.currency ?? currency
    if (next.paymentType !== undefined) setPaymentType(next.paymentType)
    if (next.currency !== undefined) setCurrency(next.currency)
    if (next.priceList !== undefined) {
      touched.current.priceList = true
      setPriceList(next.priceList)
    }
    clearError(...Object.keys(next))
    // Linko asks only when a chosen value is replaced by another one (clearing a field asks nothing).
    const replaced =
      (next.paymentType !== undefined && Boolean(paymentType) && Boolean(next.paymentType) && next.paymentType !== paymentType) ||
      (next.currency !== undefined && Boolean(currency) && Boolean(next.currency) && next.currency !== currency) ||
      (next.priceList !== undefined && Boolean(priceList) && Boolean(next.priceList) && next.priceList !== priceList)
    if (items.length && replaced) setPendingPricing({ paymentType: nextType, currency: nextCurrency, priceList: nextList })
  }

  function applyPendingPricing() {
    if (!pendingPricing) return
    setItems((current) =>
      current.map((item) => {
        const product = products?.find((row) => (item.productId ? row.id === item.productId : row.name === item.productName))
        return product ? { ...item, unitPrice: priceOf(product, pendingPricing.priceList, pendingPricing.paymentType, pendingPricing.currency) } : item
      }),
    )
    setPendingPricing(null)
  }

  /** Linko: the new lines go first and replace the lines of the same products; the other lines follow. */
  function addItems(rows: LineItem[]) {
    clearError("products")
    setRowEdit(null)
    setItems((current) => {
      const ids = new Set(rows.map((row) => row.productId))
      return [...rows, ...current.filter((item) => !ids.has(item.productId))]
    })
  }

  const lineOf = (product: ProductRow, quantity: number, unitPrice: number): LineItem => ({
    productId: product.id,
    productName: product.name,
    unit: product.unit || "шт.",
    quantity,
    unitPrice,
    ...((product.boxAmount ?? 0) > 0 ? { boxAmount: product.boxAmount, boxUnit: product.boxUnit } : {}),
  })

  const inlineProduct = inline.product ? productById.get(Number(inline.product)) : undefined
  const inlineBox = inlineProduct && (inlineProduct.boxAmount ?? 0) > 0 ? { amount: inlineProduct.boxAmount!, unit: inlineProduct.boxUnit ?? "" } : null

  /** Linko handleAdd: a product, a quantity and a price are needed; the row empties and stays open for the next one. */
  function confirmInline() {
    const quantity = parseNum(inline.quantity)
    const unitPrice = parseNum(inline.unitPrice)
    if (!inlineProduct || !(quantity > 0) || !(unitPrice >= 0)) return
    addItems([lineOf(inlineProduct, quantity, unitPrice)])
    setInline({ product: "", box: "", quantity: "", unitPrice: "" })
    inlineProductRef.current?.focus()
  }

  function openInline() {
    setExcelOpen(false)
    setInlineOpen(true)
  }

  /** Linko «Импортировать c Excel»: needs the price list, payment type, warehouse and currency first. */
  function toggleExcel() {
    const missing: Record<string, string> = {}
    if (!priceList) missing.priceList = required
    if (!paymentType) missing.paymentType = required
    if (!warehouse) missing.warehouse = required
    if (!currency) missing.currency = required
    if (Object.keys(missing).length) {
      setFieldErrors((current) => ({ ...current, ...missing }))
      return
    }
    setInlineOpen(false)
    setExcelOpen((open) => !open)
  }

  /** The template: the warehouse's products in stock with their list price; «Кол-во» is filled in by the user. */
  function downloadTemplate() {
    const rows = (sellable ?? []).filter((product) => productStock(product) > 0)
    downloadExcelTable(`${t("Заказ")} ${warehouse}`.trim(), [
      [t("Наименование"), t("Кол-во"), t("Цена"), t("Ед. изм."), t("На складе")],
      ...rows.map((product) => [product.name, "", priceOf(product), product.unit || "", productStock(product)]),
    ])
  }

  async function importFile(file: File) {
    const rows = await readExcelRows(file)
    const byName = new Map((sellable ?? []).map((product) => [nameKey(product.name), product]))
    const unknown: string[] = []
    const parsed: LineItem[] = []
    for (const [name, quantity, price] of rows) {
      const productName = (name ?? "").trim()
      const qty = parseNum(quantity ?? "")
      if (!productName || !(qty > 0)) continue
      const product = byName.get(nameKey(productName))
      if (!product) {
        unknown.push(productName)
        continue
      }
      const typed = parseNum(price ?? "")
      parsed.push(lineOf(product, qty, Number.isFinite(typed) && typed >= 0 ? typed : priceOf(product)))
    }
    if (parsed.length) addItems(parsed)
    if (unknown.length) setError(`${t("Товары не найдены в каталоге")}: ${unknown.slice(0, 5).join(", ")}`)
    else if (!parsed.length) setError(t("В файле нет товаров с количеством"))
    if (parsed.length) setExcelOpen(false)
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {}
    if (!shop && !editing) errors.client = required
    if (!paymentType) errors.paymentType = required
    if (!currency) errors.currency = required
    if (!priceList && !(editing && !editing.priceList)) errors.priceList = required
    if (!agent) errors.agent = required
    // An older order may have none: the server then takes the client's / agent's organization.
    if (organizations?.length && !organization && !(editing && !editing.organization)) errors.organization = required
    if (!lastPayDate) errors.paymentDate = required
    if (!warehouse) errors.warehouse = required
    if (!deliveryType) errors.deliveryType = required
    if (!items.length) errors.products = t("Вы еще не выбрали ни одного товара.")
    return errors
  }

  /** A refused save: the field the server names shows the message, anything else stays in the footer. */
  function showRefusal(body: Refusal | null, fallback: string) {
    const text = orderApiErrorText(body, t, fallback)
    const field = body?.field ? FIELD_OF[body.field] : undefined
    if (field) setFieldErrors((current) => ({ ...current, [field]: text }))
    else setError(text)
  }

  async function save() {
    setError("")
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
    const pickup = deliveryType === "Самовывоз"
    setSaving(true)
    try {
      if (editing) {
        // Only what changed is sent (the server checks each change: final / shipped orders, stock,
        // references); the client is linked by id, dates are ISO days, the amount follows the lines.
        const patch: Partial<Order> = {}
        if (shop && shop.id !== editing.clientId) Object.assign(patch, { clientId: shop.id, client: shop.name })
        if (agent !== (editing.agent ?? "")) patch.agent = agent
        // Sent when changed, or kept by hand while the client / agent / warehouse changes
        // (otherwise the server lets a default organization follow them).
        if (organization !== (editing.organization ?? "") || (touched.current.organization && partyChanged)) patch.organization = organization
        // Самовывоз: like Linko's serializer, no delivery man and no delivery date are sent.
        if (!pickup && deliveryDate && deliveryDate !== parseAnyDay(editing.delivery)) patch.delivery = deliveryDate
        if (priceList !== (editing.priceList ?? "")) patch.priceList = priceList
        if (warehouse !== initialParty.warehouse) patch.warehouse = warehouse
        const payment = paymentType === "Перечисление" ? "bank" : "cash"
        if (payment !== (editing.paymentType ?? "")) patch.paymentType = payment
        if (lastPayDate !== (editing.paymentDate ?? "")) patch.paymentDate = lastPayDate
        if (terms !== editing.dealType) patch.dealType = terms
        if (deliveryType !== (editing.deliveryType ?? "")) patch.deliveryType = deliveryType
        if (!pickup && deliverer !== (editing.deliveryMan ?? "")) patch.deliveryMan = deliverer
        if (comment.trim() !== (editing.comment ?? "")) patch.comment = comment.trim()
        if (currency && currency !== (editing.currency ?? "")) patch.currency = currency
        if (["Не подтвержден", "В процессе", "Есть на складе"].includes(editing.status)) {
          const nextStatus = confirmed ? (editing.status === "Не подтвержден" ? "Есть на складе" : editing.status) : "Не подтвержден"
          if (nextStatus !== editing.status) patch.status = nextStatus
        }
        if (Object.keys(patch).length) {
          const response = await fetch(`/api/orders/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })
          if (!response.ok) {
            showRefusal((await response.json().catch(() => null)) as Refusal | null, "Не удалось сохранить заказ")
            setSaving(false)
            return
          }
        }
        // Lines: removed ones are deleted, new or changed ones saved; untouched lines are left alone.
        const original = new Map((edit?.items ?? []).filter((item) => item.id).map((item) => [item.id, item]))
        const changed = (item: LineItem) => {
          const before = item.id ? original.get(item.id) : undefined
          return !before || before.quantity !== item.quantity || before.unitPrice !== item.unitPrice || (before.discountPercent ?? 0) !== (item.discountPercent ?? 0)
        }
        const kept = new Set(items.filter((item) => item.id).map((item) => item.id))
        const body = (item: LineItem) => JSON.stringify({ productId: item.productId ?? products?.find((row) => row.name === item.productName)?.id, productName: item.productName, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: item.discountPercent ?? 0, currency })
        const results = await Promise.all([
          ...(edit?.items ?? []).filter((item) => item.id && !kept.has(item.id)).map((item) => fetch(`/api/orders/${editing.id}/items/${item.id}`, { method: "DELETE" })),
          ...items.filter(changed).map((item) =>
            fetch(item.id ? `/api/orders/${editing.id}/items/${item.id}` : `/api/orders/${editing.id}/items`, { method: item.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: body(item) }),
          ),
        ])
        const failed = results.find((result) => !result.ok)
        if (failed) {
          showRefusal((await failed.json().catch(() => null)) as Refusal | null, "Не удалось сохранить заказ")
          setSaving(false)
          return
        }
        onSaved?.({ ...patch, amount: `${num(total)} ${currency}` })
        return
      }
      // One request: the order and its lines are saved together (all or nothing),
      // in the chosen currency and warehouse; the server checks stock.
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: shop!.id,
          zone: shop!.zone,
          type: shop!.type,
          priceList,
          agent,
          organization: organization || undefined,
          currency,
          warehouse,
          deliveryMan: !pickup && deliverer ? deliverer : undefined,
          delivery: pickup ? undefined : deliveryDate,
          paymentDate: lastPayDate,
          paymentType: paymentType === "Наличные" ? "cash" : paymentType === "Перечисление" ? "bank" : "",
          deliveryType,
          dealType: terms,
          comment: comment.trim() || undefined,
          status: confirmed ? "Есть на складе" : "Не подтвержден",
          items: items.map((item) => ({ productId: item.productId, productName: item.productName, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, currency })),
        }),
      })
      const body = (await response.json().catch(() => null)) as (Order & Refusal) | null
      if (!response.ok || !body) {
        showRefusal(body, "Не удалось создать заказ")
        setSaving(false)
        return
      }
      onCreated(body)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("Не удалось создать заказ"))
      setSaving(false)
    }
  }

  const link = "text-[13px] text-[#4f6fe0] hover:underline"
  // Linko's hover text of the disabled «+ добавить товар»: what is still missing.
  const missingHint = [t("Выберите"), priceList ? "" : t("прайс лист"), paymentType ? "" : t("и"), paymentType ? "" : t("типа оплаты"), currency ? "" : t("и"), currency ? "" : t("валюту")].join(" ")
  const gridColumns = hasBoxes ? "35% repeat(5, minmax(0, 1fr)) 100px" : "35% repeat(4, minmax(0, 1fr)) 100px"

  // Rendered in a portal so it is never clipped or stacked under the client drawer it is opened from.
  return createPortal(
    <div className="fixed inset-0 z-[1301] overflow-y-auto bg-white text-[#333]">
     <div className="flex min-h-full flex-col">
      <header className="relative h-[59px] shrink-0 border-b border-[#efefef]">
        <h2 className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{t(editing ? "Изменение заказа" : "Добавление заказа")}</h2>
        <button type="button" onClick={() => setExitOpen(true)} aria-label={t("Закрыть")} className="absolute right-[10px] top-[5.5px] flex h-12 w-12 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
        </button>
      </header>

      <div className="flex flex-1">
        <aside className="w-[280px] shrink-0 border-r border-[#efefef] px-[30px] pb-[11px] pt-[20.7px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold leading-[16.3px]">{t("Выбор клиента")}</span>
            {/* Linko: a new tab on the client list with «Добавить клиента» already open (#/shop?openCreateDialog=true). */}
            <a href="/clients?openCreateDialog=true" target="_blank" rel="noopener" className={link}>+ {t("добавить")}</a>
          </div>

          <DateField label={t("Дата создания")} required value={date} onChange={setDate} first />
          <SelectField
            label={t("Название клиента")}
            required
            placeholderLabel
            searchable
            searchOnly
            limit={50}
            value={shopId || editShopName}
            onChange={(value) => { setEditShopName(""); chooseShop(value) }}
            loading={!shops && !editing}
            options={shopOptions}
            onClear={() => { setEditShopName(""); chooseShop("") }}
            error={fieldErrors.client}
          />

          {insufficient && (
            <div className="-mx-[30px] mt-[10px] flex h-[56px] items-center bg-[#ffebeb] px-[30px] text-[13px] text-[#f44336]">{t("Недостаточно товаров на складе")}</div>
          )}

          <h3 className={`${insufficient ? "mt-[6px]" : "mt-[14.3px]"} text-[13px] font-semibold leading-[16.3px]`}>{t("Оплата")}</h3>
          <label className="mt-[20px] flex h-5 cursor-pointer items-center gap-[6px] text-[13px] font-semibold text-black">
            <Checkbox checked={prize} onChange={setPrize} />
            {t("Призовой заказ за балл")}
          </label>

          <div className="mt-[25.5px]">
            <SelectField label={t("Тип оплаты")} placeholderLabel value={paymentType} onChange={(value) => changePricing({ paymentType: value })} options={paymentTypes.map((row) => ({ value: row, label: t(row) }))} onClear={() => changePricing({ paymentType: "" })} error={fieldErrors.paymentType} />
          </div>
          <SelectField label={t("Валюта")} required placeholderLabel value={currency} onChange={(value) => changePricing({ currency: value })} loading={!currencies} options={(currencies ?? []).map((row) => ({ value: row.code, label: row.code }))} onClear={() => changePricing({ currency: "" })} error={fieldErrors.currency} />
          <SelectField label={t("Прайс лист")} required placeholderLabel searchable value={priceList} onChange={(value) => changePricing({ priceList: value })} loading={!priceListOptions} options={(priceListOptions ?? []).map((row) => ({ value: row, label: row }))} onClear={() => changePricing({ priceList: "" })} error={fieldErrors.priceList} />
          <SelectField label={t("Агент")} required placeholderLabel searchable value={agent} onChange={chooseAgent} loading={!formOptions} options={agentOptions} onClear={() => chooseAgent("")} error={fieldErrors.agent} />
          {(organizations === null || organizations.length > 0) && (
            <SelectField label={t("Организация")} required placeholderLabel searchable value={organization} onChange={chooseOrganization} loading={!organizations} options={(organizations ?? []).map((row) => ({ value: row, label: row }))} onClear={() => chooseOrganization("")} error={fieldErrors.organization} />
          )}
          {editing && <OrganizationMoveHint stored={editing.organization ?? ""} chosen={organization} />}
          <DateField label={t("Дата окончательной оплаты")} required value={lastPayDate} onChange={(value) => { clearError("paymentDate"); setLastPayDate(value) }} />

          <h3 className="mt-[6.2px] text-[13px] font-semibold leading-[16.3px]">{t("Условия договора")}</h3>
          <div className="mt-[7.8px] space-y-[10px]">
            {([["standard", "Стандартная"], ["consignment", "Консигнация"]] as const).map(([value, label]) => (
              <label key={value} className="flex h-6 cursor-pointer items-center text-[13px] font-semibold text-black">
                <svg viewBox="0 0 24 24" className="ml-[2px] h-5 w-5 shrink-0" aria-hidden>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" fill="#666" />
                  {terms === value && <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z" fill="#5d6474" />}
                </svg>
                <input type="radio" name="terms" checked={terms === value} onChange={() => setTerms(value)} className="sr-only" />
                <span className="ml-[18px] font-normal">{t(label)}</span>
              </label>
            ))}
          </div>
          <div className="mt-[18.5px]"><SelectField label={t("Склад")} required placeholderLabel searchable value={warehouse} onChange={chooseWarehouse} loading={!warehouses} options={(warehouses ?? []).map((row) => ({ value: row, label: row }))} onClear={() => chooseWarehouse("")} error={fieldErrors.warehouse} /></div>

          <h3 className="mt-[13.7px] text-[13px] font-semibold leading-[16.3px]">{t("Условия доставки")}</h3>
          <div className="mt-[9.6px]"><SelectField label={t("Тип доставки")} required placeholderLabel value={deliveryType} onChange={(value) => { clearError("deliveryType"); setDeliveryType(value) }} options={deliveryTypes.map((row) => ({ value: row, label: t(row) }))} onClear={() => setDeliveryType("")} error={fieldErrors.deliveryType} /></div>
          {/* Linko shows «Доставщик» and «Дата доставки» only for «Доставка». */}
          {deliveryType === "Доставка" && (
            <>
              <div className="mt-[4.2px]">
                <SelectField label={t("Доставщик")} placeholderLabel searchable value={deliverer} onChange={(value) => { clearError("deliverer"); setDeliverer(value) }} loading={!formOptions} options={delivererOptions} onClear={() => setDeliverer("")} error={fieldErrors.deliverer} />
              </div>
              <div className="-mt-[6px]"><DateField label={t("Дата доставки")} value={deliveryDate} onChange={setDeliveryDate} /></div>
            </>
          )}

          <div className="mt-5 space-y-[14px] text-[13px] font-semibold">
            <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={confirmed} onChange={setConfirmed} />{t("Подтвержденный")}</label>
            <label className="flex cursor-pointer items-center gap-2"><Checkbox checked={noBonus} onChange={setNoBonus} />{t("Создать без бонуса")}</label>
            <label className="flex cursor-pointer items-start gap-2"><Checkbox checked={autoDiscounts} onChange={setAutoDiscounts} className="mt-0.5" /><span className="leading-5">{t("Задействовать автоматические скидки")}</span></label>
          </div>

          <input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t("Комментарии")}
            className="mt-6 w-full border-b border-slate-300 bg-transparent py-2 text-[13px] font-semibold outline-none placeholder:text-slate-800"
          />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col px-[30px]">
          <div className="flex h-12 items-center justify-center border-b-2 border-[#4f6fe0] text-[13px] font-medium">{t("Товары")}</div>
          {pendingPricing && (
            <div className="mt-[44px] flex flex-col items-center text-center">
              <p className="text-[16px] font-semibold leading-[20px]">
                {t("Цены товаров будут изменены на")} {pendingPricing.priceList} ({pendingPricing.currency}, {t(pendingPricing.paymentType).toLowerCase()})
              </p>
              <div className="mt-[22px] flex gap-[67px] text-[13px] font-bold text-[#1E4A9A]">
                <button type="button" onClick={() => setPendingPricing(null)} className="uppercase">{t("Нет")}</button>
                <button type="button" onClick={applyPendingPricing} className="uppercase">{t("Да")}</button>
              </div>
            </div>
          )}
          <div className={pendingPricing ? "hidden" : "contents"}>
          <div className="mt-[22px] flex h-9 items-center justify-between">
            <h3 className="text-[13px] font-semibold leading-[16.3px]">{t("Список товаров")}</h3>
            <div className="flex items-center">
              {ready ? (
                <>
                  <button type="button" onClick={openInline} className={`h-9 px-4 ${link}`}>{t("добавить товар")}</button>
                  <button type="button" onClick={() => { setExcelOpen(false); setPickerOpen(true) }} className={`h-9 px-4 ${link}`}>{t("добавить из списка")}</button>
                </>
              ) : (
                <span title={missingHint} className="inline-flex">
                  <button type="button" disabled className="h-9 px-4 text-[13px] text-slate-800">+ {t("добавить товар")}</button>
                </span>
              )}
              <button type="button" onClick={toggleExcel} className={`h-9 rounded-[2px] px-4 ${link} ${excelOpen ? "bg-[#e0e0e0] hover:no-underline" : ""}`}>{t("импортировать c excel")}</button>
            </div>
          </div>

          {excelOpen && (
            <ExcelSteps
              canDownload={Boolean(warehouse)}
              onDownload={downloadTemplate}
              onConfirm={(file) => void importFile(file)}
            />
          )}

          {inlineOpen && ready && (
            <div className="-mx-[30px] mt-5 grid grid-cols-12 items-end gap-x-4 bg-[#f1f4f7] px-[18px] pb-4 pt-6">
              <div className={inlineBox ? "col-span-3" : "col-span-5"}>
                <SelectField
                  label={t("Наименование")}
                  placeholderLabel
                  flat
                  searchable
                  limit={50}
                  buttonRef={inlineProductRef}
                  value={inline.product}
                  onChange={(value) => {
                    const product = productById.get(Number(value))
                    setInline({ product: value, box: "", quantity: "", unitPrice: product ? String(priceOf(product)) : "" })
                  }}
                  onClear={() => setInline({ product: "", box: "", quantity: "", unitPrice: "" })}
                  loading={!sellable}
                  options={(sellable ?? []).map((row) => ({ value: String(row.id), label: `${row.name} (${num(productStock(row))} ${t(row.unit || "шт.")})` }))}
                />
              </div>
              {inlineBox && (
                <FloatField
                  className="col-span-2"
                  label={`${t(inlineBox.unit || "Группа")} (${num(inlineBox.amount)} ${t(inlineProduct?.unit || "шт.")})`}
                  value={inline.box}
                  onChange={(value) => {
                    const boxes = parseNum(value)
                    setInline({ ...inline, box: value, quantity: Number.isFinite(boxes) ? String(roundBox(boxes * inlineBox.amount)) : inline.quantity })
                  }}
                  onEnter={confirmInline}
                />
              )}
              <FloatField
                className="col-span-2"
                label={t("Кол-во")}
                value={inline.quantity}
                onChange={(value) => {
                  const quantity = parseNum(value)
                  setInline({ ...inline, quantity: value, box: inlineBox && Number.isFinite(quantity) ? String(roundBox(quantity / inlineBox.amount)) : inline.box })
                }}
                onEnter={confirmInline}
              />
              <span className="col-span-1 pb-[8px] text-[13px] text-[#333]">{inlineProduct ? t(inlineProduct.unit || "шт.") : ""}</span>
              <FloatField className="col-span-3" label={t("Сумма за ед")} value={inline.unitPrice} onChange={(value) => setInline({ ...inline, unitPrice: value })} onEnter={confirmInline} />
              <div className="col-span-1 flex justify-center pb-1">
                <button type="button" onClick={confirmInline} aria-label={t("Добавить")} className="text-[#4f6fe0]"><Check className="h-6 w-6" /></button>
              </div>
            </div>
          )}

          {fieldErrors.products && <div className="mt-[10px] rounded-[2px] bg-[#ffebee] px-[15px] py-[10px] text-center text-[13px] text-[#f44336]">{fieldErrors.products}</div>}

          {items.length === 0 ? (
            <div className="mt-[22px] flex flex-col items-center text-center text-[13px] leading-[18px] text-slate-400">
              <img src="/empty-basket.svg" alt="" className="mb-[22px] h-[72px] w-[72px]" />
              {ready ? (
                <p>
                  {t("Вы еще не выбрали ни одного товара.")}<br />
                  <button type="button" onClick={openInline} className="text-[#0a9bd9]">{t("Добавить")}</button> {t("товар?")}
                </p>
              ) : (
                <p>{t("Для добавления товаров,")}<br />{t("выберите тип оплаты, валюту и прайс лист")}</p>
              )}
            </div>
          ) : (
            <div className="mt-[23.5px] text-[13px]">
              <div className="grid h-10 items-center text-[12px] font-semibold" style={{ gridTemplateColumns: gridColumns }}>
                <span className="px-[5px]">{t("Наименование")}</span>
                {hasBoxes && <span className="pl-[5px]">{t("Группа")}</span>}
                <span className="pl-[5px]">{t("Кол-во")}</span>
                <span className="pl-[5px]">{t("На складе")}</span>
                <span className="pl-[5px]">{t("Цена")}({currency})</span>
                <span className="pl-[5px]">{t("Всего")}({currency})</span>
                <span className="pr-[10px] text-right">
                  <button type="button" onClick={() => { setRowEdit(null); setItems([]) }} aria-label={t("Очистить все товары")} title={t("Очистить все товары")}>
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="#666" aria-hidden><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                  </button>
                </span>
              </div>
              {items.map((item, index) => {
                const editingRow = rowEdit?.index === index
                const unit = item.unit || "шт."
                const left = stockOf(item)
                const box = boxOf(item)
                const editInput = "mr-4 w-[calc(100%-16px)] border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold outline-none placeholder:font-normal placeholder:text-[#999]"
                return (
                  <div key={item.id ?? item.productId ?? item.productName} className="grid h-10 items-center" style={{ gridTemplateColumns: gridColumns }}>
                    <span className="truncate px-[5px]"><b className="mr-[5px] font-semibold">{index + 1}.</b>{item.productName}</span>
                    {hasBoxes && (
                      editingRow ? (
                        box ? (
                          <input
                            autoFocus
                            inputMode="decimal"
                            value={rowEdit.box}
                            placeholder={num(roundBox(item.quantity / box.amount))}
                            onChange={(event) => {
                              const boxes = parseNum(event.target.value)
                              setRowEdit({ ...rowEdit, box: event.target.value, quantity: Number.isFinite(boxes) ? String(roundBox(boxes * box.amount)) : rowEdit.quantity })
                            }}
                            className={editInput}
                          />
                        ) : <span />
                      ) : (
                        <span className="pl-[5px]">{box ? boxLabel(item.quantity, box.amount, box.unit, t) : ""}</span>
                      )
                    )}
                    {editingRow ? (
                      <>
                        <input
                          autoFocus={!box}
                          inputMode="decimal"
                          value={rowEdit.quantity}
                          placeholder={`${num(item.quantity)} ${t(unit)}`}
                          onChange={(event) => {
                            const quantity = parseNum(event.target.value)
                            setRowEdit({ ...rowEdit, quantity: event.target.value, box: box && Number.isFinite(quantity) ? String(roundBox(quantity / box.amount)) : rowEdit.box })
                          }}
                          className={editInput}
                        />
                        <span className="pl-[5px]">{left === undefined ? "" : `${num(left)} ${t(unit)}`}</span>
                        <input inputMode="decimal" value={rowEdit.unitPrice} placeholder={num(item.unitPrice)} onChange={(event) => setRowEdit({ ...rowEdit, unitPrice: event.target.value })} className={`${editInput} text-right`} />
                      </>
                    ) : (
                      <>
                        <span className={`pl-[5px] ${left !== undefined && left < item.quantity ? "text-[#f44336]" : ""}`}>{num(item.quantity)} {t(unit)}</span>
                        <span className="pl-[5px]">{left === undefined ? "" : `${num(left)} ${t(unit)}`}</span>
                        <span className="pl-[5px]">{num(item.unitPrice, 8)}</span>
                      </>
                    )}
                    <span className="pl-[5px]">{num(item.quantity * item.unitPrice, 8)}</span>
                    <span className="flex items-center justify-end gap-[10px] pr-[10px]">
                      {editingRow ? (
                        <button
                          type="button"
                          aria-label={t("Сохранить")}
                          onClick={() => {
                            // Linko handleEdit: an empty input keeps the line's value.
                            const quantity = parseNum(rowEdit.quantity)
                            const unitPrice = parseNum(rowEdit.unitPrice)
                            setItems((current) =>
                              current.map((row, i) => (i === index ? { ...row, quantity: quantity > 0 ? quantity : row.quantity, unitPrice: unitPrice >= 0 ? unitPrice : row.unitPrice } : row)),
                            )
                            setRowEdit(null)
                          }}
                          className="text-[#4f6fe0]"
                        >
                          <Check className="h-5 w-5" />
                        </button>
                      ) : (
                        <>
                          <button type="button" aria-label={t("Изменить")} onClick={() => setRowEdit({ index, box: "", quantity: "", unitPrice: "" })}>
                            <svg viewBox="0 0 24 24" className="h-[30px] w-[30px] p-[5px]" fill="#666" aria-hidden><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
                          </button>
                          <button type="button" onClick={() => { setRowEdit(null); setItems((current) => current.filter((_, i) => i !== index)) }} aria-label={t("Удалить")}>
                            <svg viewBox="0 0 24 24" className="h-[30px] w-[30px] p-[5px]" fill="#666" aria-hidden><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          </div>
        </section>
      </div>

      <footer className="flex h-[66px] shrink-0 items-center justify-between border-t border-[#efefef] pl-[30px] pr-[10px]">
        <div className="flex items-center gap-6 text-[16px]">
          <span>{t("Общая сумма заказа:")} <b>{num(total)}{currency ? ` ${currency}` : ""}</b></span>
          <span>{t("Общее кол-во:")} <b>{totalQty}</b></span>
          {error && <span className="text-[13px] text-red-500">{error}</span>}
        </div>
        <button type="button" onClick={() => setConfirmOpen(true)} disabled={saving} className="h-9 min-w-[88px] disabled:opacity-50">
          <span className="inline-block px-[15px] py-[9px] text-[13px] font-semibold uppercase leading-[18px] text-[#129fdd]">{t(editing ? "Изменить заказ" : "Оформить заказ")}</span>
        </button>
      </footer>

      {confirmOpen && (
        <Modal title={t("Выполнить")} onClose={() => setConfirmOpen(false)}>
          <div className="min-h-[210px] px-[30px]">
            <div className="py-5 text-[13px] leading-[16.3px]">{t("Подтверждение запроса")}</div>
            <div className="-mx-[30px] bg-[#f1f5f8] px-[30px] py-5 text-[13px] font-semibold leading-[16.3px]">{t(editing ? "Изменить заказ" : "Оформить заказ")}</div>
          </div>
          <div className="flex justify-end border-t border-[#efefef] p-[10px]">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setConfirmOpen(false)
                void save()
              }}
              className="h-9 min-w-[88px] px-4 text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50"
            >
              {t("Да")}
            </button>
          </div>
        </Modal>
      )}

      {exitOpen && (
        <Modal title={t("Подтверждение отмены")} onClose={() => setExitOpen(false)}>
          <div className="mt-[40px] bg-[#f1f4f7] px-[30px] py-[14px] text-[13px] font-semibold">{t("Подтвердите выход (Esc), или (Alt + Enter) чтобы продолжить")}</div>
          <div className="h-[114px]" />
          <div className="flex justify-end border-t border-slate-200 px-[30px] py-5">
            <button type="button" onClick={onClose} className="text-[13px] font-bold uppercase text-[#0a9bd9]">{t("Да")}</button>
          </div>
        </Modal>
      )}

      {pickerOpen && (
        <ProductPicker
          products={sellable}
          currency={currency}
          priceOf={(product) => priceOf(product)}
          stockOf={productStock}
          onClose={() => setPickerOpen(false)}
          onSave={(rows) => {
            if (rows.length) addItems(rows.map((row) => lineOf(row.product, row.quantity, row.unitPrice)))
            setPickerOpen(false)
          }}
        />
      )}
     </div>
    </div>,
    document.body,
  )
}

function Modal({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[1701] flex items-center justify-center bg-black/50">
      <div className="w-[500px] bg-white shadow-xl">
        {title && (
          <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
            <h3 className="text-[13px] font-bold uppercase">{title}</h3>
            <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#666]"><X className="h-6 w-6" /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

/** Linko's order Excel block: «1. Загрузить шаблон», «2. Заполните excel и загрузите» (then «2. Сменить файл»
 * and the file name), «3. Подтвердить» once a file is chosen. */
function ExcelSteps({ canDownload, onDownload, onConfirm }: { canDownload: boolean; onDownload: () => void; onConfirm: (file: File) => void }) {
  const { t } = useLanguage()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const step = "h-9 rounded-[2px] px-4 text-[13px] uppercase text-[#333] hover:bg-[#f2f2f2] disabled:cursor-default disabled:text-[#bdbdbd] disabled:hover:bg-transparent"
  return (
    <div className="mt-[10px] flex flex-wrap items-center justify-between border border-[#efefef] py-[5px]">
      <button type="button" disabled={!canDownload} onClick={onDownload} className={step}>1. {t("Загрузить шаблон")}</button>
      <div className="flex items-center">
        <button type="button" onClick={() => input.current?.click()} className={step}>2. {t(file ? "Сменить файл" : "Заполните excel и загрузите")}</button>
        {file && <span className="mr-4 max-w-[220px] truncate text-[13px] text-[#586174]">{file.name}</span>}
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(event) => {
            const picked = event.target.files?.[0]
            event.target.value = ""
            if (picked) setFile(picked)
          }}
        />
      </div>
      <button type="button" disabled={!file} onClick={() => file && onConfirm(file)} className={step}>3. {t("Подтвердить")}</button>
    </div>
  )
}

const PICKER_PAGE_SIZES = [25, 50, 100]

/** «Добавление продуктов» of «добавить из списка» (Linko's AddProductDialog with its product rows): type / brand
 * filters, a search sent with Enter or the magnifier, 50 rows a page with arrows; per row Группа (boxes) /
 * Кол-во / Цена (the list price, editable) / Сумма / Код / В наличии (the chosen warehouse). */
export function ProductPicker({
  products,
  currency,
  priceOf,
  stockOf,
  onClose,
  onSave,
}: {
  products: ProductRow[] | null
  currency: string
  priceOf: (product: ProductRow) => number
  stockOf: (product: ProductRow) => number
  onClose: () => void
  onSave: (rows: Array<{ product: ProductRow; quantity: number; unitPrice: number }>) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState("")
  const [query, setQuery] = useState("")
  const [type, setType] = useState("")
  const [brand, setBrand] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [values, setValues] = useState<Record<number, { box: string; quantity: string; price: string }>>({})
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const distinct = (list: Array<string | undefined>) => [...new Set(list.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "ru"))
  const types = useMemo(() => distinct((products ?? []).map((row) => row.type)), [products])
  const brands = useMemo(() => distinct((products ?? []).map((row) => row.brand)), [products])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (products ?? []).filter(
      (row) => (!type || row.type === type) && (!brand || row.brand === brand) && (!needle || `${row.name} ${row.article ?? ""}`.toLowerCase().includes(needle)),
    )
  }, [products, query, type, brand])
  const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, lastPage)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)
  const hasBox = visible.some((row) => (row.boxAmount ?? 0) > 0)
  const from = filtered.length ? (current - 1) * pageSize + 1 : 0
  const to = Math.min(current * pageSize, filtered.length)

  // The list price prefilled as Linko prints it (spaced thousands, decimal comma).
  const initialValue = (product: ProductRow) => ({ box: "", quantity: "", price: num(priceOf(product), 8) })
  const valueOf = (product: ProductRow) => values[product.id] ?? initialValue(product)
  const setValue = (product: ProductRow, patch: Partial<{ box: string; quantity: string; price: string }>) =>
    setValues((currentValues) => ({ ...currentValues, [product.id]: { ...(currentValues[product.id] ?? initialValue(product)), ...patch } }))

  function save() {
    const rows: Array<{ product: ProductRow; quantity: number; unitPrice: number }> = []
    for (const product of products ?? []) {
      const value = values[product.id]
      const quantity = value ? parseNum(value.quantity) : Number.NaN
      if (!(quantity > 0)) continue
      const price = parseNum(value.price)
      rows.push({ product, quantity, unitPrice: Number.isFinite(price) && price >= 0 ? price : priceOf(product) })
    }
    onSave(rows)
  }

  const box = "h-[42px] w-full rounded-[2px] border border-[#e8edf2] bg-[#f4f8fb] px-[10px] text-right text-[13px] outline-none focus:border-[#4f6fe0]"
  const columns = hasBox ? "2fr 2fr 2fr 2fr 1fr 1fr 1fr" : "4fr 2fr 2fr 2fr 2fr"
  return (
    <div className="fixed inset-0 z-[1501] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[48px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
        <h2 className="text-[13px] font-bold uppercase">{t("Добавление продуктов")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#666]"><X className="h-6 w-6" /></button>
      </header>
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-6 border-b border-[#efefef] px-[30px] py-[6px]">
        <div className="flex items-end gap-6">
          <div className="w-[220px]"><SelectField label={t("Фильтр по типу")} placeholderLabel flat searchable value={type} onChange={(value) => { setType(value); setPage(1) }} options={types.map((row) => ({ value: row, label: row }))} onClear={() => setType("")} /></div>
          <div className="w-[220px]"><SelectField label={t("Фильтр по бренду")} placeholderLabel flat searchable value={brand} onChange={(value) => { setBrand(value); setPage(1) }} options={brands.map((row) => ({ value: row, label: row }))} onClear={() => setBrand("")} /></div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setQuery(draft)
            setPage(1)
          }}
          className="relative w-[280px]"
        >
          <input ref={searchRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`${t("Поиск товаров")}...`} aria-label={t("Поиск товаров")} className="h-[42px] w-full rounded-[2px] border border-[#e8edf2] bg-[#f4f8fb] pl-[10px] pr-10 text-[13px] outline-none" />
          <button type="submit" aria-label={t("Поиск")} className="absolute right-0 top-0 flex h-[42px] w-10 items-center justify-center text-[#bac6ce]"><Search className="h-5 w-5" /></button>
        </form>
        <div className="flex items-center justify-end gap-5 text-[13px] text-[#333]">
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} aria-label={t("Строк на странице")} className="bg-transparent outline-none">
            {PICKER_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          <span>{from} - {to} {t("из")} {filtered.length}</span>
          <span className="flex items-center gap-1">
            <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label={t("Назад")} className="flex h-6 w-6 items-center justify-center rounded-full border border-[#333] disabled:border-[#ccc] disabled:text-[#ccc]"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" disabled={current >= lastPage} onClick={() => setPage(current + 1)} aria-label={t("Вперед")} className="flex h-6 w-6 items-center justify-center rounded-full border border-[#333] disabled:border-[#ccc] disabled:text-[#ccc]"><ChevronRight className="h-4 w-4" /></button>
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!products ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#4f6fe0]" /></div>
        ) : visible.length === 0 ? (
          <p className="mt-24 text-center text-[13px] text-slate-400">{t("По вашему запросу ничего не найдено")}...</p>
        ) : (
          <>
            <div className="sticky top-0 z-[1] grid h-[50px] items-center gap-x-4 border-b border-[#efefef] bg-white px-[30px] font-semibold" style={{ gridTemplateColumns: columns }}>
              <span>{t("Наименование")}</span>
              {hasBox && <span>{t("Группа")}</span>}
              <span>{t("Кол-во")}</span>
              <span>{t("Цена")}</span>
              {hasBox && <span className="text-right">{t("Сумма")}</span>}
              <span className={hasBox ? "text-right" : "text-center"}>{t("Код")}</span>
              <span className={hasBox ? "text-right" : ""}>{t("В наличии")}</span>
            </div>
            <div>
            {visible.map((product) => {
              const value = valueOf(product)
              const unit = t(product.unit || "шт.")
              const productBox = (product.boxAmount ?? 0) > 0 ? product.boxAmount! : 0
              const sum = (parseNum(value.quantity) || 0) * (parseNum(value.price) || 0)
              return (
                <div key={product.id} className="grid min-h-[53px] items-center gap-x-4 border-b border-[#efefef] px-[30px] odd:bg-[#F4F8FB]" style={{ gridTemplateColumns: columns }}>
                  <span>{product.name}</span>
                  {hasBox && (
                    <span className="flex items-center gap-[10px]">
                      {productBox > 0 && (
                        <>
                          <input
                            inputMode="decimal"
                            value={value.box}
                            aria-label={`${t("Группа")}: ${product.name}`}
                            onChange={(event) => {
                              const boxes = parseNum(event.target.value)
                              setValue(product, { box: event.target.value, quantity: Number.isFinite(boxes) ? String(roundBox(boxes * productBox)) : value.quantity })
                            }}
                            className={box}
                          />
                          <span className="whitespace-nowrap">{t(product.boxUnit || "Группа")} ({num(productBox)} {unit})</span>
                        </>
                      )}
                    </span>
                  )}
                  <span className="flex items-center gap-[10px]">
                    <input
                      inputMode="decimal"
                      value={value.quantity}
                      aria-label={`${t("Кол-во")}: ${product.name}`}
                      onChange={(event) => {
                        const quantity = parseNum(event.target.value)
                        setValue(product, { quantity: event.target.value, box: productBox && Number.isFinite(quantity) ? String(roundBox(quantity / productBox)) : value.box })
                      }}
                      className={box}
                    />
                    <span className="whitespace-nowrap">{unit}</span>
                  </span>
                  <span className="flex items-center gap-[10px]">
                    <input inputMode="decimal" value={value.price} aria-label={`${t("Цена")}: ${product.name}`} onChange={(event) => setValue(product, { price: event.target.value })} className={box} />
                    <span className="whitespace-nowrap">{currency}</span>
                  </span>
                  {hasBox && <span className="whitespace-nowrap text-right font-semibold">{num(sum)} <span className="ml-[10px]">{currency}</span></span>}
                  <span className={hasBox ? "text-right" : "text-center"}>{product.article || "-"}</span>
                  <span className={`whitespace-nowrap ${hasBox ? "text-right" : ""}`}>{num(stockOf(product))} {unit}</span>
                </div>
              )
            })}
            </div>
          </>
        )}
      </div>
      <footer className="flex h-[56px] shrink-0 items-center justify-end border-t border-[#efefef] px-[30px]">
        <button type="button" onClick={save} className="text-[13px] font-bold uppercase text-[#0a9bd9]">{t("Сохранить")}</button>
      </footer>
    </div>
  )
}

const BOX_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const BOX_CHECKED = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

export function Checkbox({ checked, onChange, className }: { checked: boolean; onChange: (value: boolean) => void; className?: string }) {
  return (
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center ${className ?? ""}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <path d={checked ? BOX_CHECKED : BOX_EMPTY} fill={checked ? "#129fdd" : "#666"} />
      </svg>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
    </span>
  )
}

export function SelectField({
  label,
  required,
  value,
  onChange,
  options,
  onClear,
  loading,
  placeholderLabel,
  flat,
  searchable,
  searchOnly,
  limit,
  error,
  buttonRef,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
  options: Option[]
  onClear?: () => void
  loading?: boolean
  /** Label sits inside the field (bold) while empty, and floats above once a value is chosen. */
  placeholderLabel?: boolean
  flat?: boolean
  /** Typing filters the options (Linko's react-select). */
  searchable?: boolean
  /** With `searchable`: the menu opens only once something is typed (Linko's async selects, e.g. the client). */
  searchOnly?: boolean
  /** Most options the menu shows at once (Linko pages its selects by 50). */
  limit?: number
  /** Linko's field error: red underline and the message under the field. */
  error?: string
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((row) => row.value === value) ?? (value ? { value, label: value } : undefined)

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const typing = Boolean(searchable && open)
  const needle = searchable ? query.trim().toLowerCase() : ""
  const matched = needle ? options.filter((row) => row.label.toLowerCase().includes(needle)) : options
  const shown = limit ? matched.slice(0, limit) : matched
  const menuOpen = open && (!searchOnly || Boolean(needle))
  const floating = !placeholderLabel || Boolean(selected) || typing

  function pick(row: Option) {
    onChange(row.value)
    setOpen(false)
    setQuery("")
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
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
      // Closes the menu only: the dialog's own Esc (exit confirmation) must not fire.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setQuery("")
    } else if (event.key === "Tab") {
      setOpen(false)
      setQuery("")
    }
  }

  const line = error ? "border-b-2 border-[#f44336]" : "border-b border-[#e0e0e0]"
  return (
    <div ref={rootRef} className={`relative ${flat ? "" : "mt-[8px]"}`}>
      <span className={`block h-[13px] text-[9.75px] font-semibold leading-[12.2px] text-black ${floating ? "" : "invisible"}`}>
        {label}{required && <span className="text-[13px] font-normal text-red-500"> *</span>}
      </span>
      {typing ? (
        <div className={`relative flex h-[41px] w-full items-center pr-14 pt-[3px] text-[13px] font-semibold text-[#333] ${line}`}>
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={selected?.label ?? ""}
            aria-label={label}
            className="w-full bg-transparent font-semibold outline-none placeholder:font-semibold placeholder:text-[#333]"
          />
          <span className="absolute right-0 top-[11px] flex items-center text-[#999]">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <svg viewBox="0 0 10 7" className="mr-[10px] h-[7px] w-[10px]" aria-hidden><path d="M0 7h10L5 0z" fill="#999" /></svg>
          </span>
        </div>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            setOpen((current) => !current)
            setQuery("")
            setActive(0)
          }}
          className={`relative flex h-[41px] w-full items-center pr-14 pt-[3px] text-left text-[13px] font-semibold text-[#333] ${line}`}
        >
          {selected ? <span className="truncate">{selected.label}</span> : placeholderLabel ? <span className="font-semibold text-black">{label}{required && <span className="text-red-500"> *</span>}</span> : null}
          <span className="absolute right-0 top-[11px] flex items-center text-[#999]">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {selected && onClear && (
              <span role="button" aria-label={t("Очистить")} onClick={(event) => { event.stopPropagation(); onClear() }} className="mr-[10px] text-[18px] leading-[18px] hover:text-slate-700">×</span>
            )}
            <svg viewBox="0 0 10 7" className="mr-[10px] h-[7px] w-[10px]" aria-hidden><path d={open ? "M0 7h10L5 0z" : "M0 0h10L5 7z"} fill="#999" /></svg>
          </span>
        </button>
      )}
      {error && <span className="block pt-[2px] text-[12px] leading-[15px] text-[#f44336]">{error}</span>}
      {menuOpen && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-60 overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-[13px] font-semibold text-slate-400">{loading ? t("Загрузка...") : searchable && needle ? t("Не найдено") : "—"}</li>
          ) : (
            shown.map((row, index) => (
              <li key={`${row.value}-${index}`}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(row)}
                  className={`block w-full px-3 py-2 text-left text-[13px] font-semibold ${row.value === value || (typing && index === active) ? "bg-[#e3effd] text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  {row.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

export function DateField({ label, required, value, onChange, first }: { label: string; required?: boolean; value: string; onChange: (value: string) => void; first?: boolean }) {
  const { t } = useLanguage()
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  return (
    <div className={`pb-[12px] ${first ? "mt-0" : "mt-[8px]"}`}>
      <span className="block h-[13px] text-[9.75px] font-semibold leading-[12.2px] text-black">
        {label}{required && <span className="text-[13px] font-normal text-red-500"> *</span>}
      </span>
      <button
        type="button"
        aria-label={label}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setAnchor({ left: rect.left, top: rect.bottom + 9 })
        }}
        className="relative flex h-[27.5px] w-full cursor-pointer items-end border-b border-[#e0e0e0] text-left text-[13px] leading-[19.5px] text-[#333]"
      >
        <span>{t(formatDate(value))}</span>
        <Calendar className="absolute right-[3px] top-[4px] h-4 w-4 text-[#ccc]" />
      </button>
      {anchor && <DatePickerDialog anchor={anchor} value={value} onCancel={() => setAnchor(null)} onPick={(next) => { onChange(next); setAnchor(null) }} />}
    </div>
  )
}

/** Linko's inline text field: the label is a bold placeholder while empty and floats above once filled; Enter adds the line. */
function FloatField({ label, value, onChange, onEnter, className }: { label: string; value: string; onChange: (value: string) => void; onEnter?: () => void; className?: string }) {
  return (
    <div className={className}>
      <span className={`block h-[13px] text-[9.75px] font-semibold leading-[12.2px] text-black ${value === "" ? "invisible" : ""}`}>{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            onEnter?.()
          }
        }}
        placeholder={label}
        aria-label={label}
        className="h-[34px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] font-semibold outline-none placeholder:font-semibold placeholder:text-black"
      />
    </div>
  )
}

export function FlatInput({ label, value, onChange, className, type = "text" }: { label: string; value: string; onChange: (value: string) => void; className?: string; type?: string }) {
  return (
    <div className={className}>
      <input
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="h-[34px] w-full border-b border-slate-300 bg-transparent text-[13px] font-semibold outline-none placeholder:text-slate-800"
      />
    </div>
  )
}
