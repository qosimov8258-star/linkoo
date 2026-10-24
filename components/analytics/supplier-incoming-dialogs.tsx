"use client"

import { X } from "lucide-react"
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import { incomingPaymentTypes, supplyCostLines, type Incoming } from "./supplier-incomings-data"
import { notify } from "@/lib/notify"

export const LOG_LABELS: Record<string, string> = {
  created: "Поставка создана",
  updated: "Поставка изменена",
  accepted: "Принято на склад",
  unaccepted: "Приёмка отменена",
  cancelled: "Поставка отменена",
  expense_added: "Добавлен расход",
  expense_deleted: "Удален расход",
  repriced: "Наценка проставлена",
}

function todayLabel() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function Dialog({ title, onClose, onSubmit, children, footer, wide }: { title: string; onClose: () => void; onSubmit: (event: FormEvent) => void; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={onSubmit} className={`flex max-h-[90vh] w-full ${wide ? "max-w-5xl" : "max-w-md"} flex-col rounded bg-white`}>
        <header className="flex items-center justify-between border-b p-6">
          <b className="uppercase">{title}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-6">{children}</div>
        <footer className="flex items-center justify-end gap-3 border-t p-5">{footer}</footer>
      </form>
    </div>
  )
}

const fieldClass = "mt-2 block w-full border-b border-slate-200 bg-white pb-1 outline-none focus:border-[#4f70e7]"

/** "Добавить расход": an additional cost of the supply (delivery, customs…),
 * spread over the lines' net cost. */
export function IncomingExpenseDialog({ incoming, onClose, onSaved }: { incoming: Incoming; onClose: () => void; onSaved: (incoming: Incoming) => void }) {
  const { t } = useLanguage()
  const [date, setDate] = useState(todayLabel())
  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState(incoming.currency || "SUM")
  const [paymentType, setPaymentType] = useState<string>(incomingPaymentTypes[0])
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = Number(amount.replace(",", "."))
    if (!description.trim() || !(value > 0)) return
    setSaving(true)
    try {
      const response = await fetch(`/api/supplier-incomings/${incoming.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, description, amount: value, currency, paymentType }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        notify(data.error ? t(data.error) : t("Не удалось добавить расход"))
        return
      }
      onSaved(data as Incoming)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={`${t("Добавить расход")} — ${t("Поставка №")} ${incoming.id}`}
      onClose={onClose}
      onSubmit={save}
      footer={<button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-2.5 font-semibold text-white hover:brightness-95 disabled:opacity-60">{t("Сохранить")}</button>}
    >
      <label className="block text-sm font-medium">
        {t("Дата создания")} *
        <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
      </label>
      <label className="block text-sm font-medium">
        {t("Описание расхода")} *
        <input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("Например: доставка")} className={fieldClass} />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm font-medium">
          {t("Сумма")} *
          <input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={fieldClass} />
        </label>
        <label className="block text-sm font-medium">
          {t("Валюта")}
          <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={fieldClass}>
            <option>SUM</option>
            <option>USD</option>
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">
        {t("Тип оплаты")}
        <select value={paymentType} onChange={(event) => setPaymentType(event.target.value)} className={fieldClass}>
          {incomingPaymentTypes.map((item) => <option key={item} value={item}>{t(item)}</option>)}
        </select>
      </label>
      <p className="text-xs text-slate-500">{t("Расход распределяется на себестоимость товаров поставки пропорционально их стоимости.")}</p>
    </Dialog>
  )
}

type PriceList = { id: number; name: string; currency: string }
type RoundType = "default" | "up" | "down"
type Calculated = { product: string; purchasePrice: number; unitCost: number; averageCost: number; markup: string; price: string }

function roundPrice(value: number, step: number, type: RoundType) {
  if (!(step > 0)) return Math.round(value * 100) / 100
  const ratio = value / step
  const rounded = type === "up" ? Math.ceil(ratio - 1e-9) : type === "down" ? Math.floor(ratio + 1e-9) : Math.round(ratio)
  return rounded * step
}

/** "Наценка": selling prices for a price list from the supply's net costs —
 * price × rate, then + markup %, then rounding (as on the demo). */
export function IncomingRepriceDialog({ incoming, units, onClose, onSaved }: { incoming: Incoming; units: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [averages, setAverages] = useState<Record<string, number>>({})
  const [productNames, setProductNames] = useState<Set<string> | null>(null)
  const [priceListId, setPriceListId] = useState("")
  const [currency, setCurrency] = useState(incoming.currency || "SUM")
  const [rate, setRate] = useState("")
  const [markup, setMarkup] = useState("")
  const [perProduct, setPerProduct] = useState(false)
  const [roundTo, setRoundTo] = useState("")
  const [roundType, setRoundType] = useState<RoundType>("default")
  const [comment, setComment] = useState("")
  const [rows, setRows] = useState<Calculated[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetch("/api/price-lists").then((response) => (response.ok ? response.json() : [])), fetch("/api/products").then((response) => (response.ok ? response.json() : []))])
      .then(([lists, products]) => {
        if (cancelled) return
        setPriceLists(lists as PriceList[])
        const catalog = products as Array<{ name: string; cost: number }>
        setAverages(Object.fromEntries(catalog.map((product) => [product.name, product.cost])))
        setProductNames(new Set(catalog.map((product) => product.name)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const lines = useMemo(() => {
    const merged = new Map<string, { product: string; purchasePrice: number; unitCost: number }>()
    for (const line of supplyCostLines(incoming)) if (!merged.has(line.product)) merged.set(line.product, line)
    return Array.from(merged.values())
  }, [incoming])
  const missing = productNames ? lines.filter((line) => !productNames.has(line.product)).map((line) => line.product) : []
  const priceable = productNames ? lines.filter((line) => productNames.has(line.product)) : lines

  function priceFor(base: number, markupValue: string) {
    const multiplier = Number(rate.replace(",", ".")) || 1
    const percent = Number(markupValue.replace(",", ".")) || 0
    return roundPrice((base * multiplier * (100 + percent)) / 100, Number(roundTo.replace(",", ".")), roundType)
  }

  function calculate() {
    setRows(
      priceable.map((line) => {
        const existing = rows.find((row) => row.product === line.product)
        const lineMarkup = perProduct ? existing?.markup ?? markup : markup
        return {
          product: line.product,
          purchasePrice: line.purchasePrice,
          unitCost: line.unitCost,
          averageCost: averages[line.product] ?? 0,
          markup: lineMarkup,
          price: String(priceFor(line.unitCost, lineMarkup)),
        }
      }),
    )
  }

  function updateRow(product: string, patch: Partial<Calculated>) {
    setRows((current) =>
      current.map((row) => {
        if (row.product !== product) return row
        const next = { ...row, ...patch }
        return patch.markup !== undefined ? { ...next, price: String(priceFor(row.unitCost, patch.markup)) } : next
      }),
    )
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!priceListId || !rows.length) return
    setSaving(true)
    try {
      const response = await fetch(`/api/supplier-incomings/${incoming.id}/reprice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceListId: Number(priceListId), currency, comment, prices: rows.map((row) => ({ product: row.product, price: Number(row.price.replace(",", ".")) || 0 })) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        notify(data.error ? t(data.error) : t("Не удалось сохранить наценку"))
        return
      }
      notify(`${t("Цены обновлены")}: ${data.updated}`)
      onSaved()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  const money = (value: number) => `${(Math.round(value * 100) / 100).toLocaleString("ru-RU")} ${incoming.currency || "SUM"}`

  return (
    <Dialog
      wide
      title={`${t("Наценка")} — ${t("Поставка №")} ${incoming.id}`}
      onClose={onClose}
      onSubmit={save}
      footer={<button type="submit" disabled={saving || !priceListId || !rows.length} className="rounded bg-[#6ccd8b] px-6 py-2.5 font-semibold text-white hover:brightness-95 disabled:opacity-50">{t("Сохранить")}</button>}
    >
      <div className="grid gap-6 md:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <label className="block text-sm font-medium">
            {t("Прайс лист")} *
            <select required value={priceListId} onChange={(event) => setPriceListId(event.target.value)} className={fieldClass}>
              <option value="">{t("Выберите...")}</option>
              {priceLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
          </label>
          {!priceLists.length && <p className="text-xs text-amber-600">{t("Нет прайс-листов — создайте их в разделе «Прайс-листы»")}</p>}
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm font-medium">
              {t("Валюта")}
              <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={fieldClass}>
                <option>SUM</option>
                <option>USD</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              {t("Умножать на (курс)")}
              <input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="1" className={fieldClass} />
            </label>
          </div>
          <label className="block text-sm font-medium">
            {t("Наценка %")}
            <input inputMode="decimal" value={markup} onChange={(event) => setMarkup(event.target.value)} className={fieldClass} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={perProduct} onChange={(event) => setPerProduct(event.target.checked)} />
            {t("Поставить наценку на каждый товар отдельно")}
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block text-sm font-medium">
              {t("Округлить до")}
              <input inputMode="decimal" value={roundTo} onChange={(event) => setRoundTo(event.target.value)} placeholder="100" className={fieldClass} />
            </label>
            <label className="block text-sm font-medium">
              {t("Условия округлений")}
              <select value={roundType} onChange={(event) => setRoundType(event.target.value as RoundType)} className={fieldClass}>
                <option value="default">{t("По умолчанию")}</option>
                <option value="up">{t("Округление вверх")}</option>
                <option value="down">{t("Округление вниз")}</option>
              </select>
            </label>
          </div>
          <button type="button" onClick={calculate} className="w-full rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
            {t("Расчитать")}
          </button>
          <div className="rounded bg-slate-50 p-3 text-xs text-slate-500">
            <p className="font-semibold text-slate-600">{t("Этапы расчета")}</p>
            <p>1. {t("цена = цена * X (если X указано)")}</p>
            <p>2. {t("цена = цена * (100 + наценка) / 100")}</p>
            <p>3. {t("После выполняется округление.")}</p>
          </div>
          <label className="block text-sm font-medium">
            {t("Оставить комментарий")}
            <input value={comment} onChange={(event) => setComment(event.target.value)} className={fieldClass} />
          </label>
        </div>

        <div className="min-w-0">
          <p className="mb-2 font-semibold">{t("Список товаров")}</p>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="py-2 pr-3">{t("Товар")}</th>
                <th className="py-2 pr-3">{t("Закупочная цена")}</th>
                <th className="py-2 pr-3">{t("Себестоимость")}</th>
                <th className="py-2 pr-3">{t("Усред. Себ.")}</th>
                {perProduct && <th className="py-2 pr-3">{t("Наценка %")}</th>}
                <th className="py-2 pr-3">{t("Новая цена")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.product} className="border-t border-slate-100">
                  <td className="py-2 pr-3">{row.product} <span className="text-slate-400">{units[row.product]}</span></td>
                  <td className="py-2 pr-3">{money(row.purchasePrice)}</td>
                  <td className="py-2 pr-3">{money(row.unitCost)}</td>
                  <td className="py-2 pr-3">{money(row.averageCost)}</td>
                  {perProduct && (
                    <td className="py-2 pr-3">
                      <input inputMode="decimal" value={row.markup} onChange={(event) => updateRow(row.product, { markup: event.target.value })} className="w-20 border-b border-slate-300 outline-none" />
                    </td>
                  )}
                  <td className="py-2 pr-3">
                    <input inputMode="decimal" value={row.price} onChange={(event) => updateRow(row.product, { price: event.target.value })} className="w-28 border-b border-slate-300 font-semibold outline-none" />
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={perProduct ? 6 : 5} className="py-10 text-center text-slate-400">{t("Укажите параметры и нажмите «Расчитать»")}</td></tr>
              )}
            </tbody>
          </table>
          {missing.length > 0 && (
            <div className="mt-4 text-sm">
              <p className="font-semibold text-amber-600">{t("Не найденные продукты")}</p>
              <p className="text-slate-500">{missing.join(", ")}</p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  )
}
