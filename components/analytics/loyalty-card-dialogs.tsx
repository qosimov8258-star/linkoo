"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, X, XCircle } from "lucide-react"

import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  cashbackTypeLabel,
  type LoyaltyCardDetail,
  type LoyaltyCardOptions,
  type LoyaltyHistoryRow,
  type LoyaltyTransactionResult,
} from "@/lib/loyalty-card-types"

// Dialogs of "Накопительная карта": the client's cashback history (demo 4934
// "Информация по клиенту"), "Добавить приход / расход клиенту" (4935) and the
// filter popup (4418: "Тип клиента" → "Подкатегория").

export const LOYALTY_API = "/api/loyalty-card"
export const DETAIL_PAGE_SIZE = 25

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

function DialogFrame({ title, width, onClose, children, footer }: { title: ReactNode; width: number; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-black/45 px-4 py-10" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full rounded bg-white shadow-xl" style={{ maxWidth: width }} onClick={(event) => event.stopPropagation()}>
        <div className="flex h-[60px] items-center justify-between gap-4 border-b border-[#efefef] pl-[30px] pr-[10px]">
          <h2 className="truncate text-[14px] font-bold uppercase text-[#333]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-[38px] w-[38px] shrink-0 items-center justify-center text-[#666]">
            <X className="h-6 w-6" />
          </button>
        </div>
        {children}
        {footer && <div className="flex justify-end border-t border-[#efefef] p-[10px]">{footer}</div>}
      </div>
    </div>
  )
}

/** Client name, or "Клиент удалён #id" for movements of a deleted client. */
export function useClientName() {
  const { t } = useLanguage()
  return (client: { id: number; name: string; exists: boolean }) => (client.exists ? client.name || "No" : `${t("Клиент удалён")} #${client.id}`)
}

// --- "Информация по клиенту" ----------------------------------------------------------------

function historyNote(row: LoyaltyHistoryRow, t: (text: string) => string): string {
  const parts: string[] = []
  if (row.comment) parts.push(row.comment)
  else if (row.payout) parts.push(`${t("Выдача денег для кэшбека")}${row.payout.docNo ? ` № ${row.payout.docNo}` : ""}`)
  if (row.payout?.cashbox) parts.push(`${t("Касса")}: ${row.payout.cashbox}`)
  if (row.createdBy) parts.push(row.createdBy)
  return parts.join(" · ")
}

export function LoyaltyInfoDialog({
  clientId,
  page,
  onPage,
  onClose,
}: {
  clientId: number
  /** 1-based (demo dPage). */
  page: number
  onPage: (page: number) => void
  onClose: () => void
}) {
  const { t, language } = useLanguage()
  const clientName = useClientName()
  const [data, setData] = useState<LoyaltyCardDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetchJson<LoyaltyCardDetail>(`${LOYALTY_API}/${clientId}?page=${page}&pageSize=${DETAIL_PAGE_SIZE}`, { signal: controller.signal })
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [clientId, page])

  const count = data?.count ?? 0
  const lastPage = Math.max(1, Math.ceil(count / DETAIL_PAGE_SIZE))
  const start = count ? (page - 1) * DETAIL_PAGE_SIZE + 1 : 0
  const end = Math.min(page * DETAIL_PAGE_SIZE, count)
  const column = "w-1/4 px-2 text-left"

  return (
    <DialogFrame title={`${t("Информация по клиенту")} ${data ? clientName(data.client) : ""}`} width={1000} onClose={onClose}>
      {error ? (
        <p className="px-[30px] py-10 text-center text-[#e57373]">{t(error)}</p>
      ) : (
        <div className={`px-[30px] text-[13px] text-[#333] ${loading ? "opacity-60" : ""}`}>
          <div className="flex items-center border-b border-[#efefef] py-[15px] font-semibold">
            <div className={column}>{t("Тип")}</div>
            <div className={column}>{t("Акция")}</div>
            <div className={column}>{t("Дата")}</div>
            <div className={column}>{t("Сумма")}</div>
          </div>
          <div className="max-h-[445px] overflow-y-auto">
            {data?.rows.map((row) => {
              const note = historyNote(row, t)
              return (
                <div key={row.id} className="flex items-center border-b border-dashed border-[#e1e5eb] py-[15px] last:border-b-0">
                  <div className={column}>
                    <div>{t(cashbackTypeLabel(row.type))}</div>
                    {note && <div className="mt-0.5 text-[12px] text-[#999]">{note}</div>}
                  </div>
                  <div className={column}>{row.promotion}</div>
                  <div className={column}>{row.date ? formatStatementDate(row.date, language, true) : t("Не указано")}</div>
                  <div className={`${column} font-semibold`}>
                    {formatMoney(row.amount, 3)} {currencyLabel(row.currency)}
                  </div>
                </div>
              )
            })}
            {!loading && data && data.rows.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-14 text-[13px] font-semibold text-[#666]">
                <span aria-hidden className="text-5xl">🤖</span>
                {t("Пока транзакции нет")}
              </div>
            )}
            {loading && !data && <div className="py-14 text-center text-[#9aa3b6]">{t("Загрузка...")}</div>}
          </div>
          <div className="my-4 flex items-center justify-end gap-2 text-[#5d6474]">
            <span>
              {start} - {end} {t("из")} {count}
            </span>
            <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("Назад")} className="p-1 text-black/60 disabled:opacity-30">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" disabled={page >= lastPage} onClick={() => onPage(page + 1)} aria-label={t("Вперед")} className="p-1 text-black/60 disabled:opacity-30">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </DialogFrame>
  )
}

// --- "Добавить приход / расход клиенту" -----------------------------------------------------

/** Demo normalizer: digits with one decimal separator (spaces / commas allowed while typing). */
function parseAmount(value: string): number {
  const cleaned = value.replace(/[\s ]/g, "").replace(",", ".")
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return Number.NaN
  return Number(cleaned)
}

export function LoyaltyTransactionDialog({
  client,
  kind,
  balances,
  options,
  onClose,
  onSaved,
}: {
  client: { id: number; name: string }
  /** add = "Добавить" (приход), expense = "Списать" (расход). */
  kind: "add" | "expense"
  /** The client's current cashback balances (shown in place of the demo's division balances). */
  balances: Record<string, number>
  options: LoyaltyCardOptions | null
  onClose: () => void
  onSaved: (result: LoyaltyTransactionResult) => void
}) {
  const { t } = useLanguage()
  const [price, setPrice] = useState("")
  const [currency, setCurrency] = useState(options?.baseCurrency ?? "SUM")
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<{ price?: string; currency?: string; form?: string }>({})
  const [saving, setSaving] = useState(false)

  const currencies = options?.currencies ?? [{ code: currency, label: currencyLabel(currency) }]
  const amount = parseAmount(price)
  const current = balances[currency] ?? 0
  const overdraw = kind === "expense" && amount > 0 && amount > current

  const submit = async () => {
    const next: typeof errors = {}
    if (!price.trim()) next.price = "Обязательное поле"
    else if (!(amount > 0)) next.price = "Введите положительное число"
    if (!currency) next.currency = "Обязательное поле"
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      const result = await fetchJson<LoyaltyTransactionResult>(LOYALTY_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, kind, amount, currency, comment: comment.trim() }),
      })
      onSaved(result)
      onClose()
    } catch (reason) {
      setErrors({ form: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setSaving(false)
    }
  }

  const input = "mt-1 block w-full border-b border-[#e8e8e8] bg-transparent pb-1.5 text-[13px] font-normal text-black outline-none focus:border-[#129fdd]"
  const label = "block text-[13px] font-bold text-black"
  return (
    <DialogFrame
      title={t(kind === "expense" ? "Добавить расход клиенту" : "Добавить приход клиенту")}
      width={500}
      onClose={onClose}
      footer={
        <button type="submit" form="loyalty-transaction-form" disabled={saving} className="h-9 rounded px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-black/5 disabled:opacity-50">
          {t("Сохранить")}
        </button>
      }
    >
      <form
        id="loyalty-transaction-form"
        className="px-[30px] py-[10px] text-[13px] text-[#333]"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="py-[10px]">
          {t("Клиент")}: <strong>{client.name || "No"}</strong>
        </div>
        <div className="min-h-[250px] space-y-5 pt-1">
          <label className={label}>
            {t("Цена")}
            <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" autoFocus className={input} aria-invalid={Boolean(errors.price)} />
            {errors.price && <span className="mt-1 block text-[12px] text-[#e57373]">{t(errors.price)}</span>}
          </label>
          <label className={label}>
            {t("Валюта")}
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={`${input} cursor-pointer`}>
              {currencies.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
            {errors.currency && <span className="mt-1 block text-[12px] text-[#e57373]">{t(errors.currency)}</span>}
          </label>
          <label className={label}>
            {t("Комментарий")}
            <input value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} className={input} />
          </label>
          {overdraw && <p className="text-[12px] text-[#c27c0e]">{t("Сумма больше остатка кэшбэка клиента")}</p>}
          {errors.form && <p className="text-[13px] font-semibold text-[#e57373]">{t(errors.form)}</p>}
        </div>
      </form>
    </DialogFrame>
  )
}

// --- Filter popup (4418) --------------------------------------------------------------------

export function LoyaltyFilterDialog({
  open,
  clientType,
  options,
  onClose,
  onApply,
}: {
  open: boolean
  clientType: string
  options: LoyaltyCardOptions | null
  onClose: () => void
  onApply: (clientType: string) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(clientType)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    // Re-seed the draft each time the popup opens.
    setLastOpen(open)
    if (open) setDraft(clientType)
  }
  if (!open) return null
  const types = options?.clientTypes ?? []
  const choices = draft && !types.includes(draft) ? [draft, ...types] : types
  const select = "mt-1 block h-9 w-full border-b border-[#dbe0e8] bg-transparent text-[13px] text-[#333] outline-none focus:border-[#4f70e7] disabled:text-[#bbb]"
  return (
    <>
      <div className="fixed inset-0 z-[95]" onClick={onClose} />
      <form
        className="absolute -left-[30px] -top-[19px] z-[96] w-[310px] bg-white px-5 pb-[10px] pt-5 shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"
        onSubmit={(event) => {
          event.preventDefault()
          onApply(draft)
          onClose()
        }}
      >
        <div className="flex h-[30px] items-center justify-between">
          <span className="text-[15px] text-[#777]">{t("Фильтр")}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#555]">
            <XCircle className="h-6 w-6" strokeWidth={1.5} />
          </button>
        </div>
        <label className="relative mt-[28px] block h-[40px] border-b border-[#d5dae1]">
          <span className={`pointer-events-none absolute left-0 ${draft ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>{t("Тип клиента")}</span>
          <select value={draft} onChange={(event) => setDraft(event.target.value)} className="absolute inset-x-0 bottom-0 h-[26px] w-full appearance-none bg-transparent text-[13px] outline-none">
            <option value=""></option>
            {choices.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 10 5" className="pointer-events-none absolute bottom-[10px] right-[2px] h-[5px] w-[10px] fill-[#757575]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
        </label>
        {draft && (
          <label className="mt-3 block text-[13px] text-[#999]">
            {t("Подкатегория")}
            {/* Client types have no sub-types in this database. */}
            <select value="" disabled className={select}>
              <option value="">{t("Не указано")}</option>
            </select>
          </label>
        )}
        <button type="submit" className="mt-[22px] h-9 rounded-[3px] bg-[#5d6474] px-4 text-[13px] font-semibold uppercase text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          {t("Применить")}
        </button>
      </form>
    </>
  )
}
