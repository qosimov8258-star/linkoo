"use client"

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react"

import { AGENT_DRAWER, SHOP_DRAWER, shopHref, shopIdOf, useAddressSearch, writeAddressParams, writeShopParam } from "@/components/clients/shop-open-address"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

import { AgentDayView } from "./agent-day-view"
import { EmbeddedShopCard } from "./shop-drawer-swap"

// Linko's agent drawer (drawer_agent_visit): an agent's name in Системная дистрибуция (its report's on_click) or in the
// dashboard's agent widgets opens the agent's day on the right — сделки, посещено, Заказ оформлен / Отказы / Надо
// посетить, the day switcher and the timeline of clients — the same day as Отслеживание (GET
// /api/tracking/agents/<id>/day), on the end of the page's period. Like Linko's, the drawer lives in the address:
// drawer=drawer_agent_visit&drawerOpen=true&id=<agent>&date=<day> (the day switcher pushes date=<day>, its X writes
// drawerOpen=false&id=0), and a client of the day swaps the day for the client's shop card (drawer=shop&openShop=<id>;
// the card's X writes openShop=0&drawer=drawer_agent_visit and the day comes back). A reload reopens the day or the
// card, and Back steps through them.

type DrawerState = { employeeId: number; date: string; shop: number | null }

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The drawer of a query string (null when closed). */
function drawerOf(search: string): DrawerState | null {
  const params = new URLSearchParams(search)
  const drawer = params.get("drawer")
  if (params.get("drawerOpen") !== "true" || (drawer !== AGENT_DRAWER && drawer !== SHOP_DRAWER)) return null
  const employeeId = shopIdOf(params.get("id"))
  if (employeeId === null) return null
  const date = params.get("date") ?? ""
  return { employeeId, date: DAY.test(date) ? date : todayIso(), shop: drawer === SHOP_DRAWER ? shopIdOf(params.get("openShop")) : null }
}

export function AgentVisitDrawer({
  employeeId,
  date,
  shop,
  width,
  onClose,
  onDayChange,
  onOpenShop,
  onCloseShop,
}: {
  employeeId: number
  date: string
  /** The shop card shown in the day's place. */
  shop: number | null
  width: number
  onClose: () => void
  onDayChange: (day: string) => void
  onOpenShop: (clientId: number) => void
  onCloseShop: () => void
}) {
  const { t } = useLanguage()
  const clientHref = useCallback((clientId: number) => shopHref("openShop", clientId, { drawer: SHOP_DRAWER }), [])
  return (
    // An outside click closes the day; the shop card stays (only its X closes it, as Linko's).
    <div className="fixed inset-0 z-[700]" onMouseDown={(event) => shop === null && event.target === event.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={t("Агент")} className="absolute bottom-0 right-0 top-0 max-w-full bg-white shadow-[-2px_0_10px_rgba(0,0,0,0.2)]" style={{ width }}>
        {shop !== null ? (
          <EmbeddedShopCard clientId={shop} onClose={onCloseShop} />
        ) : (
          <AgentDayView
            key={`${employeeId}|${date}`}
            variant="drawer"
            employeeId={employeeId}
            date={date}
            onClose={onClose}
            closeOnEscape
            onDayChange={onDayChange}
            onOpenClient={onOpenShop}
            clientHref={clientHref}
          />
        )}
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One drawer per page: any agent name inside <AgentDrawerScope> opens it
// ---------------------------------------------------------------------------

type OpenAgent = (agent: { employeeId: number; date?: string }) => void

const AgentDrawerContext = createContext<OpenAgent | null>(null)

/** Hosts the agent drawer of a page; <AgentLink> inside opens it. `date` = the day it opens on (the period's end),
 * `width` = Linko's drawer width there (600 on the reports, 800 on the dashboard), `push` = opening adds a history entry
 * (Linko's dashboard pushes, its reports replace). */
export function AgentDrawerScope({ date, width = 600, push = false, children }: { date?: string; width?: number; push?: boolean; children: ReactNode }) {
  const search = useAddressSearch()
  const drawer = useMemo(() => drawerOf(search), [search])
  const open = useCallback<OpenAgent>(
    (agent) =>
      writeAddressParams(
        { openShop: null, drawer: AGENT_DRAWER, drawerOpen: "true", id: String(agent.employeeId), date: agent.date ?? date ?? todayIso() },
        push ? "push" : "replace",
      ),
    [date, push],
  )
  const close = useCallback(() => writeAddressParams({ drawerOpen: "false", id: "0" }, "replace"), [])
  const changeDay = useCallback((day: string) => writeAddressParams({ date: day }), [])
  const openShop = useCallback((clientId: number) => writeShopParam("openShop", clientId, { drawer: SHOP_DRAWER }), [])
  const closeShop = useCallback(() => writeShopParam("openShop", null), [])
  return (
    <AgentDrawerContext.Provider value={open}>
      {children}
      {drawer && (
        <AgentVisitDrawer
          employeeId={drawer.employeeId}
          date={drawer.date}
          shop={drawer.shop}
          width={width}
          onClose={close}
          onDayChange={changeDay}
          onOpenShop={openShop}
          onCloseShop={closeShop}
        />
      )}
    </AgentDrawerContext.Provider>
  )
}

/** An agent's name that opens the agent drawer of the page (plain text outside a scope): Linko's blue link of a report
 * ("link"), or the dashboard's name that turns blue and bold under the pointer ("plain"). */
export function AgentLink({
  employeeId,
  name,
  date,
  className = "",
  tone = "link",
}: {
  employeeId: number | null | undefined
  name: ReactNode
  date?: string
  className?: string
  tone?: "link" | "plain"
}) {
  const open = useContext(AgentDrawerContext)
  if (!open || !employeeId) return <>{name}</>
  return (
    <button
      type="button"
      onClick={(event) => {
        // A grouped row toggles itself on click: the name opens the drawer only.
        event.stopPropagation()
        open({ employeeId, date })
      }}
      className={`max-w-full truncate text-left ${tone === "link" ? "text-[#1E4A9A] hover:underline" : "hover:font-semibold hover:text-[#1E4A9A]"} ${className}`}
    >
      {name}
    </button>
  )
}
