"use client"

import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Loader2 } from "lucide-react"

import { RefSearchSelect } from "@/components/analytics/ref-search-select"
import { FilterSelect, RefFilterPanel } from "@/components/ref/list-kit"

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
  const currencyByLabel = new Map(choices.map((item) => [item.label, item.code]))
  const statusByLabel = new Map(CASHBACK_REQUEST_STATUSES.map((status) => [t(CASHBACK_REQUEST_STATUS_LABELS[status]), status]))
  const labelOfCurrency = choices.find((item) => item.code === draft.currency)?.label ?? ""
  const labelOfStatus = draft.status ? t(CASHBACK_REQUEST_STATUS_LABELS[draft.status as (typeof CASHBACK_REQUEST_STATUSES)[number]] ?? "") : ""
  return (
    <>
      <div className="fixed inset-0 z-[95]" onClick={onClose} />
      <div className="absolute left-0 top-0 z-[96]">
        <RefFilterPanel
          narrow
          onClose={onClose}
          onApply={() => {
            onApply(draft)
            onClose()
          }}
          applyClassName="mt-2"
        >
          <FilterSelect label={t("Валюта")} value={labelOfCurrency} options={choices.map((item) => item.label)} onChange={(label) => setDraft((value) => ({ ...value, currency: currencyByLabel.get(label) ?? "" }))} />
          <FilterSelect label={t("Статус")} value={labelOfStatus} options={[...statusByLabel.keys()]} onChange={(label) => setDraft((value) => ({ ...value, status: statusByLabel.get(label) ?? "" }))} />
        </RefFilterPanel>
      </div>
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
  // Material-UI modal dialog: centred, 54 % black overlay, 60px title bar.
  return createPortal(
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/[0.54] font-sans text-[13px] text-[#333]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]"
        style={{ width, maxWidth: "100%" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <span className="truncate text-[13px] font-bold uppercase text-[#333]">{title}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

function InfoLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex w-full flex-wrap justify-between leading-[25px]">
      <span>{label}:</span>
      <span className="max-w-[50%] truncate text-right font-semibold">{children}</span>
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
  const button = "h-9 min-w-[88px] cursor-pointer px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-black/5 disabled:opacity-50"
  return (
    <DialogFrame title={title} width={500} onClose={onClose}>
      <form
        className="text-[13px] text-[#333]"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="px-[30px] py-[15px]">
          <ul>
            <InfoLine label={t("Клиент")}>{req.client.name || t("Не указано")}</InfoLine>
            <InfoLine label={t("Сумма")}>{requestAmount(req.amount)}</InfoLine>
            <InfoLine label={t("Валюта")}>{currencyLabel(req.currency) || t("Не указано")}</InfoLine>
            <InfoLine label={t("Статус")}>{t(cashbackRequestStatusLabel(req.status))}</InfoLine>
          </ul>
        </div>
        <div className="flex border-b border-[#efefef] pl-[30px] pr-[10px]">
          {!pending ? (
            <p className="py-3 font-semibold text-[#e57373]">{t("Запрос уже обработан")}</p>
          ) : reject ? (
            <div className="-mt-[10px] mb-5 text-[15px] font-semibold text-black">{t("Вы действительно хотите отклонит этот запрос?")}</div>
          ) : (
            <div className="-mb-[10px] -mt-[4px] w-full">
              <RefSearchSelect
                label={t("Касса")}
                items={detail.cashboxes.map((cashbox) => ({ value: String(cashbox.id), label: cashbox.name }))}
                selected={detail.cashboxes.filter((cashbox) => String(cashbox.id) === cashboxId).map((cashbox) => ({ value: String(cashbox.id), label: cashbox.name }))}
                onChange={(next) => setCashboxId(next[0]?.value ?? "")}
                error={errors.cashbox ? t(errors.cashbox) : undefined}
                searchable={false}
                rowHeight={32}
                dense
              />
            </div>
          )}
        </div>
        {errors.form && <p className="px-[30px] pt-3 text-[13px] font-semibold text-[#e57373]">{t(errors.form)}</p>}
        <div className="flex justify-end p-[10px]">
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
