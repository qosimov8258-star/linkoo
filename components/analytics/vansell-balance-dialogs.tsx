"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"

import { formatMoney } from "@/lib/finance/currency"
import { monthEndIso, monthStartIso, nowLocalIso, todayIso } from "@/lib/finance/dates"
import type { FinanceCurrency } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of the "Баланс вансел" page (demo modules 3904, 3906, 3908, 3910):
// "Добавить" / "Добавить расход", edit of a manual movement, "Скачать акт
// сверки" period picker, bulk "Изменить лимит", plus the "Пользователи"
// multi-select of the filter popup and a small snackbar.

export type VansellEmployeeOption = { id: number; name: string }

type FieldErrors = Partial<Record<"user" | "currency" | "amount" | "date" | "form", string>>

const fieldClass = "mt-1 block w-full border-b border-[#dbe0e8] bg-transparent pb-1.5 text-[15px] font-semibold text-[#17233b] outline-none focus:border-[#4f70e7]"

/** Demo normalizeNumber: thousands separated by spaces, comma → dot, up to 3 decimals. */
export function formatAmountInput(raw: string, allowNegative = false): string {
  let text = raw.replace(/\s/g, "").replace(/,/g, ".")
  const negative = allowNegative && text.startsWith("-")
  text = text.replace(/[^\d.]/g, "")
  const [integer, ...rest] = text.split(".")
  const fraction = rest.length ? `.${rest.join("").slice(0, 3)}` : ""
  return `${negative ? "-" : ""}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${fraction}`
}

export function parseAmountInput(text: string): number {
  const value = Number(text.replace(/\s/g, "").replace(/,/g, "."))
  return Number.isFinite(value) ? value : NaN
}

type ErrorBody = { error?: string; details?: { fieldErrors?: Record<string, string[] | undefined> } } | null

/** Error text of a failed JSON response ({ error }) or the HTTP status. */
async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as ErrorBody
  return body?.error || `HTTP ${response.status}`
}

/** Server errors of the movement routes, inline under the matching field (demo formInlineValidate). */
async function responseFieldErrors(response: Response): Promise<FieldErrors> {
  const body = (await response.json().catch(() => null)) as ErrorBody
  const message = body?.error || `HTTP ${response.status}`
  if (response.status === 404 && message === "Вансел не найден") return { user: message }
  if (message === "Валюта не найдена") return { currency: message }
  const fields = body?.details?.fieldErrors ?? {}
  const errors: FieldErrors = {}
  if (fields.employeeId?.length) errors.user = message
  if (fields.currency?.length) errors.currency = message
  if (fields.amount?.length) errors.amount = message
  if (fields.date?.length) errors.date = message
  return Object.keys(errors).length ? errors : { form: message }
}

const openModals: object[] = []

export function VansellModal({
  title,
  width = 500,
  onClose,
  children,
  footer,
}: {
  title: ReactNode
  width?: number
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const { t } = useLanguage()
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    // Escape closes only the topmost of the stacked dialogs (detail → edit / act).
    const token = {}
    openModals.push(token)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openModals[openModals.length - 1] === token) closeRef.current()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      openModals.splice(openModals.indexOf(token), 1)
    }
  }, [])
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/40 px-3 py-10" onClick={onClose}>
      <div className="w-full rounded-md bg-white shadow-2xl" style={{ maxWidth: width }} onClick={(event) => event.stopPropagation()}>
        <header className="flex min-h-[60px] items-center justify-between gap-4 border-b border-[#efefef] pl-7 pr-3">
          <h2 className="text-[15px] font-bold uppercase tracking-wide text-[#333]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-[#f2f5f8]">
            <X className="h-5 w-5" />
          </button>
        </header>
        {children}
        {footer && <footer className="flex items-center justify-end gap-3 border-t border-[#efefef] px-7 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

function FieldError({ text }: { text?: string }) {
  const { t } = useLanguage()
  return text ? <p className="mt-1 text-[12px] font-medium text-[#e57373]">{t(text)}</p> : null
}

function SaveButton({ saving, disabled, onClick }: { saving: boolean; disabled?: boolean; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button type="button" onClick={onClick} disabled={saving || disabled} className="font-bold uppercase tracking-wide text-[#129fdd] disabled:opacity-50">
      {saving ? t("Сохранение...") : t("Сохранить")}
    </button>
  )
}

function CurrencySelect({ value, onChange, currencies, error }: { value: string; onChange: (code: string) => void; currencies: FinanceCurrency[]; error?: string }) {
  const { t } = useLanguage()
  return (
    <label className="relative block text-[13px] font-medium text-[#586174]">
      {t("Валюта")}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`${fieldClass} appearance-none pr-6`}>
        <option value="">—</option>
        {currencies.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
      <FieldError text={error} />
    </label>
  )
}

/** "Добавить" (plus) / "Добавить расход" (minus) — POST /api/vansell-transactions, a 'none_type' movement. */
export function VansellMovementDialog({
  kind,
  employeeId,
  employees,
  currencies,
  onClose,
  onSaved,
}: {
  kind: "add" | "expense"
  employeeId: number
  employees: VansellEmployeeOption[]
  currencies: FinanceCurrency[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [user, setUser] = useState(String(employeeId))
  const [currency, setCurrency] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => nowLocalIso().slice(0, 16))
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const options = useMemo(() => {
    const list = [...employees].sort((a, b) => a.name.localeCompare(b.name, "ru"))
    return list.some((item) => item.id === employeeId) ? list : [{ id: employeeId, name: `#${employeeId}` }, ...list]
  }, [employees, employeeId])

  const save = async () => {
    const value = parseAmountInput(amount)
    const next: FieldErrors = {}
    if (!user) next.user = "Обязательное поле"
    if (!currency) next.currency = "Обязательное поле"
    if (!amount.trim()) next.amount = "Обязательное поле"
    else if (!(value > 0)) next.amount = "Введите сумму больше нуля"
    if (!date) next.date = "Обязательное поле"
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      const response = await fetch("/api/vansell-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: Number(user), currency, amount: value, kind, date, comment: comment.trim() }),
      })
      if (!response.ok) {
        setErrors(await responseFieldErrors(response))
        return
      }
      onSaved()
    } catch {
      setErrors({ form: "Сервер недоступен, попробуйте ещё раз" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <VansellModal title={t(kind === "add" ? "Добавить" : "Добавить расход")} onClose={onClose} footer={<SaveButton saving={saving} onClick={save} />}>
      <div className="flex min-h-[400px] flex-col gap-6 px-7 py-6">
        <label className="relative block text-[13px] font-medium text-[#586174]">
          {t("Пользователь")}
          <select value={user} onChange={(event) => setUser(event.target.value)} className={`${fieldClass} appearance-none pr-6`}>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          <FieldError text={errors.user} />
        </label>
        <CurrencySelect value={currency} onChange={setCurrency} currencies={currencies} error={errors.currency} />
        <label className="block text-[13px] font-medium text-[#586174]">
          {t("Сумма")}
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(formatAmountInput(event.target.value))} className={fieldClass} />
          <FieldError text={errors.amount} />
        </label>
        <label className="block text-[13px] font-medium text-[#586174]">
          {t("Дата создания")}
          <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
          <FieldError text={errors.date} />
        </label>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t("Оставить комментарий...")}
          rows={Math.min(6, Math.max(1, comment.split("\n").length))}
          className="block w-full resize-none border-b border-[#dbe0e8] bg-transparent pb-1.5 text-[15px] text-[#17233b] outline-none placeholder:text-[#586174] focus:border-[#4f70e7]"
        />
        <FieldError text={errors.form} />
      </div>
    </VansellModal>
  )
}

export type VansellEditTarget = { id: number; employeeId: number; amount: number; currency: string; date: string }

/** Edit of a manual ("Нет типа") movement — PUT /api/vansell-transactions/[id] (demo StaffBalanceUpdateForm). */
export function VansellEditMovementDialog({
  target,
  currencies,
  onClose,
  onSaved,
}: {
  target: VansellEditTarget
  currencies: FinanceCurrency[]
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [amount, setAmount] = useState(() => formatAmountInput(String(target.amount), true))
  const [currency, setCurrency] = useState(target.currency)
  const [date, setDate] = useState(() => target.date.slice(0, 16) || nowLocalIso().slice(0, 16))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const value = parseAmountInput(amount)
    const next: FieldErrors = {}
    if (!amount.trim() || amount.trim() === "-") next.amount = "Обязательное поле"
    else if (!Number.isFinite(value) || value === 0) next.amount = "Сумма не может быть равна нулю"
    if (!currency) next.currency = "Обязательное поле"
    if (!date) next.date = "Обязательное поле"
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      const response = await fetch(`/api/vansell-transactions/${target.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: target.employeeId, amount: value, currency, date }),
      })
      if (!response.ok) {
        const mapped = await responseFieldErrors(response)
        // The edit dialog has no "Пользователь" field.
        setErrors(mapped.user ? { form: mapped.user } : mapped)
        return
      }
      onSaved()
    } catch {
      setErrors({ form: "Сервер недоступен, попробуйте ещё раз" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <VansellModal title={t("Изменение баланса вансел")} width={400} onClose={onClose} footer={<SaveButton saving={saving} onClick={save} />}>
      <div className="flex flex-col gap-6 px-7 py-6">
        <label className="block text-[13px] font-medium text-[#586174]">
          {t("Сумма")}
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(formatAmountInput(event.target.value, true))} className={fieldClass} />
          <FieldError text={errors.amount} />
        </label>
        <CurrencySelect value={currency} onChange={setCurrency} currencies={currencies} error={errors.currency} />
        <label className="block text-[13px] font-medium text-[#586174]">
          {t("Дата")}
          <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
          <FieldError text={errors.date} />
        </label>
        <FieldError text={errors.form} />
      </div>
    </VansellModal>
  )
}

/** "Скачать акт сверки" period picker (demo VanSellImportForm): default = current month. */
export function VansellActPeriodDialog({ onClose, onDownload }: { onClose: () => void; onDownload: (period: { from: string; to: string }) => Promise<void> }) {
  const { t } = useLanguage()
  const [from, setFrom] = useState(() => monthStartIso())
  const [to, setTo] = useState(() => monthEndIso())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const download = async () => {
    // Demo: without an end date the act is built for today only.
    const period = !to ? { from: todayIso(), to: todayIso() } : !from ? { from: to, to } : from <= to ? { from, to } : { from: to, to: from }
    setBusy(true)
    setError("")
    try {
      await onDownload(period)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <VansellModal
      title={t("Скачать акт сверки")}
      width={400}
      onClose={onClose}
      footer={
        <button type="button" onClick={download} disabled={busy} className="font-bold uppercase tracking-wide text-[#129fdd] disabled:opacity-50">
          {busy ? t("Загрузка...") : t("Скачать")}
        </button>
      }
    >
      <div className="flex flex-col gap-3 px-7 py-6">
        <span className="text-[13px] font-medium text-[#586174]">{t("Выберите период")}</span>
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-[#dbe0e8] px-2" aria-label={t("С")} />
          <span className="text-[#586174]">—</span>
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 min-w-0 flex-1 rounded-md border border-[#dbe0e8] px-2" aria-label={t("По")} />
        </div>
        {error && <p className="text-[13px] font-medium text-[#e57373]">{error}</p>}
      </div>
    </VansellModal>
  )
}

/** Bulk "Изменить лимит" over the ticked rows: POST /api/vansell-transactions/limits [{employeeId, limit}]. */
export function VansellLimitDialog({
  rows,
  limits,
  onClose,
  onSaved,
}: {
  rows: Array<{ id: number; name: string }>
  /** Current limits by employee id. */
  limits: Map<number, number>
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, limits.has(row.id) ? formatAmountInput(String(limits.get(row.id))) : ""])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const save = async () => {
    const body = rows.map((row) => ({ employeeId: row.id, limit: values[row.id]?.trim() ? parseAmountInput(values[row.id]) : 0 }))
    if (body.some((item) => !Number.isFinite(item.limit) || item.limit < 0)) {
      setError("Введите корректный лимит")
      return
    }
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/vansell-transactions/limits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!response.ok) {
        setError(await responseError(response))
        return
      }
      onSaved()
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <VansellModal title={t("Изменить лимит")} onClose={onClose} footer={<SaveButton saving={saving} disabled={!rows.length} onClick={save} />}>
      <div className="max-h-[55vh] overflow-y-auto px-7 py-4">
        <div className="grid grid-cols-[1fr_180px] gap-4 border-b border-[#efefef] pb-2 text-[13px] font-semibold text-[#586174]">
          <span>{t("Вансел")}</span>
          <span>{t("Лимит")}</span>
        </div>
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[1fr_180px] items-center gap-4 border-b border-dashed border-[#e1e5eb] py-2.5">
            <span className="text-[14px] text-[#17233b]">{row.name}</span>
            <input
              inputMode="decimal"
              value={values[row.id] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [row.id]: formatAmountInput(event.target.value) }))}
              className="border-b border-[#dbe0e8] bg-transparent pb-1 text-[14px] font-semibold outline-none focus:border-[#4f70e7]"
              aria-label={`${t("Лимит")} ${row.name}`}
            />
          </div>
        ))}
        {!rows.length && <p className="py-8 text-center text-[#9aa3b6]">{t("Выберите вансел в таблице")}</p>}
        {error && <p className="pt-3 text-[13px] font-medium text-[#e57373]">{t(error)}</p>}
      </div>
    </VansellModal>
  )
}

/** "Пользователи" multi-select of the filter popup (searchable checkbox list). */
export function VansellUsersSelect({ options, value, onChange }: { options: VansellEmployeeOption[]; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const selected = new Set(value)
  const sorted = useMemo(() => [...options].sort((a, b) => a.name.localeCompare(b.name, "ru")), [options])
  const needle = query.trim().toLocaleLowerCase("ru")
  const visible = needle ? sorted.filter((item) => item.name.toLocaleLowerCase("ru").includes(needle)) : sorted
  const names = sorted.filter((item) => selected.has(String(item.id))).map((item) => item.name)
  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id])
  return (
    <div className="flex flex-col gap-1 md:col-span-2">
      <span className="text-sm text-[#586174]">{t("Пользователи")}</span>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-[#dbe0e8] px-3 py-2 text-left"
      >
        <span className={names.length ? "text-[#17233b]" : "text-[#9aa3b6]"}>{names.length ? names.join(", ") : t("Выберите...")}</span>
        <span className="flex items-center gap-1 text-[#9aa3b6]">
          {value.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t("Очистить")}
              onClick={(event) => {
                event.stopPropagation()
                onChange([])
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") onChange([])
              }}
            >
              <X className="h-4 w-4" />
            </span>
          )}
          <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="rounded-md border border-[#dbe0e8] bg-white">
          <label className="flex items-center gap-2 border-b border-[#efefef] px-3 py-2">
            <Search className="h-4 w-4 text-[#9aa3b6]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-full bg-transparent text-[14px] outline-none" />
          </label>
          <div className="max-h-56 overflow-y-auto py-1">
            {visible.map((item) => {
              const id = String(item.id)
              const checked = selected.has(id)
              return (
                <button key={id} type="button" onClick={() => toggle(id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[14px] hover:bg-[#f2f5f8]">
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? "border-[#4f70e7] bg-[#4f70e7] text-white" : "border-[#9aa3b6]"}`}>
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  {item.name}
                </button>
              )
            })}
            {!visible.length && <p className="px-3 py-3 text-center text-[13px] text-[#9aa3b6]">{t("Ничего не найдено")}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/** Bottom snackbar ("Успешно сохранено"); hides itself after 3 s. */
export function VansellSnackbar({ text, onHide }: { text: string; onHide: () => void }) {
  const { t } = useLanguage()
  useEffect(() => {
    if (!text) return
    const timer = window.setTimeout(onHide, 3000)
    return () => window.clearTimeout(timer)
  }, [text, onHide])
  if (!text) return null
  return <div className="fixed bottom-6 left-1/2 z-[130] -translate-x-1/2 rounded-md bg-[#323232] px-6 py-3 text-[14px] text-white shadow-lg">{t(text)}</div>
}

/** Tooltip body of "Принятие оплаты": bank and cash parts per currency. */
export function paymentHintLines(totals: Record<string, Record<string, number>>, codes: string[], label: (code: string) => string, t: (text: string) => string): string[] {
  return codes.flatMap((code) => [
    `${t("Перечисление")}: ${formatMoney(totals[code]?.bank_transfer_plus ?? 0, 3)} ${label(code)}`,
    `${t("Наличные")}: ${formatMoney(totals[code]?.cash_transfer_plus ?? 0, 3)} ${label(code)}`,
  ])
}
