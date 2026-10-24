"use client"

import { useMemo, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  MapPin,
  Pencil,
  RotateCcw,
  ScanLine,
  X,
} from "lucide-react"
import type { Agent, AgentCategory } from "./tracking-data"
import { isoDay, useWayAgents } from "./use-way-agents"
import { useLanguage } from "@/lib/i18n/language-context"

const tabs: { id: "agents" | AgentCategory }[] = [{ id: "agents" }, { id: "walk" }, { id: "tags" }, { id: "delivery" }, { id: "finance" }]

// Material battery glyphs of the reference panel: <=20 red, <=30 orange, below 90 "80", from 90 full.
const BATTERY_BODY = "M17 5.33C17 4.6 16.4 4 15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33"
function Battery({ level }: { level: number }) {
  const bucket = level <= 20 ? 20 : level <= 30 ? 30 : level < 90 ? 80 : 100
  const fill = bucket === 20 ? "#f44336" : bucket === 30 ? "#f0ad4e" : "#81c784"
  const edge = bucket === 20 ? 17 : bucket === 30 ? 15 : 9
  return (
    <div className="flex h-[44px] flex-col items-end justify-between">
      <svg viewBox="0 0 24 24" className="h-6 w-6 rotate-90" style={{ fill }} aria-hidden>
        {bucket === 100 ? (
          <path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z" />
        ) : (
          <>
            <path fillOpacity=".3" d={`${BATTERY_BODY}V${edge}h10V5.33z`} />
            <path d={`M7 ${edge}v${20.67 - edge}C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V${edge}H7z`} />
          </>
        )}
      </svg>
      <span className="text-[13px] leading-[16px]">{Math.round(level)}%</span>
    </div>
  )
}

function AgentRow({ agent, onSelect }: { agent: Agent; onSelect: (id: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(agent.id)}
      className="relative flex h-[45px] w-full cursor-pointer items-center border-t border-[#efefef] pl-[45px] pr-[30px] text-left transition-colors hover:bg-[#f7f9fb]"
    >
      <span className="absolute left-[10px] top-1/2 h-[10px] w-[10px] -translate-y-1/2 rounded-full" style={{ background: agent.color }} />
      <span className="absolute left-[30px] top-1/2 h-[30px] w-[3px] -translate-y-1/2 bg-[#999]" />
      <span className="block min-w-[160px]">
        <b className="block whitespace-nowrap text-[13px] font-bold leading-[17px]">{agent.name}</b>
        <i className="block whitespace-nowrap text-[13px] font-normal leading-[16px]">{agent.timestamp}</i>
      </span>
      <span className="text-[13px] leading-[16px]">{agent.ratio}</span>
      <span className="ml-auto">
        <Battery level={agent.battery} />
      </span>
    </button>
  )
}

export function AgentsSidebar() {
  const { t, language } = useLanguage()
  const [activeTab, setActiveTab] = useState<"agents" | AgentCategory>("agents")
  const [query, setQuery] = useState("")
  const [date, setDate] = useState(() => new Date())
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const [routeFilterOpen, setRouteFilterOpen] = useState(false)
  const [routeOrder, setRouteOrder] = useState<"default" | "optimized">("default")
  const defaultRouteClients: string[] = []
  const routeClients = routeOrder === "optimized" ? [...defaultRouteClients].sort((a, b) => a.localeCompare(b, "ru")) : defaultRouteClients

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
    return `${date.getDate()} ${t(months[date.getMonth()])} ${date.getFullYear()}`
  }, [date, t])

  const { agents } = useWayAgents(activeTab, isoDay(date), language)
  const filtered = useMemo(() => agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase())), [agents, query])
  const onlineAgents = filtered.filter((agent) => agent.online)
  const offlineAgents = filtered.filter((agent) => !agent.online)

  function shiftDate(days: number) {
    setDate((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() + days)
      return next
    })
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId)

  if (selectedAgent) {
    return (
      <aside className="flex h-full w-[650px] shrink-0 flex-col border-l bg-slate-50">
        <header className="flex items-center gap-4 border-b bg-white px-6 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-500 font-bold text-white">{selectedAgent.name.charAt(0)}</span>
          <ChevronLeft className="h-5 w-5 text-slate-500" />
          <strong className="uppercase text-slate-700">{selectedAgent.name}</strong>
          <ChevronRight className="h-5 w-5 text-slate-500" />
          <div className="relative ml-auto">
            <button type="button" onClick={() => setRouteFilterOpen((value) => !value)} className="text-[#536fe1]">{t("Показать фильтр")}⌄</button>
            {routeFilterOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-56 border border-slate-200 bg-white p-4 shadow-xl">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={routeOrder === "optimized"} onChange={() => setRouteOrder((current) => (current === "optimized" ? "default" : "optimized"))} />
                  {t("Оптимизированный порядок (А-Я)")}
                </label>
              </div>
            )}
          </div>
          <button type="button" onClick={() => setSelectedAgentId(null)} aria-label={t("Закрыть")}><X className="h-7 w-7" /></button>
        </header>
        <div className="grid grid-cols-2 border-b bg-white px-7 py-4">
          <div className="flex items-center gap-3"><Flame className="h-8 w-8 text-slate-400" /><div><b className="text-xl">0 <small>SUM</small></b><p>{t("сделки")}</p></div></div>
          <div className="flex items-center gap-3 justify-self-end"><MapPin className="h-8 w-8 text-slate-400" /><div><b className="text-xl">{selectedAgent.ratio}</b><p>{t("посещено")}</p></div></div>
        </div>
        <div className="grid grid-cols-3 gap-4 p-6">
          <div className="rounded bg-[#39ca79] py-3 text-center font-bold text-white"><b className="text-2xl">0</b> {t("Заказ оформлен")}</div>
          <div className="rounded bg-[#ff5d63] py-3 text-center font-bold text-white"><b className="text-2xl">0</b> {t("Отказы")}</div>
          <div className="rounded bg-[#13a0f4] py-3 text-center font-bold text-white"><b className="text-2xl">0</b> {t("Надо посетить")}</div>
        </div>
        <div className="flex items-center gap-5 px-6">
          <button type="button" onClick={() => shiftDate(-1)} className="rounded bg-[#20abc8] px-4 py-2 font-bold text-white">‹</button>
          <b className="text-[#20abc8]">{t("28 июля 2026")}</b>
          <button type="button" onClick={() => shiftDate(1)} className="rounded bg-[#20abc8] px-4 py-2 font-bold text-white">›</button>
          <button type="button" onClick={() => setRouteOrder("optimized")} className="ml-auto rounded bg-[#536fe1] px-5 py-3 font-bold text-white">{routeOrder === "optimized" ? t("Маршрут оптимизирован ✓") : t("Оптимизировать маршрут")}</button>
          <ScanLine className="text-slate-500" /><Pencil className="rounded bg-slate-300 p-1 text-white" />
        </div>
        <div className="relative mt-5 flex-1 overflow-y-auto px-10 pb-8 pl-32">
          <div className="absolute bottom-0 left-[94px] top-0 w-1 bg-[#20abc8]" />
          {routeClients.map((client) => (
            <label key={client} className="relative mb-3 block rounded bg-white px-7 py-5 shadow">
              <span className="absolute -left-[52px] top-8 h-7 w-7 rounded-full border-[3px] border-[#536fe1] bg-white" />
              <span className="flex items-center gap-3 text-lg font-bold text-slate-600"><input type="checkbox" className="h-6 w-6" />{client}</span>
              <span className="mt-2 flex items-center gap-3 text-slate-600"><RotateCcw className="h-5 w-5 text-orange-400" />{t("Следует посетить 28 Июль 2026 года")}</span>
            </label>
          ))}
        </div>
      </aside>
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
    <aside className="fixed right-0 top-0 z-[60] flex h-screen w-[334px] flex-col bg-white text-[13px] text-[#333] shadow-[-2px_0_6px_rgba(0,0,0,0.15)]">
      {/* Date navigation */}
      <div className="flex h-[60px] shrink-0 items-center justify-between px-[30px]">
        <button type="button" onClick={() => shiftDate(-1)} aria-label={t("Предыдущий день")} className="flex h-[34px] w-[34px] items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
        </button>
        <span className="text-[16px] font-semibold">{dateLabel}</span>
        <button type="button" onClick={() => shiftDate(1)} aria-label={t("Следующий день")} className="flex h-[34px] w-[34px] items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex h-[40px] shrink-0 items-center justify-center gap-[20px] bg-[#ccc]">
        {tabs.map(({ id }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className="flex h-[40px] w-[40px] items-center justify-center"
            aria-label={id}
          >
            <svg viewBox="0 0 24 24" className={`h-[22px] w-[22px] ${activeTab === id ? "fill-[#666]" : "fill-white"}`}><path d={MaterialTabs[id]} /></svg>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="shrink-0 px-[30px] pt-[10px]">
        <div className="flex h-[43px] items-center border border-dashed border-[#e0e0e0] pl-[11px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Поиск агентов...")}
            className="h-full flex-1 bg-transparent text-[13px] text-[#333] outline-none placeholder:text-black/30"
          />
          <button type="button" className="mb-[3px] flex h-[40px] w-[40px] items-center justify-center" aria-label={t("Поиск агентов...")}>
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#5d6474]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
          </button>
        </div>
      </div>

      {/* Online agents */}
      {onlineAgents.length > 0 ? (
        <>
          <div className="flex h-[44px] shrink-0 items-center justify-between border-t border-[#efefef] pl-[17px] pr-[30px]">
            <span className="text-[13px] font-semibold leading-[16px]">{t("Онлайн агенты")}</span>
            <span className="text-[13px] font-bold leading-[16px]">{onlineAgents.length}</span>
          </div>
          <div className="max-h-[40%] overflow-y-auto">
            {onlineAgents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={setSelectedAgentId} />
            ))}
          </div>
        </>
      ) : (
        <div className="flex h-[227px] shrink-0 flex-col items-center pt-[58px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/robot-empty.png" alt="" className="w-[92px]" />
          <p className="mt-[30px] text-center text-[13px] leading-[16px] text-[#777]">{t("Онлайн агенты не найдены...")}</p>
        </div>
      )}

      {/* Offline agents */}
      {offlineAgents.length > 0 ? (
        <>
          <div className="flex h-[44px] shrink-0 items-center justify-between border-t border-[#efefef] pl-[17px] pr-[30px]">
            <span className="text-[13px] font-semibold leading-[16px]">{t("Офлайн агенты")}</span>
            <span className="text-[13px] font-bold leading-[16px]">{offlineAgents.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {offlineAgents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onSelect={setSelectedAgentId} />
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center border-t border-[#efefef] px-4 pt-[20px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/robot-empty.png" alt="" className="w-[92px]" />
          <p className="mt-[30px] text-center text-[13px] leading-[16px] text-[#777]">{t("Офлайн агенты не найдены...")}</p>
        </div>
      )}
    </aside>
  )
}
