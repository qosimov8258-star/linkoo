"use client"

import { Calendar, Check, ChevronDown, ChevronUp, Loader2, X } from "lucide-react"
import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { formatUnitTotals } from "@/components/analytics/internal-transfers-picker"
import { readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"

import { useAllowedProductIds, useAllowedRows } from "./allowed-products"
import { orderApiErrorText, type AgentLimitExceeded, type Order, type ProductRestrictionRefusal } from "./orders-data"

type Option = { value: string; label: string }
type ShopRow = { id: number; name: string; agent?: string; deliverer?: string; zone?: string; type?: string }
type ProductRow = {
  id: number
  name: string
  type?: string
  brand?: string
  unit?: string
  canSell?: boolean
  deleted?: boolean
  priceLists?: { name: string; cash?: number; nonCash?: number; currency?: string; nonCashCurrency?: string }[]
}
type LineItem = { productId: number; productName: string; unit: string; quantity: number; unitPrice: number }
/** GET /api/orders/defaults (lib/orders-repo.ts getOrderDefaults). */
type OrderDefaults = { agent: string; priceList: string; warehouse: string; organization: string }

const paymentTypes = ["Наличные", "Перечисление"]
const deliveryTypes = ["Самовывоз", "Доставка"]

export function toInputDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatDate(value: string) {
  if (!value) return ""
  return new Date(`${value}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
}

function money(value: number) {
  return (Math.round(value * 100) / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

export function AddOrderDialog({
  initialShopId,
  onClose,
  onCreated,
}: {
  initialShopId?: number
  onClose: () => void
  onCreated: (order: Order) => void
}) {
  const { t } = useLanguage()
  const today = useMemo(() => new Date(), [])
  const tomorrow = useMemo(() => new Date(today.getTime() + 24 * 60 * 60 * 1000), [today])

  const [shops, setShops] = useState<ShopRow[] | null>(null)
  const [agents, setAgents] = useState<string[] | null>(null)
  const [warehouses, setWarehouses] = useState<string[] | null>(null)
  const [priceLists, setPriceLists] = useState<string[] | null>(null)
  const [currencies, setCurrencies] = useState<string[] | null>(null)
  const [products, setProducts] = useState<ProductRow[] | null>(null)
  const [organizations, setOrganizations] = useState<string[] | null>(null)

  const [shopId, setShopId] = useState(initialShopId ? String(initialShopId) : "")
  const [date, setDate] = useState(toInputDate(today))
  const [prize, setPrize] = useState(false)
  const [paymentType, setPaymentType] = useState("")
  const [currency, setCurrency] = useState("")
  const [priceList, setPriceList] = useState("")
  const [agent, setAgent] = useState("")
  // Ограничение продуктов: an agent with a product / type list is offered only those products.
  const sellable = useAllowedRows(products, useAllowedProductIds(agent))
  const [organization, setOrganization] = useState("")
  const [lastPayDate, setLastPayDate] = useState(toInputDate(tomorrow))
  const [terms, setTerms] = useState<"standard" | "consignment">("standard")
  const [warehouse, setWarehouse] = useState("")
  const [deliveryType, setDeliveryType] = useState("Доставка")
  const [deliverer, setDeliverer] = useState("")
  const [deliveryDate, setDeliveryDate] = useState(toInputDate(tomorrow))
  const [confirmed, setConfirmed] = useState(true)
  const [noBonus, setNoBonus] = useState(Boolean(initialShopId))
  const [autoDiscounts, setAutoDiscounts] = useState(false)
  const [comment, setComment] = useState("")

  const [items, setItems] = useState<LineItem[]>([])
  const [inlineOpen, setInlineOpen] = useState(false)
  const [inline, setInline] = useState({ product: "", quantity: "", unitPrice: "" })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [repriceOpen, setRepriceOpen] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const importRef = useRef<HTMLInputElement>(null)
  // Fields the user chose by hand keep their value; the others follow the client (applyDefaults).
  const touched = useRef({ agent: false, priceList: false, warehouse: false, organization: false })
  const hasItems = useRef(false)
  const defaultsRequest = useRef(0)

  /** Defaults of the server (GET /api/orders/defaults) for the client: its agent, the price
   * list marked "default for orders" (else the client's branch list), the branch's single
   * sales warehouse (else none) and the organization of its contracts / agent / warehouse.
   * Without a client: no agent and no warehouse. Hand-picked fields are kept; the price
   * list never changes under lines already added. */
  const applyDefaults = useCallback((next: { shopId: string; agent?: string; warehouse?: string }) => {
    const request = ++defaultsRequest.current
    const params = new URLSearchParams()
    if (next.shopId) params.set("clientId", next.shopId)
    if (next.agent !== undefined) params.set("agent", next.agent)
    if (next.warehouse !== undefined) params.set("warehouse", next.warehouse)
    void fetch(`/api/orders/defaults?${params}`)
      .then((response) => (response.ok ? (response.json() as Promise<OrderDefaults>) : null))
      .catch(() => null)
      .then((defaults) => {
        if (!defaults || request !== defaultsRequest.current) return
        if (!touched.current.agent) setAgent(defaults.agent)
        if (!touched.current.warehouse) setWarehouse(defaults.warehouse)
        if (!touched.current.priceList && !hasItems.current && defaults.priceList) setPriceList(defaults.priceList)
        if (!touched.current.organization) setOrganization(defaults.organization)
      })
  }, [])

  useEffect(() => {
    const load = (url: string) => fetch(url).then((response) => (response.ok ? response.json() : []))
    load("/api/clients?balances=0").then((rows: ShopRow[]) => setShops(rows))
    load("/api/employees").then((rows: { firstName: string; lastName: string }[]) => setAgents(rows.map((row) => `${row.firstName} ${row.lastName}`.trim())))
    load("/api/warehouses").then((rows: { name: string }[]) => setWarehouses(rows.map((row) => row.name)))
    load("/api/price-lists").then((rows: { name: string }[]) => setPriceLists(rows.map((row) => row.name)))
    load("/api/currencies").then((rows: { code: string }[]) => setCurrencies(rows.map((row) => row.code)))
    load("/api/organizations").then((rows: { name: string }[]) => setOrganizations(rows.map((row) => row.name).filter(Boolean)))
    // Only products that can be sold (the API refuses the others).
    load("/api/products").then((rows: ProductRow[]) => setProducts(rows.filter((row) => row.canSell !== false && !row.deleted)))
    applyDefaults({ shopId: initialShopId ? String(initialShopId) : "" })
  }, [applyDefaults, initialShopId])

  useEffect(() => {
    hasItems.current = items.length > 0
  }, [items])

  function chooseShop(value: string) {
    setShopId(value)
    applyDefaults({ shopId: value, agent: touched.current.agent ? agent : undefined, warehouse: touched.current.warehouse ? warehouse : undefined })
  }

  function chooseAgent(value: string) {
    touched.current.agent = true
    setAgent(value)
    // The organization may follow the agent (its single organization).
    if (!touched.current.organization) applyDefaults({ shopId, agent: value, warehouse: touched.current.warehouse ? warehouse : undefined })
  }

  function chooseWarehouse(value: string) {
    touched.current.warehouse = true
    setWarehouse(value)
    if (!touched.current.organization) applyDefaults({ shopId, agent: touched.current.agent ? agent : undefined, warehouse: value })
  }

  function chooseOrganization(value: string) {
    touched.current.organization = true
    setOrganization(value)
  }

  const shop = shops?.find((row) => String(row.id) === shopId)
  // Price lists come from the directory plus any named on products, so the picker is never empty when prices exist.
  const allPriceLists = useMemo(() => {
    if (!priceLists || !products) return null
    return Array.from(new Set([...priceLists, ...products.flatMap((row) => (row.priceLists ?? []).map((entry) => entry.name))]))
  }, [priceLists, products])

  // Currency: SUM (else the first one). Agent, price list, warehouse and organization come
  // from applyDefaults: nothing is guessed before the client is chosen.
  useEffect(() => {
    if (currencies?.length && !currency) setCurrency(currencies.includes("SUM") ? "SUM" : currencies[0])
  }, [currencies, currency])
  // The client's own deliverer is the default "Доставщик" of its orders.
  useEffect(() => {
    if (deliverer || !shop?.deliverer || shop.deliverer === "Не указано") return
    if (agents?.includes(shop.deliverer)) setDeliverer(shop.deliverer)
  }, [shop, agents, deliverer])

  // Esc asks for confirmation first; a second Esc leaves, Alt+Enter keeps working.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        if (pickerOpen) setPickerOpen(false)
        else if (exitOpen) onClose()
        else setExitOpen(true)
      } else if (event.key === "Enter" && event.altKey && exitOpen) {
        event.preventDefault()
        setExitOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [exitOpen, pickerOpen, onClose])

  const ready = Boolean(paymentType && currency && (priceList || !allPriceLists?.length))
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  // Quantities are totalled per unit (never one sum over kg and pieces).
  const totalQty = formatUnitTotals(items.map((item) => ({ qty: item.quantity, unit: item.unit })), t)

  // A price list price is used only in the order currency (a SUM price is not a USD price).
  function priceOf(product: ProductRow, list = priceList, type = paymentType, inCurrency = currency) {
    const entry = product.priceLists?.find((row) => row.name === list)
    if (!entry) return 0
    const nonCash = type === "Перечисление"
    const entryCurrency = (nonCash ? entry.nonCashCurrency || entry.currency : entry.currency) || "SUM"
    if (inCurrency && entryCurrency.toUpperCase() !== inCurrency.toUpperCase()) return 0
    return (nonCash ? entry.nonCash : entry.cash) ?? 0
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
    if (items.length) {
      setItems((current) =>
        current.map((item) => {
          const product = products?.find((row) => row.id === item.productId)
          return product ? { ...item, unitPrice: priceOf(product, nextList, nextType, nextCurrency) } : item
        }),
      )
      setRepriceOpen(true)
    }
  }

  function addItems(rows: LineItem[]) {
    setItems((current) => {
      const merged = [...current]
      for (const row of rows) {
        const index = merged.findIndex((item) => item.productId === row.productId)
        if (index >= 0) merged[index] = { ...merged[index], quantity: merged[index].quantity + row.quantity }
        else merged.push(row)
      }
      return merged
    })
  }

  function confirmInline() {
    const quantity = Number(inline.quantity)
    const unitPrice = Number(inline.unitPrice)
    if (!inline.product || !(quantity > 0) || !(unitPrice >= 0)) return
    const product = products?.find((row) => String(row.id) === inline.product)
    if (!product) return
    addItems([{ productId: product.id, productName: product.name, unit: product.unit || "шт.", quantity, unitPrice }])
    setInline({ product: "", quantity: "", unitPrice: "" })
    setInlineOpen(false)
  }

  function importItems(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    void (async () => {
      const rows = await readExcelRows(file)
      const key = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ")
      const byName = new Map((sellable ?? []).map((product) => [key(product.name), product]))
      const unknown: string[] = []
      const parsed: LineItem[] = []
      for (const [name, quantity, price] of rows) {
        const productName = (name ?? "").trim()
        const qty = Number(quantity)
        const unitPrice = Number(price)
        if (!productName || !(qty > 0) || !Number.isFinite(unitPrice) || unitPrice < 0) continue
        const product = byName.get(key(productName))
        if (!product) {
          unknown.push(productName)
          continue
        }
        parsed.push({ productId: product.id, productName: product.name, unit: product.unit || "шт.", quantity: qty, unitPrice })
      }
      if (parsed.length) addItems(parsed)
      if (unknown.length) setError(`${t("Товары не найдены в каталоге")}: ${unknown.slice(0, 5).join(", ")}`)
    })()
  }

  async function save() {
    setError("")
    if (!shop) return setError(t("Выберите клиента"))
    if (!paymentType) return setError(t("Выберите тип оплаты"))
    if (!agent) return setError(t("Выберите агента"))
    if (organizations?.length && !organization) return setError(t("Выберите организацию"))
    if (!warehouse) return setError(t("Выберите склад"))
    if (!currency) return setError(t("Выберите валюту"))
    if (!items.length) return setError(t("Вы еще не выбрали ни одного товара."))
    setSaving(true)
    try {
      // One request: the order and its lines are saved together (all or nothing),
      // in the chosen currency and warehouse; the server checks stock.
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: shop.id,
          zone: shop.zone,
          type: shop.type,
          priceList,
          agent,
          organization: organization || undefined,
          currency,
          warehouse,
          deliveryMan: deliverer || undefined,
          delivery: deliveryDate,
          paymentDate: lastPayDate,
          paymentType: paymentType === "Наличные" ? "cash" : paymentType === "Перечисление" ? "bank" : "",
          deliveryType,
          dealType: terms,
          comment: comment.trim() || undefined,
          status: confirmed ? "Есть на складе" : "Не подтвержден",
          items: items.map((item) => ({ productId: item.productId, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, currency })),
        }),
      })
      const body = (await response.json().catch(() => null)) as (Order & { error?: string; agentLimit?: AgentLimitExceeded; productRestriction?: ProductRestrictionRefusal }) | null
      if (!response.ok || !body) throw new Error(orderApiErrorText(body, t, "Не удалось создать заказ"))
      onCreated(body)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("Не удалось создать заказ"))
      setSaving(false)
    }
  }

  const link = "text-[13px] text-[#4f6fe0] hover:underline"

  // Rendered in a portal so it is never clipped or stacked under the client drawer it is opened from.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-white text-slate-800">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-slate-200 pl-[30px] pr-[22px]">
        <h2 className="text-[13px] font-bold uppercase">{t("Добавление заказа")}</h2>
        <button type="button" onClick={() => setExitOpen(true)} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800">
          <X className="h-6 w-6" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[280px] shrink-0 overflow-y-auto border-r border-slate-200 px-[30px] pb-6 pt-[18px]">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold">{t("Выбор клиента")}</span>
            <button type="button" onClick={() => window.open("/clients", "_blank")} className={link}>+ {t("добавить")}</button>
          </div>

          <DateField label={t("Дата создания")} required value={date} onChange={setDate} first />
          <SelectField label={t("Название клиента")} required placeholderLabel value={shopId} onChange={chooseShop} loading={!shops} options={(shops ?? []).map((row) => ({ value: String(row.id), label: row.name }))} onClear={() => chooseShop("")} />

          <h3 className="mt-[14px] text-[13px] font-semibold">{t("Оплата")}</h3>
          <label className="mt-[20px] flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
            <Checkbox checked={prize} onChange={setPrize} />
            {t("Призовой заказ за балл")}
          </label>

          <div className="mt-[31px]">
            <SelectField label={t("Тип оплаты")} placeholderLabel value={paymentType} onChange={(value) => changePricing({ paymentType: value })} options={paymentTypes.map((row) => ({ value: row, label: t(row) }))} onClear={() => changePricing({ paymentType: "" })} />
          </div>
          <SelectField label={t("Валюта")} required value={currency} onChange={(value) => changePricing({ currency: value })} loading={!currencies} options={(currencies ?? []).map((row) => ({ value: row, label: row }))} onClear={() => changePricing({ currency: "" })} />
          <SelectField label={t("Прайс лист")} required value={priceList} onChange={(value) => changePricing({ priceList: value })} loading={!allPriceLists} options={(allPriceLists ?? []).map((row) => ({ value: row, label: row }))} onClear={() => changePricing({ priceList: "" })} />
          <SelectField label={t("Агент")} required value={agent} onChange={chooseAgent} loading={!agents} options={(agents ?? []).map((row) => ({ value: row, label: row }))} onClear={() => chooseAgent("")} />
          {(organizations === null || organizations.length > 0) && (
            <SelectField label={t("Организация")} required value={organization} onChange={chooseOrganization} loading={!organizations} options={(organizations ?? []).map((row) => ({ value: row, label: row }))} onClear={() => chooseOrganization("")} />
          )}
          <DateField label={t("Дата окончательной оплаты")} required value={lastPayDate} onChange={setLastPayDate} />

          <h3 className="mt-[22px] text-[13px] font-semibold">{t("Условия договора")}</h3>
          <div className="mt-3 space-y-3">
            {([["standard", "Стандартная"], ["consignment", "Консигнация"]] as const).map(([value, label]) => (
              <label key={value} className="flex cursor-pointer items-center gap-5 text-[13px]">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${terms === value ? "border-slate-500" : "border-slate-800"}`}>
                  {terms === value && <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />}
                </span>
                <input type="radio" name="terms" checked={terms === value} onChange={() => setTerms(value)} className="sr-only" />
                {t(label)}
              </label>
            ))}
          </div>
          <SelectField label={t("Склад")} required value={warehouse} onChange={chooseWarehouse} loading={!warehouses} options={(warehouses ?? []).map((row) => ({ value: row, label: row }))} onClear={() => chooseWarehouse("")} />

          <h3 className="mt-[22px] text-[13px] font-semibold">{t("Условия доставки")}</h3>
          <SelectField label={t("Тип доставки")} required value={deliveryType} onChange={setDeliveryType} options={deliveryTypes.map((row) => ({ value: row, label: t(row) }))} onClear={() => setDeliveryType("")} />
          <div className="mt-[22px]">
            <SelectField label={t("Доставщик")} placeholderLabel value={deliverer} onChange={setDeliverer} loading={!agents} options={(agents ?? []).map((row) => ({ value: row, label: row }))} onClear={() => setDeliverer("")} />
          </div>
          <DateField label={t("Дата доставки")} value={deliveryDate} onChange={setDeliveryDate} />

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

        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto px-[30px]">
          <div className="border-b-2 border-[#4f6fe0] py-[14px] text-center text-[13px]">{t("Товары")}</div>
          <div className="mt-[30px] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">{t("Список товаров")}</h3>
            <div className="flex items-center gap-8 pr-4">
              <button type="button" disabled={!ready} onClick={() => setInlineOpen(true)} className={ready ? link : "text-[13px] text-slate-800"}>
                {ready ? "" : "+ "}{t("добавить товар")}
              </button>
              {ready && <button type="button" onClick={() => setPickerOpen(true)} className={link}>{t("добавить из списка")}</button>}
              <input ref={importRef} type="file" accept=".csv,.xls,.xlsx" onChange={importItems} className="hidden" />
              <button type="button" onClick={() => importRef.current?.click()} className={link}>{t("импортировать c excel")}</button>
            </div>
          </div>

          {inlineOpen && ready && (
            <div className="-mx-[30px] mt-5 flex items-end gap-10 bg-[#f1f4f7] px-[18px] pb-4 pt-8">
              <div className="w-[510px]">
                <SelectField
                  label={t("Наименование")}
                  placeholderLabel
                  flat
                  value={inline.product}
                  onChange={(value) => {
                    const product = products?.find((row) => String(row.id) === value)
                    setInline({ product: value, quantity: inline.quantity || "1", unitPrice: product ? String(priceOf(product)) : "" })
                  }}
                  loading={!sellable}
                  options={(sellable ?? []).map((row) => ({ value: String(row.id), label: row.name }))}
                />
              </div>
              <FlatInput label={t("Кол-во")} type="number" value={inline.quantity} onChange={(value) => setInline({ ...inline, quantity: value })} className="w-[200px]" />
              <FlatInput label={t("Сумма за ед")} type="number" value={inline.unitPrice} onChange={(value) => setInline({ ...inline, unitPrice: value })} className="w-[310px]" />
              <button type="button" onClick={confirmInline} aria-label={t("Добавить")} className="mb-2 text-[#4f6fe0]"><Check className="h-6 w-6" /></button>
            </div>
          )}

          {items.length === 0 ? (
            <div className="mt-[22px] flex flex-col items-center text-center text-[13px] leading-[18px] text-slate-400">
              <img src="/empty-basket.svg" alt="" className="mb-[22px] h-[72px] w-[72px]" />
              {ready ? (
                <p>
                  {t("Вы еще не выбрали ни одного товара.")}<br />
                  <button type="button" onClick={() => setInlineOpen(true)} className="text-[#0a9bd9]">{t("Добавить")}</button> {t("товар?")}
                </p>
              ) : (
                <p>{t("Для добавления товаров,")}<br />{t("выберите тип оплаты, валюту и прайс лист")}</p>
              )}
            </div>
          ) : (
            <table className="mt-6 w-full text-left text-[13px]">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3">№</th>
                  <th>{t("Наименование")}</th>
                  <th>{t("Кол-во")}</th>
                  <th>{t("Сумма за ед")}</th>
                  <th>{t("Сумма")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.productId} className="border-t">
                    <td className="p-3">{index + 1}</td>
                    <td>{item.productName}</td>
                    <td>{item.quantity} {item.unit}</td>
                    <td>{money(item.unitPrice)} {currency}</td>
                    <td>{money(item.quantity * item.unitPrice)} {currency}</td>
                    <td>
                      <button type="button" onClick={() => setItems((current) => current.filter((_, i) => i !== index))} aria-label={t("Удалить")} className="text-red-500 hover:text-red-700"><X className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <footer className="flex h-[66px] shrink-0 items-center justify-between border-t border-slate-200 px-[30px]">
        <div className="flex items-center gap-6 text-[16px]">
          <span>{t("Общая сумма заказа:")} <b>{money(total)}{currency ? ` ${currency}` : ""}</b></span>
          <span>{t("Общее кол-во:")} <b>{totalQty}</b></span>
          {error && <span className="text-[13px] text-red-500">{error}</span>}
        </div>
        <button type="button" onClick={save} disabled={saving} className="text-[13px] font-bold uppercase text-[#0a9bd9] hover:underline disabled:opacity-50">
          {t("Оформить заказ")}
        </button>
      </footer>

      {repriceOpen && (
        <Modal onClose={() => setRepriceOpen(false)}>
          <p className="px-[30px] py-8 text-[13px]">{t("Цены товаров будут изменены на")} ({currency}, {t(paymentType).toLowerCase()})</p>
          <div className="flex justify-end gap-6 border-t border-slate-200 px-[30px] py-4 text-[13px] font-bold uppercase text-[#0a9bd9]">
            <button type="button" onClick={() => setRepriceOpen(false)}>{t("Нет")}</button>
            <button type="button" onClick={() => setRepriceOpen(false)}>{t("Да")}</button>
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
          priceOf={(product) => priceOf(product)}
          onClose={() => setPickerOpen(false)}
          onSave={(rows) => {
            addItems(rows)
            setPickerOpen(false)
          }}
        />
      )}
    </div>,
    document.body,
  )
}

function Modal({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50">
      <div className="w-[500px] bg-white shadow-xl">
        {title && (
          <div className="flex items-center justify-between px-[30px] pt-5">
            <h3 className="text-[13px] font-bold uppercase">{title}</h3>
            <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-600"><X className="h-6 w-6" /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

export function ProductPicker({
  products,
  priceOf,
  onClose,
  onSave,
}: {
  products: ProductRow[] | null
  priceOf: (product: ProductRow) => number
  onClose: () => void
  onSave: (rows: LineItem[]) => void
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [type, setType] = useState("")
  const [brand, setBrand] = useState("")
  const [quantities, setQuantities] = useState<Record<number, string>>({})

  const types = useMemo(() => Array.from(new Set((products ?? []).map((row) => row.type).filter(Boolean))) as string[], [products])
  const brands = useMemo(() => Array.from(new Set((products ?? []).map((row) => row.brand).filter(Boolean))) as string[], [products])
  const visible = (products ?? [])
    .filter((row) => row.name.toLowerCase().includes(query.toLowerCase()))
    .filter((row) => !type || row.type === type)
    .filter((row) => !brand || row.brand === brand)
    .slice(0, 50)

  function save() {
    const rows: LineItem[] = []
    for (const product of products ?? []) {
      const quantity = Number(quantities[product.id])
      if (quantity > 0) rows.push({ productId: product.id, productName: product.name, unit: product.unit || "шт.", quantity, unitPrice: priceOf(product) })
    }
    onSave(rows)
  }

  return (
    <div className="fixed inset-0 z-[105] flex flex-col bg-white">
      <header className="flex h-[48px] shrink-0 items-center justify-between border-b border-slate-200 px-[30px]">
        <h2 className="text-[13px] font-bold uppercase">{t("Добавление продуктов")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-600"><X className="h-6 w-6" /></button>
      </header>
      <div className="flex shrink-0 items-end gap-8 px-[30px] pb-3 pt-4">
        <div className="w-[260px]"><SelectField label={t("Фильтр по типу")} placeholderLabel value={type} onChange={setType} options={types.map((row) => ({ value: row, label: row }))} onClear={() => setType("")} /></div>
        <div className="w-[260px]"><SelectField label={t("Фильтр по бренду")} placeholderLabel value={brand} onChange={setBrand} options={brands.map((row) => ({ value: row, label: row }))} onClear={() => setBrand("")} /></div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск товаров...")} className="w-[300px] border-b border-slate-300 py-2 text-[13px] outline-none" />
        <span className="ml-auto pb-2 text-[13px] text-slate-500">50 &nbsp; 1 - {visible.length} {t("из")} {products?.length ?? 0}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[30px]">
        {!products ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#4f6fe0]" /></div>
        ) : visible.length === 0 ? (
          <p className="mt-24 text-center text-[13px] text-slate-400">{t("По вашему запросу ничего не найдено...")}</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <tbody>
              {visible.map((product) => (
                <tr key={product.id} className="border-b border-dashed border-slate-200">
                  <td className="py-3">{product.name}</td>
                  <td className="text-slate-500">{product.type}</td>
                  <td className="text-slate-500">{product.brand}</td>
                  <td className="w-32">
                    <input
                      type="number"
                      min="0"
                      value={quantities[product.id] ?? ""}
                      onChange={(event) => setQuantities({ ...quantities, [product.id]: event.target.value })}
                      placeholder={t("Кол-во")}
                      className="w-24 border-b border-slate-300 py-1 outline-none"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <footer className="flex h-[56px] shrink-0 items-center justify-end border-t border-slate-200 px-[30px]">
        <button type="button" onClick={save} className="text-[13px] font-bold uppercase text-[#0a9bd9]">{t("Сохранить")}</button>
      </footer>
    </div>
  )
}

export function Checkbox({ checked, onChange, className }: { checked: boolean; onChange: (value: boolean) => void; className?: string }) {
  return (
    <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[3px] border-2 ${checked ? "border-slate-600 bg-slate-600" : "border-slate-600"} ${className ?? ""}`}>
      {checked && <Check className="h-3 w-3 stroke-[3] text-white" />}
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
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((row) => row.value === value) ?? (value ? { value, label: value } : undefined)

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const floating = !placeholderLabel || Boolean(selected)

  return (
    <div ref={rootRef} className={`relative ${flat ? "" : "mt-[14px]"}`}>
      <span className={`block h-3 text-[10px] font-semibold leading-3 ${floating ? "" : "invisible"}`}>
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      <button type="button" onClick={() => setOpen((current) => !current)} className="relative flex h-[34px] w-full items-center border-b border-slate-300 pr-14 text-left text-[13px]">
        {selected ? <span className="truncate">{selected.label}</span> : placeholderLabel ? <span className="font-semibold">{label}{required && <span className="text-red-500"> *</span>}</span> : null}
        <span className="absolute right-0 flex items-center gap-2 text-slate-500">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {selected && onClear && (
            <span role="button" aria-label={t("Очистить")} onClick={(event) => { event.stopPropagation(); onClear() }} className="hover:text-slate-800"><X className="h-3.5 w-3.5" /></span>
          )}
          {open ? <ChevronUp className="h-4 w-4 fill-current" /> : <ChevronDown className="h-4 w-4 fill-current" />}
        </span>
      </button>
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-60 overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-[13px] font-semibold text-slate-400">{loading ? t("Загрузка...") : "—"}</li>
          ) : (
            options.map((row, index) => (
              <li key={`${row.value}-${index}`}>
                <button
                  type="button"
                  onClick={() => { onChange(row.value); setOpen(false) }}
                  className={`block w-full px-3 py-2 text-left text-[13px] font-semibold ${row.value === value ? "bg-[#e3effd] text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}
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
  return (
    <div className={first ? "mt-0" : "mt-[14px]"}>
      <span className="block h-3 text-[10px] font-semibold leading-3">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      <label className="relative flex h-[34px] cursor-pointer items-center border-b border-slate-300 text-[13px]">
        <span>{t(formatDate(value))}</span>
        <Calendar className="absolute right-0 h-4 w-4 text-slate-400" />
        <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
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
