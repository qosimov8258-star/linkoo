"use client"

import { useState } from "react"

import { BranchBalanceWidget } from "@/components/analytics/balance/branch-widget"
import { CashOverview, useBalanceOverview, WarehouseOverview } from "@/components/analytics/balance-sections"
import { periodRange } from "@/components/analytics/balance-tab-view"
import { ReportPage, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { formatDayMonth, monthStartIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Dashboard tab "ФИЛИАЛ": branch balances of the chosen period (default: the
// current month) from GET /api/balances/branch — the totals strip and one row
// per branch — plus the warehouse and cash sections of the same period
// (GET /api/balances/overview).

export function BranchTabView() {
  const { language } = useLanguage()
  const [period, setPeriod] = useState("МЕСЯЦ")
  const [custom, setCustom] = useState(() => ({ from: monthStartIso(), to: todayIso() }))
  const [applied, setApplied] = useState(() => periodRange("МЕСЯЦ", custom))
  const overview = useBalanceOverview(applied)

  const choosePeriod = (value: string) => {
    setPeriod(value)
    if (value !== "СВОЯ") setApplied(periodRange(value, custom))
  }
  const changeCustom = (next: { from: string; to: string }) => {
    setCustom(next)
    setApplied(periodRange("СВОЯ", next))
  }
  const dayLabel = (iso: string) => `${formatDayMonth(iso, language)} ${iso.slice(0, 4)}`
  const range = `${dayLabel(applied.from)} - ${dayLabel(applied.to)}`

  return (
    <ReportPage>
      <WidgetHeader active="ФИЛИАЛ" />
      <WidgetUserCard period={period} onPeriod={choosePeriod} range={range}>
        {period === "СВОЯ" && (
          <span className="ml-[8px] flex items-center gap-[6px] text-[13px]">
            <input type="date" value={custom.from} max={custom.to} onChange={(event) => event.target.value && changeCustom({ ...custom, from: event.target.value })} className="h-[30px] border-b" />
            <input type="date" value={custom.to} min={custom.from} onChange={(event) => event.target.value && changeCustom({ ...custom, to: event.target.value })} className="h-[30px] border-b" />
          </span>
        )}
      </WidgetUserCard>

      <BranchBalanceWidget from={applied.from} to={applied.to} />

      <WarehouseOverview data={overview.data} />
      <div className="mt-[30px]"><CashOverview data={overview.data} /></div>
      <div className="h-[30px]" />
    </ReportPage>
  )
}
