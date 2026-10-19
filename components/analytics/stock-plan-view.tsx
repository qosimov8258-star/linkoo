"use client"

import { Suspense, useCallback, useState } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { useStockOptions, useUrlState } from "@/components/analytics/stock-move-filters"
import { StockPlanMovements } from "@/components/analytics/stock-plan-movements"
import { countsApiQuery, planStateFromParams } from "@/components/analytics/stock-plan-state"
import { StockPlanTasks } from "@/components/analytics/stock-plan-tasks"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"
import { PLAN_TAB_LABELS, PLAN_TABS, type PlanTab, type PlanTaskCounts } from "@/lib/stock-plan-types"

// "План приемок и передач" (demo #/stock/receive, uz "Qabul qilish | Yuborish |
// Mahsulot harakati | Qabul tarixi | Etkazish tarixi"): what each warehouse
// still has to receive / send, the stock movement lines, and the done history.
// Real data: supplier incomings, internal transfers, orders and the stock
// ledger (lib/stock). Actions go to the documents' own endpoints. The state
// (tab, filters, search, page, expanded row) lives in the URL.

const BADGE_TABS: Partial<Record<PlanTab, keyof PlanTaskCounts>> = { receive: "receive", transfer: "transfer" }

export function StockPlanView() {
  return (
    <Suspense fallback={null}>
      <StockPlanContent />
    </Suspense>
  )
}

function StockPlanContent() {
  const { t } = useLanguage()
  const { searchParams, update } = useUrlState()
  const state = planStateFromParams(searchParams)
  const canWrite = useCanWrite()
  const counts = useCashJson<PlanTaskCounts>(`/api/stock/plan/counts?${countsApiQuery(state)}`)
  const [lookupsWanted, setLookupsWanted] = useState(false)
  const { options } = useStockOptions(lookupsWanted)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const notify = useCallback((text: string, error = false) => setMessage({ text, tone: error ? "error" : "success" }), [])
  const closeSnackbar = useCallback(() => setMessage(null), [])
  const wantOptions = useCallback(() => setLookupsWanted(true), [])

  // Demo handleTabChange: each tab opens with an empty query.
  const openTab = (tab: PlanTab) => {
    const params = new URLSearchParams()
    if (tab !== "receive") params.set("tab", tab)
    const query = params.toString()
    window.history.pushState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname)
  }

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center gap-3 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
        <span className="text-3xl font-light text-[#586174]">|</span>
        <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("План приемок и передач")}</h1>
      </header>

      <section className="mx-4 mt-4 overflow-x-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] md:mx-6">
        <div className="grid min-w-[720px] grid-cols-5">
          {PLAN_TABS.map((tab) => {
            const badge = BADGE_TABS[tab]
            const count = badge ? counts.data?.[badge] : undefined
            return (
              <button
                key={tab}
                type="button"
                onClick={() => openTab(tab)}
                className={`flex h-[52px] items-center justify-center gap-2 border-b-[3px] px-2 text-[15px] ${state.tab === tab ? "border-[rgb(79,113,220)] font-semibold text-[#17233b]" : "border-transparent text-[#586174] hover:text-[#17233b]"}`}
              >
                {t(PLAN_TAB_LABELS[tab])}
                {Boolean(count) && <span className="rounded-full bg-[rgb(79,113,220)] px-2 text-[12px] font-semibold leading-5 text-white">{count}</span>}
              </button>
            )
          })}
        </div>
      </section>

      {state.tab === "movement" ? (
        <StockPlanMovements key="movement" state={state} update={update} options={options} onOptionsWanted={wantOptions} notify={notify} />
      ) : (
        <StockPlanTasks key={state.tab} tab={state.tab} state={state} update={update} canWrite={canWrite} options={options} onOptionsWanted={wantOptions} notify={notify} onChanged={counts.reload} />
      )}

      <CashSnackbar message={message} onClose={closeSnackbar} />
    </main>
  )
}
