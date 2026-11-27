"use client"

import { X } from "lucide-react"
import { FormEvent, useEffect, useState, type ReactNode } from "react"

import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { incomingPaymentTypes, type Incoming } from "./supplier-incomings-data"
import { notify } from "@/lib/notify"
import { currencyLabel } from "@/lib/finance/currency"

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

type CurrencyRow = { code?: string; isBase?: boolean }

/** Every configured currency (Валюты, GET /api/currencies, base first) for the currency selects of
 * supplies, their expenses, "Наценка" and supplier returns. `base` is the base currency, the
 * default of a new document ("SUM" until the list has loaded). */
export function useCurrencyCodes(): { base: string; codes: string[] } {
  const [state, setState] = useState<{ base: string; codes: string[] }>({ base: "SUM", codes: [] })
  useEffect(() => {
    let cancelled = false
    fetch("/api/currencies", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<CurrencyRow[]>) : []))
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return
        const codes = Array.from(new Set(rows.map((row) => String(row.code ?? "").trim()).filter(Boolean)))
        const base = String(rows.find((row) => row.isBase)?.code ?? "").trim() || codes[0] || "SUM"
        setState({ base, codes })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

/** Options of a currency select: the configured codes (the base one when none is configured yet)
 * plus the document's own code when it is not configured any more (an old document stays editable). */
export function currencyChoices(codes: string[], base: string, current: string): string[] {
  const list = codes.length ? [...codes] : [base]
  const value = current.trim()
  if (value && !list.includes(value)) list.push(value)
  return list
}

function Dialog({ title, onClose, onSubmit, children, footer, wide }: { title: string; onClose: () => void; onSubmit: (event: FormEvent) => void; children: ReactNode; footer: ReactNode; wide?: boolean }) {
  const { t } = useLanguage()
  // Escape closes the dialog, like the other dialogs of the app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
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

const fieldClass = "mt-2 block w-full border-b border-slate-200 bg-white pb-1 outline-none focus:border-[#1E4A9A]"

/** "Добавить расход": an additional cost of the supply (delivery, customs…),
 * spread over the lines' net cost. */
export function IncomingExpenseDialog({ incoming, onClose, onSaved }: { incoming: Incoming; onClose: () => void; onSaved: (incoming: Incoming) => void }) {
  const { t } = useLanguage()
  // The business day (Asia/Tashkent): the server refuses a day after it.
  const [date, setDate] = useState(() => todayIso())
  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const currencies = useCurrencyCodes()
  // "" = the default: the supply's currency, else the base currency.
  const [currencyChoice, setCurrency] = useState(incoming.currency || "")
  const currency = currencyChoice || currencies.base
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
            {currencyChoices(currencies.codes, currencies.base, currency).map((code) => <option key={code} value={code}>{currencyLabel(code)}</option>)}
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
