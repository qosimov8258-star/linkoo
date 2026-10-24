"use client"

import { useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, X } from "lucide-react"

import { cashMutate } from "@/components/analytics/cash/use-cash"
import { MaterialBody, MaterialCheckbox, MaterialDate, MaterialDialog, MaterialFooter, MaterialInput } from "@/components/analytics/cash-material"
import { RefSearchSelect } from "@/components/analytics/ref-search-select"
import { convertMoney, rateOf, type RateMap } from "@/lib/cash/rates"
import type { CustomerPaymentOptions, CustomerPaymentRow, CustomerPaymentEditInput } from "@/lib/cash/customer-payments-types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
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
  const [date, setDate] = useState("")
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
  const cashboxItems = cashboxes.map((cashbox) => ({ value: String(cashbox.id), label: `${cashbox.name} (${currencyLabel(cashbox.currency)})` }))
  return (
    <MaterialDialog title={t("Принять на кассу")} onClose={onClose} width={400}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <MaterialBody className="pb-[19px] pt-[21px]">
          <p className="break-words text-[13px] leading-4 text-black">
            {t("Выбранные оплаты")}: <strong>{ids.join(", ")}</strong>
          </p>
          <RefSearchSelect
            className="mt-[4px]"
            dense
            searchable={false}
            rowHeight={32}
            label={t("Кассы")}
            items={cashboxItems}
            selected={cashboxItems.filter((item) => item.value === cashboxId)}
            onChange={(next) => setCashboxId(next[0]?.value ?? "")}
          />
          <MaterialDate label={t("Дата")} value={date} onChange={setDate} />
        </MaterialBody>
        <MaterialFooter label={busy ? t("Сохранение...") : t("Сохранить")} busy={busy} disabled={!ids.length} error={error ? t(error) : undefined} />
      </form>
    </MaterialDialog>
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
    <MaterialDialog title={t("Изменить выбранные оплаты")} onClose={onClose} width={450} top={64}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <MaterialBody minHeight={210} className="pt-[19px]">
          <MaterialCheckbox checked={change} onChange={setChange} label={t("Изменить дату счет фактуры")} />
          {change && <MaterialDate className="mt-[14px]" label={t("Дата счет фактуры")} value={invoiceDate} onChange={setInvoiceDate} />}
        </MaterialBody>
        <MaterialFooter label={busy ? t("Сохранение...") : t("Сохранить")} busy={busy} disabled={!change} error={error ? t(error) : undefined} />
      </form>
    </MaterialDialog>
  )
}

/** Confirm dialog (delete: red; submit: blue). */
export function ConfirmDialog({
  title,
  question,
  message,
  confirmLabel,
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
    <MaterialDialog title={t(title)} onClose={onClose} width={500}>
      <MaterialBody minHeight={210} className="pt-[20px]">
        {question && <p className="text-[13px] leading-4 text-black">{t(question)}</p>}
        <div className="-mx-[30px] mt-[21px] flex h-[55px] items-center bg-[#f1f5f8] px-[30px] text-[13px] font-semibold text-black">{message}</div>
      </MaterialBody>
      <MaterialFooter type="button" onClick={onConfirm} busy={busy} label={busy ? t("Загрузка...") : t(confirmLabel)} error={error ? t(error) : undefined} />
    </MaterialDialog>
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
  const [customRate, setCustomRate] = useState(String(row.cashRate ?? rateOf(row.realCurrency, rates, base) ?? 1))
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

  const userItems = users.map((user) => ({ value: user, label: user }))
  const typeItems = [
    { value: "cash", label: t("Наличный") },
    { value: "bank", label: t("Банковский счет") },
  ]
  const orgItems = organizations.map((item) => ({ value: item, label: item }))
  const currencyItems = currencies.map((item) => ({ value: item.code, label: item.label }))
  const pick = (items: Array<{ value: string; label: string }>, value: string) => items.filter((item) => item.value === value)

  return (
    <MaterialDialog title={t("Изменение транзакции")} onClose={onClose} width={400}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <MaterialBody className="pb-[49px] pt-[11px]">
          <p className="text-[13px] leading-4 text-black">
            {t("Клиент")}: <strong>{row.client.name}</strong>
          </p>
          {row.accepted && (
            <p className="mt-2 flex gap-2 text-[12px] leading-4 text-[#f44336]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("Изменить транзакцию, деньги уже приняты в кассу. При изменении изменится баланс кассы тоже.")}
            </p>
          )}
          <RefSearchSelect
            className="mt-[24px]"
            dense
            searchable={false}
            rowHeight={32}
            label={t("Пользователь")}
            items={userItems}
            selected={pick(userItems, createdBy)}
            onChange={(next) => setCreatedBy(next[0]?.value ?? "")}
          />
          <RefSearchSelect
            dense
            searchable={false}
            rowHeight={32}
            label={t("Тип оплаты")}
            items={typeItems}
            selected={pick(typeItems, paymentType)}
            onChange={(next) => !inCashbox && setPaymentType(next[0]?.value === "bank" ? "bank" : "cash")}
          />
          <MaterialInput className="mt-[2px]" label={t("Сумма")} value={amount} inputMode="decimal" onChange={setAmount} />
          <RefSearchSelect
            className="mt-[13px]"
            dense
            searchable={false}
            rowHeight={32}
            label={t("Организация")}
            items={orgItems}
            selected={pick(orgItems, organization)}
            onChange={(next) => setOrganization(next[0]?.value ?? "")}
          />
          <RefSearchSelect
            dense
            searchable={false}
            rowHeight={32}
            label={t("Валюта")}
            items={currencyItems}
            selected={pick(currencyItems, currency)}
            onChange={(next) => !inCashbox && next[0] && setCurrency(next[0].value)}
          />
          <RefSearchSelect
            dense
            searchable={false}
            rowHeight={32}
            label={t("Индивидуальная покрытия долга")}
            items={currencyItems}
            selected={debtCurrency === currency ? [] : pick(currencyItems, debtCurrency)}
            onChange={(next) => !row.orderId && setDebtCurrency(next[0]?.value ?? currency)}
          />
          <MaterialInput className="mt-[9px]" label={t("Курс")} value={customRate} inputMode="decimal" onChange={(value) => { setCustomRate(value); setRateType("custom") }} />
          <MaterialInput className="mt-[16px]" placeholderLabel label={t("Комментарий...")} value={comment} onChange={setComment} />
        </MaterialBody>
        <MaterialFooter label={busy ? t("Сохранение...") : t("Сохранить")} busy={busy} error={error ? t(error) : undefined} />
      </form>
    </MaterialDialog>
  )
}
