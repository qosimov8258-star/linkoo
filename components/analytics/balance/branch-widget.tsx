"use client"

import { useBalanceList } from "@/components/analytics/balance/use-balance"
import { currencyLabel } from "@/lib/finance/currency"
import { monthEndIso, monthStartIso } from "@/lib/finance/dates"
import { MOVEMENT_LABELS } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Branch balances of a period (default: the current month) for the dashboard
// tab "ФИЛИАЛ": the totals strip and one row per branch, from the same ledger
// as "Баланс филиалов" (GET /api/balances/branch). + = the branch is owed
// (it sent goods / money), − = it owes.

const COLUMNS = ["begin_balance", "stock_transfer_minus", "stock_transfer_plus", "payments", "none_type_plus", "none_type_minus", "end_balance"] as const

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function label(column: (typeof COLUMNS)[number]): string {
  if (column === "begin_balance") return "Баланс на начало периода"
  if (column === "end_balance") return "Баланс на конец периода"
  return MOVEMENT_LABELS.branch[column]
}

function Amount({ value }: { value: number }) {
  if (!value) return <span>0</span>
  return <span className={`font-semibold ${value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"}`}>{money(value)}</span>
}

export function BranchBalanceWidget({ from = monthStartIso(), to = monthEndIso() }: { from?: string; to?: string }) {
  const { t } = useLanguage()
  const { data, loading, error } = useBalanceList("branch", { from, to, pageSize: 0 })
  const codes = data?.visibleCurrencies ?? []

  return (
    <section className="mx-[30px] mt-[30px] overflow-hidden rounded-[12px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="grid grid-cols-2 divide-x divide-[#efefef] border-b border-[#efefef] text-center text-[13px] sm:grid-cols-4 lg:grid-cols-7">
        {COLUMNS.map((column) => (
          <div key={column} className="px-[10px] py-[14px]">
            <p className={`text-[15px] font-semibold leading-[19px] ${column.endsWith("balance") ? "text-[#1ea1f2]" : column.endsWith("minus") ? "text-[#e57373]" : "text-[#71ce87]"}`}>
              {codes.map((code) => `${money(data?.totals[code]?.[column] ?? 0)} ${currencyLabel(code)}`).join(", ") || "0"}
            </p>
            <p className="mt-[2px] leading-4 text-[#555]">{t(label(column))}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-[13px]">
          <thead className="bg-[#f2f5f8]">
            <tr className="h-[36px]">
              <th className="w-[220px]" />
              {COLUMNS.map((column) => (
                <th key={column} colSpan={Math.max(1, codes.length)} className="px-2 text-left font-semibold">
                  {t(label(column))}
                </th>
              ))}
            </tr>
            <tr className="h-[36px]">
              <th className="px-[16px] text-left font-semibold">{t("Филиал")}</th>
              {COLUMNS.map((column) =>
                codes.map((code) => (
                  <th key={`${column}-${code}`} className="px-2 text-left font-semibold">
                    {currencyLabel(code)}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row, index) => (
              <tr key={row.key} className={`h-[40px] border-t border-[#efefef] ${index % 2 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                <td className="px-[16px]">{row.name}</td>
                {COLUMNS.map((column) =>
                  codes.map((code) => (
                    <td key={`${column}-${code}`} className="px-2">
                      <Amount value={row.currencies[code]?.[column] ?? 0} />
                    </td>
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-center py-3 text-[13px] text-[#555]">
          {loading ? t("Загрузка...") : error ? t(error) : `${t("Филиалов")}: ${data?.rows.length ?? 0}`}
        </div>
      </div>
    </section>
  )
}
