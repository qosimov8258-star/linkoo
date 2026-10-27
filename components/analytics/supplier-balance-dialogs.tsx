"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, X } from "lucide-react"

import { currencyLabel } from "@/lib/finance/currency"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import type { FinanceCurrency } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of "Баланс поставщиков" (demo modules 3913 / 3914 / 3915 + the
// delete confirm): "Добавить приход / расход поставщику", "Изменение баланса
// поставщика", "Запрос средств", "Подтверждение удаления", plus the small
// form primitives, the organization multi-select of the filter popup and
// the snackbar. All writes go to /api/supplier-balance-transactions(/[id]).

export type SupplierPaymentType = "" | "cash" | "bank"

/** GET /api/supplier-balance-transactions/[id] (see lib/supplier-balance-repo.ts). */
type SupplierBalanceTransaction = {
  id: number
  supplierId: number
  supplierName: string
  kind: "add" | "expense" | "fund_request"
  currency: string
  amount: number
  signedAmount: number
  date: string
  comment: string
  paymentType: SupplierPaymentType
  organization: string
  branch: string
}

type Named = { id: number; name: string }

/** Demo PaymentTypeSearchField options (supplier documents use these labels). */
export const SUPPLIER_PAYMENT_TYPES: Array<{ value: "bank" | "cash"; label: string }> = [
  { value: "bank", label: "Банковский счет" },
  { value: "cash", label: "Наличный" },
]

export function supplierPaymentTypeLabel(value: string): string {
  return SUPPLIER_PAYMENT_TYPES.find((item) => item.value === value)?.label ?? ""
}

/** "1 200 000,5" → 1200000.5 (NaN when not a number). */
function parseAmount(text: string): number {
  const normalized = text.replace(/[\s ]/g, "").replace(",", ".")
  return normalized ? Number(normalized) : Number.NaN
}

/** Keeps digits, one separator and (when `signed`) a leading minus — the demo's numeric normalize. */
function normalizeAmount(text: string, signed = false): string {
  const sign = signed && text.trim().startsWith("-") ? "-" : ""
  const body = text.replace(/[^\d.,\s]/g, "")
  return sign + body.replace(/^\s+/, "")
}

type SendResult = { ok: true } | { ok: false; error: string; fields: Record<string, string> }

async function sendJson(url: string, method: string, body?: unknown): Promise<SendResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.ok) return { ok: true }
    const data = (await response.json().catch(() => null)) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } } | null
    const fields: Record<string, string> = {}
    for (const [name, messages] of Object.entries(data?.details?.fieldErrors ?? {})) if (messages?.[0]) fields[name] = messages[0]
    return { ok: false, error: data?.error || `HTTP ${response.status}`, fields }
  } catch {
    return { ok: false, error: "Сервер недоступен", fields: {} }
  }
}

// --- primitives ----------------------------------------------------------------

export function FormField({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-[#586174]">{label}</span>
      <div className={`relative border-b pb-1.5 ${error ? "border-[#e57373]" : "border-[#dbe0e8]"}`}>{children}</div>
      {error && <span className="mt-1 block text-xs text-[#e57373]">{error}</span>}
    </label>
  )
}

const inputClass = "mt-1 block w-full bg-transparent text-[15px] font-semibold text-[#17233b] outline-none"
const selectClass = `${inputClass} appearance-none pr-6`

export function SelectInput({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 top-2 h-4 w-4 text-[#9aa3b6]" />
    </>
  )
}

function DialogShell({
  title,
  width = 500,
  onClose,
  onSubmit,
  saving = false,
  submitLabel = "Сохранить",
  error,
  children,
}: {
  title: ReactNode
  width?: number
  onClose: () => void
  onSubmit?: () => void
  saving?: boolean
  submitLabel?: string
  error?: string
  children: ReactNode
}) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-12" onClick={onClose}>
      <form
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (!saving) onSubmit?.()
        }}
        className="w-full rounded-md bg-white shadow-2xl"
        style={{ maxWidth: width }}
      >
        <header className="flex items-center justify-between border-b border-[#efefef] px-8 py-5">
          <h2 className="text-[15px] font-bold uppercase tracking-wide text-[#333]">{title}</h2>
          <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="text-[#666]">
            <X className="h-6 w-6" />
          </button>
        </header>
        <div className="space-y-5 px-8 py-6">
          {children}
          {error && <p className="rounded bg-[#fdecec] px-3 py-2 text-sm text-[#c94b4b]">{error}</p>}
        </div>
        {onSubmit && (
          <footer className="flex justify-end border-t border-[#efefef] px-8 py-4">
            <button type="submit" disabled={saving} className="text-[13px] font-bold uppercase tracking-wide text-[#4f70e7] disabled:opacity-50">
              {saving ? t("Сохранение...") : t(submitLabel)}
            </button>
          </footer>
        )}
      </form>
    </div>
  )
}

function CurrencyOptions({ currencies }: { currencies: FinanceCurrency[] }) {
  return (
    <>
      {currencies.map((currency) => (
        <option key={currency.code} value={currency.code}>
          {currency.label || currencyLabel(currency.code)}
        </option>
      ))}
    </>
  )
}

function NameOptions({ names, current }: { names: string[]; current: string }) {
  const { t } = useLanguage()
  const list = current && !names.includes(current) ? [current, ...names] : names
  return (
    <>
      <option value="">{t("Не указано")}</option>
      {list.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </>
  )
}

function PaymentTypeSelect({ value, onChange }: { value: SupplierPaymentType; onChange: (value: SupplierPaymentType) => void }) {
  const { t } = useLanguage()
  return (
    <SelectInput value={value} onChange={(next) => onChange(next as SupplierPaymentType)}>
      <option value="">{t("Не указано")}</option>
      {SUPPLIER_PAYMENT_TYPES.map((item) => (
        <option key={item.value} value={item.value}>
          {t(item.label)}
        </option>
      ))}
    </SelectInput>
  )
}

function useFieldErrors() {
  const { t } = useLanguage()
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState("")
  return {
    fields,
    error,
    reset: () => {
      setFields({})
      setError("")
    },
    fail: (result: Extract<SendResult, { ok: false }>) => {
      setFields(result.fields)
      setError(Object.keys(result.fields).length ? "" : t(result.error))
    },
    setField: (name: string, message: string) => setFields({ [name]: message }),
  }
}

// --- "Добавить приход / расход поставщику" ------------------------------------

export function SupplierTransactionDialog({
  mode,
  supplier,
  currencies,
  baseCurrency,
  organizations,
  branches,
  onClose,
  onSaved,
}: {
  /** add = green "+" (Прочие приходы), expense = red "−" (Прочие расходы). */
  mode: "add" | "expense"
  supplier: Named
  currencies: FinanceCurrency[]
  baseCurrency: string
  organizations: string[]
  branches: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [paymentType, setPaymentType] = useState<SupplierPaymentType>("")
  const [currency, setCurrency] = useState(baseCurrency)
  const [amount, setAmount] = useState("")
  const [branch, setBranch] = useState("")
  const [organization, setOrganization] = useState("")
  const [date, setDate] = useState(() => nowLocalIso().slice(0, 16))
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)
  const errors = useFieldErrors()

  const submit = async () => {
    errors.reset()
    const value = parseAmount(amount)
    if (!(value > 0)) return errors.setField("amount", t("Сумма должна быть больше нуля"))
    setSaving(true)
    const result = await sendJson("/api/supplier-balance-transactions", "POST", {
      supplierId: supplier.id,
      kind: mode,
      currency,
      amount: Math.abs(value),
      paymentType,
      organization,
      branch,
      date,
      comment,
    })
    setSaving(false)
    if (result.ok) onSaved()
    else errors.fail(result)
  }

  return (
    <DialogShell
      title={t(mode === "add" ? "Добавить приход поставщику" : "Добавить расход поставщику")}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      error={errors.error}
    >
      <p className="text-[14px] text-[#586174]">
        {t("Поставщик")}: <b className="text-[#17233b]">{supplier.name}</b>
      </p>
      <FormField label={t("Тип оплаты")} error={errors.fields.paymentType}>
        <PaymentTypeSelect value={paymentType} onChange={setPaymentType} />
      </FormField>
      <FormField label={t("Валюта")} error={errors.fields.currency}>
        <SelectInput value={currency} onChange={setCurrency}>
          <CurrencyOptions currencies={currencies} />
        </SelectInput>
      </FormField>
      <FormField label={t("Сумма")} error={errors.fields.amount}>
        <input value={amount} inputMode="decimal" autoFocus onChange={(event) => setAmount(normalizeAmount(event.target.value))} className={inputClass} />
      </FormField>
      <FormField label={t("Филиал")} error={errors.fields.branch}>
        <SelectInput value={branch} onChange={setBranch}>
          <NameOptions names={branches} current={branch} />
        </SelectInput>
      </FormField>
      <FormField label={t("Организация")} error={errors.fields.organization}>
        <SelectInput value={organization} onChange={setOrganization}>
          <NameOptions names={organizations} current={organization} />
        </SelectInput>
      </FormField>
      <FormField label={t("Дата создания")} error={errors.fields.date}>
        <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
      </FormField>
      <FormField label="" error={errors.fields.comment}>
        <textarea
          value={comment}
          rows={1}
          placeholder={t("Комментарий...")}
          onChange={(event) => setComment(event.target.value)}
          className="mt-1 block max-h-[72px] min-h-[24px] w-full resize-y bg-transparent text-[15px] text-[#17233b] outline-none placeholder:text-[#586174]"
        />
      </FormField>
    </DialogShell>
  )
}

// --- "Изменение баланса поставщика" -------------------------------------------

export function SupplierTransactionEditDialog({
  id,
  currencies,
  organizations,
  onClose,
  onSaved,
}: {
  /** supplier_balance_transactions.id (StatementRow.sourceId of a supplier_manual row). */
  id: number
  currencies: FinanceCurrency[]
  organizations: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [item, setItem] = useState<SupplierBalanceTransaction | null>(null)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/supplier-balance-transactions/${id}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error((body as { error?: string } | null)?.error || `HTTP ${response.status}`)
        setItem(body as SupplierBalanceTransaction)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [id])

  if (!item) {
    return (
      <DialogShell title={t("Изменение баланса поставщика")} onClose={onClose}>
        <p className={`py-8 text-center ${loadError ? "text-[#e57373]" : "text-[#9aa3b6]"}`}>{loadError ? t(loadError) : t("Загрузка...")}</p>
      </DialogShell>
    )
  }
  return <EditForm item={item} currencies={currencies} organizations={organizations} onClose={onClose} onSaved={onSaved} />
}

function EditForm({
  item,
  currencies,
  organizations,
  onClose,
  onSaved,
}: {
  item: SupplierBalanceTransaction
  currencies: FinanceCurrency[]
  organizations: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [paymentType, setPaymentType] = useState<SupplierPaymentType>(item.paymentType)
  const [amount, setAmount] = useState(String(item.signedAmount))
  const [currency, setCurrency] = useState(item.currency)
  const [organization, setOrganization] = useState(item.organization)
  const [date, setDate] = useState(() => (parseAnyDate(item.date) ?? nowLocalIso()).slice(0, 16))
  const [comment, setComment] = useState(item.comment)
  const [saving, setSaving] = useState(false)
  const errors = useFieldErrors()
  const currencyList = currencies.some((entry) => entry.code === currency)
    ? currencies
    : [...currencies, { code: currency, label: currencyLabel(currency), name: currency, rate: null, isBase: false, id: null }]

  const submit = async () => {
    errors.reset()
    const value = parseAmount(amount)
    if (!Number.isFinite(value) || value === 0) return errors.setField("amount", t("Обязательное поле"))
    setSaving(true)
    const result = await sendJson(`/api/supplier-balance-transactions/${item.id}`, "PUT", { amount: value, currency, paymentType, organization, date, comment })
    setSaving(false)
    if (result.ok) onSaved()
    else errors.fail(result)
  }

  return (
    <DialogShell title={t("Изменение баланса поставщика")} onClose={onClose} onSubmit={submit} saving={saving} error={errors.error}>
      {item.supplierName && (
        <p className="text-[14px] text-[#586174]">
          {t("Поставщик")}: <b className="text-[#17233b]">{item.supplierName}</b>
        </p>
      )}
      <FormField label={t("Тип оплаты")} error={errors.fields.paymentType}>
        <PaymentTypeSelect value={paymentType} onChange={setPaymentType} />
      </FormField>
      <FormField label={t("Сумма")} error={errors.fields.amount}>
        <input value={amount} inputMode="decimal" onChange={(event) => setAmount(normalizeAmount(event.target.value, true))} className={inputClass} />
      </FormField>
      <FormField label={t("Валюта")} error={errors.fields.currency}>
        <SelectInput value={currency} onChange={setCurrency}>
          <CurrencyOptions currencies={currencyList} />
        </SelectInput>
      </FormField>
      <FormField label={t("Организация")} error={errors.fields.organization}>
        <SelectInput value={organization} onChange={setOrganization}>
          <NameOptions names={organizations} current={organization} />
        </SelectInput>
      </FormField>
      <FormField label={t("Дата создания")} error={errors.fields.date}>
        <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
      </FormField>
      <FormField label="" error={errors.fields.comment}>
        <textarea
          value={comment}
          rows={1}
          placeholder={t("Комментарий...")}
          onChange={(event) => setComment(event.target.value)}
          className="mt-1 block max-h-[72px] min-h-[24px] w-full resize-y bg-transparent text-[15px] text-[#17233b] outline-none placeholder:text-[#586174]"
        />
      </FormField>
    </DialogShell>
  )
}

// --- "Запрос средств" ------------------------------------------------------------

export function SupplierRequestDialog({
  supplierId,
  suppliers,
  currencies,
  baseCurrency,
  onClose,
  onSaved,
}: {
  /** Preset supplier (row of the request tab). */
  supplierId: number | null
  suppliers: Named[]
  currencies: FinanceCurrency[]
  baseCurrency: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [provider, setProvider] = useState(supplierId ? String(supplierId) : "")
  const [amount, setAmount] = useState("")
  const [currency, setCurrency] = useState(baseCurrency)
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)
  const errors = useFieldErrors()

  const submit = async () => {
    errors.reset()
    if (!provider) return errors.setField("supplierId", t("Выберите поставщика"))
    const value = parseAmount(amount)
    if (!(value > 0)) return errors.setField("amount", t("Сумма должна быть больше нуля"))
    setSaving(true)
    const result = await sendJson("/api/supplier-balance-transactions", "POST", { supplierId: Number(provider), kind: "fund_request", amount: value, currency, comment })
    setSaving(false)
    if (result.ok) onSaved()
    else errors.fail(result)
  }

  return (
    <DialogShell title={t("Запрос средств")} onClose={onClose} onSubmit={submit} saving={saving} error={errors.error}>
      <FormField label={t("Поставщик")} error={errors.fields.supplierId}>
        <SelectInput value={provider} onChange={setProvider}>
          <option value="">{t("Выберите поставщика")}</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </SelectInput>
      </FormField>
      <FormField label={t("Сумма")} error={errors.fields.amount}>
        <input value={amount} inputMode="decimal" autoFocus onChange={(event) => setAmount(normalizeAmount(event.target.value))} className={inputClass} />
      </FormField>
      <FormField label={t("Валюта")} error={errors.fields.currency}>
        <SelectInput value={currency} onChange={setCurrency}>
          <CurrencyOptions currencies={currencies} />
        </SelectInput>
      </FormField>
      <FormField label="" error={errors.fields.comment}>
        <textarea
          value={comment}
          rows={1}
          placeholder={t("Комментарий...")}
          onChange={(event) => setComment(event.target.value)}
          className="mt-1 block max-h-[72px] min-h-[24px] w-full resize-y bg-transparent text-[15px] text-[#17233b] outline-none placeholder:text-[#586174]"
        />
      </FormField>
    </DialogShell>
  )
}

// --- delete confirm --------------------------------------------------------------

/** `onFailed` gets the server's reason (e.g. a paid money request cannot be deleted). */
export function SupplierDeleteDialog({ id, onClose, onDeleted, onFailed }: { id: number; onClose: () => void; onDeleted: () => void; onFailed: (error?: string) => void }) {
  const { t } = useLanguage()
  const [saving, setSaving] = useState(false)
  const remove = async () => {
    setSaving(true)
    const result = await sendJson(`/api/supplier-balance-transactions/${id}`, "DELETE")
    setSaving(false)
    if (result.ok) onDeleted()
    else onFailed(result.error)
  }
  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center bg-black/40 px-4 pt-32" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-full max-w-[420px] rounded-md bg-white shadow-2xl">
        <header className="border-b border-[#efefef] px-6 py-4 text-[15px] font-bold uppercase text-[#333]">{t("Подтверждение удаления")}</header>
        <div className="space-y-2 px-6 py-5 text-[14px] text-[#17233b]">
          <p>{t("Вы уверены что хотите удалить эти данные?")}</p>
          <p className="font-semibold">№ {id}</p>
        </div>
        <footer className="flex justify-end gap-6 border-t border-[#efefef] px-6 py-4 text-[13px] font-bold uppercase tracking-wide">
          <button type="button" onClick={onClose} className="text-[#586174]">
            {t("Отмена")}
          </button>
          <button type="button" onClick={remove} disabled={saving} className="text-[#e57373] disabled:opacity-50">
            {t("Удалить")}
          </button>
        </footer>
      </div>
    </div>
  )
}

// --- filter popup: organization multi-select --------------------------------------

export function MultiSelectField({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  const all = [...value.filter((item) => !options.includes(item)), ...options]
  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name])
  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <span className="text-[13px] font-semibold text-black">{label}</span>
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex h-9 items-center justify-between gap-2 border-b border-[#dbe0e8] px-0 text-left text-[13px] text-[#17233b]">
        <span className="truncate">{value.length ? value.join(", ") : t("Все")}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[5] mt-1 max-h-64 overflow-y-auto rounded-md border border-[#e1e5eb] bg-white py-1 shadow-lg">
          {!all.length && <p className="px-3 py-2 text-sm text-[#9aa3b6]">{t("Ничего не найдено")}</p>}
          {all.map((name) => (
            <button key={name} type="button" onClick={() => toggle(name)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-[#f2f5f8]">
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${value.includes(name) ? "border-[#4f70e7] bg-[#4f70e7] text-white" : "border-[#c4cbd6]"}`}>
                {value.includes(name) && <Check className="h-3 w-3" />}
              </span>
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- snackbar ----------------------------------------------------------------------

export type SnackbarMessage = { text: string; tone: "success" | "error" }

export function Snackbar({ message, onClose }: { message: SnackbarMessage | null; onClose: () => void }) {
  const { t } = useLanguage()
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(onClose, 3500)
    return () => window.clearTimeout(timer)
  }, [message, onClose])
  if (!message) return null
  return (
    <div
      role="status"
      className={`fixed bottom-6 left-1/2 z-[140] flex -translate-x-1/2 items-center gap-4 rounded-md px-5 py-3 text-[14px] font-medium text-white shadow-lg ${
        message.tone === "success" ? "bg-[#323232]" : "bg-[#c94b4b]"
      }`}
    >
      {t(message.text)}
      <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
