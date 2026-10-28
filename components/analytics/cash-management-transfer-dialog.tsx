"use client"

import { useState } from "react"

import { cashMutate } from "@/components/analytics/cash/use-cash"
import { MaterialDate } from "@/components/analytics/cash-material"
import {
  CashModal,
  FormField,
  PrimaryButton,
  ReadonlyField,
  SearchSelect,
  formatCash,
  inputClass,
  mutationError,
  parseAmount,
  useCashRates,
  useJsonList,
  type Named,
} from "@/components/analytics/cash-management-shared"
import { resolveTransfer, transferAmountTo, TRANSFER_MAX_PERCENTAGE, TRANSFER_MIN_PERCENTAGE } from "@/lib/cash/rates"
import type { CashboxWithBalance, CashTransferInput, CashTransferResult } from "@/lib/cash/types"
import { currencyLabel, formatMoney, normCurrency } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// "Перевод" (demo module 3849, TransactionSendForm): Текущая касса (a select
// in "Общий объем"), С организации, Касса получатель, На организацию,
// Сумма с кассы + Процент (same currency, cash ↔ bank) or + Курс (different
// currencies), Дата создания, Комментарий, Деньги накопленные за период →
// POST /api/cash/transfers (two legs: type 1 out, type 2 in).
// The amounts follow the server's resolveTransfer (lib/cash/rates.ts): a transfer
// never creates money — "Процент" is 50…100, a "Курс" at most 10 % worse and
// 2 % better than the currency table; the dialog shows the same error before sending.

type Errors = Partial<Record<"from" | "to" | "amount" | "rate" | "percentage" | "comment" | "form", string>>

const SERVER_FIELDS: Record<string, keyof Errors> = {
  fromCashbox: "from",
  toCashbox: "to",
  amountFrom: "amount",
  amountTo: "amount",
  rate: "rate",
  percentage: "percentage",
  comment: "comment",
}

export function CashTransferDialog({
  fromCashbox,
  cashboxes,
  onClose,
  onSaved,
}: {
  /** The selected cashbox; null = "Общий объем" (the source is chosen here). */
  fromCashbox: CashboxWithBalance | null
  cashboxes: CashboxWithBalance[]
  onClose: () => void
  onSaved: (result: CashTransferResult) => void
}) {
  const { t, language } = useLanguage()
  const { base, rates } = useCashRates()
  const organizations = useJsonList<Named>("/api/organizations").items
  const [fromId, setFromId] = useState(fromCashbox ? String(fromCashbox.id) : "")
  const [toId, setToId] = useState("")
  const [fromOrganization, setFromOrganization] = useState("")
  const [toOrganization, setToOrganization] = useState("")
  const [amount, setAmount] = useState("")
  const [percentage, setPercentage] = useState("100")
  const [rate, setRate] = useState("")
  const [date, setDate] = useState(() => todayIso())
  const [comment, setComment] = useState("")
  const [accumulated, setAccumulated] = useState({ from: "", to: "" })
  const [periodOpen, setPeriodOpen] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  const source = cashboxes.find((item) => String(item.id) === fromId) ?? null
  const target = cashboxes.find((item) => String(item.id) === toId) ?? null
  const fromCurrency = source ? normCurrency(source.currency, base) : ""
  const toCurrency = target ? normCurrency(target.currency, base) : ""
  const sameCurrency = Boolean(source && target) && fromCurrency === toCurrency
  const percentMode = sameCurrency && source?.type !== target?.type
  const rateMode = Boolean(source && target) && !sameCurrency
  const amountFrom = parseAmount(amount)
  // The default "Курс" follows transferAmountTo: base per source unit, base per target unit, or target per source unit.
  const defaultRate = rateMode ? transferAmountTo({ amountFrom: 1, fromCurrency, toCurrency, baseCurrency: base, rates }).rate : null
  // Same rules as the server: the preview shows what the target receives, or why it cannot.
  const resolved =
    source && target && amountFrom > 0
      ? resolveTransfer({
          amountFrom,
          fromCurrency,
          toCurrency,
          fromType: source.type,
          toType: target.type,
          baseCurrency: base,
          rates,
          rate: rateMode ? parseAmount(rate) || defaultRate : null,
          percentage: percentMode ? parseAmount(percentage) || 100 : null,
        })
      : null
  const preview = resolved?.ok ? resolved : null
  const rateHint = rateMode
    ? toCurrency === base
      ? `1 ${currencyLabel(fromCurrency)} = ? ${currencyLabel(toCurrency)}`
      : fromCurrency === base
        ? `1 ${currencyLabel(toCurrency)} = ? ${currencyLabel(fromCurrency)}`
        : `1 ${currencyLabel(fromCurrency)} = ? ${currencyLabel(toCurrency)}`
    : ""

  const submit = async () => {
    const next: Errors = {}
    if (!source) next.from = t("Выберите кассу")
    if (!target) next.to = t("Выберите кассу")
    if (source && target && source.id === target.id) next.to = t("Выберите другую кассу")
    if (!(amountFrom > 0)) next.amount = t("Укажите сумму")
    if (percentMode && !(parseAmount(percentage) > 0)) next.percentage = t("Укажите сумму")
    if (rateMode && !(parseAmount(rate) > 0) && !defaultRate) next.rate = t("Курс валюты не задан")
    if (!Object.keys(next).length && resolved && !resolved.ok) next[resolved.field === "percentage" ? "percentage" : resolved.field === "rate" ? "rate" : "amount"] = t(resolved.error)
    if (Object.keys(next).length) return setErrors(next)
    const body: CashTransferInput = {
      fromCashboxId: Number(fromId),
      toCashboxId: Number(toId),
      fromOrganization: fromOrganization || undefined,
      toOrganization: toOrganization || undefined,
      amountFrom,
      rate: rateMode ? parseAmount(rate) || defaultRate || undefined : undefined,
      percentage: percentMode ? parseAmount(percentage) || 100 : undefined,
      date: date || undefined,
      comment: comment.trim() || undefined,
      accumulatedFrom: accumulated.from || undefined,
      accumulatedTo: accumulated.to || undefined,
    }
    setBusy(true)
    const result = await cashMutate<CashTransferResult>("POST", "/api/cash/transfers", body)
    setBusy(false)
    if (!result.ok) {
      const field = (result.field && SERVER_FIELDS[result.field]) || "form"
      return setErrors({ [field]: mutationError(result, t), form: mutationError(result, t) })
    }
    onSaved(result.data)
  }

  const cashboxOption = (item: CashboxWithBalance) => ({ value: String(item.id), label: `${item.name} (${currencyLabel(item.currency)})`, hint: `${formatCash(item.balance, item.currency)}${item.branch ? ` · ${item.branch}` : ""}` })
  const organizationOptions = organizations.map((item) => ({ value: item.name, label: item.name }))

  return (
    <CashModal
      title={t("Перевод")}
      onClose={onClose}
      size="xs"
      footerButtons="filled"
      footer={
        <>
          {errors.form && <span className="mr-auto text-[13px] text-[#e57373]">{errors.form}</span>}
          <PrimaryButton tone="green" busy={busy} onClick={submit}>
            {t("Отправить")}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {fromCashbox ? (
          <ReadonlyField label={t("Текущая касса")} value={fromCashbox.name} />
        ) : (
          <FormField label={t("Текущая касса")} required error={errors.from}>
            <SearchSelect
              value={fromId}
              invalid={Boolean(errors.from)}
              onChange={(value) => {
                setFromId(value)
                setRate("")
                setErrors({})
              }}
              options={cashboxes.map(cashboxOption)}
              placeholder={t("Текущая касса")}
            />
          </FormField>
        )}
        <FormField label={t("С организации")}>
          <SearchSelect value={fromOrganization} onChange={setFromOrganization} options={organizationOptions} placeholder={t("С организации")} />
        </FormField>
        <FormField label={t("Касса получатель")} required error={errors.to}>
          <SearchSelect
            value={toId}
            invalid={Boolean(errors.to)}
            onChange={(value) => {
              setToId(value)
              setRate("")
              setErrors({})
            }}
            options={cashboxes.filter((item) => String(item.id) !== fromId).map(cashboxOption)}
            placeholder={t("Касса получатель")}
          />
        </FormField>
        <FormField label={t("На организацию")}>
          <SearchSelect value={toOrganization} onChange={setToOrganization} options={organizationOptions} placeholder={t("На организацию")} />
        </FormField>
        <div className={percentMode || rateMode ? "grid grid-cols-2 gap-3" : ""}>
          <FormField label={<>{t("Сумма с кассы")}{fromCurrency ? <span className="ml-3 font-normal text-[#555]">{currencyLabel(fromCurrency)}</span> : null}</>} required error={errors.amount}>
            <input type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={`${inputClass} ${errors.amount ? "border-[#e57373]" : ""}`} />
          </FormField>
          {percentMode && (
            <FormField label={`${t("Процент")} (%)`} required error={errors.percentage}>
              <input
                type="number"
                min={TRANSFER_MIN_PERCENTAGE}
                max={TRANSFER_MAX_PERCENTAGE}
                step="any"
                value={percentage}
                onChange={(event) => {
                  setPercentage(event.target.value)
                  setErrors((current) => ({ ...current, percentage: undefined }))
                }}
                className={`${inputClass} ${errors.percentage ? "border-[#e57373]" : ""}`}
              />
            </FormField>
          )}
          {rateMode && (
            <FormField label={t("Курс")} required error={errors.rate}>
              <input
                type="number"
                min="0"
                step="any"
                value={rate}
                placeholder={defaultRate ? formatMoney(defaultRate, 5) : ""}
                onChange={(event) => {
                  setRate(event.target.value)
                  setErrors((current) => ({ ...current, rate: undefined }))
                }}
                className={`${inputClass} ${errors.rate ? "border-[#e57373]" : ""}`}
              />
            </FormField>
          )}
        </div>
        {rateMode && <span className="-mt-2 text-[12px] text-[#9aa3b6]">{rateHint}</span>}
        {source && target && (
          <p className="text-[13px] text-[#586174]">
            {percentMode ? `${t("Касса")} ${target.name} ${t("получает")}` : t("Сумма перевода")}:{" "}
            <b className="text-[#17233b]">{preview ? `${formatMoney(preview.amountTo, 5)} ${currencyLabel(toCurrency)}` : "—"}</b>
          </p>
        )}
        {resolved && !resolved.ok && !errors.percentage && !errors.rate && !errors.amount && (
          <span className="-mt-2 text-[12px] text-[#e57373]">{t(resolved.error)}</span>
        )}
        {percentMode && <span className="-mt-2 text-[12px] text-[#9aa3b6]">{t("Процент от 50 до 100: касса-получатель получает не больше, чем ушло из кассы")}</span>}
        <MaterialDate label={t("Дата создания")} value={date} max={todayIso()} onChange={setDate} />
        <FormField label={t("Комментарий...")} error={errors.comment}>
          <input value={comment} onChange={(event) => setComment(event.target.value)} className={inputClass} />
        </FormField>
        <div className="flex min-h-[44px] flex-col justify-end">
          <span className="mb-[2px] flex items-center gap-1 text-[10px] font-bold leading-3 text-black">
            {t("Деньги накопленные за период")}
            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-[#bdbdbd]" aria-hidden>
              <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" />
            </svg>
          </span>
          <button type="button" onClick={() => setPeriodOpen((current) => !current)} className="h-[26px] w-[256px] border-b border-[#e8e8e8] text-left text-[13px] text-black">
            {accumulated.from || accumulated.to ? `${formatDateText(accumulated.from, language) || "…"} — ${formatDateText(accumulated.to, language) || "…"}` : t("Укажите дату")}
          </button>
          {periodOpen && (
            <span className="mt-2 flex items-center gap-2">
              <input type="date" value={accumulated.from} onChange={(event) => setAccumulated((current) => ({ ...current, from: event.target.value }))} className={`${inputClass} flex-1`} />
              <span className="text-[#586174]">—</span>
              <input type="date" value={accumulated.to} onChange={(event) => setAccumulated((current) => ({ ...current, to: event.target.value }))} className={`${inputClass} flex-1`} />
            </span>
          )}
        </div>
      </div>
    </CashModal>
  )
}
