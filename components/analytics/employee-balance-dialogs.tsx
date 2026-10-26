"use client"

import { FilterCardSelect, useFilterCard } from "@/components/analytics/balance/filter-bar"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"

import { nowLocalIso, todayIso } from "@/lib/finance/dates"
import type { FinanceCurrency } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of the "Баланс сотрудников" page (fork of the van-sell modules
// 3904 / 3906): "Зачислить" / "Списать", the "Скачать акт сверки" period
// picker, the "Пользователи" multi-select of the filter popup and a small
// snackbar.

export type EmployeeOption = { id: number; name: string }

/** Row menu actions of the demo (⋮): both write a 'none_type' movement
 * (column "Коректировки"); add = +amount, expense = −amount. */
export type EmployeeMovementAction = "add" | "expense"

export const MOVEMENT_ACTION_LABELS: Record<EmployeeMovementAction, string> = {
  add: "Зачислить",
  expense: "Списать",
}

type FieldErrors = Partial<Record<"user" | "currency" | "amount" | "date" | "form", string>>

const fieldClass = "mt-1 block w-full border-b border-[#dbe0e8] bg-transparent pb-1.5 text-[15px] font-semibold text-[#17233b] outline-none focus:border-[#4f70e7]"

/** Demo normalizeNumber: thousands separated by spaces, comma → dot, up to 3 decimals. */
export function formatAmountInput(raw: string): string {
  const text = raw.replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.]/g, "")
  const [integer, ...rest] = text.split(".")
  const fraction = rest.length ? `.${rest.join("").slice(0, 3)}` : ""
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${fraction}`
}

export function parseAmountInput(text: string): number {
  const value = Number(text.replace(/\s/g, "").replace(/,/g, "."))
  return Number.isFinite(value) ? value : NaN
}

type ErrorBody = { error?: string; details?: { fieldErrors?: Record<string, string[] | undefined> } } | null

/** Server error of a failed save, placed under its field like the demo's
 * inline validation: 404 → Пользователь, unknown currency → Валюта, zod
 * fieldErrors (Russian i18n keys) → their fields; anything else → form level. */
async function responseFieldErrors(response: Response): Promise<FieldErrors> {
  const body = (await response.json().catch(() => null)) as ErrorBody
  const message = body?.error || `HTTP ${response.status}`
  if (response.status === 404) return { user: message }
  if (message === "Валюта не найдена") return { currency: message }
  const fields = body?.details?.fieldErrors ?? {}
  const first = (name: string) => fields[name]?.[0] || undefined
  const errors: FieldErrors = {}
  if (first("employeeId")) errors.user = first("employeeId")
  if (first("currency")) errors.currency = first("currency")
  if (first("amount")) errors.amount = first("amount")
  if (first("date")) errors.date = first("date")
  return Object.keys(errors).length ? errors : { form: message }
}

const openModals: object[] = []

export function EmployeeModal({
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
    // Escape closes only the topmost of the stacked dialogs (act → period picker).
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

/** "Зачислить" / "Списать" — POST /api/employee-balance-transactions (type 'none_type'). */
export function EmployeeMovementDialog({
  action,
  employeeId,
  employees,
  currencies,
  onClose,
  onSaved,
}: {
  action: EmployeeMovementAction
  employeeId: number
  employees: EmployeeOption[]
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
  /** Editing a field hides its (and the form-level) error until the next save. */
  const edited = (field: keyof FieldErrors) => setErrors((current) => (current[field] || current.form ? { ...current, [field]: undefined, form: undefined } : current))

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
      const response = await fetch("/api/employee-balance-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: Number(user),
          kind: action,
          type: "none_type",
          currency,
          amount: value,
          date,
          comment: comment.trim(),
        }),
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
    <EmployeeModal
      title={t(MOVEMENT_ACTION_LABELS[action])}
      onClose={onClose}
      footer={
        <button type="button" onClick={save} disabled={saving} className="font-bold uppercase tracking-wide text-[#4f70e7] disabled:opacity-50">
          {saving ? t("Сохранение...") : t("Сохранить")}
        </button>
      }
    >
      <div className="flex flex-col gap-6 px-7 py-6">
        <label className="relative block text-[13px] font-medium text-[#586174]">
          {t("Пользователь")}
          <select
            value={user}
            onChange={(event) => {
              setUser(event.target.value)
              edited("user")
            }}
            className={`${fieldClass} appearance-none pr-6`}
          >
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          <FieldError text={errors.user} />
        </label>
        <label className="relative block text-[13px] font-medium text-[#586174]">
          {t("Валюта")}
          <select
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value)
              edited("currency")
            }}
            className={`${fieldClass} appearance-none pr-6`}
          >
            <option value="">—</option>
            {currencies.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          <FieldError text={errors.currency} />
        </label>
        <label className="block text-[13px] font-medium text-[#586174]">
          {t("Сумма")}
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(formatAmountInput(event.target.value))
              edited("amount")
            }}
            className={fieldClass}
          />
          <FieldError text={errors.amount} />
        </label>
        <label className="block text-[13px] font-medium text-[#586174]">
          {t("Дата создания")}
          <input
            type="datetime-local"
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              edited("date")
            }}
            className={fieldClass}
          />
          <FieldError text={errors.date} />
        </label>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          maxLength={2000}
          placeholder={t("Оставить комментарий...")}
          rows={Math.min(6, Math.max(1, comment.split("\n").length))}
          className="block w-full resize-none border-b border-[#dbe0e8] bg-transparent pb-1.5 text-[15px] text-[#17233b] outline-none placeholder:text-[#586174] focus:border-[#4f70e7]"
        />
        <FieldError text={errors.form} />
      </div>
    </EmployeeModal>
  )
}

/** "Скачать акт сверки" period picker ("Выберите период" + "Скачать"); defaults to the act's period. */
export function EmployeeActPeriodDialog({
  from: initialFrom,
  to: initialTo,
  onClose,
  onDownload,
}: {
  from: string
  to: string
  onClose: () => void
  onDownload: (period: { from: string; to: string }) => Promise<void>
}) {
  const { t } = useLanguage()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const download = async () => {
    // Without an end date the act is built for today only (demo VanSellImportForm).
    const period = !to ? { from: from || todayIso(), to: from || todayIso() } : !from ? { from: to, to } : from <= to ? { from, to } : { from: to, to: from }
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
    <EmployeeModal
      title={t("Скачать акт сверки")}
      width={400}
      onClose={onClose}
      footer={
        <button type="button" onClick={download} disabled={busy} className="font-bold uppercase tracking-wide text-[#4f70e7] disabled:opacity-50">
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
        {error && <p className="text-[13px] font-medium text-[#e57373]">{t(error)}</p>}
      </div>
    </EmployeeModal>
  )
}

/** "Пользователи" multi-select of the filter popup (searchable checkbox list). */
export function EmployeeUsersSelect({ options, value, onChange }: { options: EmployeeOption[]; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const card = useFilterCard()
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
      {card ? (
        <FilterCardSelect label={t("Пользователи")} text={names.join(", ")} onClick={() => setOpen((current) => !current)} />
      ) : (
        <>
        <span className="text-sm text-[#586174]">{t("Пользователи")}</span>
        <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border border-[#dbe0e8] px-3 py-2">
          <button type="button" onClick={() => setOpen((current) => !current)} className={`flex-1 text-left ${names.length ? "text-[#17233b]" : "text-[#9aa3b6]"}`}>
            {names.length ? names.join(", ") : t("Выберите...")}
          </button>
          <span className="flex items-center gap-1 text-[#9aa3b6]">
            {value.length > 0 && (
              <button type="button" aria-label={t("Очистить")} onClick={() => onChange([])}>
                <X className="h-4 w-4" />
              </button>
            )}
            <button type="button" aria-label={t("Пользователи")} onClick={() => setOpen((current) => !current)}>
              <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
            </button>
          </span>
        </div>
        </>
      )}
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
export function EmployeeSnackbar({ text, onHide }: { text: string; onHide: () => void }) {
  const { t } = useLanguage()
  useEffect(() => {
    if (!text) return
    const timer = window.setTimeout(onHide, 3000)
    return () => window.clearTimeout(timer)
  }, [text, onHide])
  if (!text) return null
  return (
    <div role="status" className="fixed bottom-6 left-1/2 z-[130] -translate-x-1/2 rounded bg-[#323232] px-6 py-3 text-[14px] text-white shadow-lg">
      {t(text)}
    </div>
  )
}
