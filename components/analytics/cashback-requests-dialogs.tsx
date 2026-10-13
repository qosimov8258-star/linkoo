"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Loader2, X } from "lucide-react"

import {
  CASHBACK_REQUEST_STATUSES,
  CASHBACK_REQUEST_STATUS_LABELS,
  cashbackRequestStatusLabel,
  type CashbackRequestCurrency,
  type CashbackRequestDetail,
  type CashbackRequestRow,
} from "@/lib/cashback-requests-types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of "Запросы на снятие кэшбэка" (demo chunk 137): the filter popup
// (4456: Валюта + Статус) and the confirm / reject dialog (5158
// "CashboxConfirmForm": Клиент / Сумма / Валюта / Статус + Касса, or the
// "really reject?" question with Нет / Да).

export const CASHBACK_REQUESTS_API = "/api/cashback-withdrawal-requests"

export type ApiError = Error & { field?: string | null }

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const body = (await response.json().catch(() => null)) as (T & { error?: string; field?: string | null }) | null
  if (!response.ok || !body) {
    const error = new Error(body?.error || `HTTP ${response.status}`) as ApiError
    error.field = body?.field ?? null
    throw error
  }
  return body
}

/** Amount as the demo numberFormat prints it: ru-RU grouping, ≤ 3 decimals, no currency. */
export function requestAmount(value: number): string {
  return value ? formatMoney(value, 3) : "0"
}

// --- Filter popup (4456) ----------------------------------------------------------------------

export type CashbackRequestFilters = { status: string; currency: string }

export function CashbackRequestsFilterPopup({
  open,
  filters,
  currencies,
  onClose,
  onApply,
}: {
  open: boolean
  filters: CashbackRequestFilters
  currencies: CashbackRequestCurrency[]
  onClose: () => void
  onApply: (filters: CashbackRequestFilters) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(filters)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    // Re-seed the draft each time the popup opens.
    setLastOpen(open)
    if (open) setDraft(filters)
  }
  if (!open) return null
  const choices = draft.currency && !currencies.some((item) => item.code === draft.currency) ? [{ code: draft.currency, label: currencyLabel(draft.currency) }, ...currencies] : currencies
  const select = "mt-1 block h-9 w-full cursor-pointer border-b border-[#dbe0e8] bg-transparent text-[13px] text-[#333] outline-none focus:border-[#4f70e7]"
  return (
    <>
      <div className="fixed inset-0 z-[95]" onClick={onClose} />
      <form
        className="absolute left-0 top-0 z-[96] w-[310px] max-w-[calc(100vw-2rem)] bg-white px-5 py-[10px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"
        onSubmit={(event) => {
          event.preventDefault()
          onApply(draft)
          onClose()
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[15px] text-[#5d6474]">{t("Фильтр")}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="p-2 text-[#8f8f8f]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="mt-2 block text-[13px] text-[#999]">
          {t("Валюта")}
          <select value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))} className={select}>
            <option value="">{t("Все")}</option>
            {choices.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-[13px] text-[#999]">
          {t("Статус")}
          <select value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value }))} className={select}>
            <option value="">{t("Все")}</option>
            {CASHBACK_REQUEST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(CASHBACK_REQUEST_STATUS_LABELS[status])}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="mt-[15px] h-9 rounded bg-[#4f70e7] px-4 text-[13px] font-semibold uppercase text-white">
          {t("Применить")}
        </button>
      </form>
    </>
  )
}

// --- Confirm / reject dialog (5158) -------------------------------------------------------------

function DialogFrame({ title, width, onClose, children }: { title: ReactNode; width: number; onClose: () => void; children: ReactNode }) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-10" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="w-full rounded bg-white shadow-xl" style={{ maxWidth: width }} onClick={(event) => event.stopPropagation()}>
        <div className="flex h-[60px] items-center justify-between gap-4 border-b border-[#efefef] pl-[30px] pr-[10px]">
          <h2 className="truncate text-[14px] font-bold uppercase text-[#333]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-[38px] w-[38px] shrink-0 items-center justify-center text-[#666]">
            <X className="h-6 w-6" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function InfoLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-4 leading-[25px]">
      <span>{label}:</span>
      <span className="max-w-[60%] truncate text-right font-semibold">{children}</span>
    </li>
  )
}

export function CashbackRequestDecisionDialog({
  requestId,
  mode,
  onClose,
  onDone,
}: {
  requestId: number
  /** confirm = "Подтвердить" (choose a cashbox → payout), reject = "Отклонить". */
  mode: "confirm" | "reject"
  onClose: () => void
  onDone: (row: CashbackRequestRow) => void
}) {
  const { t } = useLanguage()
  const [detail, setDetail] = useState<CashbackRequestDetail | null>(null)
  const [loadError, setLoadError] = useState("")
  const [cashboxId, setCashboxId] = useState("")
  const [errors, setErrors] = useState<{ cashbox?: string; form?: string }>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchJson<CashbackRequestDetail>(`${CASHBACK_REQUESTS_API}/${requestId}`, { signal: controller.signal })
      .then((data) => {
        setDetail(data)
        // A single matching cashbox is preselected.
        if (data.cashboxes.length === 1) setCashboxId(String(data.cashboxes[0].id))
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [requestId])

  const reject = mode === "reject"
  const request = detail?.request
  const pending = request?.status === "pending"

  const submit = async () => {
    if (!request) return
    if (!reject && !cashboxId) {
      setErrors({ cashbox: "Обязательное поле" })
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const row = await fetchJson<CashbackRequestRow>(`${CASHBACK_REQUESTS_API}/${request.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reject ? { status: "rejected" } : { status: "confirmed", cashboxId: Number(cashboxId) }),
      })
      onDone(row)
    } catch (reason) {
      const error = reason as ApiError
      // Demo formErrorHandler(["cashbox"]): cashbox errors under the field, the rest as a message.
      if (error.field === "cashbox") setErrors({ cashbox: error.message })
      else setErrors({ form: error.message })
    } finally {
      setSaving(false)
    }
  }

  const title = t(reject ? "Отклонить" : "Подтвердить")
  if (!detail) {
    return (
      <DialogFrame title={title} width={loadError ? 500 : 300} onClose={onClose}>
        {loadError ? (
          <p className="px-[30px] py-10 text-center text-[13px] text-[#e57373]">{t(loadError)}</p>
        ) : (
          <div className="flex items-center justify-center py-10 text-[#4f70e7]">
            <Loader2 className="h-8 w-8 animate-spin" aria-label={t("Загрузка...")} />
          </div>
        )}
      </DialogFrame>
    )
  }

  const req = detail.request
  const available = detail.balance
  const short = !reject && req.amount > available
  const button = "h-9 rounded px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-black/5 disabled:opacity-50"
  return (
    <DialogFrame title={title} width={500} onClose={onClose}>
      <form
        className="text-[13px] text-[#333]"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="px-[30px] pb-5 pt-[15px]">
          <ul>
            <InfoLine label={t("Клиент")}>{req.client.name || t("Не указано")}</InfoLine>
            <InfoLine label={t("Сумма")}>{requestAmount(req.amount)}</InfoLine>
            <InfoLine label={t("Валюта")}>{currencyLabel(req.currency) || t("Не указано")}</InfoLine>
            <InfoLine label={t("Статус")}>{t(cashbackRequestStatusLabel(req.status))}</InfoLine>
            {req.client.exists && (
              <InfoLine label={t("Баланс кэшбэка")}>
                <span style={{ color: available > 0 ? "#92ce95" : available < 0 ? "#e27676" : undefined }}>
                  {formatMoney(available, 3)} {currencyLabel(req.currency)}
                </span>
              </InfoLine>
            )}
          </ul>
        </div>
        <div className="border-y border-[#efefef] px-[30px] pb-6 pt-4">
          {!pending ? (
            <p className="font-semibold text-[#e57373]">{t("Запрос уже обработан")}</p>
          ) : reject ? (
            <p className="text-[15px] font-semibold text-black">{t("Вы действительно хотите отклонить этот запрос?")}</p>
          ) : (
            <label className="block text-[13px] text-[#999]">
              {t("Касса")}
              <select
                value={cashboxId}
                onChange={(event) => setCashboxId(event.target.value)}
                autoFocus
                aria-invalid={Boolean(errors.cashbox)}
                className="mt-1 block h-9 w-full cursor-pointer border-b border-[#dbe0e8] bg-transparent text-[13px] text-[#333] outline-none focus:border-[#4f70e7]"
              >
                <option value="">{t("Не выбрано")}</option>
                {detail.cashboxes.map((cashbox) => (
                  <option key={cashbox.id} value={cashbox.id}>
                    {cashbox.name} · {formatMoney(cashbox.balance)} {currencyLabel(cashbox.currency)}
                  </option>
                ))}
              </select>
              {errors.cashbox && <span className="mt-1 block text-[12px] text-[#e57373]">{t(errors.cashbox)}</span>}
              {!detail.cashboxes.length && <span className="mt-1 block text-[12px] text-[#c27c0e]">{t("Нет касс в валюте запроса")}</span>}
            </label>
          )}
          {pending && short && !errors.form && <p className="mt-3 text-[12px] text-[#c27c0e]">{t("Недостаточно кэшбэка у клиента")}</p>}
          {errors.form && <p className="mt-3 text-[13px] font-semibold text-[#e57373]">{t(errors.form)}</p>}
        </div>
        <div className="flex justify-end gap-1 p-[10px]">
          {reject && pending ? (
            <>
              <button type="button" onClick={onClose} className={button}>
                {t("Нет")}
              </button>
              <button type="submit" disabled={saving} className={button}>
                {t("Да")}
              </button>
            </>
          ) : pending ? (
            <button type="submit" disabled={saving} className={button}>
              {t("Подтвердить")}
            </button>
          ) : (
            <button type="button" onClick={onClose} className={button}>
              {t("Закрыть")}
            </button>
          )}
        </div>
      </form>
    </DialogFrame>
  )
}
