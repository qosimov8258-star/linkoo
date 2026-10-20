"use client"

import { X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

import { Checkbox, DateField, SelectField, toInputDate } from "./add-order-dialog"
import { RELEASED_STATUSES, type Order } from "./orders-data"
import type { ClientReturnRow } from "./returns-view"

type Mode = "order" | "client"
type ClientRow = { id: number; name: string; deliverer?: string; agent?: string }
type ProductRow = { id: number; name: string; unit?: string; deleted?: boolean }
type Returnable = { orderItemId: number; productName: string; unit: string; ordered: number; returned: number; available: number; price: number; currency: string }
type FreeLine = { productId: number; productName: string; unit: string; quantity: string; price: string }

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url)
    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

/** Full-screen "Добавление возврата": a return of a shipped order (its lines,
 * up to what is still returnable, at the order price) or of a client without
 * an order (catalog products at a given price). Saved via /api/client-returns. */
export function AddReturnDialog({ initialOrderId, onClose, onCreated }: { initialOrderId?: number; onClose: () => void; onCreated: (created: ClientReturnRow) => void }) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<Mode>("order")
  const [date, setDate] = useState(() => toInputDate(new Date()))
  const [clientId, setClientId] = useState("")
  const [orderId, setOrderId] = useState(initialOrderId ? String(initialOrderId) : "")
  const [warehouse, setWarehouse] = useState("")
  const [deliverer, setDeliverer] = useState("")
  const [agent, setAgent] = useState("")
  const [comment, setComment] = useState("")
  const [manual, setManual] = useState(false)
  const [currency, setCurrency] = useState("")
  const [clients, setClients] = useState<ClientRow[]>([])
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [currencies, setCurrencies] = useState<string[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [returnable, setReturnable] = useState<Returnable[]>([])
  const [qty, setQty] = useState<Record<number, string>>({})
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [lines, setLines] = useState<FreeLine[]>([])
  const [pick, setPick] = useState({ product: "", quantity: "1", price: "" })
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getJson<ClientRow[]>("/api/clients?balances=0").then((rows) => setClients(rows ?? []))
    void getJson<Array<{ name: string; active?: boolean }>>("/api/warehouses").then((rows) => setWarehouses((rows ?? []).filter((row) => row.active !== false).map((row) => row.name)))
    void getJson<Array<{ firstName?: string; lastName?: string; name?: string }>>("/api/employees").then((rows) => setPeople((rows ?? []).map((row) => `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.name || "").filter(Boolean)))
    void getJson<Array<{ code: string; isBase?: boolean }>>("/api/currencies").then((rows) => setCurrencies((rows ?? []).map((row) => row.code)))
    void getJson<ProductRow[]>("/api/products").then((rows) => setProducts((rows ?? []).filter((row) => !row.deleted)))
    void getJson<Order[]>("/api/orders?balances=0").then((rows) => setOrders((rows ?? []).filter((row) => RELEASED_STATUSES.includes(row.status))))
  }, [])

  // An order chosen up front (from the order card) brings its client and warehouse.
  useEffect(() => {
    if (!orderId) return
    const order = orders.find((row) => String(row.id) === orderId)
    if (!order) return
    if (order.clientId && String(order.clientId) !== clientId) setClientId(String(order.clientId))
    if (!warehouse && order.warehouse) setWarehouse(order.warehouse)
    if (!deliverer && order.deliveryMan) setDeliverer(order.deliveryMan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, orders])

  useEffect(() => {
    setReturnable([])
    setQty({})
    setPrices({})
    if (!orderId) return
    void getJson<Returnable[]>(`/api/orders/${orderId}/returnable`).then((rows) => setReturnable(rows ?? []))
  }, [orderId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const client = clients.find((row) => String(row.id) === clientId)
  const clientOrders = useMemo(() => orders.filter((row) => client && (row.clientId ? row.clientId === client.id : row.client === client.name)), [orders, client])
  const order = orders.find((row) => String(row.id) === orderId)
  const orderCurrency = order?.currency || returnable[0]?.currency || ""
  const priceOf = (line: Returnable) => (manual && prices[line.orderItemId] !== undefined ? Number(prices[line.orderItemId]) || 0 : line.price)
  const total =
    mode === "order"
      ? returnable.reduce((sum, line) => sum + (Number(qty[line.orderItemId]) || 0) * priceOf(line), 0)
      : lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.price) || 0), 0)
  const totalQty = mode === "order" ? returnable.reduce((sum, line) => sum + (Number(qty[line.orderItemId]) || 0), 0) : lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0)
  const shownCurrency = mode === "order" ? orderCurrency : currency || currencies[0] || ""

  const options = {
    clients: clients.map((row) => ({ value: String(row.id), label: row.name })),
    orders: clientOrders.map((row) => ({ value: String(row.id), label: `№${row.id} — ${row.amount} (${t(row.status)})` })),
    warehouses: warehouses.map((name) => ({ value: name, label: name })),
    people: people.map((name) => ({ value: name, label: name })),
    currencies: currencies.map((code) => ({ value: code, label: code })),
    products: products.map((row) => ({ value: String(row.id), label: row.name })),
  }

  function addFreeLine() {
    const product = products.find((row) => String(row.id) === pick.product)
    if (!product) return setError(t("Выберите товар"))
    if (!(Number(pick.quantity) > 0) || !(Number(pick.price) >= 0) || pick.price === "") return setError(t("Проверьте количество и цену"))
    setLines((current) => [...current, { productId: product.id, productName: product.name, unit: product.unit || "шт.", quantity: pick.quantity, price: pick.price }])
    setPick({ product: "", quantity: "1", price: "" })
    setError("")
  }

  async function save(accept: boolean) {
    setError("")
    if (!client) return setError(t("Выберите клиента"))
    if (!warehouse) return setError(t("Выберите склад"))
    let items: Array<Record<string, unknown>>
    if (mode === "order") {
      if (!order) return setError(t("Выберите заказ"))
      const chosen = returnable.filter((line) => (Number(qty[line.orderItemId]) || 0) > 0)
      if (!chosen.length) return setError(t("Укажите количество возврата"))
      const over = chosen.find((line) => Number(qty[line.orderItemId]) > line.available)
      if (over) return setError(`${over.productName}: ${t("Количество возврата больше доступного")}`)
      items = chosen.map((line) => ({ orderItemId: line.orderItemId, quantity: Number(qty[line.orderItemId]), ...(manual ? { price: priceOf(line) } : {}) }))
    } else {
      if (!lines.length) return setError(t("Добавьте товары возврата"))
      items = lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity), price: Number(line.price) }))
    }
    setSaving(true)
    try {
      const response = await fetch("/api/client-returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          orderId: mode === "order" ? order?.id : undefined,
          warehouse,
          returnDate: date,
          currency: mode === "client" ? shownCurrency || undefined : undefined,
          deliverer: deliverer || undefined,
          agent: agent || undefined,
          comment: comment.trim() || undefined,
          items,
          accept,
        }),
      })
      const body = (await response.json().catch(() => null)) as (ClientReturnRow & { error?: string }) | null
      if (!response.ok || !body) return setError(t(body?.error ?? "Не удалось сохранить изменения на сервере"))
      onCreated(body)
    } finally {
      setSaving(false)
    }
  }

  const modes: { key: Mode; label: string }[] = [
    { key: "order", label: t("Возврат по заказу") },
    { key: "client", label: t("Возврат по конкретному клиенту") },
  ]

  return createPortal(
    <div className="fixed inset-0 z-[110] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#efefef] px-[14px]">
        <h2 className="text-[13px] font-bold uppercase">{t("Добавление возврата")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-600">
          <X className="h-6 w-6" />
        </button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[405px_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r border-[#efefef] px-[14px] py-[16px] pr-[60px]">
          <div className="space-y-[14px]">
            {modes.map((item) => (
              <label key={item.key} className="flex cursor-pointer items-center gap-[8px] text-[12px] font-semibold">
                <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 ${mode === item.key ? "border-slate-700" : "border-slate-600"}`}>
                  {mode === item.key && <span className="h-[8px] w-[8px] rounded-full bg-slate-700" />}
                </span>
                <input type="radio" name="return-mode" checked={mode === item.key} onChange={() => setMode(item.key)} className="sr-only" />
                {item.label}
              </label>
            ))}
          </div>
          <p className="mb-[2px] mt-[26px] text-[12px] font-semibold">{t("Детали")}</p>
          <DateField label={t("Дата возврата")} required value={date} onChange={setDate} />
          <SelectField label={t("Клиент")} required placeholderLabel value={clientId} onChange={(value) => (setClientId(value), setOrderId(""))} options={options.clients} onClear={() => (setClientId(""), setOrderId(""))} />
          {mode === "order" ? (
            <SelectField label={t("Заказ")} required placeholderLabel value={orderId} onChange={setOrderId} options={options.orders} onClear={() => setOrderId("")} />
          ) : (
            <SelectField label={t("Валюта")} required value={shownCurrency} onChange={setCurrency} options={options.currencies} />
          )}
          <SelectField label={t("Склад")} required placeholderLabel value={warehouse} onChange={setWarehouse} options={options.warehouses} onClear={() => setWarehouse("")} />
          <SelectField label={t("Доставщик")} placeholderLabel value={deliverer} onChange={setDeliverer} options={options.people} onClear={() => setDeliverer("")} />
          <SelectField label={t("Ответственный агент")} placeholderLabel value={agent} onChange={setAgent} options={options.people} onClear={() => setAgent("")} />
          <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("Оставить комментарий...")} className="mt-[22px] h-[34px] w-full border-b border-slate-300 bg-transparent text-[13px] font-semibold outline-none placeholder:text-slate-800" />
          {mode === "order" && (
            <label className="mt-[22px] flex cursor-pointer items-center gap-[8px] text-[12px] font-semibold">
              <Checkbox checked={manual} onChange={setManual} />
              {t("Указать стоимость в ручную")}
            </label>
          )}
        </aside>
        <main className="relative min-w-0 overflow-y-auto px-[14px] py-[12px]">
          <span className="text-[12px] font-semibold">{t("Список товаров")}</span>
          {mode === "order" ? (
            !order ? (
              <p className="mt-[130px] text-center text-[12px] text-slate-400">{client ? t("Выберите отгруженный заказ клиента.") : t("Для добавления товаров выберите клиента.")}</p>
            ) : (
              <table className="mt-4 w-full text-left">
                <thead>
                  <tr className="font-semibold">
                    <th className="py-2">{t("Наименование")}</th>
                    <th>{t("По заказу")}</th>
                    <th>{t("Уже возвращено")}</th>
                    <th>{t("Доступно")}</th>
                    <th>{t("Кол-во возврата")}</th>
                    <th>{`${t("Цена")} (${orderCurrency})`}</th>
                    <th>{t("Сумма")}</th>
                  </tr>
                </thead>
                <tbody>
                  {returnable.map((line) => (
                    <tr key={line.orderItemId} className="border-y border-dotted border-[#9ec9e8] bg-[#f1f4f7]">
                      <td className="py-[10px]">{line.productName}</td>
                      <td>{line.ordered}</td>
                      <td>{line.returned}</td>
                      <td>{line.available}</td>
                      <td className="w-[140px] pr-4">
                        <input type="number" min="0" max={line.available} step="any" disabled={line.available <= 0} value={qty[line.orderItemId] ?? ""} onChange={(event) => setQty((current) => ({ ...current, [line.orderItemId]: event.target.value }))} className="w-full border-b-2 border-[#374557] bg-transparent py-1 outline-none disabled:opacity-40" />
                      </td>
                      <td className="w-[140px] pr-4">
                        <input disabled={!manual} value={manual ? (prices[line.orderItemId] ?? String(line.price)) : String(line.price)} onChange={(event) => setPrices((current) => ({ ...current, [line.orderItemId]: event.target.value }))} className="w-full border-b border-dotted border-[#374557] bg-transparent py-1 font-bold outline-none" />
                      </td>
                      <td>{((Number(qty[line.orderItemId]) || 0) * priceOf(line)).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : !client ? (
            <p className="mt-[130px] text-center text-[12px] text-slate-400">{t("Для добавления товаров выберите клиента.")}</p>
          ) : (
            <>
              <div className="mt-4 flex items-end gap-4 bg-[#f1f4f7] px-3 pb-3 pt-2">
                <div className="w-[360px]">
                  <SelectField label={t("Товар")} placeholderLabel flat value={pick.product} onChange={(value) => setPick({ ...pick, product: value })} options={options.products} />
                </div>
                <input type="number" min="0" step="any" value={pick.quantity} onChange={(event) => setPick({ ...pick, quantity: event.target.value })} placeholder={t("Кол-во")} className="h-[34px] w-[120px] border-b border-slate-300 bg-transparent outline-none" />
                <input type="number" min="0" step="any" value={pick.price} onChange={(event) => setPick({ ...pick, price: event.target.value })} placeholder={`${t("Цена")} (${shownCurrency})`} className="h-[34px] w-[160px] border-b border-slate-300 bg-transparent outline-none" />
                <button type="button" onClick={addFreeLine} className="text-[12px] font-semibold text-[#0a9ddb]">
                  + {t("добавить товар")}
                </button>
              </div>
              <table className="mt-4 w-full text-left">
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={`${line.productId}-${index}`} className="border-b border-dotted border-[#d6d6d6]">
                      <td className="py-2">{line.productName}</td>
                      <td>
                        {line.quantity} {line.unit}
                      </td>
                      <td>
                        {line.price} {shownCurrency}
                      </td>
                      <td className="text-right">
                        <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} aria-label={t("Удалить")} className="text-[#e57373]">
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </main>
      </div>
      <footer className="flex h-[56px] shrink-0 items-center justify-between border-t border-[#efefef] px-[14px]">
        <span className="text-[12px] font-semibold">
          {t("Общая стоимость:")} <span className="text-[#0a9ddb]">{`${total.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${shownCurrency}`}</span> &nbsp; {t("Общее кол-во:")} <span className="text-[#0a9ddb]">{`${totalQty} ${t("ед")}`}</span>
        </span>
        <div className="flex items-center gap-6">
          {error && <span className="text-[12px] text-[#e57373]">{error}</span>}
          <button type="button" disabled={saving} onClick={() => save(false)} className="text-[12px] font-bold uppercase text-[#0a9ddb] disabled:opacity-50">
            {t("Сохранить")}
          </button>
          <button type="button" disabled={saving} onClick={() => save(true)} className="text-[12px] font-bold uppercase text-[#48a34b] disabled:opacity-50">
            {t("Сохранить и принять на склад")}
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  )
}
