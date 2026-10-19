"use client"

import { useState } from "react"
import { X } from "lucide-react"

import { accountingActExcelRows, actExcelRows, BalanceActTable, paymentTypeLabel, StatementComment, describeStatementRow, type ActColumn } from "@/components/analytics/balance/act-table"
import { BalanceAmount } from "@/components/analytics/balance/amount"
import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { useBalanceStatement } from "@/components/analytics/balance/use-balance"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import type { BalanceDateMode } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Информация по балансу клиента: NAME" (demo act modal 2342), shared by
// Баланс клиентов (kind "client") and Долги по счетам (kind "account"):
// per-organization balance strip with "Детали" (cash / bank split), own
// period + Организация / Валюта / Тип оплаты filters, the act table and the
// "Акт сверки" / "Бухгалтерский акт сверки" Excel downloads.

export function ClientActDialog({
  kind,
  entityKey,
  name,
  from: initialFrom,
  to: initialTo,
  mode = "created",
  onClose,
}: {
  kind: "client" | "account"
  /** BalanceRow.key of the client / account. */
  entityKey: string
  name: string
  from: string
  to: string
  mode?: BalanceDateMode
  onClose: () => void
}) {
  const { t, language } = useLanguage()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [organization, setOrganization] = useState("")
  const [currency, setCurrency] = useState("")
  const [paymentType, setPaymentType] = useState<"" | "cash" | "bank">("")
  const [details, setDetails] = useState(false)

  const { data, loading, error } = useBalanceStatement(kind, entityKey, {
    from,
    to,
    mode,
    organization: organization ? [organization] : [],
    currency,
    paymentType,
    withOrganizations: true,
  })
  const codes = data ? (currency ? [currency] : data.visibleCurrencies) : []
  const deliverer = String(data?.entity.info.deliverer ?? "")

  const columns: ActColumn[] = [
    { label: "Комментарий", render: (row) => <StatementComment row={row} />, excel: (row) => describeStatementRow(row, t) },
    { label: "Доставщик", render: (row) => (row.source === "order" ? deliverer : ""), excel: (row) => (row.source === "order" ? deliverer : "") },
    { label: "Организация", render: (row) => row.organization, excel: (row) => row.organization },
    { label: "Тип оплаты", render: (row) => t(paymentTypeLabel(row.paymentType)), excel: (row) => t(paymentTypeLabel(row.paymentType)) },
  ]
  // The prop name is empty when the act is opened from a URL (?openClient) before the list loaded.
  const title = data?.entity.name || name
  const fileName = `${t("Акт сверки")} ${title} ${from} - ${to}`

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 py-8" onClick={onClose}>
      <div className="w-full max-w-[1100px] rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e1e5eb] px-6 py-4">
          <h2 className="text-lg font-bold uppercase text-[#17233b]">
            {t("Информация по балансу клиента")}: {title}
          </h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-start gap-3 px-6 pt-4">
          {(data?.organizations ?? []).map((item) => (
            <div key={item.organization || "-"} className="rounded-md border border-[#e1e5eb] px-3 py-2">
              <div className="text-sm text-[#586174]">{item.organization || t("Не указано")}</div>
              {Object.entries(item.currencies).map(([code, amount]) => (
                <div key={code}>
                  <BalanceAmount value={amount} currency={currencyLabel(code)} variant="card" />
                </div>
              ))}
              {details &&
                item.paymentTypes
                  .filter((part) => part.amount)
                  .map((part) => (
                    <div key={`${part.paymentType}-${part.currency}`} className="text-sm text-[#586174]">
                      {part.paymentType === "bank" ? t("Переч.") : part.paymentType === "cash" ? t("Нал.") : t("Не указано")}: <BalanceAmount value={part.amount} currency={currencyLabel(part.currency)} />
                    </div>
                  ))}
            </div>
          ))}
          {Boolean(data?.organizations?.length) && (
            <button type="button" onClick={() => setDetails((value) => !value)} className="self-center text-[#4f70e7] hover:underline">
              {t("Детали")}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3 px-6 py-4">
          <label className="flex flex-col gap-1 text-sm text-[#586174]">
            {t("Диапазон дат")}
            <span className="flex items-center gap-2">
              <input type="date" value={from} max={to} onChange={(event) => event.target.value && setFrom(event.target.value)} className="h-10 rounded-md border border-[#dbe0e8] px-3 text-[#17233b]" />
              <input type="date" value={to} min={from} onChange={(event) => event.target.value && setTo(event.target.value)} className="h-10 rounded-md border border-[#dbe0e8] px-3 text-[#17233b]" />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm text-[#586174]">
            {t("Организация")}
            <select value={organization} onChange={(event) => setOrganization(event.target.value)} className="h-10 min-w-[180px] rounded-md border border-[#dbe0e8] px-3 text-[#17233b]">
              <option value="">{t("Все организации")}</option>
              {(data?.organizations ?? [])
                .filter((item) => item.organization)
                .map((item) => (
                  <option key={item.organization} value={item.organization}>
                    {item.organization}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-[#586174]">
            {t("Валюта")}
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="h-10 min-w-[120px] rounded-md border border-[#dbe0e8] px-3 text-[#17233b]">
              <option value="">{t("Все")}</option>
              {(data?.currencies ?? []).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-[#586174]">
            {t("Тип оплаты")}
            <select value={paymentType} onChange={(event) => setPaymentType(event.target.value as "" | "cash" | "bank")} className="h-10 min-w-[160px] rounded-md border border-[#dbe0e8] px-3 text-[#17233b]">
              <option value="">{t("Все")}</option>
              <option value="cash">{t("Наличные")}</option>
              <option value="bank">{t("Перечисление")}</option>
            </select>
          </label>
          <div className="ml-auto">
            <BalanceDownloadMenu
              disabled={!data}
              items={[
                { label: "Акт сверки", onClick: () => data && downloadExcelTable(fileName, actExcelRows(data, columns, t, language, codes)) },
                { label: "Бухгалтерский акт сверки", onClick: () => data && downloadExcelTable(`${fileName} (2)`, accountingActExcelRows(data, t, language, codes)) },
              ]}
            />
          </div>
        </div>

        <div className={`px-6 pb-6 ${loading ? "opacity-60" : ""}`}>
          {error && <p className="py-6 text-center text-[#e57373]">{error}</p>}
          {!data && !error && <p className="py-10 text-center text-[#9aa3b6]">{t("Загрузка...")}</p>}
          {data && <BalanceActTable statement={data} currencies={codes} columns={columns} />}
        </div>
      </div>
    </div>
  )
}
