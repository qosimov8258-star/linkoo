"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { useStockOptions, useUrlState } from "@/components/analytics/stock-move-filters"
import { PLAN_MOVEMENTS_DOWNLOAD_EVENT, StockPlanMovements } from "@/components/analytics/stock-plan-movements"
import { countsApiQuery, planStateFromParams } from "@/components/analytics/stock-plan-state"
import { StockPlanTasks } from "@/components/analytics/stock-plan-tasks"
import { RI, RefHeader, RefPage, RefTabs } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { NO_PLAN_RIGHTS, PLAN_TAB_LABELS, PLAN_TABS, type PlanPermission, type PlanRights, type PlanTab, type PlanTaskCounts } from "@/lib/stock-plan-types"

// "План приемок и передач" (demo #/stock/receive, uz "Qabul qilish | Yuborish |
// Mahsulot harakati | Qabul tarixi | Etkazish tarixi"): what each warehouse
// still has to receive / send, the stock movement lines, and the done history.
// Real data: supplier incomings, internal transfers, orders and the stock
// ledger (lib/stock). Actions go to the documents' own endpoints (a client
// return's to the plan's own POST /api/stock/plan/returns/[id]/accept). The state
// (tab, filters, search, page, expanded row) lives in the URL.

/** The user's plan permissions from GET /api/auth/me — the server rule of hasPermission
 * (lib/rbac.ts): role manager or admin and, for a user restricted by an access right
 * (Права доступа), the permission granted. No rights while loading, so a button the
 * server would refuse (403) is never offered. */
function usePlanRights(): PlanRights {
  const [rights, setRights] = useState<PlanRights>(NO_PLAN_RIGHTS)
  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ role?: string; permissions?: string[] | null }>) : null))
      .then((user) => {
        if (cancelled || !user) return
        const writer = user.role === "manager" || user.role === "admin"
        const granted = (code: PlanPermission) => writer && (user.role === "admin" || !Array.isArray(user.permissions) || user.permissions.includes(code))
        setRights({ "stock.manage": granted("stock.manage"), "procurement.manage": granted("procurement.manage") })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return rights
}

export function StockPlanView() {
  return (
    <Suspense fallback={null}>
      <StockPlanContent />
    </Suspense>
  )
}

/** The ⋮ page menu of "Движение товаров": one item, "Скачать все". */
function MovementsMenu() {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  return (
    <div ref={root} className="relative mr-[2px] -mt-[4px]">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={t("Меню")} className="flex h-12 w-12 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.more} /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-[50px] z-[60] flex h-14 w-[280px] items-center rounded-[2px] bg-white pl-5 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              window.dispatchEvent(new Event(PLAN_MOVEMENTS_DOWNLOAD_EVENT))
            }}
            className="flex w-full items-center text-left text-[13px] text-[#333]"
          >
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#71ce87]">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d={RI.download} /></svg>
            </span>
            <span className="ml-[26px]">{t("Скачать все")}</span>
          </button>
        </div>
      )}
    </div>
  )
}

function StockPlanContent() {
  const { t } = useLanguage()
  const { searchParams, update } = useUrlState()
  const state = planStateFromParams(searchParams)
  const rights = usePlanRights()
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
    <RefPage>
      <RefHeader title={t("План приемок и передач")}>
        {state.tab === "movement" && <MovementsMenu />}
      </RefHeader>

      <RefTabs
        separate
        labels={PLAN_TABS.map((tab) => PLAN_TAB_LABELS[tab])}
        value={PLAN_TAB_LABELS[state.tab]}
        onChange={(label) => openTab(PLAN_TABS.find((tab) => PLAN_TAB_LABELS[tab] === label) ?? "receive")}
      />

      {state.tab === "movement" ? (
        <StockPlanMovements key="movement" state={state} update={update} options={options} onOptionsWanted={wantOptions} notify={notify} />
      ) : (
        <StockPlanTasks key={state.tab} tab={state.tab} state={state} update={update} rights={rights} options={options} onOptionsWanted={wantOptions} notify={notify} onChanged={counts.reload} />
      )}

      <CashSnackbar message={message} onClose={closeSnackbar} />
    </RefPage>
  )
}
