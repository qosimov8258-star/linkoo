"use client"

import { useMemo, useState } from "react"
import type { Agent, AgentCategory } from "./tracking-data"
import { isoDay, useWayAgents } from "./use-way-agents"
import { RefTip } from "@/components/ref/ref-tip"
import { AgentDayDrawer } from "@/components/analytics/agent-day-drawer"
import type { AgentDay } from "./agent-day"
import { useLanguage } from "@/lib/i18n/language-context"

const TAB_TIPS: Record<"agents" | AgentCategory, string> = { agents: "Все", walk: "Агенты", tags: "Мерчендайзеры", delivery: "Доставщики", finance: "Инкассаторы" }
const tabs: { id: "agents" | AgentCategory }[] = [{ id: "agents" }, { id: "walk" }, { id: "tags" }, { id: "delivery" }, { id: "finance" }]

// Material battery glyphs of the reference panel: <=20 red, <=30 orange, below 90 "80", from 90 full.
const BATTERY_BODY = "M17 5.33C17 4.6 16.4 4 15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33"
function Battery({ level }: { level: number }) {
  const bucket = level <= 20 ? 20 : level <= 30 ? 30 : level < 90 ? 80 : 100
  const fill = bucket === 20 ? "#f44336" : bucket === 30 ? "#f0ad4e" : "#81c784"
  const edge = bucket === 20 ? 17 : bucket === 30 ? 15 : 9
  return (
    <div>
      <div style={{ transform: "rotate(90deg)" }}>
        <svg viewBox="0 0 24 24" aria-hidden style={{ display: "inline-block", verticalAlign: "baseline", width: 24, height: 24, fill, userSelect: "none" }}>
          {bucket === 100 ? (
            <path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z" />
          ) : (
            <>
              <path fillOpacity=".3" d={`${BATTERY_BODY}V${edge}h10V5.33z`} />
              <path d={`M7 ${edge}v${20.67 - edge}C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V${edge}H7z`} />
            </>
          )}
        </svg>
      </div>
      <div style={{ paddingLeft: 3 }}>{Math.round(level)}%</div>
    </div>
  )
}

function AgentRow({ agent, onSelect }: { agent: Agent; onSelect: (id: number) => void }) {
  return (
    <div
      onClick={() => onSelect(agent.id)}
      className="relative flex h-[45px] w-full cursor-pointer items-center justify-between border-t border-[#efefef] pl-[45px] pr-[30px] text-left leading-[16.25px] transition-colors hover:bg-[#f7f9fb]"
    >
      <div className="absolute left-[10px] top-[calc(50%-5px)] h-[10px] w-[10px] rounded-full" style={{ background: agent.color }} />
      <div className="absolute left-[30px] top-1/2 -mt-[15px] h-[30px] w-[3px] bg-[#999]">
        {agent.todo > 0 && <div className="absolute inset-x-0 bottom-0 bg-[#8dc572]" style={{ height: `${Math.min(100, (agent.done / agent.todo) * 100)}%` }} />}
      </div>
      <span>
        <b>{agent.name}</b> <br />
        <i>{agent.timestamp}</i>
      </span>
      <span>
        {agent.done} / {agent.todo}
        {agent.noPlan > 0 && <span className="ml-px text-[#ee667d]"> + {agent.noPlan}</span>}
      </span>
      <Battery level={agent.battery} />
    </div>
  )
}

type SidebarProps = {
  selectedId: number | null
  onSelect: (id: number | null) => void
  tab: "agents" | AgentCategory
  onTab: (tab: "agents" | AgentCategory) => void
  /** The day shown by the panel and by the agent card (one for both, as in the reference). */
  date: Date
  onDate: (date: Date) => void
  day: AgentDay
  dayLoading: boolean
  status: string
  onStatus: (status: string) => void
  /** The applied search of the panel (it takes effect on Enter, as in the reference) and the map shows the same agents. */
  search: string
  onSearch: (search: string) => void
  onLocate: (lat: number, lon: number) => void
}

export function AgentsSidebar({ selectedId, onSelect, tab: activeTab, onTab: setActiveTab, date, onDate, day, dayLoading, status, onStatus, search, onSearch, onLocate }: SidebarProps) {
  const { t, language } = useLanguage()
  const [query, setQuery] = useState(search)

  const dateLabel = useMemo(() => {
    const months = [
      "Января",
      "Февраля",
      "Марта",
      "Апреля",
      "Мая",
      "Июня",
      "Июля",
      "Августа",
      "Сентября",
      "Октября",
      "Ноября",
      "Декабря",
    ]
    return `${String(date.getDate()).padStart(2, "0")} ${t(months[date.getMonth()])} ${date.getFullYear()}`
  }, [date, t])

  const { agents } = useWayAgents(activeTab, isoDay(date), language)
  const filtered = useMemo(() => agents.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase())), [agents, search])
  const onlineAgents = filtered.filter((agent) => agent.online)
  const offlineAgents = filtered.filter((agent) => !agent.online)

  function shiftDate(days: number) {
    const next = new Date(date)
    next.setDate(next.getDate() + days)
    onDate(next)
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedId)
  const stepAgent = (step: number) => {
    const list = filtered.length ? filtered : agents
    const index = list.findIndex((agent) => agent.id === selectedId)
    const next = list[(index + step + list.length) % list.length]
    if (next) onSelect(next.id)
  }

  if (selectedAgent) {
    return (
      <AgentDayDrawer
        variant="tracking"
        width={530}
        name={selectedAgent.name}
        date={isoDay(date)}
        onClose={() => onSelect(null)}
        onPrev={() => stepAgent(-1)}
        onNext={() => stepAgent(1)}
        tracking={{ day, loading: dayLoading, status, onStatus, onLocate, onDate: (iso) => onDate(new Date(`${iso}T00:00:00`)) }}
      />
    )
  }

  const MaterialTabs: Record<string, string> = {
    agents: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
    walk: "M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm9 7h-6v13h-2v-6h-2v6H9V9H3V7h18v2z",
    tags: "M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7zm11.77 8.27L13 19.54l-4.27-4.27C8.28 14.81 8 14.19 8 13.5c0-1.38 1.12-2.5 2.5-2.5.69 0 1.32.28 1.77.74l.73.72.73-.73c.45-.45 1.08-.73 1.77-.73 1.38 0 2.5 1.12 2.5 2.5 0 .69-.28 1.32-.73 1.77z",
    delivery: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
    finance: "M11 17h2v-1h1c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1h-3v-1h4V8h-2V7h-2v1h-1c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h3v1H9v2h2v1zm9-13H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4V6h16v12z",
  }

  return (
    <aside className="fixed right-0 top-0 z-[60] flex h-screen w-[334px] flex-col bg-white text-[13px] leading-[16.25px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      {/* Date navigation */}
      <div className="flex h-[60px] shrink-0 items-center justify-between px-[30px]">
        <button type="button" onClick={() => shiftDate(-1)} aria-label={t("Предыдущий день")} className="flex h-[34px] w-[34px] items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-[34px] w-[34px] fill-[#666]"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
        </button>
        <span className="text-[16px] font-semibold">{dateLabel}</span>
        <button type="button" onClick={() => shiftDate(1)} aria-label={t("Следующий день")} className="flex h-[34px] w-[34px] items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-[34px] w-[34px] fill-[#666]"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex h-[40px] shrink-0 items-center justify-center gap-[20px] bg-[#ccc]">
        {tabs.map(({ id }) => (
          <RefTip key={id} text={t(TAB_TIPS[id])} side="bottom">
            <button
              type="button"
              onClick={() => setActiveTab(id)}
              className="relative flex h-[40px] w-[40px] items-center justify-center"
              aria-label={id}
            >
              <svg viewBox="0 0 24 24" className={`h-[22px] w-[22px] ${activeTab === id ? "fill-[#666]" : "fill-white"}`}><path d={MaterialTabs[id]} /></svg>
              {activeTab === id && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 border-x-[6px] border-b-[6px] border-x-transparent border-b-white" />}
            </button>
          </RefTip>
        ))}
      </div>

      {/* Search */}
      <div className="shrink-0 px-[30px] py-[10px]">
        <div className="relative h-[44px] border-2 border-dashed border-[#efefef]">
          <div className="flex h-[40px] items-center pl-[10px] pr-[35px]">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSearch(query)
              }}
              placeholder={t("Поиск агентов...")}
              className="h-full w-full bg-transparent text-[13px] text-[#333] outline-none placeholder:text-black/30"
            />
          </div>
          <button type="button" onClick={() => onSearch(query)} className="absolute right-0 top-0 h-[40px] w-[40px]" aria-label={t("Поиск агентов...")}>
            <div className="ml-[9px] mt-[7px] h-[26px] w-[22px]">
              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#5d6474]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            </div>
          </button>
        </div>
      </div>

      {/* Online agents */}
      {onlineAgents.length > 0 ? (
        <>
          <div className="flex h-[45px] shrink-0 items-center justify-between border-t border-[#efefef] pl-[5%] pr-[30px]">
            <span className="text-[13px] font-semibold leading-[16.25px]">{t("Онлайн агенты")}</span>
            <span className="text-[13px] font-bold leading-[16.25px]">{onlineAgents.length}</span>
          </div>
          <div className="max-h-[40%] overflow-y-auto">
            {onlineAgents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={onSelect} />
            ))}
          </div>
        </>
      ) : (
        <div className="mb-[25px] shrink-0 bg-[url('/robot-empty.png')] bg-[length:120px] bg-center bg-no-repeat px-[40px] pt-[175px] text-center text-[13px] leading-[16.25px] text-[#666]">{t("Онлайн агенты не найдены...")}</div>
      )}

      {/* Offline agents */}
      {offlineAgents.length > 0 ? (
        <>
          <div className="flex h-[45px] shrink-0 items-center justify-between border-t border-[#efefef] pl-[5%] pr-[30px]">
            <span className="text-[13px] font-semibold leading-[16.25px]">{t("Офлайн агенты")}</span>
            <span className="text-[13px] font-bold leading-[16.25px]">{offlineAgents.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {offlineAgents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={onSelect} />
            ))}
          </div>
        </>
      ) : (
        <div className="shrink-0 bg-[url('/robot-empty.png')] bg-[length:120px] bg-center bg-no-repeat px-[40px] pt-[175px] text-center text-[13px] leading-[16.25px] text-[#666]">{t("Офлайн агенты не найдены...")}</div>
      )}
    </aside>
  )
}
