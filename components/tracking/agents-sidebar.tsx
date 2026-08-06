"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Users,
  Accessibility,
  Tag,
  Truck,
  DollarSign,
  Flame,
  MapPin,
  Pencil,
  RotateCcw,
  ScanLine,
  X,
} from "lucide-react"
import { agents } from "./tracking-data"

const tabs = [
  { id: "agents", icon: Users },
  { id: "walk", icon: Accessibility },
  { id: "tags", icon: Tag },
  { id: "delivery", icon: Truck },
  { id: "finance", icon: DollarSign },
]

function Battery({ level }: { level: number }) {
  const color = level >= 50 ? "#27ae60" : level >= 20 ? "#f2994a" : "#eb5757"
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center">
        <div className="relative h-4 w-8 rounded-[3px] border-2 border-slate-400">
          <div
            className="absolute inset-y-0 left-0 m-[1px] rounded-[1px]"
            style={{ width: `calc(${level}% - 2px)`, background: color }}
          />
        </div>
        <div className="h-2 w-[3px] rounded-r-sm bg-slate-400" />
      </div>
      <span className="text-xs font-semibold text-slate-500">{level}%</span>
    </div>
  )
}

export function AgentsSidebar() {
  const [activeTab, setActiveTab] = useState("agents")
  const [query, setQuery] = useState("")
  const [date, setDate] = useState(() => new Date())
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)

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
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`
  }, [date])

  const filtered = useMemo(
    () => agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase())),
    [query],
  )

  function shiftDate(days: number) {
    setDate((d) => {
      const next = new Date(d)
      next.setDate(next.getDate() + days)
      return next
    })
  }

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId)
  const routeClients = ["ИП Каркабаев", "ЧЛ Кылышбай", "Частное Лицо", "Doston market", "Ashraf Hakimi", "Usman Dembele", "Markus Vitinha"]

  if (selectedAgent) {
    return (
      <aside className="flex h-full w-[650px] shrink-0 flex-col border-l bg-slate-50">
        <header className="flex items-center gap-4 border-b bg-white px-6 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-500 font-bold text-white">{selectedAgent.name.charAt(0)}</span>
          <ChevronLeft className="h-5 w-5 text-slate-500" />
          <strong className="uppercase text-slate-700">{selectedAgent.name}</strong>
          <ChevronRight className="h-5 w-5 text-slate-500" />
          <button type="button" className="ml-auto text-[#536fe1]">Показать фильтр⌄</button>
          <button type="button" onClick={() => setSelectedAgentId(null)} aria-label="Закрыть"><X className="h-7 w-7" /></button>
        </header>
        <div className="grid grid-cols-2 border-b bg-white px-7 py-4">
          <div className="flex items-center gap-3"><Flame className="h-8 w-8 text-slate-400" /><div><b className="text-xl">0 <small>SUM</small></b><p>сделки</p></div></div>
          <div className="flex items-center gap-3 justify-self-end"><MapPin className="h-8 w-8 text-slate-400" /><div><b className="text-xl">{selectedAgent.ratio}</b><p>посещено</p></div></div>
        </div>
        <div className="grid grid-cols-3 gap-4 p-6">
          <div className="rounded bg-[#39ca79] py-3 text-center font-bold text-white"><b className="text-2xl">0</b> Заказ оформлен</div>
          <div className="rounded bg-[#ff5d63] py-3 text-center font-bold text-white"><b className="text-2xl">0</b> Отказы</div>
          <div className="rounded bg-[#13a0f4] py-3 text-center font-bold text-white"><b className="text-2xl">7</b> Надо посетить</div>
        </div>
        <div className="flex items-center gap-5 px-6">
          <button type="button" onClick={() => shiftDate(-1)} className="rounded bg-[#20abc8] px-4 py-2 font-bold text-white">‹</button>
          <b className="text-[#20abc8]">28 июля 2026</b>
          <button type="button" onClick={() => shiftDate(1)} className="rounded bg-[#20abc8] px-4 py-2 font-bold text-white">›</button>
          <button type="button" className="ml-auto rounded bg-[#536fe1] px-5 py-3 font-bold text-white">Оптимизировать маршрут</button>
          <ScanLine className="text-slate-500" /><Pencil className="rounded bg-slate-300 p-1 text-white" />
        </div>
        <div className="relative mt-5 flex-1 overflow-y-auto px-10 pb-8 pl-32">
          <div className="absolute bottom-0 left-[94px] top-0 w-1 bg-[#20abc8]" />
          {routeClients.map((client) => (
            <label key={client} className="relative mb-3 block rounded bg-white px-7 py-5 shadow">
              <span className="absolute -left-[52px] top-8 h-7 w-7 rounded-full border-[3px] border-[#536fe1] bg-white" />
              <span className="flex items-center gap-3 text-lg font-bold text-slate-600"><input type="checkbox" className="h-6 w-6" />{client}</span>
              <span className="mt-2 flex items-center gap-3 text-slate-600"><RotateCcw className="h-5 w-5 text-orange-400" />Следует посетить 28 Июль 2026 года</span>
            </label>
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-[400px] shrink-0 flex-col border-l border-slate-200 bg-white">
      {/* Date navigation */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <button
          onClick={() => shiftDate(-1)}
          className="rounded-full p-1 text-slate-500 transition-colors hover:bg-slate-100"
          aria-label="Предыдущий день"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <span className="text-lg font-semibold text-slate-700">{dateLabel}</span>
        <button
          onClick={() => shiftDate(1)}
          className="rounded-full p-1 text-slate-500 transition-colors hover:bg-slate-100"
          aria-label="Следующий день"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Category tabs */}
      <div className="flex items-center justify-around border-b border-slate-200 px-2">
        {tabs.map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex flex-1 items-center justify-center border-b-2 py-3 transition-colors ${
              activeTab === id
                ? "border-brand-blue text-brand-blue"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
            aria-label={id}
          >
            <Icon className="h-5 w-5" />
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск агентов..."
            className="flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
          />
          <Search className="h-5 w-5 text-slate-400" />
        </div>
      </div>

      {/* Online (empty) */}
      <div className="flex flex-col items-center px-4 py-2">
        <Image
          src="/robot-mascot.png"
          alt="Робот-помощник"
          width={120}
          height={120}
          className="h-28 w-28 object-contain"
        />
        <p className="mt-1 text-center text-sm font-medium text-slate-400">
          Онлайн агенты не найдены...
        </p>
      </div>

      {/* Offline agents */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-base font-bold text-slate-700">Офлайн агенты</span>
        <span className="text-base font-bold text-slate-700">{filtered.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setSelectedAgentId(agent.id)}
            className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: agent.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-slate-700">{agent.name}</p>
              <p className="truncate text-sm text-slate-400">{agent.timestamp}</p>
            </div>
            <span className="shrink-0 text-sm font-medium text-slate-500">{agent.ratio}</span>
            <Battery level={agent.battery} />
          </button>
        ))}
      </div>
    </aside>
  )
}
