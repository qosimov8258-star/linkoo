"use client"

import { useMemo, useState } from "react"
import { X } from "lucide-react"

import { BalanceAmount } from "@/components/analytics/balance/amount"
import { useFinanceCurrencies, useLookup } from "@/components/analytics/balance/use-balance"
import { currencyLabel, formatMoney, normCurrency } from "@/lib/finance/currency"
import { nowLocalIso } from "@/lib/finance/dates"
import type { BalanceRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Групповой приход" (demo module 2345), shared by Баланс клиентов and Долги
// по счетам: payment details on the left, the selected clients/accounts with
// their end balances and an "Оплата" amount each on the right. Saves through
// POST /api/balances/group-payment (one customer payment per amount).

type Named = { id: number; name: string }
type Cashbox = Named & { currency: string; branch: string; paymentType: string }

export function GroupPaymentDialog({
  open,
  rows,
  currencies,
  onClose,
  onSaved,
}: {
  open: boolean
  /** Selected rows of the list (BalanceRow.key is sent as the item key). */
  rows: BalanceRow[]
  /** Currency codes whose end balance is shown per row (demo: SUM, USD). */
  currencies: string[]
  onClose: () => void
  /** Called after a successful save (show "Успешно сохранено", refetch list + totals). */
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const cashboxes = useLookup<Cashbox>(open ? "/api/cashboxes" : null)
  const branches = useLookup<Named>(open ? "/api/branches" : null)
  const categories = useLookup<Named>(open ? "/api/income-categories" : null)
  const organizations = useLookup<Named>(open ? "/api/organizations" : null)
  const employees = useLookup<Named>(open ? "/api/employees" : null)
  const { data: currencyInfo } = useFinanceCurrencies()

  const [date, setDate] = useState(() => nowLocalIso().slice(0, 16))
  const [branch, setBranch] = useState("")
  const [cashboxId, setCashboxId] = useState("")
  const [category, setCategory] = useState("")
  const [deliveryMan, setDeliveryMan] = useState("")
  const [organization, setOrganization] = useState("")
  const [rateType, setRateType] = useState<"current" | "custom">("current")
  const [customRate, setCustomRate] = useState("")
  const [verified, setVerified] = useState(true)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const cashbox = cashboxes.find((item) => String(item.id) === cashboxId)
  const currency = cashbox ? normCurrency(cashbox.currency) : ""
  const base = currencyInfo?.base ?? "SUM"
  const currentRate = currencyInfo?.currencies.find((item) => item.code === currency)?.rate ?? null
  const rate = rateType === "custom" ? Number(customRate) || null : currentRate
  const total = useMemo(() => rows.reduce((sum, row) => sum + (Number(amounts[row.key]) || 0), 0), [rows, amounts])

  if (!open) return null

  const submit = async () => {
    setError("")
    const items = rows.map((row) => ({ key: row.key, amount: Number(amounts[row.key]) || 0 })).filter((item) => item.amount > 0)
    if (!cashboxId) return setError(t("Выберите кассу"))
    if (!organization) return setError(t("Организация обязательна"))
    if (!items.length) return setError(t("Укажите сумму оплаты"))
    setSaving(true)
    try {
      const response = await fetch("/api/balances/group-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          cashboxId: Number(cashboxId),
          organization,
          branch,
          incomeCategory: category,
          deliveryMan,
          isVerified: verified,
          rateType,
          customRate: rateType === "custom" && rate ? rate : undefined,
          items,
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || t("Не удалось сохранить"))
      }
      setAmounts({})
      onSaved()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  const field = "h-10 w-full rounded-md border border-[#dbe0e8] px-3 text-[#17233b] disabled:bg-[#f2f5f8]"
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 py-8" onClick={onClose}>
      <div className="w-full max-w-[1100px] rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e1e5eb] px-6 py-4">
          <h2 className="text-lg font-bold text-[#17233b]">{t("Групповой приход")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-6 px-6 py-5 lg:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-3 text-sm text-[#586174]">
            <label className="flex flex-col gap-1">
              {t("Дата создания")}
              <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1">
              {t("Филиал")}
              <select value={branch} onChange={(event) => setBranch(event.target.value)} className={field}>
                <option value="">{t("Не указано")}</option>
                {branches.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {t("Касса")}
              <select value={cashboxId} onChange={(event) => setCashboxId(event.target.value)} className={field}>
                <option value="">{t("Выберите кассу")}</option>
                {cashboxes
                  .filter((item) => !branch || !item.branch || item.branch === branch)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({currencyLabel(item.currency)})
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {t("Категория прихода")}
              <select value={category} onChange={(event) => setCategory(event.target.value)} className={field}>
                <option value="">{t("Не указано")}</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {t("Валюта оплаты")}
              <input value={currency ? currencyLabel(currency) : ""} disabled className={field} />
            </label>
            <label className="flex flex-col gap-1">
              {t("Ответственный доставщик")}
              <select value={deliveryMan} onChange={(event) => setDeliveryMan(event.target.value)} className={field}>
                <option value="">{t("Не указано")}</option>
                {employees.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              {t("Организация")} *
              <select value={organization} onChange={(event) => setOrganization(event.target.value)} className={field}>
                <option value="">{t("Выберите организацию")}</option>
                {organizations.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {currency && currency !== base && (
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={rateType === "current"} onChange={() => setRateType("current")} />
                  {t("Текущий курс")} {currentRate ? `(${formatMoney(currentRate)})` : ""}
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={rateType === "custom"} onChange={() => setRateType("custom")} />
                  {t("Индивидуальный")}
                </label>
                {rateType === "custom" && (
                  <input type="number" min="0" step="any" value={customRate} onChange={(event) => setCustomRate(event.target.value)} placeholder={t("Курс")} className={field} />
                )}
                <span>
                  {t("После конвертации")}: <b className="text-[#17233b]">{rate ? `${formatMoney(total * rate)} ${currencyLabel(base)}` : "—"}</b>
                </span>
              </div>
            )}
            <label className="flex items-center gap-2 text-[#17233b]">
              <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} className="h-4 w-4 accent-[#4f70e7]" />
              {t("Подтвержденный приход (Я получил деньги)")}
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="bg-[#edf2f7] text-left text-[#253653]">
                  <th className="px-3 py-2">№</th>
                  <th className="px-3 py-2">{t("Клиент")}</th>
                  {currencies.map((code) => (
                    <th key={code} className="px-3 py-2">
                      {t("Баланс на конец периода")} ({currencyLabel(code)})
                    </th>
                  ))}
                  <th className="px-3 py-2">{t("Оплата")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.key} className="border-b border-[#e1e5eb]">
                    <td className="px-3 py-2">{index + 1}</td>
                    <td className="px-3 py-2">{row.name}</td>
                    {currencies.map((code) => (
                      <td key={code} className="px-3 py-2">
                        <BalanceAmount value={row.currencies[code]?.end_balance ?? 0} />
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={amounts[row.key] ?? ""}
                        onChange={(event) => setAmounts((value) => ({ ...value, [row.key]: event.target.value }))}
                        className="h-9 w-36 rounded-md border border-[#dbe0e8] px-2"
                      />
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={3 + currencies.length} className="px-3 py-10 text-center text-[#9aa3b6]">
                      {t("Выберите клиентов в таблице")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-3 text-right font-semibold text-[#17233b]">
              {t("Итого")}: {formatMoney(total)} {currency ? currencyLabel(currency) : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-[#e1e5eb] px-6 py-4">
          {error && <span className="mr-auto text-[#e57373]">{error}</span>}
          <button type="button" onClick={onClose} className="h-10 rounded-md border border-[#dbe0e8] px-5 text-[#586174]">
            {t("Отмена")}
          </button>
          <button type="button" onClick={submit} disabled={saving} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white disabled:opacity-50">
            {t("Сохранить")}
          </button>
        </div>
      </div>
    </div>
  )
}
