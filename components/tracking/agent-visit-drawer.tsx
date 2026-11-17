"use client"

import { createContext, useCallback, useContext, useState, type ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { AgentDayView } from "./agent-day-view"

// The agent drawer of the visit reports (Linko's drawer_agent_visit): a click on an agent's name in Системная
// дистрибуция, Визиты агента, Визиты по дням, Время работы агента … opens the agent's day on the right — сделки,
// посещено, Заказ оформлен / Отказы / Надо посетить, the day switcher and the timeline of clients — the same day
// as Отслеживание (GET /api/tracking/agents/<id>/day). The day is the end of the report's period, as Linko's.

export function AgentVisitDrawer({ employeeId, name, date, onClose }: { employeeId: number; name?: string; date?: string; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[700]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label={name ?? t("Агент")} className="absolute bottom-0 right-0 top-0 w-[600px] max-w-full bg-white shadow-[-2px_0_10px_rgba(0,0,0,0.2)]">
        <AgentDayView variant="drawer" employeeId={employeeId} name={name} date={date} onClose={onClose} closeOnEscape />
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One drawer per page: any agent name inside <AgentDrawerScope> opens it
// ---------------------------------------------------------------------------

type OpenAgent = (agent: { employeeId: number; name?: string; date?: string }) => void

const AgentDrawerContext = createContext<OpenAgent | null>(null)

/** Hosts the agent drawer of a page; <AgentLink> inside opens it. `date` = the day it opens on (the report's end). */
export function AgentDrawerScope({ date, children }: { date?: string; children: ReactNode }) {
  const [agent, setAgent] = useState<{ employeeId: number; name?: string; date?: string } | null>(null)
  const open = useCallback<OpenAgent>((next) => setAgent(next), [])
  return (
    <AgentDrawerContext.Provider value={open}>
      {children}
      {agent && <AgentVisitDrawer key={`${agent.employeeId}|${agent.date ?? date ?? ""}`} employeeId={agent.employeeId} name={agent.name} date={agent.date ?? date} onClose={() => setAgent(null)} />}
    </AgentDrawerContext.Provider>
  )
}

/** An agent's name as Linko's blue link: a click opens the agent drawer of the page (plain text outside a scope). */
export function AgentLink({ employeeId, name, date, className = "" }: { employeeId: number | null | undefined; name: ReactNode; date?: string; className?: string }) {
  const open = useContext(AgentDrawerContext)
  if (!open || !employeeId) return <>{name}</>
  return (
    <button
      type="button"
      onClick={(event) => {
        // A grouped row toggles itself on click: the name opens the drawer only.
        event.stopPropagation()
        open({ employeeId, name: typeof name === "string" ? name : undefined, date })
      }}
      className={`max-w-full truncate text-left text-[#1E4A9A] hover:underline ${className}`}
    >
      {name}
    </button>
  )
}
