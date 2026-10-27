"use client"

import { Calendar, Check, Loader2, X } from "lucide-react"
import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"

import type { Order } from "./orders-data"

type Option = { value: string; label: string }
type ShopRow = { id: number; name: string; agent?: string; zone?: string; type?: string }
type ProductRow = {
  id: number
  name: string
  type?: string
  brand?: string
  unit?: string
  priceLists?: { name: string; cash?: number; nonCash?: number }[]
}
type LineItem = { id?: number; productName: string; unit: string; quantity: number; unitPrice: number; discountPercent?: number; boxAmount?: number; boxUnit?: string }

const RU_MONTH_PREFIXES = ["янв", "фев", "мар", "апр", "ма", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

/** "08 сент. 2026" / "8 сентября 2026 г." -> "2026-09-08" ("" when it cannot be read). */
function parseRuDate(value: string) {
  const match = /(\d{1,2})\s+([А-Яа-я]+)\.?\s+(\d{4})/.exec(value)
  if (!match) return ""
  const month = RU_MONTH_PREFIXES.findIndex((prefix) => match[2].toLowerCase().startsWith(prefix))
  if (month < 0) return ""
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`
}

const paymentTypes = ["Наличные", "Перечисление"]

/** Pre-selected values of the reference app's "Добавление заказа" form (used when the directory has them). */
const PREFERRED = { currency: "USD", priceList: "donalik", warehouse: "Andijon skladi" }
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
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

/** "Группа" column: whole boxes plus the loose rest, like the reference ("0 блок (+1)"). */
function groupLabel(quantity: number, boxAmount?: number, boxUnit?: string) {
  if (!boxAmount || boxAmount <= 0) return "0"
  const blocks = Math.floor(quantity / boxAmount)
  const rest = Math.round((quantity - blocks * boxAmount) * 1000) / 1000
  return `${blocks} ${boxUnit || "блок"}${rest > 0 ? ` (+${rest})` : ""}`
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
  const { t, language } = useLanguage()
  const today = useMemo(() => new Date(), [])
  const tomorrow = useMemo(() => new Date(today.getTime() + 24 * 60 * 60 * 1000), [today])

  const [shops, setShops] = useState<ShopRow[] | null>(null)
  const [agents, setAgents] = useState<string[] | null>(null)
  const [warehouses, setWarehouses] = useState<string[] | null>(null)
  const [priceLists, setPriceLists] = useState<string[] | null>(null)
  const [currencies, setCurrencies] = useState<string[] | null>(null)
  const [products, setProducts] = useState<ProductRow[] | null>(null)

  const [shopId, setShopId] = useState(initialShopId ? String(initialShopId) : "")
  const editing = edit?.order
  // Edit mode shows the order's own client right away; the directory (4k shops) loads in the background.
  const [editShopName, setEditShopName] = useState(editing ? editing.marketName || editing.client : "")
  const [date, setDate] = useState(editing?.createdAt ? editing.createdAt.slice(0, 10) : toInputDate(today))
  const [prize, setPrize] = useState(false)
  const [paymentType, setPaymentType] = useState(editing ? editing.payTypeName || (editing.payMethod === "bank" ? "Перечисление" : paymentTypes[0]) : paymentTypes[0])
  const [currency, setCurrency] = useState(editing ? editing.amount.trim().split(/\s+/).pop() || "" : "")
  const [priceList, setPriceList] = useState(editing?.priceList ?? "")
  const [agent, setAgent] = useState(editing?.agent ?? "")
  const [lastPayDate, setLastPayDate] = useState(editing?.dueDate || toInputDate(tomorrow))
  const [terms, setTerms] = useState<"standard" | "consignment">(editing?.dealType === "1" ? "consignment" : "standard")
  const [warehouse, setWarehouse] = useState(editing?.stockName ?? "")
  const [deliveryType, setDeliveryType] = useState(editing?.deliveryType === "self" ? "Самовывоз" : "Доставка")
  const [deliverer, setDeliverer] = useState(editing?.deliveryMan ?? "")
  const [deliveryDate, setDeliveryDate] = useState(editing ? editing.acceptedDate || parseRuDate(editing.delivery) || toInputDate(tomorrow) : toInputDate(tomorrow))
  const [confirmed, setConfirmed] = useState(editing ? editing.status !== "Не подтвержден" : true)
  const [noBonus, setNoBonus] = useState(Boolean(initialShopId))
  const [autoDiscounts, setAutoDiscounts] = useState(false)
  const [comment, setComment] = useState("")

  const [items, setItems] = useState<LineItem[]>(edit?.items ?? [])
  const [inlineOpen, setInlineOpen] = useState(false)
  const [inline, setInline] = useState({ product: "", quantity: "", unitPrice: "" })
  const [pickerOpen, setPickerOpen] = useState(false)
  // changing the price list / currency / payment type asks before the line prices follow it (the reference shows the question in the products panel)
  const [pendingPricing, setPendingPricing] = useState<{ paymentType: string; currency: string; priceList: string } | null>(null)
  const [exitOpen, setExitOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const importRef = useRef<HTMLInputElement>(null)
  const [stock, setStock] = useState<Record<string, number>>({})
  const [rowEdit, setRowEdit] = useState<{ index: number; quantity: string; unitPrice: string } | null>(null)

  useEffect(() => {
    const load = (url: string) => fetch(url).then((response) => (response.ok ? response.json() : []))
    load("/api/clients").then((rows: ShopRow[]) => setShops(rows))
    load("/api/employees").then((rows: { firstName: string; lastName: string }[]) => setAgents(rows.map((row) => `${row.firstName} ${row.lastName}`.trim())))
    load("/api/warehouses").then((rows: { name: string }[]) => setWarehouses(rows.map((row) => row.name)))
    load("/api/price-lists").then((rows: { name: string }[]) => setPriceLists(rows.map((row) => row.name)))
    load("/api/currencies").then((rows: { code: string }[]) => setCurrencies(rows.map((row) => row.code)))
    load("/api/products").then((rows: ProductRow[]) => setProducts(rows))
  }, [])

  const shop = shops?.find((row) => String(row.id) === shopId)
  useEffect(() => {
    if (!editing || shopId || !shops) return
    const names = [editing.marketName, editing.client].filter(Boolean)
    const found = shops.find((row) => names.includes(row.name))
    if (found) setShopId(String(found.id))
  }, [editing, shopId, shops])
  // Price lists come from the directory plus any named on products, so the picker is never empty when prices exist.
  const allPriceLists = useMemo(() => {
    if (!priceLists || !products) return null
    return Array.from(new Set([...priceLists, ...products.flatMap((row) => (row.priceLists ?? []).map((entry) => entry.name))]))
  }, [priceLists, products])

  // Defaults like the original app: first currency / price list / warehouse, the shop's agent.
  useEffect(() => {
    if (currencies?.length && !currency) setCurrency(currencies.includes(PREFERRED.currency) ? PREFERRED.currency : currencies.includes("SUM") ? "SUM" : currencies[0])
  }, [currencies, currency])
  useEffect(() => {
    if (allPriceLists?.length && !priceList) setPriceList(allPriceLists.includes(PREFERRED.priceList) ? PREFERRED.priceList : allPriceLists[0])
  }, [allPriceLists, priceList])
  useEffect(() => {
    if (warehouses?.length && !warehouse) setWarehouse(warehouses.includes(PREFERRED.warehouse) ? PREFERRED.warehouse : warehouses[0])
  }, [warehouses, warehouse])
  useEffect(() => {
    if (agent) return
    if (shopId && !shops) return // wait for the shop so its agent wins over the first employee
    if (shop?.agent && shop.agent !== "Не указано") setAgent(shop.agent)
    else if (agents?.length) setAgent(agents[0])
  }, [shop, shops, shopId, agents, agent])

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

  // "На складе": what the chosen warehouse still has of each product (stock balances API).
  useEffect(() => {
    if (!warehouse) return
    let cancelled = false
    fetch(`/api/stock/balances?pageSize=0&warehouse=${encodeURIComponent(warehouse)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { rows?: { name: string; available: number }[] } | null) => {
        if (cancelled || !data?.rows) return
        setStock(Object.fromEntries(data.rows.map((row) => [row.name, row.available])))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [warehouse])

  const ready = Boolean(paymentType && currency && (priceList || !allPriceLists?.length))
  const insufficient = items.some((item) => stock[item.productName] !== undefined && stock[item.productName] < item.quantity)
  const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const totalQty = items.reduce((sum, item) => sum + item.quantity, 0)

  function priceOf(product: ProductRow, list = priceList, type = paymentType) {
    const entry = product.priceLists?.find((row) => row.name === list)
    return (type === "Перечисление" ? entry?.nonCash : entry?.cash) ?? 0
  }

  function changePricing(next: { paymentType?: string; currency?: string; priceList?: string }) {
    const nextType = next.paymentType ?? paymentType
    const nextList = next.priceList ?? priceList
    if (next.paymentType !== undefined) setPaymentType(next.paymentType)
    if (next.currency !== undefined) setCurrency(next.currency)
    if (next.priceList !== undefined) setPriceList(next.priceList)
    if (items.length) setPendingPricing({ paymentType: nextType, currency: next.currency ?? currency, priceList: nextList })
  }

  function applyPendingPricing() {
    if (!pendingPricing) return
    setItems((current) =>
      current.map((item) => {
        const product = products?.find((row) => row.name === item.productName)
        return product ? { ...item, unitPrice: priceOf(product, pendingPricing.priceList, pendingPricing.paymentType) } : item
      }),
    )
    setPendingPricing(null)
  }

  function addItems(rows: LineItem[]) {
    setItems((current) => {
      const merged = [...current]
      for (const row of rows) {
        const index = merged.findIndex((item) => item.productName === row.productName)
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
    const product = products?.find((row) => row.name === inline.product)
    addItems([{ productName: inline.product, unit: product?.unit || "шт.", quantity, unitPrice }])
    setInline({ product: "", quantity: "", unitPrice: "" })
    setInlineOpen(false)
  }

  function importItems(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    void (async () => {
      const rows = await readExcelRows(file)
      const parsed = rows
        .map(([name, quantity, price]) => ({ productName: (name ?? "").trim(), unit: "шт.", quantity: Number(quantity), unitPrice: Number(price) }))
        .filter((row) => row.productName && row.quantity > 0 && Number.isFinite(row.unitPrice))
      if (parsed.length) addItems(parsed)
    })()
  }

  async function save() {
    setError("")
    if (!shop && !editing) return setError(t("Выберите клиента"))
    if (!paymentType) return setError(t("Выберите тип оплаты"))
    if (!agent) return setError(t("Выберите агента"))
    if (!warehouse) return setError(t("Выберите склад"))
    if (!items.length) return setError(t("Вы еще не выбрали ни одного товара."))
    setSaving(true)
    try {
      if (editing) {
        const patch: Partial<Order> = {
          client: shop?.name ?? editing.client,
          agent,
          delivery: formatDate(deliveryDate),
          amount: `${money(total)} ${currency}`,
          product: editing.product,
          priceList,
          stockName: warehouse,
          payTypeName: paymentType,
          dealType: terms === "consignment" ? "1" : "0",
          deliveryType: deliveryType === "Самовывоз" ? "self" : "delivery",
          deliveryMan: deliverer,
          dueDate: lastPayDate,
          status: confirmed ? (editing.status === "Не подтвержден" ? "Есть на складе" : editing.status) : "Не подтвержден",
        }
        const response = await fetch(`/api/orders/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })
        if (!response.ok) throw new Error("update failed")
        const kept = new Set(items.filter((item) => item.id).map((item) => item.id))
        const body = (item: LineItem) => JSON.stringify({ productName: item.productName, unit: item.unit, quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: item.discountPercent ?? 0, currency })
        await Promise.all([
          ...(edit?.items ?? []).filter((item) => item.id && !kept.has(item.id)).map((item) => fetch(`/api/orders/${editing.id}/items/${item.id}`, { method: "DELETE" })),
          ...items.map((item) =>
            fetch(item.id ? `/api/orders/${editing.id}/items/${item.id}` : `/api/orders/${editing.id}/items`, { method: item.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: body(item) }),
          ),
        ])
        onSaved?.(patch)
        return
      }
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: shop!.name,
          zone: shop!.zone,
          type: shop!.type,
          product: priceList,
          agent,
          delivery: formatDate(deliveryDate),
          amount: `${money(total)} ${currency}`,
          // everything the form collected is saved, not just the headline fields (the card shows them again)
          priceList,
          stockName: warehouse,
          payTypeName: paymentType,
          dealType: terms === "consignment" ? "1" : "0",
          deliveryType: deliveryType === "Самовывоз" ? "self" : "delivery",
          deliveryMan: deliverer,
          dueDate: lastPayDate,
          ...(confirmed ? {} : { status: "Не подтвержден" }),
        }),
      })
      if (!response.ok) throw new Error("create failed")
      const created = (await response.json()) as Order
      await Promise.all(
        items.map((item) =>
          fetch(`/api/orders/${created.id}/items`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...item, currency }),
          }),
        ),
      )
      onCreated(created)
    } catch {
      setError(t(editing ? "Не удалось сохранить заказ" : "Не удалось создать заказ"))
      setSaving(false)
    }
  }

  const link = "text-[13px] text-[#4f6fe0] hover:underline"

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
            <button type="button" onClick={() => window.open("/clients", "_blank")} className={link}>+ {t("добавить")}</button>
          </div>

          <DateField label={t("Дата создания")} required value={date} onChange={setDate} first />
          <SelectField label={t("Название клиента")} required placeholderLabel value={shopId || editShopName} onChange={(value) => { setEditShopName(""); setShopId(value) }} loading={!shops && !editing} options={(shops ?? []).map((row) => ({ value: String(row.id), label: row.name }))} onClear={() => { setShopId(""); setEditShopName("") }} />

          {insufficient && (
            <div className="-mx-[30px] mt-[10px] flex h-[56px] items-center bg-[#ffebeb] px-[30px] text-[13px] text-[#f44336]">{t("Недостаточно товаров на складе")}</div>
          )}

          <h3 className={`${insufficient ? "mt-[6px]" : "mt-[14.3px]"} text-[13px] font-semibold leading-[16.3px]`}>{t("Оплата")}</h3>
          <label className="mt-[20px] flex h-5 cursor-pointer items-center gap-[6px] text-[13px] font-semibold text-black">
            <Checkbox checked={prize} onChange={setPrize} />
            {t("Призовой заказ за балл")}
          </label>

          <div className="mt-[25.5px]">
            <SelectField label={t("Тип оплаты")} placeholderLabel value={paymentType} onChange={(value) => changePricing({ paymentType: value })} options={paymentTypes.map((row) => ({ value: row, label: t(row) }))} onClear={() => changePricing({ paymentType: "" })} />
          </div>
          <SelectField label={t("Валюта")} required value={currency} onChange={(value) => changePricing({ currency: value })} loading={!currencies} options={(currencies ?? []).map((row) => ({ value: row, label: row }))} onClear={() => changePricing({ currency: "" })} />
          <SelectField label={t("Прайс лист")} required value={priceList} onChange={(value) => changePricing({ priceList: value })} loading={!allPriceLists} options={(allPriceLists ?? []).map((row) => ({ value: row, label: row }))} onClear={() => changePricing({ priceList: "" })} />
          <SelectField label={t("Агент")} required value={agent} onChange={setAgent} loading={!agents} options={(agents ?? []).map((row) => ({ value: row, label: row }))} onClear={() => setAgent("")} />
          <DateField label={t("Дата окончательной оплаты")} required value={lastPayDate} onChange={setLastPayDate} />

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
          <div className="mt-[18.5px]"><SelectField label={t("Склад")} required value={warehouse} onChange={setWarehouse} loading={!warehouses} options={(warehouses ?? []).map((row) => ({ value: row, label: row }))} onClear={() => setWarehouse("")} /></div>

          <h3 className="mt-[13.7px] text-[13px] font-semibold leading-[16.3px]">{t("Условия доставки")}</h3>
          <div className="mt-[9.6px]"><SelectField label={t("Тип доставки")} required value={deliveryType} onChange={setDeliveryType} options={deliveryTypes.map((row) => ({ value: row, label: t(row) }))} onClear={() => setDeliveryType("")} /></div>
          <div className="mt-[4.2px]">
            <SelectField label={t("Доставщик")} placeholderLabel value={deliverer} onChange={setDeliverer} loading={!agents} options={(agents ?? []).map((row) => ({ value: row, label: row }))} onClear={() => setDeliverer("")} />
          </div>
          <div className="-mt-[6px]"><DateField label={t("Дата доставки")} value={deliveryDate} onChange={setDeliveryDate} /></div>

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
              <div className="mt-[22px] flex gap-[67px] text-[13px] font-bold text-[#4f71dc]">
                <button type="button" onClick={() => setPendingPricing(null)} className="uppercase">{t("Нет")}</button>
                <button type="button" onClick={applyPendingPricing} className="uppercase">{t("Да")}</button>
              </div>
            </div>
          )}
          <div className={pendingPricing ? "hidden" : "contents"}>
          <div className="mt-[22px] flex h-9 items-center justify-between">
            <h3 className="text-[13px] font-semibold leading-[16.3px]">{t("Список товаров")}</h3>
            <div className="flex items-center">
              <button type="button" disabled={!ready} onClick={() => setInlineOpen(true)} className={`h-9 px-4 ${ready ? link : "text-[13px] text-slate-800"}`}>
                {ready ? "" : "+ "}{language === "uz" ? "mahsulot qo'shish" : t("добавить товар")}
              </button>
              {ready && <button type="button" onClick={() => setPickerOpen(true)} className={`h-9 px-4 ${link}`}>{t("добавить из списка")}</button>}
              <input ref={importRef} type="file" accept=".csv,.xls,.xlsx" onChange={importItems} className="hidden" />
              <button type="button" onClick={() => importRef.current?.click()} className={`h-9 px-4 ${link}`}>{t("импортировать c excel")}</button>
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
                    const product = products?.find((row) => row.name === value)
                    setInline({ product: value, quantity: inline.quantity || "1", unitPrice: product ? String(priceOf(product)) : "" })
                  }}
                  loading={!products}
                  options={Array.from(new Set((products ?? []).map((row) => row.name))).map((name) => ({ value: name, label: name }))}
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
            <div className="mt-[23.5px] text-[13px]">
              <div className="grid h-10 grid-cols-[35%_10.86%_10.86%_10.86%_10.86%_10.86%_1fr] items-center text-[12px] font-semibold">
                <span className="px-[5px]">{t("Наименование")}</span>
                <span className="pl-[5px]">{t("Группа")}</span>
                <span className="pl-[5px]">{t("Кол-во")}</span>
                <span className="pl-[5px]">{t("На складе")}</span>
                <span className="pl-[5px]">{t("Цена")}({currency})</span>
                <span className="pl-[5px]">{t("Всего")}({currency})</span>
                <span className="pr-[10px] text-right">
                  <button type="button" onClick={() => setItems([])} aria-label={t("Удалить")}>
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="#666" aria-hidden><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                  </button>
                </span>
              </div>
              {items.map((item, index) => {
                const editingRow = rowEdit?.index === index
                const unit = item.unit || "шт."
                const left = stock[item.productName]
                return (
                  <div key={item.id ?? item.productName} className="grid h-10 grid-cols-[35%_10.86%_10.86%_10.86%_10.86%_10.86%_1fr] items-center">
                    <span className="truncate px-[5px]"><b className="mr-[5px] font-semibold">{index + 1}.</b>{item.productName}</span>
                    <span className="pl-[5px]">{groupLabel(item.quantity, item.boxAmount, item.boxUnit)}</span>
                    {editingRow ? (
                      <>
                        <input autoFocus type="number" min="0" step="any" value={rowEdit.quantity} onChange={(event) => setRowEdit({ ...rowEdit, quantity: event.target.value })} className="mr-4 w-[100px] border-b border-slate-300 bg-transparent font-semibold outline-none" />
                        <span className="pl-[5px]">{left === undefined ? "" : `${money(left)} ${unit}`}</span>
                        <input type="number" min="0" step="any" value={rowEdit.unitPrice} onChange={(event) => setRowEdit({ ...rowEdit, unitPrice: event.target.value })} className="mr-4 w-[100px] border-b border-slate-300 bg-transparent font-semibold outline-none" />
                      </>
                    ) : (
                      <>
                        <span className={`pl-[5px] ${left !== undefined && left < item.quantity ? "text-[#f44336]" : ""}`}>{item.quantity} {unit}</span>
                        <span className="pl-[5px]">{left === undefined ? "" : `${money(left)} ${unit}`}</span>
                        <span className="pl-[5px]">{money(item.unitPrice)}</span>
                      </>
                    )}
                    <span className="pl-[5px]">{money((editingRow ? Number(rowEdit.quantity) * Number(rowEdit.unitPrice) : item.quantity * item.unitPrice) || 0)}</span>
                    <span className="flex items-center justify-end gap-[10px] pr-[10px]">
                      {editingRow ? (
                        <button
                          type="button"
                          aria-label={t("Сохранить")}
                          onClick={() => {
                            const quantity = Number(rowEdit.quantity)
                            const unitPrice = Number(rowEdit.unitPrice)
                            if (quantity > 0 && unitPrice >= 0) setItems((current) => current.map((row, i) => (i === index ? { ...row, quantity, unitPrice } : row)))
                            setRowEdit(null)
                          }}
                          className="text-[#4f6fe0]"
                        >
                          <Check className="h-5 w-5" />
                        </button>
                      ) : (
                        <button type="button" aria-label={t("Изменить")} onClick={() => setRowEdit({ index, quantity: String(item.quantity), unitPrice: String(item.unitPrice) })}>
                          <svg viewBox="0 0 24 24" className="h-[30px] w-[30px] p-[5px]" fill="#666" aria-hidden><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
                        </button>
                      )}
                      <button type="button" onClick={() => setItems((current) => current.filter((_, i) => i !== index))} aria-label={t("Удалить")}>
                        <svg viewBox="0 0 24 24" className="h-[30px] w-[30px] p-[5px]" fill="#666" aria-hidden><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                      </button>
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
          <span>{t("Общая сумма заказа:")} <b>{money(total)}{currency && currency !== "SUM" ? ` ${currency}` : ""}</b></span>
          <span>{t("Общее кол-во:")} <b>{totalQty} {t("ед.")}</b></span>
          {error && <span className="text-[13px] text-red-500">{error}</span>}
        </div>
        <button type="button" onClick={save} disabled={saving} className="h-9 min-w-[88px] disabled:opacity-50">
          <span className="inline-block px-[15px] py-[9px] text-[13px] font-semibold uppercase leading-[18px] text-[#129fdd]">{t(editing ? "Изменить заказ" : "Оформить заказ")}</span>
        </button>
      </footer>

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
          products={products}
          priceOf={priceOf}
          onClose={() => setPickerOpen(false)}
          onSave={(rows) => {
            addItems(rows)
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
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50">
      <div className="w-[500px] bg-white shadow-xl">
        {title && (
          <div className="flex items-center justify-between px-[30px] pt-5">
            <h3 className="text-[13px] font-bold uppercase">{title}</h3>
            <button type="button" onClick={onClose} aria-label="close" className="text-slate-600"><X className="h-6 w-6" /></button>
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
      if (quantity > 0) rows.push({ productName: product.name, unit: product.unit || "шт.", quantity, unitPrice: priceOf(product) })
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
    <div ref={rootRef} className={`relative ${flat ? "" : "mt-[8px]"}`}>
      <span className={`block h-[13px] text-[9.75px] font-semibold leading-[12.2px] text-black ${floating ? "" : "invisible"}`}>
        {label}{required && <span className="text-[13px] font-normal text-red-500"> *</span>}
      </span>
      <button type="button" onClick={() => setOpen((current) => !current)} className="relative flex h-[41px] w-full items-center border-b border-[#e0e0e0] pr-14 pt-[3px] text-left text-[13px] font-semibold text-[#333]">
        {selected ? <span className="truncate">{selected.label}</span> : placeholderLabel ? <span className="font-semibold text-black">{label}{required && <span className="text-red-500"> *</span>}</span> : null}
        <span className="absolute right-0 top-[11px] flex items-center text-[#999]">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {selected && onClear && (
            <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onClear() }} className="mr-[10px] text-[18px] leading-[18px] hover:text-slate-700">×</span>
          )}
          <svg viewBox="0 0 10 7" className="mr-[10px] h-[7px] w-[10px]" aria-hidden><path d={open ? "M0 7h10L5 0z" : "M0 0h10L5 7z"} fill="#999" /></svg>
        </span>
      </button>
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-60 overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-[13px] font-semibold text-slate-400">{loading ? "Загрузка..." : "—"}</li>
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
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  return (
    <div className={`pb-[12px] ${first ? "mt-0" : "mt-[8px]"}`}>
      <span className="block h-[13px] text-[9.75px] font-semibold leading-[12.2px] text-black">
        {label}{required && <span className="text-[13px] font-normal text-red-500"> *</span>}
      </span>
      <button
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setAnchor({ left: rect.left, top: rect.bottom + 9 })
        }}
        className="relative flex h-[27.5px] w-full cursor-pointer items-end border-b border-[#e0e0e0] text-left text-[13px] leading-[19.5px] text-[#333]"
      >
        <span data-no-translate>{formatDate(value)}</span>
        <Calendar className="absolute right-[3px] top-[4px] h-4 w-4 text-[#ccc]" />
      </button>
      {anchor && <DatePickerDialog anchor={anchor} value={value} onCancel={() => setAnchor(null)} onPick={(next) => { onChange(next); setAnchor(null) }} />}
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
