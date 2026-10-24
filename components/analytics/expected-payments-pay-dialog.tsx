"use client"

import { useMemo, useState, type ReactNode } from "react"

import { cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { MaterialBody, MaterialCheckbox, MaterialDate, MaterialDialog, MaterialFooter, MaterialInput } from "@/components/analytics/cash-material"
import { RefSearchSelect } from "@/components/analytics/ref-search-select"
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
  const { t, language } = useLanguage()
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
  const amountValue = amount ?? (part ? formatMoney(part.remaining, 3) : "")

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
    <div className="flex justify-between gap-4 bg-[#f1f5f8] px-[30px] py-[16px] text-[13px] leading-5 text-black">
      <div className="flex flex-col">
        <span>
          {t("Заказ")} <strong className="font-semibold">№{orderId}</strong>
        </span>
        <span>
          {t("Клиент:")} <strong className="font-semibold">{order?.client.name ?? "…"}</strong>
        </span>
        <span>
          {t("Организация:")} <strong className="font-semibold">{order?.organization || t("Не указано")}</strong>
        </span>
      </div>
      <div className="flex flex-col text-right">
        <span>
          {t("Тип оплаты:")} <strong className="font-semibold">{t(order?.paymentType === "bank" ? "Перечислением" : "Наличными")}</strong>
        </span>
        <span>
          {t("Сумма заказа:")} <strong className="font-semibold">{part ? `${formatMoney(part.total, 3)} ${currencyLabel(part.currency)}` : "…"}</strong>
        </span>
        <span>
          {t("Остаток:")} <strong className="font-semibold">{part ? `${formatMoney(part.remaining, 3)} ${currencyLabel(part.currency)}` : "…"}</strong>
        </span>
      </div>
    </div>
  )

  const pick = (items: Array<{ value: string; label: string }>, value: string) => items.filter((item) => item.value === value)
  const branchItems = (options?.branches ?? []).map((item) => ({ value: item, label: item }))
  const cashboxItems = (options?.cashboxes ?? []).map((item) => ({ value: String(item.id), label: `${item.name} (${currencyLabel(item.currency)})` }))
  const categoryItems = orderCategories.map((category) => ({ value: String(category.id), label: category.name }))
  const contractItems = contracts.map((contract) => ({ value: String(contract.id), label: `№ ${contract.fullNumber}${contract.hint ? ` · ${contract.hint}` : ""}` }))
  const staffItems = (options?.employees ?? []).map((employee) => ({ value: String(employee.id), label: employee.name }))
  const selectProps = { dense: true, searchable: false, rowHeight: 32 } as const
  const dayPart = dateValue.slice(0, 10)
  const dayText = dayPart
    ? `${new Date(`${dayPart}T00:00:00`).toLocaleDateString(language === "uz" ? "uz-UZ" : language === "en" ? "en-US" : "ru-RU", { day: "numeric", month: "long", year: "numeric" })}`
    : ""

  return (
    <MaterialDialog
      title={t("Приход")}
      onClose={onClose}
      width={500}
      top={80}
      onSubmit={() => void submit()}
      footer={<MaterialFooter label={busy ? t("Сохранение...") : t("Сохранить")} busy={busy} disabled={detail.loading} error={error ? t(error) : undefined} />}
    >
      {header}
      {detail.error ? (
        <p className="px-[30px] py-6 text-[#f44336]">{t(detail.error)}</p>
      ) : (
        <MaterialBody className="pb-[30px] pt-[23px]">
          <MaterialDate
            compact
            label={t("Дата создания")}
            value={dayPart}
            display={dayText}
            onChange={(value) => setDate(`${value}T${dateValue.slice(11) || "00:00"}`)}
          />
          <RefSearchSelect className="mt-[13px]" {...selectProps} label={t("Филиал")} items={branchItems} selected={pick(branchItems, branch)} onChange={(next) => setBranch(next[0]?.value ?? "")} />
          <RefSearchSelect {...selectProps} label={t("Касса")} items={cashboxItems} selected={pick(cashboxItems, cashboxId)} onChange={(next) => changeCashbox(next[0]?.value ?? "")} />
          <RefSearchSelect
            {...selectProps}
            label={t("Категория прихода")}
            items={categoryItems}
            selected={pick(categoryItems, categoryValue)}
            onChange={(next) => setCategoryId(next[0]?.value ?? "")}
          />
          {order?.paymentType === "bank" && (
            <RefSearchSelect {...selectProps} label={t("Контракт")} items={contractItems} selected={pick(contractItems, contractId)} onChange={(next) => setContractId(next[0]?.value ?? "")} />
          )}
          <MaterialInput className="mt-[2px] w-[calc(100%-5px)]" label={t("Сумма")} value={amountValue} inputMode="decimal" onChange={setAmount} />
          {foreign && cash && cashRate ? (
            <div className="mt-1 text-[12px] text-black">
              {t("В основной валюте")}: {formatMoney(cash * cashRate)} {currencyLabel(base)}
            </div>
          ) : null}
          <RefSearchSelect className="mt-[13px]" {...selectProps} label={t("Ответственный персонал")} items={staffItems} selected={pick(staffItems, responsibleId)} onChange={(next) => setResponsibleId(next[0]?.value ?? "")} />
          <MaterialInput className="mt-[20px]" placeholderLabel label={t("Комментарий...")} value={comment} onChange={setComment} />
          <div className="mt-[22px] pl-[2px]">
            <MaterialCheckbox checked={verified} onChange={setVerified} label={t("Подтвержденный приход (Я получил деньги)")} />
          </div>

          {showRates && (
            <div className="mt-4 flex flex-col gap-2 text-[13px]">
              <div className="flex flex-wrap gap-4">
                {(["current", "custom"] as const).map((mode) => (
                  <label key={mode} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="payRateType"
                      checked={rateType === mode}
                      onChange={() => {
                        setRateType(mode)
                        if (mode === "custom" && !customRate && currentRate) setCustomRate(String(currentRate))
                        if (mode === "custom" && !debtRate && currentDebtRate) setDebtRate(String(currentDebtRate))
                      }}
                      className="h-4 w-4 accent-[#5d6474]"
                    />
                    {t(mode === "current" ? "Текущий курс" : "Индивидуальный")}
                  </label>
                ))}
              </div>
              {foreign && (
                <MaterialInput
                  label={`${t("Курс")} ${currencyLabel(cashCurrency)} (${currencyLabel(base)})`}
                  value={custom ? customRate : currentRate ? String(currentRate) : ""}
                  inputMode="decimal"
                  onChange={(value) => custom && setCustomRate(value)}
                />
              )}
              {debtForeign && (
                <MaterialInput
                  label={`${t("Курс")} ${currencyLabel(orderCurrency)} (${currencyLabel(base)})`}
                  value={custom ? debtRate : currentDebtRate ? String(currentDebtRate) : ""}
                  inputMode="decimal"
                  onChange={(value) => custom && setDebtRate(value)}
                />
              )}
            </div>
          )}
          {(converted !== null || cash) && (
            <p className="mt-[18px] text-[13px] leading-4 text-[#333]">
              {t("После конвертации")}: <strong className="ml-1 font-semibold text-black">{`${formatMoney(converted ?? cash ?? 0, 3)} ${currencyLabel(orderCurrency)}`}</strong>
            </p>
          )}
          {cash && cashbox && cashCurrency !== orderCurrency && converted === null && <p className="mt-3 text-[12px] text-[#f44336]">{t("Курс валюты не задан")}</p>}
        </MaterialBody>
      )}
    </MaterialDialog>
  )
}
