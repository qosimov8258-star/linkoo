"use client"

import { useMemo, useState } from "react"
import { CashOverview, WarehouseOverview } from "@/components/analytics/balance-sections"
import { ReportPage, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"


type Money = { sum: number; usd: number }
type Branch = { id: number; name: string; opening: Money }

const branches: Branch[] = []

const FIXED_TOTALS = { sum: 0, usd: 0 }
const groups = ["Баланс на начало периода", "Передача на склад", "Возврат передачи", "Оплата", "Прочие приходы", "Прочие расходы", "Баланс на конец"] as const

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function AmountCell({ value }: { value: number }) {
  if (value === 0) return <span>0</span>
  const color = value > 0 ? "text-[#3aa76d]" : "text-[#e5484d]"
  return <span className={`font-semibold ${color}`}>{money(value)}</span>
}

export function BranchTabView() {
  const [chartMode, setChartMode] = useState<"type" | "brand">("type")
  const [sortKey, setSortKey] = useState<"opening" | "closing" | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const sortedBranches = useMemo(() => {
    if (!sortKey) return branches
    const copy = [...branches]
    copy.sort((a, b) => {
      const result = a.opening.sum - b.opening.sum
      return sortDir === "asc" ? result : -result
    })
    return copy
  }, [sortDir, sortKey])

  const toggleSort = (key: "opening" | "closing") => {
    if (sortKey === key) setSortDir((value) => (value === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("asc") }
  }

  return (
    <ReportPage>
      <WidgetHeader active="ФИЛИАЛ" />
      <WidgetUserCard />
      <section className="mx-[30px] mt-[20px] rounded-[12px] bg-white p-[14px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="relative h-[340px]">
          {[5, 4, 3, 2, 1, 0].map((tick, index) => (
            <div key={tick} className="absolute left-0 right-[24px] border-t border-[#e8ecf1]" style={{ top: 8 + index * 62 }}>
              <span className="absolute -top-[8px] -right-[20px] w-[16px] text-[11px] text-[#777]">{tick}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="mx-[30px] mt-[1px] flex">
        <button onClick={() => setChartMode("type")} className={`h-[32px] rounded-l-[3px] border px-[16px] text-[13px] font-medium uppercase ${chartMode === "type" ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e8e8e8] bg-white text-black"}`}>Тип продукта</button>
        <button onClick={() => setChartMode("brand")} className={`h-[32px] rounded-r-[3px] border px-[16px] text-[13px] font-medium uppercase ${chartMode === "brand" ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e8e8e8] bg-white text-black"}`}>Бренд</button>
      </div>

      <section className="mx-[30px] mt-[30px] overflow-hidden rounded-[12px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="grid grid-cols-2 divide-x divide-[#efefef] border-b border-[#efefef] text-center text-[13px] sm:grid-cols-4 lg:grid-cols-7">
          {([
            ["Баланс на начало периода", `${money(FIXED_TOTALS.sum)} SUM, ${money(FIXED_TOTALS.usd)} USD`, "text-[#1ea1f2]"],
            ["Передача на склад", "0 SUM, 0 USD", "text-[#e57373]"],
            ["Возврат передачи", "0 SUM, 0 USD", "text-[#71ce87]"],
            ["Принятие оплаты", "0 SUM, 0 USD", "text-[#71ce87]"],
            ["Прочие приходы", "0 SUM, 0 USD", "text-[#71ce87]"],
            ["Прочие расходы", "0 SUM, 0 USD", "text-[#e57373]"],
            ["Баланс на конец периода", `${money(FIXED_TOTALS.sum)} SUM, ${money(FIXED_TOTALS.usd)} USD`, "text-[#1ea1f2]"],
          ] as const).map(([label, value, tone]) => (
            <div key={label} className="px-[10px] py-[14px]"><p className={`text-[15px] font-semibold leading-[19px] ${tone}`}>{value}</p><p className="mt-[2px] leading-4 text-[#555]">{label}</p></div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] border-collapse text-[13px]">
            <thead className="bg-[#f2f5f8]">
              <tr className="h-[36px]">
                <th className="w-[220px]" />
                {groups.map((group) => <th key={group} colSpan={2} className="px-2 text-left font-semibold">{group}</th>)}
              </tr>
              <tr className="h-[36px]">
                <th className="px-[16px] text-left font-semibold">Филиал</th>
                {groups.map((group) =>
                  ["SUM", "USD"].map((currency) => (
                    <th key={`${group}-${currency}`} onClick={() => (group === "Баланс на начало периода" ? toggleSort("opening") : group === "Баланс на конец" ? toggleSort("closing") : undefined)} className="cursor-pointer select-none px-2 text-left font-semibold">
                      {currency} <span className="text-[10px] text-[#777]">⇅</span>
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {sortedBranches.slice(0, 7).map((branch, index) => (
                <tr key={branch.id} className={`h-[40px] border-t border-[#efefef] ${index % 2 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                  <td className="px-[16px]">{branch.name}</td>
                  <td className="px-2"><AmountCell value={branch.opening.sum} /></td>
                  <td className="px-2"><AmountCell value={branch.opening.usd} /></td>
                  {Array.from({ length: 10 }).map((_, cellIndex) => <td key={cellIndex} className="px-2">0</td>)}
                  <td className="px-2"><AmountCell value={branch.opening.sum} /></td>
                  <td className="px-2"><AmountCell value={branch.opening.usd} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-center py-3 text-[13px] text-[#555]">Показано {Math.min(sortedBranches.length, 7)} из {sortedBranches.length} филиалов</div>
        </div>
      </section>

      <WarehouseOverview />
      <div className="mt-[30px]"><CashOverview /></div>
      <div className="h-[30px]" />
    </ReportPage>
  )
}
