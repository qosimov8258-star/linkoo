"use client"

import { useMemo, useState, type ReactNode } from "react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { PaymentModal } from "@/components/analytics/customer-payments-dialogs"
import { convertMoney, rateOf, type RateMap } from "@/lib/cash/rates"
import type { CustomerPaymentOptions, ExpectedOrderDetail } from "@/lib/cash/customer-payments-types"
import type { CashWriteResult, CategoryOptionKey } from "@/lib/cash/types"
import type { ContractOption } from "@/lib/contracts-types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// Pay dialog of "Ожидаемые оплаты" = the shared "Приход" dialog in order mode
// (demo module 1658 TransactionCreateForm with incomeCategoryKey="order",
// hideRedundant): grey order header, Дата создания, Филиал, Касса, Категория
// прихода (categories with the "order" option), Контракт (bank orders only),
// Сумма (+ "В основной валюте"), Ответственный персонал, Комментарий,
// "Подтвержденный приход", rate block for foreign-currency cashboxes.
// Saves through the cash core: POST /api/cash/orders/[id]/pay → a customer
// payment with order_id (client payment, cashbox income when verified, the
// order remainder goes down).

type Category = { id: number; name: string; kind: string; options: CategoryOptionKey[] }

const fieldClass = "h-10 w-full rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b] disabled:bg-[#f2f5f8]"

function Label({ text, children }: { text: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-[#586174]">{text}</span>
      {children}
    </label>
  )
}

const positiveOrNull = (value: string) => {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function ExpectedPaymentPayDialog({
  orderId,
  currency,
  options,
  onClose,
  onDone,
}: {
  orderId: number
  /** Currency of the clicked row (order part being paid). */
  currency: string
  options: CustomerPaymentOptions | null
  onClose: () => void
  onDone: (result: CashWriteResult) => void
}) {
  const { t } = useLanguage()
  const detail = useCashJson<ExpectedOrderDetail>(`/api/cash/customer-payments/expected/${orderId}`)
  const categories = useCashJson<{ categories: Category[] }>("/api/cash/categories?kind=income")
  const order = detail.data
  // Active contracts of the order's client (GET /api/contracts/options — also contracts covering several clients).
  const contractParams = order ? new URLSearchParams({ ...(order.client.id ? { clientId: String(order.client.id) } : {}), client: order.client.name }).toString() : ""
  const contracts = useCashJson<ContractOption[]>(order?.paymentType === "bank" ? `/api/contracts/options?${contractParams}` : null).data ?? []
  const part = order?.currencies.find((item) => item.currency === currency) ?? order?.currencies[0]
  const orderCurrency = part?.currency ?? currency
  const base = options?.baseCurrency ?? "SUM"
  const rates: RateMap = useMemo(() => Object.fromEntries((options?.currencies ?? []).map((item) => [item.code, item.rate])), [options])
  const orderCategories = useMemo(() => (categories.data?.categories ?? []).filter((category) => category.options.includes("order")), [categories.data])

  const [date, setDate] = useState<string | null>(null)
  const [branch, setBranch] = useState("")
  const [cashboxId, setCashboxId] = useState("")
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [contractId, setContractId] = useState("")
  const [amount, setAmount] = useState<string | null>(null)
  const [responsibleId, setResponsibleId] = useState("")
  const [comment, setComment] = useState("")
  const [verified, setVerified] = useState(true)
  const [rateType, setRateType] = useState<"current" | "custom">("current")
  const [customRate, setCustomRate] = useState("")
  const [debtRate, setDebtRate] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  // Demo defaults: date = order creation date, category = first "order" category;
  // amount = what is still owed on this order currency.
  const dateValue = date ?? (order?.createdAt ? order.createdAt.slice(0, 16) : "")
  const categoryValue = categoryId ?? (orderCategories[0] ? String(orderCategories[0].id) : "")
  const amountValue = amount ?? (part ? String(part.remaining) : "")

  const cashbox = options?.cashboxes.find((item) => String(item.id) === cashboxId) ?? null
  const cashCurrency = cashbox?.currency ?? orderCurrency
  const foreign = Boolean(cashbox) && cashCurrency !== base
  const custom = rateType === "custom"
  const currentRate = rateOf(cashCurrency, rates, base)
  const cashRate = custom ? positiveOrNull(customRate) : currentRate
  const cash = positiveOrNull(amountValue)
  // The order currency needs its own rate when it is neither the base nor the cashbox currency.
  const debtForeign = Boolean(cashbox) && orderCurrency !== base && orderCurrency !== cashCurrency
  const currentDebtRate = rateOf(orderCurrency, rates, base)
  const orderRate = custom && debtForeign ? positiveOrNull(debtRate) : currentDebtRate
  const showRates = foreign || debtForeign
  const converted =
    cash && cashbox && cashCurrency !== orderCurrency
      ? convertMoney(cash, cashCurrency, orderCurrency, rates, base, { fromRate: custom && foreign ? cashRate : null, toRate: custom && debtForeign ? orderRate : null })
      : null

  const changeCashbox = (value: string) => {
    setCashboxId(value)
    // Like the demo: another cashbox resets the rate mode; "Курс" is pre-filled with the current rate.
    setRateType("current")
    const next = options?.cashboxes.find((item) => String(item.id) === value)
    const rate = next ? rateOf(next.currency, rates, base) : null
    setCustomRate(rate ? String(rate) : "")
    setDebtRate(currentDebtRate ? String(currentDebtRate) : "")
  }

  const submit = async () => {
    if (!cashboxId) return setError("Выберите кассу")
    if (!cash) return setError("Укажите сумму")
    setBusy(true)
    setError("")
    const result = await cashMutate<CashWriteResult>("POST", `/api/cash/orders/${orderId}/pay`, {
      date: dateValue || undefined,
      cashboxId: Number(cashboxId),
      branch: branch || undefined,
      categoryId: categoryValue ? Number(categoryValue) : undefined,
      contractId: order?.paymentType === "bank" && contractId ? Number(contractId) : undefined,
      amount: cash,
      comment: comment.trim() || undefined,
      isVerified: verified,
      responsibleId: responsibleId ? Number(responsibleId) : undefined,
      organization: order?.organization || undefined,
      debtCurrency: orderCurrency,
      rateType,
      customRate: custom && foreign && cashRate ? cashRate : undefined,
      debtRate: custom && debtForeign && orderRate ? orderRate : undefined,
    })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    onDone(result.data)
  }

  const header = (
    <div className="grid grid-cols-1 gap-3 bg-[#f2f5f8] px-5 py-4 text-[14px] text-[#17233b] sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <span>
          {t("Заказ")} <strong>№{orderId}</strong>
        </span>
        <span>
          {t("Клиент:")} <strong>{order?.client.name ?? "…"}</strong>
        </span>
        <span>
          {t("Организация:")} <strong>{order?.organization || t("Не указано")}</strong>
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <span>
          {t("Тип оплаты:")} <strong>{t(order?.paymentType === "bank" ? "Перечислением" : "Наличными")}</strong>
        </span>
        <span>
          {t("Сумма заказа:")} <strong>{part ? `${formatMoney(part.total, 3)} ${currencyLabel(part.currency)}` : "…"}</strong>
        </span>
        <span>
          {t("Остаток:")} <strong>{part ? `${formatMoney(part.remaining, 3)} ${currencyLabel(part.currency)}` : "…"}</strong>
        </span>
      </div>
    </div>
  )

  return (
    <PaymentModal title="Приход" onClose={onClose} width={520}>
      {header}
      {detail.error ? (
        <p className="px-5 py-6 text-[#e57373]">{t(detail.error)}</p>
      ) : (
        <form
          className="flex flex-col gap-4 px-5 py-5"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Label text={t("Дата создания")}>
              <input type="datetime-local" value={dateValue} onChange={(event) => setDate(event.target.value)} className={fieldClass} required />
            </Label>
            <Label text={t("Филиал")}>
              <select value={branch} onChange={(event) => setBranch(event.target.value)} className={fieldClass}>
                <option value="">{t("Не указано")}</option>
                {(options?.branches ?? []).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Label>
            <Label text={t("Касса")}>
              <select value={cashboxId} onChange={(event) => changeCashbox(event.target.value)} className={fieldClass} required>
                <option value="">{t("Выберите кассу")}</option>
                {(options?.cashboxes ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({currencyLabel(item.currency)})
                  </option>
                ))}
              </select>
            </Label>
            <Label text={t("Категория прихода")}>
              <select value={categoryValue} onChange={(event) => setCategoryId(event.target.value)} className={fieldClass}>
                {!orderCategories.length && <option value="">{t("Не указано")}</option>}
                {orderCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Label>
            {order?.paymentType === "bank" && (
              <Label text={t("Контракт")}>
                <select value={contractId} onChange={(event) => setContractId(event.target.value)} className={fieldClass}>
                  <option value="">{t("Не указано")}</option>
                  {contracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {`№ ${contract.fullNumber}`}
                      {contract.hint ? ` · ${contract.hint}` : ""}
                    </option>
                  ))}
                </select>
              </Label>
            )}
            <Label text={t("Сумма")}>
              <span className="flex items-center gap-2">
                <input inputMode="decimal" value={amountValue} onChange={(event) => setAmount(event.target.value)} className={fieldClass} required />
                <span className="shrink-0 font-semibold text-[#586174]">{currencyLabel(cashCurrency)}</span>
              </span>
              {foreign && cash && cashRate ? (
                <span className="text-[12px] text-[#586174]">
                  {t("В основной валюте")}: {formatMoney(cash * cashRate)} {currencyLabel(base)}
                </span>
              ) : null}
            </Label>
            <Label text={t("Ответственный персонал")}>
              <select value={responsibleId} onChange={(event) => setResponsibleId(event.target.value)} className={fieldClass}>
                <option value="">{t("Не указано")}</option>
                {(options?.employees ?? []).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </Label>
          </div>

          {showRates && (
            <div className="flex flex-col gap-3 rounded-md bg-[#f2f5f8] px-3 py-3">
              <div className="flex flex-wrap gap-4 text-[14px] text-[#17233b]">
                {(["current", "custom"] as const).map((mode) => (
                  <label key={mode} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="payRateType"
                      checked={rateType === mode}
                      onChange={() => {
                        setRateType(mode)
                        if (mode === "custom" && !customRate && currentRate) setCustomRate(String(currentRate))
                        if (mode === "custom" && !debtRate && currentDebtRate) setDebtRate(String(currentDebtRate))
                      }}
                      className="h-4 w-4 accent-[#4f70e7]"
                    />
                    {t(mode === "current" ? "Текущий курс" : "Индивидуальный")}
                  </label>
                ))}
              </div>
              {foreign && (
                <Label text={`${t("Курс")} ${currencyLabel(cashCurrency)} (${currencyLabel(base)})`}>
                  <input
                    inputMode="decimal"
                    value={custom ? customRate : currentRate ? String(currentRate) : ""}
                    disabled={!custom}
                    onChange={(event) => setCustomRate(event.target.value)}
                    className={fieldClass}
                  />
                </Label>
              )}
              {debtForeign && (
                <Label text={`${t("Курс")} ${currencyLabel(orderCurrency)} (${currencyLabel(base)})`}>
                  <input
                    inputMode="decimal"
                    value={custom ? debtRate : currentDebtRate ? String(currentDebtRate) : ""}
                    disabled={!custom}
                    onChange={(event) => setDebtRate(event.target.value)}
                    className={fieldClass}
                  />
                </Label>
              )}
            </div>
          )}
          {converted !== null && (
            <p className="text-[14px] text-[#17233b]">
              {t("После конвертации")}: <strong>{`${formatMoney(converted, 3)} ${currencyLabel(orderCurrency)}`}</strong>
            </p>
          )}
          {cash && cashbox && cashCurrency !== orderCurrency && converted === null && <p className="text-[13px] text-[#d64545]">{t("Курс валюты не задан")}</p>}

          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t("Комментарий...")}
            rows={2}
            className="w-full rounded-md border border-[#dbe0e8] px-3 py-2 text-[#17233b]"
          />
          <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
            <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
            {t("Подтвержденный приход (Я получил деньги)")}
          </label>
          {error && <p className="rounded-md bg-[#fdecec] px-3 py-2 text-sm text-[#d64545]">{t(error)}</p>}
          <button type="submit" disabled={busy || detail.loading} className="h-10 w-full rounded-md bg-[#4f70e7] font-semibold text-white disabled:opacity-50">
            {busy ? t("Сохранение...") : t("Сохранить")}
          </button>
        </form>
      )}
    </PaymentModal>
  )
}
