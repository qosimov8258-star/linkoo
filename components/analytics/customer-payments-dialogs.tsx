"use client"

import { useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, X } from "lucide-react"

import { cashMutate } from "@/components/analytics/cash/use-cash"
import { convertMoney, rateOf, type RateMap } from "@/lib/cash/rates"
import type { CustomerPaymentOptions, CustomerPaymentRow, CustomerPaymentEditInput } from "@/lib/cash/customer-payments-types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of "Оплаты от клиентов": "Принять на кассу" (demo 3508), "Изменить
// выбранные оплаты" (3512), "Изменение транзакции" (2122) and the confirm
// dialog (3128) used by delete / resend. Each reports a Russian error from the
// API through t() and calls onDone() after a successful write.

const fieldClass = "h-10 w-full rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b] disabled:bg-[#f2f5f8] disabled:text-[#9aa3b6]"

export function PaymentModal({ title, onClose, children, width = 400 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-10" onClick={onClose}>
      <div className="w-full rounded-lg bg-white shadow-xl" style={{ maxWidth: width }} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b border-[#e1e5eb] px-5 py-4">
          <h2 className="text-[15px] font-bold uppercase tracking-wide text-[#17233b]">{t(title)}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-[#586174]">{t(text)}</span>
      {children}
    </label>
  )
}

function ErrorLine({ error }: { error: string }) {
  const { t } = useLanguage()
  return error ? <p className="rounded-md bg-[#fdecec] px-3 py-2 text-sm text-[#d64545]">{t(error)}</p> : null
}

function SaveButton({ busy, disabled, label = "Сохранить" }: { busy: boolean; disabled?: boolean; label?: string }) {
  const { t } = useLanguage()
  return (
    <button type="submit" disabled={busy || disabled} className="h-10 w-full rounded-md bg-[#4f70e7] font-semibold text-white disabled:opacity-50">
      {busy ? t("Сохранение...") : t(label)}
    </button>
  )
}

/** "ПРИНЯТЬ НА КАССУ": selected payments → cashbox + date (POST /api/cash/accept-cash). */
export function AcceptCashboxDialog({
  ids,
  cashboxes,
  onClose,
  onDone,
}: {
  ids: number[]
  cashboxes: CustomerPaymentOptions["cashboxes"]
  onClose: () => void
  onDone: (count: number) => void
}) {
  const { t } = useLanguage()
  const [cashboxId, setCashboxId] = useState("")
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async () => {
    if (!cashboxId) return setError("Выберите кассу")
    setBusy(true)
    setError("")
    const result = await cashMutate<{ count: number }>("POST", "/api/cash/accept-cash", { cashboxId: Number(cashboxId), date: date || undefined, ids })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onDone(result.data.count)
  }
  return (
    <PaymentModal title="Принять на кассу" onClose={onClose}>
      <form
        className="flex flex-col gap-4 px-5 py-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p className="text-[14px] text-[#17233b]">
          {t("Выбранные оплаты")}: <strong className="break-words">{ids.join(", ")}</strong>
        </p>
        <Label text="Кассы">
          <select value={cashboxId} onChange={(event) => setCashboxId(event.target.value)} className={fieldClass} required>
            <option value="">{t("Выберите кассу")}</option>
            {cashboxes.map((cashbox) => (
              <option key={cashbox.id} value={cashbox.id}>
                {cashbox.name} ({currencyLabel(cashbox.currency)})
              </option>
            ))}
          </select>
        </Label>
        <Label text="Дата">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} required />
        </Label>
        <ErrorLine error={error} />
        <SaveButton busy={busy} disabled={!ids.length} />
      </form>
    </PaymentModal>
  )
}

/** "Изменить выбранные оплаты": invoice date of the selected payments. */
export function BulkUpdateDialog({ ids, onClose, onDone }: { ids: number[]; onClose: () => void; onDone: () => void }) {
  const { t } = useLanguage()
  const [change, setChange] = useState(false)
  const [invoiceDate, setInvoiceDate] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async () => {
    setBusy(true)
    setError("")
    const result = await cashMutate("POST", "/api/cash/customer-payments/bulk-update", { ids, changeInvoiceDate: change, invoiceDate: invoiceDate || null })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onDone()
  }
  return (
    <PaymentModal title="Изменить выбранные оплаты" onClose={onClose} width={460}>
      <form
        className="flex flex-col gap-4 px-5 py-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p className="text-[14px] text-[#17233b]">
          {t("Выбранные оплаты")}: <strong className="break-words">{ids.join(", ")}</strong>
        </p>
        <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
          <input type="checkbox" checked={change} onChange={(event) => setChange(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
          {t("Изменить дату счет фактуры")}
        </label>
        {change && (
          <Label text="Дата счет фактуры">
            <input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className={fieldClass} />
          </Label>
        )}
        <ErrorLine error={error} />
        <SaveButton busy={busy} disabled={!change} />
      </form>
    </PaymentModal>
  )
}

/** Confirm dialog (delete: red; submit: blue). */
export function ConfirmDialog({
  title,
  question,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  error = "",
  onConfirm,
  onClose,
}: {
  title: string
  question?: string
  message: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  error?: string
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  return (
    <PaymentModal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3 px-5 py-5">
        {question && <p className="text-[14px] text-[#586174]">{t(question)}</p>}
        <p className="text-[15px] font-semibold text-[#17233b]">{message}</p>
        <ErrorLine error={error} />
        <div className="mt-2 flex gap-3">
          <button type="button" onClick={onClose} className="h-10 flex-1 rounded-md border border-[#dbe0e8] font-semibold text-[#586174]">
            {t("Отмена")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`h-10 flex-1 rounded-md font-semibold text-white disabled:opacity-50 ${danger ? "bg-[#e5484d]" : "bg-[#4f70e7]"}`}
          >
            {busy ? t("Загрузка...") : t(confirmLabel)}
          </button>
        </div>
      </div>
    </PaymentModal>
  )
}

const positiveOrNull = (value: string) => {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** "Изменение транзакции" (demo ClientBalanceUpdateForm) → PUT /api/cash/customer-payments/[id]. */
export function EditPaymentDialog({
  row,
  options,
  onClose,
  onDone,
}: {
  row: CustomerPaymentRow
  options: CustomerPaymentOptions | null
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useLanguage()
  const base = options?.baseCurrency ?? "SUM"
  const rates: RateMap = useMemo(() => Object.fromEntries((options?.currencies ?? []).map((currency) => [currency.code, currency.rate])), [options])
  const currencies = options?.currencies ?? [{ code: base, label: currencyLabel(base), rate: 1 }]
  const inCashbox = Boolean(row.cashbox)
  const [amount, setAmount] = useState(String(row.realAmount))
  const [currency, setCurrency] = useState(row.cashbox?.currency ?? row.realCurrency)
  const [debtCurrency, setDebtCurrency] = useState(row.currency)
  const [rateType, setRateType] = useState<"current" | "custom">(row.rateType === "custom" ? "custom" : "current")
  const [customRate, setCustomRate] = useState(String(row.cashRate ?? rateOf(row.realCurrency, rates, base) ?? ""))
  const [debtRate, setDebtRate] = useState(String(row.debtRate ?? rateOf(row.currency, rates, base) ?? ""))
  const [paymentType, setPaymentType] = useState(row.paymentType)
  const [organization, setOrganization] = useState(row.organization)
  const [createdBy, setCreatedBy] = useState(row.createdBy)
  const [comment, setComment] = useState(row.comment)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const cash = positiveOrNull(amount)
  const custom = rateType === "custom"
  const cashForeign = currency !== base
  const debtForeign = debtCurrency !== base && debtCurrency !== currency
  const converts = currency !== debtCurrency
  const preview =
    cash && converts
      ? convertMoney(cash, currency, debtCurrency, rates, base, {
          fromRate: custom && cashForeign ? positiveOrNull(customRate) : null,
          toRate: custom && debtForeign ? positiveOrNull(debtRate) : null,
        })
      : null
  const cashRate = custom && cashForeign ? positiveOrNull(customRate) : rateOf(currency, rates, base)
  const baseAmount = cash && cashRate ? cash * cashRate : null

  const users = useMemo(() => {
    const list = options?.users ?? []
    return row.createdBy && !list.includes(row.createdBy) ? [row.createdBy, ...list] : list
  }, [options, row.createdBy])
  const organizations = useMemo(() => {
    const list = options?.organizations ?? []
    return row.organization && !list.includes(row.organization) ? [row.organization, ...list] : list
  }, [options, row.organization])

  const submit = async () => {
    if (!cash) return setError("Укажите сумму")
    const body: CustomerPaymentEditInput = {
      amount: cash,
      currency,
      debtCurrency,
      rateType,
      customRate: custom && cashForeign ? (positiveOrNull(customRate) ?? undefined) : undefined,
      debtRate: custom && debtForeign ? (positiveOrNull(debtRate) ?? undefined) : undefined,
      paymentType,
      organization,
      createdBy,
      comment,
    }
    setBusy(true)
    setError("")
    const result = await cashMutate("PUT", `/api/cash/customer-payments/${row.id}`, body)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onDone()
  }

  return (
    <PaymentModal title="Изменение транзакции" onClose={onClose} width={440}>
      <form
        className="flex flex-col gap-4 px-5 py-5"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p className="text-[14px] text-[#17233b]">
          {t("Клиент")}: <strong>{row.client.name}</strong>
        </p>
        {row.accepted && (
          <p className="flex gap-2 rounded-md bg-[#fdecec] px-3 py-2 text-[13px] text-[#d64545]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {t("Изменить транзакцию, деньги уже приняты в кассу. При изменении изменится баланс кассы тоже.")}
          </p>
        )}
        <Label text="Пользователь">
          <select value={createdBy} onChange={(event) => setCreatedBy(event.target.value)} className={fieldClass}>
            {users.map((user) => (
              <option key={user} value={user}>
                {user}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Тип оплаты">
          <select value={paymentType} disabled={inCashbox} onChange={(event) => setPaymentType(event.target.value === "bank" ? "bank" : "cash")} className={fieldClass}>
            <option value="cash">{t("Наличные")}</option>
            <option value="bank">{t("Банковский счет")}</option>
          </select>
        </Label>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Label text="Сумма">
            <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={fieldClass} required />
          </Label>
          <Label text="Валюта">
            <select value={currency} disabled={inCashbox} onChange={(event) => setCurrency(event.target.value)} className={fieldClass}>
              {currencies.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </Label>
        </div>
        {inCashbox && row.cashbox && (
          <p className="-mt-2 text-[12px] text-[#9aa3b6]">
            {t("Касса")}: {row.cashbox.name}
          </p>
        )}
        <Label text="Организация">
          <select value={organization} onChange={(event) => setOrganization(event.target.value)} className={fieldClass}>
            <option value="">{t("Не указано")}</option>
            {organizations.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Label>
        <Label text="Индивидуальная покрытия долга">
          <select value={debtCurrency} disabled={Boolean(row.orderId)} onChange={(event) => setDebtCurrency(event.target.value)} className={fieldClass}>
            {currencies.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </Label>
        {(cashForeign || converts) && (
          <div className="flex flex-col gap-3 rounded-md bg-[#f2f5f8] px-3 py-3">
            <div className="flex flex-wrap gap-4 text-[14px] text-[#17233b]">
              {(["current", "custom"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2">
                  <input type="radio" name="rateType" checked={rateType === mode} onChange={() => setRateType(mode)} className="h-4 w-4 accent-[#4f70e7]" />
                  {t(mode === "current" ? "Текущий курс" : "Индивидуальный")}
                </label>
              ))}
            </div>
            {custom && cashForeign && (
              <Label text={`${t("Курс")} ${currencyLabel(currency)}`}>
                <input inputMode="decimal" value={customRate} onChange={(event) => setCustomRate(event.target.value)} className={fieldClass} />
              </Label>
            )}
            {custom && debtForeign && (
              <Label text={`${t("Курс")} ${currencyLabel(debtCurrency)}`}>
                <input inputMode="decimal" value={debtRate} onChange={(event) => setDebtRate(event.target.value)} className={fieldClass} />
              </Label>
            )}
            {converts && (
              <p className="text-[14px] text-[#17233b]">
                {t("После конвертации")}: <strong>{preview === null ? "—" : `${formatMoney(preview, 3)} ${currencyLabel(debtCurrency)}`}</strong>
              </p>
            )}
            {cashForeign && baseAmount !== null && (
              <p className="text-[13px] text-[#586174]">
                {t("В основной валюте")}: {formatMoney(baseAmount)} {currencyLabel(base)}
              </p>
            )}
          </div>
        )}
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={t("Комментарий...")}
          rows={2}
          className="w-full rounded-md border border-[#dbe0e8] px-3 py-2 text-[#17233b]"
        />
        <ErrorLine error={error} />
        <SaveButton busy={busy} />
      </form>
    </PaymentModal>
  )
}
