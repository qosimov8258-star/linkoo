"use client"

import { Search } from "lucide-react"
import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

// Анализ маршрутов: the agents of the plan and the right-hand list of them (Linko's agents_plans: every employee shown
// in tracking, inactive ones too, the newest first) — five group tabs, «Поиск агентов...», each agent with its visited /
// planned clients of the day. The list page opens it with ◂, the agent's page (Linko's #/plan/:agentId) shows it all
// the time and opens another agent from it. The list page's cards are the active agents in login order.

/** Agent categories behind the five tabs of the list, in the reference's order. */
export const AGENT_TABS = [
  { id: "all", group: "", label: "Все", icon: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" },
  { id: "agents", group: "agent", label: "Агенты", icon: "M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z" },
  { id: "merch", group: "merch", label: "Мерчендайзеры", icon: "M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7zm11.77 8.27L13 19.54l-4.27-4.27C8.28 14.81 8 14.19 8 13.5c0-1.38 1.12-2.5 2.5-2.5.69 0 1.32.28 1.77.74l.73.72.73-.73c.45-.45 1.08-.73 1.77-.73 1.38 0 2.5 1.12 2.5 2.5 0 .69-.28 1.32-.73 1.77z" },
  { id: "delivery", group: "delivery", label: "Доставщики", icon: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" },
  { id: "collectors", group: "collector", label: "Инкассаторы", icon: "M11 17h2v-1h1c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1h-3v-1h4V8h-2V7h-2v1h-1c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h3v1H9v2h2v1zm9-13H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4V6h16v12z" },
] as const

export type AgentTabId = (typeof AGENT_TABS)[number]["id"]

/** `groups` = the reference group tabs the employee is in (null while the agent plan is not loaded). */
export type RouteAgent = { employeeId: number; name: string; firstName: string; lastName: string; position: string; groups: string[] | null; active: boolean }

/** The day's board of /api/agent-visits (lib/agent-visits-repo.ts getRoutesBoard), as far as the list counts it. */
export type RouteBoard = {
  currency?: string
  problems: Array<{ employeeId: number; visited: number; plan: number }>
  active: Array<{ employeeId: number; visited: number; plan: number }>
  plans: Array<{ employeeId: number; plan: number }>
}

/** The list's «visited / planned» of each agent: visited from the board, planned from the day's plan of every agent. */
export function boardCounts(agents: RouteAgent[], board: RouteBoard | null): Map<number, { visited: number; plan: number }> {
  const progress = new Map([...(board?.problems ?? []), ...(board?.active ?? [])].map((agent) => [agent.employeeId, agent]))
  const plans = new Map((board?.plans ?? []).map((entry) => [entry.employeeId, entry.plan]))
  return new Map(
    agents.map((agent) => [agent.employeeId, { visited: progress.get(agent.employeeId)?.visited ?? 0, plan: plans.get(agent.employeeId) ?? progress.get(agent.employeeId)?.plan ?? 0 }]),
  )
}

/** The agents of the plan (its members, active or not, in login order); every active employee until the plan is seeded.
 * Only the employees of the reader's field scope (GET /api/field-activity/people). */
export function useRouteAgents(): RouteAgent[] {
  const [agents, setAgents] = useState<RouteAgent[]>([])
  useEffect(() => {
    let cancelled = false
    type EmployeeRow = { id?: number; name?: string; firstName?: string; lastName?: string; first_name?: string; last_name?: string; position?: string; active?: boolean }
    const json = async <T,>(url: string): Promise<T[]> => {
      const response = await fetch(url)
      return response.ok ? ((await response.json()) as T[]) : []
    }
    Promise.all([json<EmployeeRow>("/api/field-activity/people"), json<{ employeeId: number; active: boolean; groups: string[]; position?: number }>("/api/agent-plan-members").catch(() => [])])
      .then(([data, members]) => {
        if (cancelled || !Array.isArray(data)) return
        const plan = Array.isArray(members) && members.length ? new Map(members.map((member) => [member.employeeId, { groups: member.groups, position: member.position ?? -1, active: member.active }])) : null
        setAgents(
          data
            .filter((row) => (plan ? plan.has(Number(row.id)) : row.active !== false))
            // the reference lists the plan in its own order (unknown positions keep the employee order, after the known ones)
            .map((row, index) => ({
              employeeId: Number(row.id),
              name: [row.firstName ?? row.first_name, row.lastName ?? row.last_name].filter(Boolean).join(" ") || row.name || "",
              firstName: row.firstName ?? row.first_name ?? "",
              lastName: row.lastName ?? row.last_name ?? "",
              position: (row.position ?? "").toLowerCase(),
              groups: plan ? (plan.get(Number(row.id))?.groups ?? []) : null,
              active: plan ? plan.get(Number(row.id))?.active !== false : row.active !== false,
              order: plan && (plan.get(Number(row.id))?.position ?? -1) >= 0 ? (plan.get(Number(row.id))?.position as number) : 1000 + index,
            }))
            .filter((row) => row.name)
            .sort((a, b) => a.order - b.order)
            .map((row) => ({ employeeId: row.employeeId, name: row.name, firstName: row.firstName, lastName: row.lastName, position: row.position, groups: row.groups, active: row.active })),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return agents
}

/** The right-hand list: tabs, search, the agents with visited / planned (a click opens the agent). */
export function RouteAgentsPanel({
  agents,
  counts,
  activeId,
  onPick,
}: {
  agents: RouteAgent[]
  counts: Map<number, { visited: number; plan: number }>
  activeId?: number
  onPick: (employeeId: number) => void
}) {
  const { t } = useLanguage()
  const [agentTab, setAgentTab] = useState<AgentTabId>("all")
  const [tabTip, setTabTip] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  // The tabs are the reference's server groups (agents_plans?group=agent|merch|delivery|collector). Until the agent plan
  // is seeded a tab keeps the employees whose job names the singular of its label.
  const tab = AGENT_TABS.find((entry) => entry.id === agentTab)
  const tabMatch = agentTab === "all" ? "" : (tab?.label ?? "").slice(0, -1).toLowerCase()
  const inTab = (agent: RouteAgent) => (!tab?.group ? true : agent.groups ? agent.groups.includes(tab.group) : agent.position.includes(tabMatch))
  // Linko's agents_plans: the newest employee first.
  const shown = agents.filter((agent) => agent.name.toLowerCase().includes(query.toLowerCase()) && inTab(agent)).sort((a, b) => b.employeeId - a.employeeId)

  return (
    <>
      <div className="relative mt-5 flex h-10 items-center bg-[#c8c8c8] px-[15px]">
        {AGENT_TABS.map((entry) => (
          <div key={entry.id} className="relative" onMouseEnter={() => setTabTip(entry.id)} onMouseLeave={() => setTabTip((current) => (current === entry.id ? null : current))}>
            <button type="button" onClick={() => setAgentTab(entry.id)} aria-label={t(entry.label)} aria-pressed={agentTab === entry.id} className="relative flex h-10 w-[60px] items-center justify-center">
              <svg viewBox="0 0 24 24" className={`h-[22px] w-[22px] ${agentTab === entry.id ? "fill-[#666]" : "fill-white"}`}>
                <path d={entry.icon} />
              </svg>
              {agentTab === entry.id && <span className="absolute bottom-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-b-[5px] border-x-transparent border-b-white" />}
            </button>
            {tabTip === entry.id && (
              <span className="pointer-events-none absolute left-1/2 top-[2px] z-10 -translate-x-1/2 whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[4px] text-[13px] font-bold leading-[17px] text-white opacity-90">{t(entry.label)}</span>
            )}
          </div>
        ))}
      </div>
      <div className="relative mx-[30px] mt-[10px] flex h-11 items-center border border-dashed border-[#ddd] px-3">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`${t("Поиск агентов")}...`} className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/30" />
        <Search className="h-5 w-5 text-[#555]" />
      </div>
      {shown.length === 0 ? (
        <div className="mt-[40px] flex flex-col items-center text-center text-[13px] text-[#555]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/robot-empty.png" alt="" className="w-[92px]" />
          <p className="mt-[10px] max-w-[190px]">{t("По вашему запросу ничего не найдено")}</p>
        </div>
      ) : (
        <ul className="mt-[10px] border-t border-[#efefef]">
          {shown.map((agent) => (
            <li key={agent.employeeId}>
              <button
                type="button"
                onClick={() => onPick(agent.employeeId)}
                aria-current={agent.employeeId === activeId ? "page" : undefined}
                className={`flex h-[45px] w-full items-center justify-between border-b border-[#efefef] pl-[30px] pr-[30px] text-left text-[13px] hover:bg-[#f2f5f8] ${agent.employeeId === activeId ? "bg-[#f2f5f8] font-semibold" : ""}`}
              >
                <span className={`relative pl-[15px] before:absolute before:left-0 before:top-1/2 before:h-[30px] before:w-[3px] before:-translate-y-1/2 ${agent.employeeId === activeId ? "before:bg-[#1E4A9A]" : "before:bg-[#999]"}`}>{agent.name}</span>
                <span>
                  {counts.get(agent.employeeId)?.visited ?? 0} / {counts.get(agent.employeeId)?.plan ?? 0}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
