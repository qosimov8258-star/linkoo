"use client"

import { useState, type ReactNode } from "react"
import { Loader2, X } from "lucide-react"

import { cashMutate } from "@/components/analytics/cash/use-cash"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { MONEY_REQUEST_STATUS_LABELS, type MoneyRequest, type MoneyRequestStatus } from "@/lib/cash/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Expanded row of "Ожидаемые расходы" (demo module 4538 + 4539 + 4540): title
// "Запрос №N (status)" (click closes), left side Поставщик / Сумма оплаты, the
// «ЗАПРОС» form (Сумма, Валюта, Подтвердить|Изменить, Отменить) while the request
// is pending / approved and the user may write, "ОПЛАТА:" balances; right side
// "КОММЕНТАРИЙ:" only when there is a comment. Approve / edit / cancel =
// PATCH /api/cash/money-requests/[id] (demo PUT finance/money_request/<id>).

export const MONEY_REQUEST_STATUS_COLORS: Record<MoneyRequestStatus, string> = {
  pending: "#f0ad4e",
  approved: "rgb(79, 113, 220)",
  given: "#81c784",
  cancelled: "#e57373",
}

const DIGITS = 3

/** Demo normalizeNumber: "1 000 000,5" → 1000000.5; NaN when not a number. */
function parseAmount(value: string): number {
  const text = value.replace(/[\s  ]/g, "").replace(",", ".")
  return text ? Number(text) : Number.NaN
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-4 py-1 leading-[25px]">
      <span className="text-[#586174]">{label}</span>
      <span className="max-w-[60%] truncate text-right font-semibold">{children}</span>
    </li>
  )
}

export function ExpectedExpenseDetail({
  request,
  loading,
  error,
  canManage,
  currencies,
  onClose,
  onSaved,
  onError,
}: {
  request: MoneyRequest | null
  loading: boolean
  error: string
  /** Role manager / admin (demo can_approve_money_request / can_delete_money_request). */
  canManage: boolean
  currencies: string[]
  onClose: () => void
  onSaved: (status: "approved" | "cancelled", updated: MoneyRequest) => void
  onError: (message: string) => void
}) {
  const { t } = useLanguage()

  if (loading && !request) {
    return (
      <div className="flex h-[100px] items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-[#4f70e7]" aria-label={t("Загрузка...")} />
      </div>
    )
  }
  if (!request) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-6 py-5 text-sm text-[#c94848]">
        <span>{error ? t(error) : t("Запрос не найден")}</span>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174]">
          <X className="h-5 w-5" />
        </button>
      </div>
    )
  }

  const status = request.status
  const open = status !== "given" && status !== "cancelled"
  const currency = request.currency
  return (
    <div className="w-full bg-white text-[#333]">
      <div className="relative flex h-[65px] items-center justify-between border-b border-[#efefef] px-4 md:px-[30px]">
        <button type="button" onClick={onClose} className="absolute inset-0 z-[1] cursor-pointer" aria-label={t("Закрыть")} />
        <span className="relative text-[18px] font-semibold">
          {t("Запрос")} №{request.id}{" "}
          <span className="text-[15px]" style={{ color: MONEY_REQUEST_STATUS_COLORS[status] }}>
            ({t(MONEY_REQUEST_STATUS_LABELS[status])})
          </span>
        </span>
        <span className="relative flex items-center gap-2 text-[#9aa3b6]">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          <X className="h-5 w-5" />
        </span>
      </div>

      <div className="flex flex-col md:flex-row">
        <div className="w-full border-b border-[#efefef] md:w-[340px] md:shrink-0 md:border-b-0 md:border-r">
          <div className="border-b border-[#efefef] px-4 py-[15px] md:px-[30px]">
            <ul>
              <Field label={t("Поставщик")}>{request.supplier.name || t("Не указано")}</Field>
              <Field label={t("Сумма оплаты")}>
                {formatMoney(request.amount, DIGITS)} {currencyLabel(currency)}
              </Field>
            </ul>
          </div>

          {open && canManage && (
            <RequestForm key={`${request.id}-${request.status}-${request.amount}-${request.currency}`} request={request} currencies={currencies} onSaved={onSaved} onError={onError} />
          )}

          <div className="px-4 py-[15px] pb-5 md:px-[30px]">
            <p className="mb-1 font-semibold uppercase">{t("Оплата")}:</p>
            <ul>
              <Field label={t("Баланс")}>
                {formatMoney(request.balances.balance, DIGITS)} {currencyLabel(currency)}
              </Field>
              <Field label={t("Резерв")}>
                {formatMoney(request.balances.reserve, DIGITS)} {currencyLabel(currency)}
              </Field>
              <Field label={t("К оплате")}>
                {formatMoney(request.balances.remain, DIGITS)} {currencyLabel(currency)}
              </Field>
            </ul>
          </div>
        </div>

        <div className="min-w-0 flex-1 px-4 py-5 md:px-[30px]">
          {request.comment.trim() && (
            <>
              <p className="mb-2 font-semibold uppercase">{t("Комментарий")}:</p>
              <p className="whitespace-pre-wrap break-words">{request.comment}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RequestForm({
  request,
  currencies,
  onSaved,
  onError,
}: {
  request: MoneyRequest
  currencies: string[]
  onSaved: (status: "approved" | "cancelled", updated: MoneyRequest) => void
  onError: (message: string) => void
}) {
  const { t } = useLanguage()
  const [amount, setAmount] = useState(() => formatMoney(request.amount, DIGITS))
  const [currency, setCurrency] = useState(request.currency)
  const [busy, setBusy] = useState<"approved" | "cancelled" | null>(null)
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null)
  const options = [...new Set([...currencies, request.currency])]

  const submit = async (status: "approved" | "cancelled") => {
    setFieldError(null)
    let body: { status: "approved" | "cancelled"; amount?: number; currency?: string } = { status }
    if (status === "approved") {
      const value = parseAmount(amount)
      if (!Number.isFinite(value) || value <= 0) {
        setFieldError({ field: "amount", message: "Укажите сумму" })
        return
      }
      body = { status, amount: value, currency }
    }
    setBusy(status)
    const result = await cashMutate<MoneyRequest>("PATCH", `/api/cash/money-requests/${request.id}`, body)
    setBusy(null)
    if (result.ok) {
      onSaved(status, result.data)
      return
    }
    if (result.field === "amount" || result.field === "currency") setFieldError({ field: result.field, message: result.error })
    onError(result.error)
  }

  return (
    <div className="border-b border-[#efefef] px-4 py-[15px] md:px-[30px]">
      <p className="mb-2 font-semibold uppercase">{t("Запрос")}</p>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[#586174]">{t("Сумма")}</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className={`h-9 border-b bg-transparent text-[15px] outline-none ${fieldError?.field === "amount" ? "border-[#e57373]" : "border-[#dbe0e8] focus:border-[#4f70e7]"}`}
          />
          {fieldError?.field === "amount" && <span className="text-xs text-[#e57373]">{t(fieldError.message)}</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[#586174]">{t("Валюта")}</span>
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            className={`h-9 border-b bg-transparent text-[15px] outline-none ${fieldError?.field === "currency" ? "border-[#e57373]" : "border-[#dbe0e8]"}`}
          >
            {options.map((code) => (
              <option key={code} value={code}>
                {currencyLabel(code)}
              </option>
            ))}
          </select>
          {fieldError?.field === "currency" && <span className="text-xs text-[#e57373]">{t(fieldError.message)}</span>}
        </label>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void submit("approved")}
            className="flex h-9 items-center gap-2 rounded px-4 text-sm font-semibold uppercase text-white disabled:opacity-60"
            style={{ background: "rgb(79, 113, 220)" }}
          >
            {busy === "approved" && <Loader2 className="h-4 w-4 animate-spin" />}
            {request.status === "approved" ? t("Изменить") : t("Подтвердить")}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void submit("cancelled")}
            className="flex h-9 items-center gap-2 rounded px-4 text-sm font-semibold uppercase text-white disabled:opacity-60"
            style={{ background: "#e57373" }}
          >
            {busy === "cancelled" && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("Отменить")}
          </button>
        </div>
      </div>
    </div>
  )
}
