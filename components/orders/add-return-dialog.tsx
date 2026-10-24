"use client"

import { X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

import { Checkbox, DateField, SelectField, toInputDate } from "./add-order-dialog"

type Mode = "client" | "orders" | "legacy"

export type ReturnDraftItem = { name: string; qty: number; price: number }
export type ReturnDraft = { mode: Mode; date: string; client: string; warehouse: string; deliverer: string; agent: string; comment: string; manual: boolean; items?: ReturnDraftItem[]; order?: string }

/** Full-screen "Добавление возврата" / "Изменение возврата №N" form of the reference app. */
export function AddReturnDialog({ onClose, onSubmit, initial, editId, totalLabel }: { onClose: () => void; onSubmit: (draft: ReturnDraft) => void; initial?: Partial<ReturnDraft>; editId?: number; totalLabel?: string }) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "client")
  const [date, setDate] = useState(() => initial?.date ?? "")
  const [client, setClient] = useState(initial?.client ?? "")
  const [warehouse, setWarehouse] = useState(initial?.warehouse ?? "")
  const [deliverer, setDeliverer] = useState(initial?.deliverer ?? "")
  const [agent, setAgent] = useState(initial?.agent ?? "")
  const [comment, setComment] = useState(initial?.comment ?? "")
  const [manual, setManual] = useState(initial?.manual ?? false)
  const [clients, setClients] = useState<string[]>([])
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [byOrder, setByOrder] = useState(Boolean(initial?.order))
  const [order, setOrder] = useState(initial?.order ?? "")
  const [orders, setOrders] = useState<{ id: number; client: string }[]>([])
  const [products, setProducts] = useState<{ name: string; price: number }[]>([])
  const [items, setItems] = useState<ReturnDraftItem[]>(initial?.items ?? [])
  const [adding, setAdding] = useState(false)
  const [productName, setProductName] = useState("")
  const [productQty, setProductQty] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = async (url: string, pick: (row: { name: string }) => string, set: (rows: string[]) => void) => {
      try {
        const response = await fetch(url)
        if (!response.ok) return
        const data = (await response.json()) as { name: string }[]
        if (!cancelled && Array.isArray(data)) set(data.map(pick))
      } catch {
        // options stay empty when the API is unreachable
      }
    }
    void load("/api/clients", (row) => row.name, setClients)
    void load("/api/warehouses", (row) => row.name, setWarehouses)
    void load("/api/employees", (row) => row.name, setPeople)
    void fetch("/api/products")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { name?: string; priceLists?: { price?: number }[]; priceMin?: number }[]) => {
        if (!cancelled && Array.isArray(rows)) setProducts(rows.filter((row) => row.name).map((row) => ({ name: row.name as string, price: Number(row.priceLists?.[0]?.price ?? row.priceMin ?? 0) || 0 })))
      })
      .catch(() => {})
    void fetch("/api/orders")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { id: number; client?: string; marketName?: string }[]) => {
        if (!cancelled && Array.isArray(rows)) setOrders(rows.map((row) => ({ id: row.id, client: row.client ?? row.marketName ?? "" })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const options = useMemo(() => ({ clients: clients.map((c) => ({ value: c, label: c })), warehouses: warehouses.map((c) => ({ value: c, label: c })), people: people.map((c) => ({ value: c, label: c })) }), [clients, warehouses, people])
  const orderOptions = useMemo(() => orders.filter((row) => row.client === client).map((row) => ({ value: String(row.id), label: `№ ${row.id}` })), [orders, client])
  const productOptions = useMemo(() => products.map((row) => ({ value: row.name, label: row.name })), [products])
  const total = items.reduce((sum, item) => sum + item.qty * item.price, 0)
  const quantity = items.reduce((sum, item) => sum + item.qty, 0)
  const formatSum = (value: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)} SUM`
  function addItem() {
    const qty = Number(productQty.replace(",", "."))
    if (!productName || !(qty > 0)) return
    const price = products.find((row) => row.name === productName)?.price ?? 0
    setItems((list) => [...list, { name: productName, qty, price }])
    setProductName("")
    setProductQty("")
  }
  const modes: { key: Mode; label: string }[] = [
    { key: "client", label: t("Возврат по конкретному клиенту") },
    { key: "orders", label: t("Возврат по всем заказам") },
    { key: "legacy", label: t("Возврат по старой базе") },
  ]

  return createPortal(
    <div className="fixed inset-0 z-[110] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <header className="flex h-[59px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[28px]">
        <h2 className="text-[13px] font-bold uppercase">{editId ? `${t("Изменение возврата")} №${editId}` : t("Добавление возврата")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-600"><X className="h-6 w-6" /></button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[450px_minmax(0,1fr)]">
        <aside className="overflow-y-auto border-r border-[#efefef] px-[30px] pb-[16px] pt-[31px]">
          <div className="space-y-[10px]">
            {modes.map((item) => (
              <label key={item.key} className="flex cursor-pointer items-center gap-[8px] text-[13px] font-semibold">
                <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 ${mode === item.key ? "border-slate-700" : "border-slate-600"}`}>
                  {mode === item.key && <span className="h-[8px] w-[8px] rounded-full bg-slate-700" />}
                </span>
                <input type="radio" name="return-mode" checked={mode === item.key} onChange={() => setMode(item.key)} className="sr-only" />
                {item.label}
              </label>
            ))}
          </div>
          <p className="mb-[2px] mt-[20px] text-[13px] font-semibold">{t("Детали")}</p>
          <DateField label={t("Дата возврата")} required value={date} onChange={setDate} />
          <SelectField label={t("Клиент")} required placeholderLabel value={client} onChange={setClient} options={options.clients} onClear={() => setClient("")} />
          <SelectField label={t("Склад")} required placeholderLabel value={warehouse} onChange={setWarehouse} options={options.warehouses} onClear={() => setWarehouse("")} />
          <SelectField label={t("Доставщик")} required placeholderLabel value={deliverer} onChange={setDeliverer} options={options.people} onClear={() => setDeliverer("")} />
          <SelectField label={t("Ответственный агент")} placeholderLabel value={agent} onChange={setAgent} options={options.people} onClear={() => setAgent("")} />
          <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t("Оставить комментарий...")} className="mt-[22px] h-[34px] w-full border-b border-slate-300 bg-transparent text-[13px] font-semibold outline-none placeholder:text-slate-800" />
          {client && (
            <>
              <label className="mt-[22px] flex cursor-pointer items-center gap-[8px] text-[13px] font-semibold">
                <Checkbox checked={byOrder} onChange={setByOrder} />
                {t("Возврат по конкретному заказу")}
              </label>
              {byOrder && <SelectField label={t("Заказ")} placeholderLabel value={order} onChange={setOrder} options={orderOptions} onClear={() => setOrder("")} />}
            </>
          )}
          <label className="mt-[22px] flex cursor-pointer items-center gap-[8px] text-[13px] font-semibold">
            <Checkbox checked={manual} onChange={setManual} />
            {t("Указать стоимость в ручную")}
          </label>
        </aside>
        <main className="relative min-w-0">
          <div className="flex h-[58px] items-center justify-between px-[30px]">
            <span className="text-[13px] font-semibold">{t("Список товаров")}</span>
            <div className="flex items-center gap-[14px]">
              {!client && <span className="rounded-[3px] bg-[#3a3f4b] px-[20px] py-[10px] text-[13px] font-semibold text-white">{t("Пожалуйста, выберите клиента перед добавлением продуктов")}</span>}
              <button type="button" disabled={!client} onClick={() => setAdding(true)} className={`h-[36px] rounded-[4px] px-[16px] text-[13px] ${client ? "bg-[#eceff1] text-[#333]" : "text-[#333]"}`}>+ {t("добавить товар")}</button>
            </div>
          </div>
          {adding && (
            <div className="grid h-[85px] grid-cols-[minmax(0,1fr)_156px_40px] items-end gap-x-[16px] bg-[#f0f4f8] px-[18px] pb-[18px]">
              <SelectField label={t("Наименование")} placeholderLabel value={productName} onChange={setProductName} options={productOptions} onClear={() => setProductName("")} />
              <input value={productQty} onChange={(event) => setProductQty(event.target.value)} placeholder={t("Кол-во")} className="h-[40px] w-full border-b border-slate-300 bg-transparent text-[13px] font-semibold outline-none placeholder:text-slate-800" />
              <button type="button" onClick={addItem} aria-label={t("добавить товар")} className="mb-[8px] text-[24px] leading-none text-[#4f71dc]">+</button>
            </div>
          )}
          {items.length > 0 ? (
            <div className="px-[30px] pt-[10px]">
              {items.map((item, index) => (
                <div key={index} className="grid grid-cols-[minmax(0,1fr)_100px_140px_160px_30px] items-center border-b border-dotted border-[#d9e0e5] py-[10px] text-[13px]">
                  <span>{item.name}</span>
                  <span>{item.qty}</span>
                  <span>{formatSum(item.price)}</span>
                  <span className="font-semibold">{formatSum(item.qty * item.price)}</span>
                  <button type="button" onClick={() => setItems((list) => list.filter((_, i) => i !== index))} aria-label={t("Удалить")} className="text-[#999]">×</button>
                </div>
              ))}
            </div>
          ) : (
            <div className={`${adding ? "mt-[200px]" : "mt-[250px]"} flex flex-col items-center text-center text-[13px] text-slate-400`}>
              <img src="/empty-basket.svg" alt="" className="h-[70px] w-[60px] opacity-60" />
              <p className="mt-[20px] w-[200px] leading-[16px]">{t("Для добавления товаров выберите клиента.")}</p>
            </div>
          )}
        </main>
      </div>
      <footer className="flex h-[56px] shrink-0 items-center justify-between border-t border-[#efefef] px-[14px]">
        <span className="text-[13px] font-semibold">{t("Общая стоимость:")} <span className="text-[#0a9ddb]">{items.length ? formatSum(total) : (totalLabel ?? "0 SUM")}</span> &nbsp; {t("Общее кол-во:")} <span className="text-[#0a9ddb]">{quantity} {t("ед")}</span></span>
        <button type="button" disabled={!client} onClick={() => onSubmit({ mode, date: date || toInputDate(new Date()), client, warehouse, deliverer, agent, comment, manual, items, order: byOrder ? order : undefined })} className="text-[13px] font-bold uppercase text-[#0a9ddb] disabled:opacity-50">{t("Далее")}</button>
      </footer>
    </div>,
    document.body,
  )
}
