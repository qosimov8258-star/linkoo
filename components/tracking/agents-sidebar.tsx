"use client"

import { useEffect, useRef, useState } from "react"
import { Accessibility, ChevronLeft, ChevronRight, DollarSign, Search, Tag, Truck, Users, type LucideIcon } from "lucide-react"

import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import type { TrackingAgentRow } from "@/lib/tracking-types"

import { GROUP_TABS, agentColor, batteryColor, formatLongDay, monthTitle, shiftDay, type TrackingGroup } from "./agents-tracking-data"

// Right sidebar of Отслеживание in list mode: date navigator (with a calendar), role tabs,
// agent search, and the online / offline agents of the day.

const GROUP_ICONS: Record<TrackingGroup, LucideIcon> = { all: Users, agent: Accessibility, merch: Tag, delivery: Truck, collector: DollarSign }

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]

export function Battery({ level }: { level: number | null }) {
  if (level === null) return <span className="w-[34px] shrink-0" />
  const value = Math.max(0, Math.min(100, Math.round(level)))
  const color = batteryColor(value)
  return (
    <span className="flex w-[34px] shrink-0 flex-col items-center gap-[2px]">
      <span className="flex items-center">
        <span className="relative h-[11px] w-[22px] rounded-[2px] border border-[#999]">
          <span className="absolute inset-y-[1px] left-[1px] rounded-[1px]" style={{ width: `calc(${value}% - 2px)`, background: color }} />
        </span>
        <span className="h-[5px] w-[2px] rounded-r-sm bg-[#999]" />
      </span>
      <span className="text-[10px] text-[#666]">{value}%</span>
    </span>
  )
}

/** Single-date calendar popover (Monday first). */
function DayCalendar({ value, onPick, onClose }: { value: string; onPick: (day: string) => void; onClose: () => void }) {
  const { t, language } = useLanguage()
  const [cursor, setCursor] = useState(() => ({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) }))
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])
  const firstWeekday = (new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(cursor.year, cursor.month, 0)).getUTCDate()
  const cells: Array<number | null> = [...Array.from({ length: firstWeekday }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const move = (delta: number) =>
    setCursor((current) => {
      const index = current.year * 12 + current.month - 1 + delta
      const year = Math.floor(index / 12)
      return year < 2000 || year > 2100 ? current : { year, month: (index % 12) + 1 }
    })
  const iso = (day: number) => `${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  return (
    <div ref={rootRef} className="absolute left-1/2 top-[52px] z-[700] w-[270px] -translate-x-1/2 bg-white p-[12px] shadow-[0_4px_16px_rgba(0,0,0,0.25)]">
      <div className="mb-[8px] flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} aria-label={t("Предыдущий месяц")} className="p-1 text-[#555]">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <b className="text-[13px]">{monthTitle(cursor.year, cursor.month, language)}</b>
        <button type="button" onClick={() => move(1)} aria-label={t("Следующий месяц")} className="p-1 text-[#555]">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-[2px] text-center text-[12px]">
        {WEEKDAYS.map((day) => (
          <span key={day} className="py-[4px] font-semibold text-[#777]">
            {t(day)}
          </span>
        ))}
        {cells.map((day, index) =>
          day === null ? (
            <span key={`empty-${index}`} />
          ) : (
            <button
              key={day}
              type="button"
              onClick={() => onPick(iso(day))}
              className={`h-[30px] rounded-full ${iso(day) === value ? "bg-[#5d6474] font-bold text-white" : "text-[#333] hover:bg-[#eef1f5]"}`}
            >
              {day}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

function AgentRow({ agent, selected, online, onOpen }: { agent: TrackingAgentRow; selected: boolean; online: boolean; onOpen: () => void }) {
  const { language } = useLanguage()
  const last = agent.location?.lastActivityAt ?? null
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex h-[45px] w-full items-center gap-[8px] pl-[12px] pr-[14px] text-left transition-colors hover:bg-[#f2f4f7] ${selected ? "bg-[#ececec]" : ""}`}
    >
      <span className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: agentColor(agent.employeeId) }} />
      <span className="h-[30px] w-[3px] shrink-0" style={{ background: online ? "#3ac977" : "#999" }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-[#333]">{agent.name}</span>
        <span className="block truncate text-[11px] italic text-[#777]">{last ? formatDateText(last, language, { withTime: true }) : "—"}</span>
      </span>
      <span className="shrink-0 text-[12px] text-[#444]">
        {agent.done} / {agent.todo}
        {agent.unplanned > 0 && <span className="text-[#ee667d]"> + {agent.unplanned}</span>}
      </span>
      <Battery level={agent.location?.battery ?? null} />
    </button>
  )
}

function Section({ title, agents, online, selectedId, onSelect, emptyText }: { title: string; agents: TrackingAgentRow[]; online: boolean; selectedId: number | null; onSelect: (id: number) => void; emptyText: string }) {
  const { t } = useLanguage()
  return (
    <section className="border-t border-[#e8e8e8]">
      <div className="flex items-center justify-between px-[15px] py-[12px]">
        <span className="text-[13px] font-semibold">{t(title)}</span>
        <span className="text-[13px] font-bold">{agents.length}</span>
      </div>
      {agents.length === 0 ? (
        <div className="flex flex-col items-center px-4 pb-[18px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/robot-empty.png" alt="" className="w-[100px]" />
          <p className="-mt-[4px] text-center text-[13px] text-[#777]">{t(emptyText)}</p>
        </div>
      ) : (
        agents.map((agent) => <AgentRow key={agent.employeeId} agent={agent} online={online} selected={agent.employeeId === selectedId} onOpen={() => onSelect(agent.employeeId)} />)
      )}
    </section>
  )
}

export function AgentsSidebar({
  date,
  onDate,
  group,
  onGroup,
  search,
  onSearch,
  online,
  offline,
  loading,
  error,
  selectedId,
  onSelect,
}: {
  date: string
  onDate: (day: string) => void
  group: TrackingGroup
  onGroup: (group: TrackingGroup) => void
  search: string
  onSearch: (text: string) => void
  online: TrackingAgentRow[]
  offline: TrackingAgentRow[]
  loading: boolean
  error: string
  selectedId: number | null
  onSelect: (employeeId: number) => void
}) {
  const { t, language } = useLanguage()
  const [calendar, setCalendar] = useState(false)
  const [draft, setDraft] = useState(search)
  useEffect(() => setDraft(search), [search])

  return (
    <div className="flex h-full flex-col text-[13px] text-[#333]">
      <div className="relative flex h-[58px] shrink-0 items-center justify-between px-[30px]">
        <button type="button" onClick={() => onDate(shiftDay(date, -1))} className="text-[#555]" aria-label={t("Предыдущий день")}>
          <ChevronLeft className="h-6 w-6" />
        </button>
        <button type="button" onClick={() => setCalendar((open) => !open)} className="text-[16px] font-bold">
          {formatLongDay(date, language)}
        </button>
        <button type="button" onClick={() => onDate(shiftDay(date, 1))} className="text-[#555]" aria-label={t("Следующий день")}>
          <ChevronRight className="h-6 w-6" />
        </button>
        {calendar && (
          <DayCalendar
            value={date}
            onPick={(day) => {
              onDate(day)
              setCalendar(false)
            }}
            onClose={() => setCalendar(false)}
          />
        )}
      </div>

      <div className="flex h-[38px] shrink-0 items-stretch bg-[#5d6474]">
        {GROUP_TABS.map(({ id, label }) => {
          const Icon = GROUP_ICONS[id]
          const active = group === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onGroup(id)}
              title={t(label)}
              aria-label={t(label)}
              aria-pressed={active}
              className={`relative flex flex-1 items-center justify-center text-white transition-opacity ${active ? "opacity-100" : "opacity-60 hover:opacity-90"}`}
            >
              <Icon className="h-5 w-5" />
              {active && <span className="absolute bottom-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[6px] border-b-[6px] border-x-transparent border-b-white" />}
            </button>
          )
        })}
      </div>

      <form
        className="shrink-0 px-[20px] pb-[10px] pt-[14px]"
        onSubmit={(event) => {
          event.preventDefault()
          onSearch(draft.trim())
        }}
      >
        <div className="flex h-[40px] items-center gap-2 border border-dashed border-[#d0d0d0] pl-[12px]">
          <input
            value={draft}
            maxLength={100}
            onChange={(event) => {
              setDraft(event.target.value)
              if (!event.target.value.trim()) onSearch("")
            }}
            placeholder={t("Поиск агентов...")}
            aria-label={t("Поиск агентов...")}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#999]"
          />
          <button type="submit" aria-label={t("Поиск")} className="flex h-full w-[40px] items-center justify-center text-[#555]">
            <Search className="h-5 w-5" />
          </button>
        </div>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p className="px-[20px] py-[16px] text-center text-[#e53935]">{error}</p>
        ) : loading && online.length + offline.length === 0 ? (
          <p className="px-[20px] py-[16px] text-center text-[#777]">{t("Загрузка...")}</p>
        ) : (
          <>
            <Section title="Онлайн агенты" agents={online} online selectedId={selectedId} onSelect={onSelect} emptyText="Онлайн агенты не найдены..." />
            <Section title="Офлайн агенты" agents={offline} online={false} selectedId={selectedId} onSelect={onSelect} emptyText="Офлайн агенты не найдены..." />
          </>
        )}
      </div>
    </div>
  )
}
