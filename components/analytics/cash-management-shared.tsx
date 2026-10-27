"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { Check, ChevronDown, CircleAlert, Loader2, Search, SearchX, X } from "lucide-react"

import { useFinanceCurrencies } from "@/components/analytics/balance/use-balance"
import type { CashMutationResult } from "@/components/analytics/cash/use-cash"
import { currencyLabel, formatMoney, normCurrency } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import type { RateMap } from "@/lib/cash/rates"
import type { CashOperation, CategoryOptionKey } from "@/lib/cash/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Shared pieces of the "Управления кассой" page (demo #/transaction) and its
// dialogs: money / date formatting as the demo prints them, the modal shell,
// form fields, searchable selects, snackbar, confirm dialog, state blocks and
// small lookup hooks. Data always comes from the cash core (/api/cash/**).

export type Named = { id: number; name: string }

/** POST /api/cash/accept-cash result (lib/cash/accept.ts). */
export type AcceptCashResult = { key: string; id: number; docNo: number; amount: number; currency: string; count: number; paymentIds: number[] }

/** GET /api/cash/categories row (lib/cash/common.ts CategoryInfo; that module is server-only). */
export type CashCategory = {
  id: number
  name: string
  kind: "income" | "expense"
  options: CategoryOptionKey[]
  internal: boolean
  excludeFromPnl: boolean
  parentId: number | null
}

/** Demo amount colours (module 3840): green ≥ 0, red < 0. */
export const CASH_GREEN = "#92ce95"
export const CASH_RED = "#e57373"

/** Demo numberFormat: ru-RU grouping, up to 3 decimals, then the currency ("0 SUM" for zero). */
export function formatCash(value: number, currency: string): string {
  return `${formatMoney(value, 3)} ${currencyLabel(currency)}`
}

/** "08 окт. 2026, 18:42" (demo DD MMM YYYY, HH:mm) in the UI language. */
export function formatCashDate(iso: string, language: string, withTime = true): string {
  if (!iso) return ""
  return formatStatementDate(iso, language, withTime)
}

/** "YYYY.MM.DD" / "HH:mm" of a local ISO date-time (Excel export). */
/** System prefixes the cash core writes in front of a user comment ("Запрос на снятие кэшбэка № 12 · …"). */
const SYSTEM_COMMENT_PREFIX = /^Запрос на снятие кэшбэка № \d+$/

/** Comment of an operation in the UI language: a system prefix is translated, the user's own text stays as typed. */
export function cashCommentText(comment: string, t: (text: string) => string): string {
  const [head, ...rest] = comment.split(" · ")
  return SYSTEM_COMMENT_PREFIX.test(head.trim()) ? [t(head.trim()), ...rest].join(" · ") : comment
}

export function excelDay(iso: string): string {
  return iso ? iso.slice(0, 10).replace(/-/g, ".") : ""
}
export function excelTime(iso: string): string {
  return iso && iso.length >= 16 ? iso.slice(11, 16) : ""
}

/** Two-line amount cell: cashbox currency (bold, green / red) + base-currency line with the rate. */
export function CashAmount({ operation, align = "right" }: { operation: CashOperation; align?: "left" | "right" }) {
  const foreign = normCurrency(operation.currency) !== normCurrency(operation.baseCurrency)
  return (
    <div className={`flex flex-col gap-0.5 whitespace-nowrap ${align === "right" ? "items-end text-right" : "items-start"}`}>
      <span className="font-bold" style={{ color: operation.amount < 0 ? CASH_RED : CASH_GREEN }}>
        {formatCash(operation.amount, operation.currency)}
      </span>
      {foreign && operation.baseAmount !== null && (
        <span className="text-[12px] text-[#586174]">
          {formatCash(operation.baseAmount, operation.baseCurrency)}
          {operation.baseAmount !== 0 && operation.rate ? <span className="text-[11px] text-[#9aa3b6]"> ({formatMoney(operation.rate, 3)})</span> : null}
        </span>
      )}
    </div>
  )
}

/** Writes need role manager (or admin) — same check as the balance pages (GET /api/auth/me). */
export function useCanWrite(): boolean {
  const [canWrite, setCanWrite] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ role?: string }>) : null))
      .then((user) => {
        if (!cancelled) setCanWrite(user?.role === "manager" || user?.role === "admin")
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return canWrite
}

/** True when the signed-in user may change what every permission in `codes` covers
 * (lib/capabilities-catalog.ts): role manager or admin and, for a user restricted by an
 * access right (Права доступа), each code granted — the server rule of hasPermission in
 * lib/rbac.ts. False while loading, so a hidden action never flashes. */
export function useCanManage(codes: readonly string[]): boolean {
  const key = codes.join(",")
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ role?: string; permissions?: string[] | null }>) : null))
      .then((user) => {
        if (cancelled || !user) return
        const writer = user.role === "manager" || user.role === "admin"
        const granted = user.role === "admin" || !Array.isArray(user.permissions) || key.split(",").filter(Boolean).every((code) => user.permissions!.includes(code))
        setAllowed(writer && granted)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [key])
  return allowed
}

/** GET of a JSON array (lookups); [] while loading / on error; url = null skips. */
export function useJsonList<T>(url: string | null): { items: T[]; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; items: T[]; loading: boolean }>({ url: null, items: [], loading: false })
  useEffect(() => {
    if (!url) return
    let cancelled = false
    setState((current) => ({ url, items: current.url === url ? current.items : [], loading: true }))
    fetch(url, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((body: unknown) => {
        if (!cancelled) setState({ url, items: Array.isArray(body) ? (body as T[]) : [], loading: false })
      })
      .catch(() => {
        if (!cancelled) setState({ url, items: [], loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [url])
  return url ? { items: state.items, loading: state.loading } : { items: [], loading: false }
}

/** Currency codes + current rates (base units per unit) for the dialog previews. */
export function useCashRates(): { base: string; rates: RateMap; codes: string[] } {
  const { data } = useFinanceCurrencies()
  return useMemo(() => {
    const base = data?.base ?? "SUM"
    const rates: RateMap = {}
    for (const currency of data?.currencies ?? []) rates[currency.code] = currency.rate
    const codes = (data?.currencies ?? []).map((currency) => currency.code)
    return { base, rates, codes: codes.length ? codes : [base] }
  }, [data])
}

/** Server error → translated text (cashMutate result). */
export function mutationError(result: CashMutationResult<unknown>, t: (text: string) => string): string {
  if (result.ok) return ""
  if (result.status === 403) return t("Недостаточно прав")
  if (result.status === 0) return t("Сервер недоступен, попробуйте ещё раз")
  return t(result.error)
}

// --- layout ---------------------------------------------------------------------------

export const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-[#dbe0e8] bg-white px-3 text-[14px] text-[#17233b] outline-none focus:border-[#4f70e7] disabled:bg-[#f2f5f8] disabled:text-[#7b8497]"

const MODAL_WIDTHS = { sm: "max-w-[420px]", md: "max-w-[560px]", lg: "max-w-[1000px]", xl: "max-w-[1200px]", full: "max-w-[1400px]" } as const

/** Modal shell: full-width sheet on phones, centered card from sm up. */
export function CashModal({
  title,
  onClose,
  size = "md",
  children,
  footer,
  headerExtra,
  zIndex = 100,
}: {
  title: ReactNode
  onClose: () => void
  size?: keyof typeof MODAL_WIDTHS
  children: ReactNode
  footer?: ReactNode
  /** Extra controls in the header (pagination, filters). */
  headerExtra?: ReactNode
  zIndex?: number
}) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 flex items-start justify-center overflow-y-auto bg-black/40 sm:p-4 sm:py-8" style={{ zIndex }} onMouseDown={onClose}>
      <div className={`flex min-h-full w-full flex-col bg-white shadow-xl sm:min-h-0 sm:rounded-lg ${MODAL_WIDTHS[size]}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-3 border-b border-[#e1e5eb] px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="min-w-0 flex-1 text-[17px] font-bold uppercase text-[#17233b]">{title}</h2>
          {headerExtra}
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 px-4 py-4 sm:px-6 sm:py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#e1e5eb] px-4 py-3 sm:px-6 sm:py-4">{footer}</div>}
      </div>
    </div>
  )
}

export function FormField({ label, required, error, children, className = "" }: { label: ReactNode; required?: boolean; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-[13px] text-[#586174] ${className}`}>
      <span>
        {label}
        {required && <span className="text-[#e57373]"> *</span>}
      </span>
      {children}
      {error && <span className="text-[12px] text-[#e57373]">{error}</span>}
    </label>
  )
}

export function ReadonlyField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[13px] text-[#586174]">
      <span>{label}</span>
      <span className="min-h-10 rounded-md bg-[#f2f5f8] px-3 py-2 text-[14px] text-[#17233b]">{value || "—"}</span>
    </div>
  )
}

export function PrimaryButton({ children, onClick, disabled, busy, tone = "blue", type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean; tone?: "blue" | "green" | "red"; type?: "button" | "submit" }) {
  const colors = { blue: "bg-[#4f71dc]", green: "bg-[#71ce87]", red: "bg-[#fa8072]" }[tone]
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-6 font-semibold uppercase text-white hover:brightness-95 disabled:opacity-50 ${colors}`}>
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function SecondaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#dbe0e8] px-5 text-[#586174] hover:bg-[#f2f5f8] disabled:opacity-50">
      {children}
    </button>
  )
}

// --- selects ----------------------------------------------------------------------------

/** depth: nesting level of a tree option (sub-categories are indented under their parent). */
export type PickOption = { value: string; label: string; hint?: string; depth?: number }

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open, close])
  return ref
}

/**
 * Searchable single select. `options` are filtered locally; pass `onSearch`
 * to load them from the server instead (clients). `selectedLabel` shows the
 * current value when it is not among the loaded options (edit prefill).
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  invalid,
  selectedLabel,
  onSearch,
  loading,
  allowClear = true,
}: {
  value: string
  onChange: (value: string, option: PickOption | null) => void
  options: PickOption[]
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  selectedLabel?: string
  onSearch?: (text: string) => void
  loading?: boolean
  allowClear?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const ref = useOutside(open, () => setOpen(false))
  const selected = options.find((option) => option.value === value)
  const label = selected?.label ?? (value ? selectedLabel || value : "")
  const needle = query.trim().toLowerCase()
  const visible = (onSearch || !needle ? options : options.filter((option) => `${option.label} ${option.hint ?? ""}`.toLowerCase().includes(needle))).slice(0, 200)
  const pick = (option: PickOption) => {
    onChange(option.value, option)
    setOpen(false)
    setQuery("")
    setActive(0)
  }
  // Keyboard: ↑/↓ move the highlight, Enter picks it (the first match by default), Escape closes.
  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!visible.length) return
      setActive((current) => (current + (event.key === "ArrowDown" ? 1 : visible.length - 1)) % visible.length)
    } else if (event.key === "Enter") {
      event.preventDefault()
      const option = visible[Math.min(active, visible.length - 1)]
      if (option) pick(option)
    } else if (event.key === "Escape") {
      event.stopPropagation()
      setOpen(false)
    }
  }
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={`${inputClass} flex items-center justify-between gap-2 pr-14 text-left ${invalid ? "border-[#e57373]" : ""}`}
      >
        <span className={`truncate ${label ? "" : "text-[#9aa3b6]"}`}>{label || placeholder || t("Выберите")}</span>
      </button>
      <span className="pointer-events-none absolute right-3 top-3 text-[#9aa3b6]">
        <ChevronDown className="h-4 w-4" />
      </span>
      {allowClear && value && !disabled && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("", null)} className="absolute right-8 top-3 text-[#9aa3b6] hover:text-[#17233b]">
          <X className="h-4 w-4" />
        </button>
      )}
      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full z-[20] mt-1 rounded-md border border-[#e1e5eb] bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#eef1f5] px-3">
            <Search className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
                onSearch?.(event.target.value)
              }}
              onKeyDown={onSearchKey}
              placeholder={t("Поиск")}
              className="h-9 w-full min-w-0 text-[14px] outline-none"
            />
            {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#9aa3b6]" />}
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {!visible.length && <p className="px-3 py-2 text-[13px] text-[#9aa3b6]">{loading ? t("Загрузка...") : t("Ничего не найдено")}</p>}
            {visible.map((option, index) => (
              <button
                key={option.value}
                type="button"
                onClick={() => pick(option)}
                onMouseEnter={() => setActive(index)}
                style={option.depth ? { paddingLeft: 12 + option.depth * 18 } : undefined}
                className={`flex w-full flex-col px-3 py-2 text-left text-[14px] hover:bg-[#f2f5f8] ${option.value === value ? "font-semibold" : ""} ${option.value === value || index === active ? "bg-[#f2f5f8]" : ""}`}
              >
                <span className="truncate">{option.label}</span>
                {option.hint && <span className="truncate text-[12px] text-[#9aa3b6]">{option.hint}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Multi select with search (filter panel, accept-cash filter). */
export function MultiPick({ label, options, value, onChange }: { label: string; options: PickOption[]; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useOutside(open, () => setOpen(false))
  const known = new Map(options.map((option) => [option.value, option.label]))
  const all = [...value.filter((item) => !known.has(item)).map((item) => ({ value: item, label: item })), ...options]
  const needle = query.trim().toLowerCase()
  const visible = (needle ? all.filter((option) => option.label.toLowerCase().includes(needle)) : all).slice(0, 300)
  const toggle = (item: string) => onChange(value.includes(item) ? value.filter((current) => current !== item) : [...value, item])
  return (
    <div ref={ref} className="relative flex min-w-0 flex-col gap-1">
      <span className="text-[13px] text-[#586174]">{label}</span>
      <button type="button" onClick={() => setOpen((current) => !current)} className={`${inputClass} flex items-center justify-between gap-2 text-left`}>
        <span className={`truncate ${value.length ? "" : "text-[#9aa3b6]"}`}>{value.length ? value.map((item) => known.get(item) ?? item).join(", ") : t("Все")}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[20] mt-1 rounded-md border border-[#e1e5eb] bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#eef1f5] px-3">
            <Search className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="h-9 w-full min-w-0 text-[14px] outline-none" />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {!visible.length && <p className="px-3 py-2 text-[13px] text-[#9aa3b6]">{t("Ничего не найдено")}</p>}
            {visible.map((option) => (
              <button key={option.value} type="button" onClick={() => toggle(option.value)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-[#f2f5f8]">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${value.includes(option.value) ? "border-[#4f70e7] bg-[#4f70e7] text-white" : "border-[#c4cbd6]"}`}>
                  {value.includes(option.value) && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Clients are loaded by search (GET /api/clients?q=…) — the list can be large. */
export function useClientSearch(enabled: boolean): { options: PickOption[]; loading: boolean; search: (text: string) => void } {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  const { items, loading } = useJsonList<{ id: number; name: string; phone?: string; agent?: string }>(enabled ? `/api/clients${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}` : null)
  const options = useMemo(
    () => items.slice(0, 100).map((client) => ({ value: String(client.id), label: client.name, hint: [client.phone, client.agent && client.agent !== "Не указано" ? client.agent : ""].filter(Boolean).join(" · ") })),
    [items],
  )
  return { options, loading, search: setQuery }
}

// --- feedback ---------------------------------------------------------------------------

export type SnackbarMessage = { text: string; tone: "success" | "error" }

export function CashSnackbar({ message, onClose }: { message: SnackbarMessage | null; onClose: () => void }) {
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
      className={`fixed bottom-6 left-1/2 z-[300] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-4 rounded-md px-5 py-3 text-[14px] font-medium text-white shadow-lg ${
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

export function ConfirmDialog({
  title,
  text,
  confirmLabel = "Удалить",
  tone = "red",
  busy,
  error,
  onConfirm,
  onClose,
  children,
}: {
  title: string
  text?: ReactNode
  confirmLabel?: string
  tone?: "red" | "blue" | "green"
  busy?: boolean
  error?: string
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}) {
  const { t } = useLanguage()
  return (
    <CashModal
      title={title}
      onClose={onClose}
      size="sm"
      zIndex={160}
      footer={
        <>
          {error && <span className="mr-auto text-[13px] text-[#e57373]">{error}</span>}
          <SecondaryButton onClick={onClose}>{t("Отмена")}</SecondaryButton>
          <PrimaryButton tone={tone} busy={busy} onClick={onConfirm}>
            {t(confirmLabel)}
          </PrimaryButton>
        </>
      }
    >
      {text && <p className="text-[15px] text-[#17233b]">{text}</p>}
      {children}
    </CashModal>
  )
}

export function LoadingBlock({ className = "py-16" }: { className?: string }) {
  const { t } = useLanguage()
  return (
    <div className={`flex items-center justify-center gap-2 text-[#586174] ${className}`}>
      <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
    </div>
  )
}

export function ErrorBlock({ error, onRetry, className = "py-10" }: { error: string; onRetry?: () => void; className?: string }) {
  const { t } = useLanguage()
  return (
    <div className={`flex flex-col items-center gap-3 text-center text-[#586174] ${className}`}>
      <CircleAlert className="h-10 w-10 text-[#e57373]" />
      <p>
        {t("Не удалось выполнить запрос")}: {t(error)}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded-md border border-[#4f70e7] px-4 py-2 font-semibold text-[#4f70e7]">
          {t("Повторить")}
        </button>
      )}
    </div>
  )
}

export function EmptyBlock({ text, className = "py-16" }: { text: string; className?: string }) {
  const { t } = useLanguage()
  return (
    <div className={`flex flex-col items-center gap-3 text-center text-[13px] text-[#666] ${className}`}>
      <SearchX className="h-12 w-12 text-[#999]" />
      {t(text)}
    </div>
  )
}

/** Simple ‹ › pager for dialogs ("1 - 25 из N"). */
export function MiniPager({ page, pageSize, count, onPage }: { page: number; pageSize: number; count: number; onPage: (page: number) => void }) {
  const { t } = useLanguage()
  const last = Math.max(1, Math.ceil(count / pageSize))
  const start = count ? (page - 1) * pageSize + 1 : 0
  const end = Math.min(page * pageSize, count)
  return (
    <div className="flex items-center gap-2 text-[13px] font-normal normal-case text-[#586174]">
      <span className="whitespace-nowrap">
        {start} - {end} {t("из")} {count}
      </span>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("Назад")} className="rounded-full border border-[#4f70e7] px-2 text-[#4f70e7] disabled:border-[#dbe0e8] disabled:text-[#9aa3b6]">
        ‹
      </button>
      <button type="button" disabled={page >= last} onClick={() => onPage(page + 1)} aria-label={t("Вперед")} className="rounded-full border border-[#4f70e7] px-2 text-[#4f70e7] disabled:border-[#dbe0e8] disabled:text-[#9aa3b6]">
        ›
      </button>
    </div>
  )
}

/** Number input value → number (accepts "1 000,5"). */
export function parseAmount(value: string): number {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}
