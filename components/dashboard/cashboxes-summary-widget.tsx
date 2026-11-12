"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import type { BalanceListResult, BalanceRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// The dashboard's cash widget, as Linko's stats/widget/cashbox: for the dashboard period, six tiles (each field per
// currency, Euro / SUM / USD in Linko's order) and every cashbox newest first — its opening balance, income, expenses,
// transfers in / out, closing balance and the change («Разница» in % and in the cashbox currency) — from the cash
// ledger (GET /api/balances/cashbox, the numbers of Баланс кассы). Seven rows, then «Показать еще».

const VISIBLE_ROWS = 7
const COLUMNS = ["Кассы", "Баланс на начало", "Приход за период", "Расход за период", "Перевод в кассу", "Перевод с кассы", "Баланс на конец", "Разница"]
const TILES: Array<{ field: string; label: string; color: string }> = [
  { field: "begin_balance", label: "Баланс на начало периода", color: "#0d99ff" },
  { field: "income", label: "Приход за период", color: "#81c784" },
  { field: "expenses", label: "Расход за период", color: "#e57373" },
  { field: "transfer_income", label: "Перевод в кассу", color: "#81c784" },
  { field: "transfer_expense", label: "Перевод с кассы", color: "#e57373" },
  { field: "end_balance", label: "Баланс на конец периода", color: "#0d99ff" },
]
const ROW_FIELDS = ["begin_balance", "income", "expenses", "transfer_income", "transfer_expense", "end_balance"]

/** Linko lists its totals by currency name: Euro, SUM, USD — the codes in alphabetical order. */
const byCode = (a: string, b: string) => a.localeCompare(b)

function SummaryTile({ label, color, text }: { label: string; color: string; text: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 border-r border-[#efefef] px-3 py-4 text-center last:border-r-0">
      <span className="text-[16px] leading-5" style={{ color }}>
        {text}
      </span>
      <span className="text-[13px] text-[#666]">{t(label)}</span>
    </div>
  )
}

/** The row's own currency (the cashbox's), else the first one with money. */
function rowCurrency(row: BalanceRow): string {
  const own = String(row.info.currency ?? "")
  if (own && row.currencies[own]) return own
  return Object.keys(row.currencies).find((code) => Object.values(row.currencies[code]).some((value) => value)) ?? own
}

export function CashboxesSummaryWidget({ begin, end }: { begin: string; end: string }) {
  const { t } = useLanguage()
  const [data, setData] = useState<BalanceListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/balances/cashbox?from=${begin}&to=${end}`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<BalanceListResult>) : null))
      .then((body) => {
        if (!controller.signal.aborted) setData(body)
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [begin, end])

  const codes = useMemo(() => Object.keys(data?.totals ?? {}).sort(byCode), [data])
  const tileText = (field: string) => codes.map((code) => `${formatMoney(data?.totals[code]?.[field] ?? 0, 3)} ${currencyLabel(code)}`).join(", ")
  const rows = useMemo(
    () =>
      (data?.rows ?? []).map((row) => {
        const code = rowCurrency(row)
        const money = row.currencies[code] ?? {}
        const values = ROW_FIELDS.map((field) => Number(money[field] ?? 0))
        const change = values[5] - values[0]
        const percent = values[0] ? Math.round((change / Math.abs(values[0])) * 10000) / 100 : 0
        return { name: row.name, code, values, change, percent }
      }),
    [data],
  )
  const visibleRows = expanded ? rows : rows.slice(0, VISIBLE_ROWS)

  return (
    <div className="overflow-hidden rounded-[10px] bg-white shadow-[0_8px_24px_rgba(149,157,165,0.2)]">
      {!loading && !rows.length ? (
        <p className="p-5 text-[13px] text-[#666]">{t("Нет данных за выбранный период")}</p>
      ) : (
        <>
          <div className="flex flex-wrap overflow-hidden">
            {TILES.map((tile) => (
              <SummaryTile key={tile.field} label={tile.label} color={tile.color} text={tileText(tile.field)} />
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr className="bg-[#f2f5f8] text-[#333]">
                  {COLUMNS.map((column) => (
                    <th key={column} className="whitespace-nowrap px-[17px] py-[10px] text-left text-[13px] font-semibold">
                      {t(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={`${row.name}-${index}`} className="border-b border-[#efefef] bg-white">
                    <td className="whitespace-nowrap border-r border-[#efefef] px-[17px] py-[9px]">{row.name}</td>
                    {row.values.map((value, cellIndex) => (
                      <td key={cellIndex} className="whitespace-nowrap border-r border-[#efefef] px-[17px] py-[9px]">
                        {formatMoney(value, 3)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-[17px] py-[9px]">
                      <span className="flex items-center justify-between gap-3">
                        <span>{`${row.percent} %`}</span>
                        <span>{`${formatMoney(row.change, 3)} ${currencyLabel(row.code)}`}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length > VISIBLE_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mx-[18px] my-[10px] flex h-[30px] w-[calc(100%-36px)] items-center justify-center gap-1.5 rounded-full bg-[#f2f5f8] text-[13px] text-[#1E4A9A]"
            >
              {expanded ? t("Свернуть") : t("Показать еще")}
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
