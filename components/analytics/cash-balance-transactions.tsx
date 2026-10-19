"use client"

import Link from "next/link"
import { Landmark, Wallet } from "lucide-react"

import { balanceColor } from "@/components/analytics/balance/amount"
import { convertAmount, currencyLabel, formatMoney, roundMoney } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import type { FinanceCurrency, StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Транзакции (<касса>)" rows of the cash balance detail (demo module
// TransactionGridList with isCashbox): № | Дата | Создал | Описание | Сумма.
// Описание follows the demo's TransactionsFormat: comma-separated bold-label
// parts ("Описание: Расход, Категория: …, Филиал: …, Комментарий: …") and
// separate "Клиент:" / "Поставщик:" lines.

type Translate = (text: string) => string

type Part = { label: string; text: string; href?: string }

// Descriptions the cash management page generates itself ("Перевод в X",
// "Перевод из X", "Приход на счет клиента X"); they are already represented
// by the transaction type, so they are not repeated as a comment.
const GENERATED_DESCRIPTION = /^(Перевод (в|из)(\s|$)|Приход на счет клиента(\s|$))/i

function typeText(row: StatementRow, t: Translate): string {
  if (row.column === "transfer_income") {
    // Demo: "Перевод с <касса-отправитель>"; the target leg stores "Перевод из <касса>".
    const source = /^Перевод из\s+(.+)$/i.exec(row.description.trim())?.[1]
    if (source) return `${t("Перевод с")} ${source}`
  }
  if (row.title === "Приход на счет клиента" && row.counterparty) return `${t(row.title)} ${row.counterparty}`
  return t(row.title)
}

/** Parts of the Описание cell (inline, comma separated) and the separate counterparty lines. */
export function cashTransactionParts(row: StatementRow, t: Translate): { parts: Part[]; lines: Part[] } {
  const title = typeText(row, t)
  const parts: Part[] = [{ label: "Описание", text: title, href: row.source !== "cash_entry" ? row.href : "" }]
  if (row.category) parts.push({ label: "Категория", text: row.category })
  if (row.branch) parts.push({ label: "Филиал", text: row.branch })
  if (row.organization) parts.push({ label: "Организация", text: row.organization })
  const ownText = row.description.trim()
  const comments = [GENERATED_DESCRIPTION.test(ownText) || ownText.toLowerCase() === title.toLowerCase() ? "" : ownText, row.comment.trim()]
  const comment = [...new Set(comments.filter(Boolean))].join(", ")
  if (comment) parts.push({ label: "Комментарий", text: comment })
  const lines: Part[] = []
  if (row.counterparty) lines.push({ label: row.source === "supplier_payment" ? "Поставщик" : "Клиент", text: row.counterparty })
  return { parts, lines }
}

/** Plain-text Описание (Excel export). */
export function cashTransactionText(row: StatementRow, t: Translate): string {
  const { parts, lines } = cashTransactionParts(row, t)
  return [...parts, ...lines].map((part) => `${t(part.label)}: ${part.text}`).join(", ")
}

/** Amount of `row` in the base currency with the current rate (demo second line "<internal> <primary> (<rate>)"), or null. */
export function internalAmount(row: StatementRow, baseCurrency: string, currencies: FinanceCurrency[]): { amount: number; rate: number } | null {
  if (!baseCurrency || row.currency === baseCurrency) return null
  const rates = Object.fromEntries(currencies.map((currency) => [currency.code, currency.rate]))
  const rate = convertAmount(1, row.currency, baseCurrency, rates)
  if (!rate) return null
  return { amount: roundMoney(row.amount * rate), rate }
}

function PaymentTypeIcon({ paymentType }: { paymentType: string }) {
  const { t } = useLanguage()
  const bank = paymentType === "bank"
  const label = bank ? t("банковский счет") : t("наличные")
  return (
    <span title={label} aria-label={label} className="inline-flex shrink-0">
      {bank ? <Landmark className="h-[18px] w-[18px] text-[#6261b0]" /> : <Wallet className="h-[18px] w-[18px] text-[#4f71dc]" />}
    </span>
  )
}

const GRID = "grid grid-cols-[70px_170px_150px_minmax(0,1fr)_220px] gap-4"

export function CashTransactionsTable({
  rows,
  baseCurrency,
  currencies,
  loading,
}: {
  rows: StatementRow[]
  baseCurrency: string
  currencies: FinanceCurrency[]
  loading: boolean
}) {
  const { t, language } = useLanguage()
  return (
    <div className={`overflow-x-auto ${loading ? "opacity-60" : ""}`}>
      <div className="min-w-[900px]">
        <div className={`${GRID} border-b border-[#efefef] py-3 font-semibold text-[#666]`}>
          <span>{t("№")}</span>
          <span>{t("Дата")}</span>
          <span>{t("Создал")}</span>
          <span>{t("Описание")}</span>
          <span className="text-right">{t("Сумма")}</span>
        </div>
        {rows.map((row) => {
          const { parts, lines } = cashTransactionParts(row, t)
          const internal = internalAmount(row, baseCurrency, currencies)
          return (
            <div key={row.id} className={`${GRID} min-h-[50px] items-center border-b border-dotted border-[#dde1e5] py-2 hover:bg-[#f2f5f8]`}>
              <span>{row.sourceId ?? ""}</span>
              <span className="whitespace-nowrap">{formatStatementDate(row.date, language)}</span>
              <span className="break-words">{row.createdBy}</span>
              <div className="min-w-0 break-words">
                <div>
                  {parts.map((part, index) => (
                    <span key={part.label} className="mr-2.5 inline">
                      <strong>{t(part.label)}: </strong>
                      {part.href ? (
                        <Link href={part.href} target="_blank" className="font-semibold text-[#4f70e7] hover:underline">
                          {part.text}
                        </Link>
                      ) : (
                        part.text
                      )}
                      {index < parts.length - 1 ? "," : ""}
                    </span>
                  ))}
                </div>
                {lines.map((line) => (
                  <div key={line.label}>
                    <strong>{t(line.label)}:</strong> {line.text}
                  </div>
                ))}
              </div>
              <div className="text-right font-semibold" style={{ color: balanceColor(row.amount, "table") }}>
                <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                  <span>
                    {formatMoney(row.amount)} {currencyLabel(row.currency)}
                  </span>
                  <PaymentTypeIcon paymentType={row.paymentType} />
                </div>
                {internal && (
                  <div className="whitespace-nowrap">
                    {formatMoney(internal.amount)} {currencyLabel(baseCurrency)}{" "}
                    <span className="text-[11px] font-semibold text-[#666]">({formatMoney(internal.rate, internal.rate >= 100 ? 0 : 4)})</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
