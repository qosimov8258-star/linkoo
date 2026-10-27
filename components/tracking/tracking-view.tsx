"use client"

import { useCallback, useEffect, useState } from "react"
import dynamic from "next/dynamic"
import {
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { FilterCheck, FilterDate, FilterRange, FilterSelect, RI, RefButton, RefHeader } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { AgentsSidebar } from "./agents-sidebar"
import { DEFAULT_LEGEND, EMPTY_TIME_FILTER, useAgentDay, type LegendState, type TimeFilter } from "./agent-day"
import { isoDay } from "./use-way-agents"
import { RingSpinner } from "./agent-plans-panel"
import type { AgentCategory } from "./tracking-data"
import { TerritoryPanel } from "./territory-panel"

const TrackingMap = dynamic(() => import("./tracking-map").then((m) => m.TrackingMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-200" />,
})

/** Opening viewport of the territory map, matched to the reference's Tashkent framing. */
/** Opening viewport of the agents map: the reference centres the whole window (the panel floats above the map). */
const AGENTS_VIEW = { center: [41.32268543, 69.24545288] as [number, number], zoom: 11 }
const TERRITORY_VIEW = { center: [41.3243, 69.2316] as [number, number], zoom: 13.05 }

type TrackingViewProps = {
  view?: "agents" | "clients"
}

/** Fixed option lists; every list that depends on data comes from /api/tracking-filter-options. */
const selectOptions: Record<string, string[]> = {
  "Частота посещения": ["Каждый день", "Раз в неделю", "Раз в месяц"],
  "Класс клиента": ["A", "B", "C"],
  "Последнее посещение": ["Сегодня", "Последние 7 дней", "Последние 30 дней"],
}

type LoadedOptions = {
  clients: string[]
  clientTypes: string[]
  zones: string[]
  agents: string[]
  deliverers: string[]
  branches: string[]
  refusalTypes: string[]
  agentRoutes: string[]
}

const LOADED_KEY: Record<string, keyof LoadedOptions> = {
  Клиент: "clients",
  "Тип клиента": "clientTypes",
  Зона: "zones",
  "Ответственный агент": "agents",
  "Ответственные доставщики": "deliverers",
  Филиалы: "branches",
  "Тип отказа": "refusalTypes",
  "Маршрут агента": "agentRoutes",
}

function SelectLine({ label, value: controlled, onChange, options = [] }: { label: string; value?: string; onChange?: (value: string) => void; options?: string[] }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [internal, setInternal] = useState("")
  const value = controlled ?? internal
  const setValue = (next: string) => (onChange ? onChange(next) : setInternal(next))

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-[41px] w-full items-center border-b border-[#e8e8e8] pt-[3px] text-left text-[13px] font-semibold text-black"
      >
        <span>{t(value) || t(label)}</span>
        <svg viewBox="0 0 10 7" className="absolute right-[3px] top-[19px] h-[7px] w-[10px] fill-[#888]"><path d="M0 0l5 5.5L10 0z" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[800] max-h-48 overflow-auto bg-white py-1 shadow-xl">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setValue(option)
                setOpen(false)
              }}
              className="block w-full px-3 py-2.5 text-left text-[13px] font-semibold hover:bg-[#f2f5f8]"
            >
              {t(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CheckLine({
  label,
  defaultChecked = false,
  checked: controlledChecked,
  onChange,
}: {
  label: string
  defaultChecked?: boolean
  checked?: boolean
  onChange?: (checked: boolean) => void
}) {
  const { t } = useLanguage()
  const [internalChecked, setInternalChecked] = useState(defaultChecked)
  const checked = controlledChecked ?? internalChecked
  return (
    <label className="flex cursor-pointer items-center gap-[9px] text-[13px] font-medium text-[#333]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          setInternalChecked(event.target.checked)
          onChange?.(event.target.checked)
        }}
        className="h-[15px] w-[15px] accent-[#536fe1]"
      />
      <span>{t(label)}</span>
    </label>
  )
}

function ClientsFilterModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const empty = {
    createdBegin: "", createdEnd: "",
    lastOrderFrom: "", lastOrderTo: "", lastPaymentFrom: "", lastPaymentTo: "",
    lastRefusalFrom: "", lastRefusalTo: "", lastVisitFrom: "", lastVisitTo: "",
    agent: "", deliverer: "", branch: "", refusalType: "",
    frequency: "", agentRoute: "", client: "", clientType: "", clientClass: "", zone: "", lastVisit: "",
    noRoute: false, equipment: false, zoneUndefined: false, unlimitedDebt: false, wrongZones: false,
  }
  const [draft, setDraft] = useState(empty)
  const [days, setDays] = useState<string[]>([])
  const set = <K extends keyof typeof empty>(key: K) => (value: (typeof empty)[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const [loaded, setLoaded] = useState<Partial<LoadedOptions>>({})
  useEffect(() => {
    let cancelled = false
    fetch("/api/tracking-filter-options")
      .then((response) => (response.ok ? response.json() : {}))
      .then((next: Partial<LoadedOptions>) => !cancelled && setLoaded(next))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const options = (label: string) => (LOADED_KEY[label] ? loaded[LOADED_KEY[label]] ?? [] : selectOptions[label] ?? [])

  return (
    <div className="fixed inset-0 z-[1000] bg-black/60" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("Показать на карте")}
        onMouseDown={(event) => event.stopPropagation()}
        className="fixed left-1/2 top-4 flex max-h-[calc(100vh-32px)] w-[768px] max-w-full -translate-x-1/2 flex-col bg-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
      >
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
          <h2 className="text-[15px] font-bold uppercase text-[#333]">{t("Показать на карте")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
          </button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[386px_1fr] overflow-y-auto">
          <div className="border-r border-[#efefef] pb-[23px] pl-[30px] pr-[26px]">
            <FilterDate
              className="-mt-[8px]"
              label={t("Период создания клиента")}
              begin={draft.createdBegin}
              end={draft.createdEnd}
              onChange={(begin, end) => setDraft((current) => ({ ...current, createdBegin: begin, createdEnd: end }))}
            />
            <div className="-mt-[3px]">
              <FilterRange caption={t("Прошло дней с последнего заказа")} from={draft.lastOrderFrom} to={draft.lastOrderTo} onFrom={set("lastOrderFrom")} onTo={set("lastOrderTo")} />
              <FilterRange caption={t("Прошло дней с последней оплаты")} from={draft.lastPaymentFrom} to={draft.lastPaymentTo} onFrom={set("lastPaymentFrom")} onTo={set("lastPaymentTo")} />
              <FilterRange caption={t("Прошло дней с последнего отказа")} from={draft.lastRefusalFrom} to={draft.lastRefusalTo} onFrom={set("lastRefusalFrom")} onTo={set("lastRefusalTo")} />
              <FilterRange caption={t("Прошло дней с последнего визита")} from={draft.lastVisitFrom} to={draft.lastVisitTo} onFrom={set("lastVisitFrom")} onTo={set("lastVisitTo")} />
            </div>
            <div className="mt-[4px]">
              <FilterSelect label={t("Ответственный агент")} value={draft.agent} onChange={set("agent")} options={options("Ответственный агент")} className="mb-0" />
              <FilterSelect label={t("Ответственные доставщики")} value={draft.deliverer} onChange={set("deliverer")} options={options("Ответственные доставщики")} />
              <FilterSelect label={t("Филиалы")} value={draft.branch} onChange={set("branch")} options={options("Филиалы")} />
              <FilterSelect label={t("Тип отказа")} value={draft.refusalType} onChange={set("refusalType")} options={options("Тип отказа")} />
            </div>
            <div className="space-y-[10px] pt-[3px]">
              <FilterCheck label={t("Маршрут не установлен")} checked={draft.noRoute} onChange={set("noRoute")} compact />
              <FilterCheck label={t("Показать оборудование")} checked={draft.equipment} onChange={set("equipment")} compact />
            </div>
          </div>
          <div className="pb-5 pl-[26px] pr-[24px]">
            <div className="pt-[20px]">
              <div className="text-[13px] font-semibold leading-[16.3px] text-[#333]">{t("Показывать по маршруту (дни)")}</div>
              <div className="mt-[10px] flex gap-[18px]">
                {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setDays((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day]))}
                    className={`h-8 w-8 text-[13px] ${days.includes(day) ? "bg-[#4f71dc] text-white" : "bg-[#eceff1] text-[#666]"}`}
                  >
                    {t(day)}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-[18px]">
              <FilterSelect label={t("Частота посещения")} value={draft.frequency} onChange={set("frequency")} options={options("Частота посещения")} />
              <FilterSelect label={t("Маршрут агента")} value={draft.agentRoute} onChange={set("agentRoute")} options={options("Маршрут агента")} />
              <FilterSelect label={t("Клиент")} value={draft.client} onChange={set("client")} options={options("Клиент")} />
              <FilterSelect label={t("Тип клиента")} value={draft.clientType} onChange={set("clientType")} options={options("Тип клиента")} />
              <FilterSelect label={t("Класс клиента")} value={draft.clientClass} onChange={set("clientClass")} options={options("Класс клиента")} />
              <FilterSelect label={t("Зона")} value={draft.zone} onChange={set("zone")} options={options("Зона")} />
              <FilterSelect label={t("Последнее посещение")} value={draft.lastVisit} onChange={set("lastVisit")} options={options("Последнее посещение")} />
            </div>
            <div className="space-y-[10px] pt-[3px]">
              <FilterCheck label={t("Зона не определена")} checked={draft.zoneUndefined} onChange={set("zoneUndefined")} compact />
              <FilterCheck label={t("Неограниченный долг")} checked={draft.unlimitedDebt} onChange={set("unlimitedDebt")} compact />
              <FilterCheck label={t("Неправильно присвоенные зоны(зона агента не совпадает с зоной клиента)")} checked={draft.wrongZones} onChange={set("wrongZones")} compact />
            </div>
          </div>
        </div>
        <footer className="flex h-[57px] shrink-0 items-center justify-end gap-[21px] border-t border-[#efefef] pr-[20px]">
          <button
            type="button"
            onClick={() => {
              setDraft(empty)
              setDays([])
            }}
            className="h-9 rounded-[3px] bg-[#fa6e65] px-[16px] text-[13px] font-semibold uppercase text-white hover:brightness-95"
          >
            {t("Очистить")}
          </button>
          <button type="button" onClick={onClose} className="h-9 rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-semibold uppercase text-white hover:brightness-95">
            {t("Применить")}
          </button>
        </footer>
      </section>
    </div>
  )
}

function VideoLessonDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <section onMouseDown={(event) => event.stopPropagation()} className="w-[500px] bg-white text-[13px] shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
          <b className="uppercase">{t("Видео урок")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
          </button>
        </header>
        <div className="px-[30px] pb-[23px] pt-[40px]">
          <iframe
            title={t("Видео урок")}
            src="https://www.youtube.com/embed/rHuQyHAFfzo?si=0XlvOwwjO7z4SSrx"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="block h-[250px] w-full border-0 bg-black"
          />
        </div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#efefef] pr-[26px]">
          <button type="button" onClick={onClose} className="font-semibold uppercase text-[#0a9ddb]">{t("Закрыть")}</button>
        </footer>
      </section>
    </div>
  )
}

const ZONE_ICONS = {
  draw: "M23 8c0 1.1-.9 2-2 2-.18 0-.35-.02-.51-.07l-3.56 3.55c.05.16.07.34.07.52 0 1.1-.9 2-2 2s-2-.9-2-2c0-.18.02-.36.07-.52l-2.55-2.55c-.16.05-.34.07-.52.07s-.36-.02-.52-.07l-4.55 4.56c.05.16.07.33.07.51 0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.18 0 .35.02.51.07l4.56-4.55C8.02 9.36 8 9.18 8 9c0-1.1.9-2 2-2s2 .9 2 2c0 .18-.02.36-.07.52l2.55 2.55c.16-.05.34-.07.52-.07s.36.02.52.07l3.55-3.56C19.02 8.35 19 8.18 19 8c0-1.1.9-2 2-2s2 .9 2 2z",
  select: "M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z",
}

type ExtraZoneRow = { id: number; title: string; parent: string; branch: string; ring: [number, number][] }
type ZoneDraft = { ring: [number, number][]; drawing: boolean }

/** `editing`: an existing zone's name is open (nothing is saved for it yet); otherwise a new zone is drawn and saved to zone_extra. */
function ZoneModal({ onClose, initialName = "", editing = false, draft, onDraft, onSaved }: { onClose: () => void; initialName?: string; editing?: boolean; draft: ZoneDraft; onDraft: (draft: ZoneDraft) => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const mode = draft.drawing ? "draw" : "select"
  const setMode = (next: "draw" | "select") => onDraft({ ...draft, drawing: next === "draw" })
  const [name, setName] = useState(initialName)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [branch, setBranch] = useState("")
  const [parent, setParent] = useState("")
  const [branchNames, setBranchNames] = useState<string[]>([])
  const [zoneNames, setZoneNames] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/branches?sort=created")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { name?: string }[]) => !cancelled && setBranchNames(rows.map((row) => row.name ?? "").filter(Boolean)))
      .catch(() => {})
    fetch("/api/tracking-filter-options")
      .then((response) => (response.ok ? response.json() : {}))
      .then((next: Partial<LoadedOptions>) => !cancelled && setZoneNames(next.zones ?? []))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const [reassign, setReassign] = useState(false)
  const [video, setVideo] = useState(false)
  const save = async () => {
    if (editing) return onClose()
    if (!name.trim()) return setError(t("Обязательное поле"))
    if (draft.ring.length < 3) return setError(t("Нарисуйте зону на карте"))
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/zone-extra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name.trim(), parent, branch, updateMarketBorder: reassign, polygon: draft.ring }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        return setError(t(body?.error ?? "Не удалось сохранить"))
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="absolute left-1/2 top-0 z-[700] h-[287px] w-[550px] -translate-x-1/2 bg-white text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <label className="absolute left-[30px] top-[17px] block h-[45px] w-[270px]">
        <span className={`pointer-events-none absolute left-0 font-semibold text-black ${name ? "top-[2px] text-[10px]" : "top-[13px] text-[13px]"}`}>{t("Наименование зоны")}</span>
        <input value={name} onChange={(event) => setName(event.target.value)} className="absolute inset-x-0 top-0 h-[45px] border-0 bg-transparent pt-[13px] text-[13px] font-semibold text-black outline-none" />
        <span className="pointer-events-none absolute inset-x-0 bottom-[8px] h-px bg-[#e0e0e0]" />
      </label>
      <div className="absolute left-[310px] top-[12px] flex">
        <button type="button" onClick={() => setMode("draw")} aria-label={t("Рисовать")} className={`flex h-[48px] w-[48px] items-center justify-center ${mode === "draw" ? "bg-[#f0f0f0]" : "bg-white"}`}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={ZONE_ICONS.draw} /></svg></button>
        <button type="button" onClick={() => setMode("select")} aria-label={t("Выбрать")} className={`flex h-[48px] w-[48px] items-center justify-center ${mode === "select" ? "bg-[#f0f0f0]" : "bg-white"}`}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={ZONE_ICONS.select} /></svg></button>
        <button type="button" aria-label={t("Очистить зону")} onClick={() => { setName(""); onDraft({ ring: [], drawing: false }) }} className="flex h-[48px] w-[48px] items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={RI.trash} /></svg></button>
      </div>
      <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="absolute right-[10px] top-[10px] flex h-[48px] w-[48px] items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d={RI.close} /></svg></button>
      <div className="absolute left-[30px] top-[85px] w-[270px]"><SelectLine label="Филиал" value={branch} onChange={setBranch} options={branchNames} /></div>
      <div className="absolute left-[30px] top-[147px] w-[270px]"><SelectLine label="Родительская зона" value={parent} onChange={setParent} options={zoneNames} /></div>
      <button type="button" onClick={() => setVideo(true)} className="absolute left-[320px] top-[164px] text-[13px] text-[#129fdd]">{t("Видеоурок по созданию зоны")}</button>
      <div className="absolute left-[30px] top-[201px]">
        <FilterCheck label={t("Переназначить зоны клиентов")} checked={reassign} onChange={setReassign} compact />
      </div>
      {error && <p className="absolute bottom-[19px] left-[30px] text-[13px] text-[#f44336]">{error}</p>}
      <button type="button" disabled={saving} onClick={() => void save()} className="absolute bottom-[7px] right-[10px] h-9 w-[110.8px] text-[13px] font-semibold uppercase text-[#129fdd] disabled:opacity-50">{t("Сохранить")}</button>
      {video && <VideoLessonDialog onClose={() => setVideo(false)} />}
    </div>
  )
}

export function TrackingView({ view = "agents" }: TrackingViewProps) {
  const { t } = useLanguage()
  const [showAgents, setShowAgents] = useState(view === "agents")
  const [showClients, setShowClients] = useState(view !== "agents")
  const [showZones, setShowZones] = useState(view === "clients")
  const [sidebarOpen, setSidebarOpen] = useState(view === "agents")
  const [filterOpen, setFilterOpen] = useState(false)
  const [managePanel, setManagePanel] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [zoneOpen, setZoneOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(true)
  const [search, setSearch] = useState("")
  const [legendOpen, setLegendOpen] = useState(false)
  const [legend, setLegend] = useState<LegendState>(DEFAULT_LEGEND)
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(EMPTY_TIME_FILTER)
  // The reference rebuilds its map (behind a veil with a spinner) for half a second whenever a legend checkbox changes.
  const [mapBusy, setMapBusy] = useState(false)
  const changeLegend = (next: LegendState) => {
    setLegend(next)
    setMapBusy(true)
    window.setTimeout(() => setMapBusy(false), 500)
  }
  const [date, setDate] = useState(() => new Date())
  // The reference opens the page on the day of its `date` parameter.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("date")
    if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) setDate(new Date(`${param}T00:00:00`))
  }, [])
  const [status, setStatus] = useState("")
  const [agentSearch, setAgentSearch] = useState("")
  const [focus, setFocus] = useState<{ lat: number; lon: number; n: number } | null>(null)
  const goTo = (lat: number, lon: number) => setFocus((current) => ({ lat, lon, n: (current?.n ?? 0) + 1 }))
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const { day, loading: dayLoading } = useAgentDay(selectedAgent, isoDay(date))
  const [panelTab, setPanelTab] = useState<"agents" | AgentCategory>("agents")
  const [editZone, setEditZone] = useState<string | null>(null)
  const [draft, setDraft] = useState<ZoneDraft>({ ring: [], drawing: false })
  const [extraZones, setExtraZones] = useState<ExtraZoneRow[]>([])
  const loadExtraZones = useCallback(() => {
    fetch("/api/zone-extra")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: ExtraZoneRow[]) => Array.isArray(rows) && setExtraZones(rows))
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (view === "clients") loadExtraZones()
  }, [view, loadExtraZones])
  const closeZone = () => {
    setZoneOpen(false)
    setEditZone(null)
    setDraft({ ring: [], drawing: false })
  }
  const [mapOptions, setMapOptions] = useState<string[]>([])

  useEffect(() => {
    if (view !== "clients") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("openFilterDialog") === "true") setFilterOpen(true)
    if (params.get("openInfo") === "true") setManagePanel(true)
  }, [view])

  useEffect(() => {
    setShowAgents(view === "agents")
    setShowClients(view !== "agents")
    setShowZones(view === "clients")
    setSidebarOpen(view === "agents")
  }, [view])

  if (view === "clients") {
    return (
      <main className="flex h-[calc(100vh-50px)] flex-col overflow-hidden bg-[#f2f5f8]">
        <div className="bg-[#f2f5f8] px-[28px]">
          <RefHeader title={t("Территория")}>
            <RefButton icon={RI.filter} label={t("Показать клиентов")} onClick={() => setFilterOpen(true)} />
            <RefButton icon={RI.trend} label={t("Установить маршрут")} onClick={() => setVideoOpen(true)} />
            <RefButton icon={RI.filter} label={t("Управлять территориями")} onClick={() => setManagePanel((open) => !open)} />
            <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => setZoneOpen(true)} />
          </RefHeader>
        </div>
        <div className="relative min-h-0 flex-1">
          <TrackingMap
            showAgents={false}
            showClients={showClients}
            showZones={showZones}
            zoomControl={false}
            initialView={TERRITORY_VIEW}
            extraZones={extraZones.map((zone) => ({ id: zone.id, title: zone.title, ring: zone.ring }))}
            drawing={zoneOpen && !editZone && draft.drawing}
            draftRing={zoneOpen && !editZone ? draft.ring : []}
            onAddPoint={(point) => setDraft((current) => ({ ...current, ring: [...current.ring, point] }))}
          />
          <div className={`absolute top-[18px] z-[500] flex h-[48px] w-[252px] items-center bg-white shadow-[0_2px_6px_rgba(0,0,0,0.2)] ${managePanel ? "right-[482px]" : "right-[11px]"}`}>
            {searchOpen && (
              <label className="flex h-full flex-1 items-center px-[21px]">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Поиск")} className="w-full text-[15px] outline-none placeholder:text-[#999]" />
              </label>
            )}
            <button type="button" onClick={() => setSearchOpen((current) => !current)} className="h-full px-[18px] text-[#333]">
              {searchOpen ? <ChevronLeft className="h-4 w-4 fill-current" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
          <div className={`absolute bottom-0 z-[500] w-[230px] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.25)] ${managePanel ? "right-[470px]" : "right-0"}`}>
            <button type="button" onClick={() => setFilterOpen(true)} className="flex h-[30px] w-full items-center gap-[10px] bg-[#4f71dc] px-[14px] text-[13px] font-semibold text-white"><svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.filter} /></svg>{t("Показать клиентов")}</button>
            <div className="space-y-[4px] px-[14px] pb-[10px] pt-[10px]">
              {(["Скрыть ориентиры", "Режим спутника", "Выбор клиентов"] as const).map((label) => (
                <FilterCheck key={label} label={t(label)} checked={mapOptions.includes(label)} onChange={(on) => setMapOptions((current) => (on ? [...current, label] : current.filter((item) => item !== label)))} compact />
              ))}
            </div>
          </div>
          {zoneOpen && (
            <ZoneModal
              key={editZone ?? ""}
              initialName={editZone ?? ""}
              editing={editZone !== null}
              draft={draft}
              onDraft={setDraft}
              onClose={closeZone}
              onSaved={() => {
                closeZone()
                loadExtraZones()
              }}
            />
          )}
          {managePanel && <TerritoryPanel extraZones={extraZones} onClose={() => setManagePanel(false)} onEdit={(name) => { setEditZone(name); setZoneOpen(true) }} />}
        </div>
        {filterOpen && <ClientsFilterModal onClose={() => setFilterOpen(false)} />}
        {videoOpen && <VideoLessonDialog onClose={() => setVideoOpen(false)} />}
      </main>
    )
  }

  return (
    <div className="relative h-[calc(100vh-50px)] w-full overflow-hidden">
      <div className="absolute inset-0">
        <TrackingMap
          showAgents={showAgents}
          showClients={showClients}
          showZones={showZones}
          initialView={AGENTS_VIEW}
          plain
          onlyAgent={selectedAgent}
          tab={panelTab}
          search={agentSearch}
          focus={focus}
          day={selectedAgent !== null && !dayLoading ? day : null}
          legend={legend}
          timeFilter={timeFilter}
          recenterKey={`${isoDay(date)}|${legend.tracker}${legend.visit}${legend.actual}`}
        />
      </div>
      {selectedAgent !== null && dayLoading && (
        <div className="absolute bottom-0 left-0 right-[350px] top-[60px] z-[400] flex items-center justify-center bg-[#fcfcfc]">
          <RingSpinner />
        </div>
      )}
      {mapBusy && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-white/40">
          <RingSpinner />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-[60px] border-b border-[#efefef] bg-white/70" />
      <div className="absolute inset-y-0 left-0 z-[500] w-0">
        {selectedAgent === null ? (
          <div className="absolute left-[28px] top-[17.5px] flex h-[24px] items-center">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold leading-[22.5px] text-[#4f71dc]" />
            <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
            <span className="text-[18px] font-bold leading-[22.5px] text-[#5d6474]">{t("Отслеживание")}</span>
          </div>
        ) : (
          <TimeBar filter={timeFilter} onChange={setTimeFilter} />
        )}
        <TrackingLegend open={legendOpen} onToggle={() => setLegendOpen((current) => !current)} legend={legend} onLegend={changeLegend} onFirst={() => day.track[0] && goTo(day.track[0][0], day.track[0][1])} onLast={() => { const last = day.track[day.track.length - 1]; if (last) goTo(last[0], last[1]) }} />
      </div>
      {selectedAgent === null && <div className={`absolute bottom-0 z-[50] h-[72px] ${sidebarOpen ? "right-[334px]" : "right-0"} w-[150px] border border-[#efefef] bg-white px-[20px] opacity-70 transition-opacity duration-300 hover:opacity-100`}>
        <MapCheck label={t("Клиенты")} checked={showClients} onChange={setShowClients} />
        <MapCheck label={t("Зоны")} checked={showZones} onChange={setShowZones} />
      </div>}
      {selectedAgent === null && <button type="button" aria-label={t("Панель агентов")} onClick={() => setSidebarOpen((open) => !open)} className={`absolute top-[11px] z-[55] flex h-[40px] w-[24px] items-center justify-center bg-white ${sidebarOpen ? "right-[334px]" : "right-0"}`}>
        <svg viewBox="0 0 24 24" className={`h-6 w-6 fill-[#333] ${sidebarOpen ? "" : "rotate-180"}`}><path d="M10 17l5-5-5-5z" /></svg>
      </button>}
      {(sidebarOpen || selectedAgent !== null) && <AgentsSidebar selectedId={selectedAgent} onSelect={setSelectedAgent} tab={panelTab} onTab={setPanelTab} date={date} onDate={setDate} day={day} dayLoading={dayLoading} status={status} onStatus={setStatus} search={agentSearch} onSearch={setAgentSearch} onLocate={goTo} />}
    </div>
  )
}

const MAP_BOX = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const MAP_BOX_ON = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

function MapCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="mt-[10px] flex h-[20px] items-center text-[13px] leading-[20px] text-black">
      <svg viewBox="0 0 24 24" className="mr-[6px] h-[20px] w-[20px] fill-[#666]"><path d={checked ? MAP_BOX_ON : MAP_BOX} /></svg>
      {label}
    </button>
  )
}

const LEGEND_PINS = [
  ["Первая координата трекера", 1, 23],
  ["Промежуточные координаты трекера", 2, 23],
  ["Последняя координата трекера", 3, 23],
] as const
const LEGEND_VISITS = [
  ["Запланированный маршрут визитов", 4],
  ["Первая точка закрытия визита", 5],
  ["Промежуточные точки закрытия визита", 6],
  ["Последняя точка закрытия визита", 7],
  ["Внеплановый визит", 8],
  ["Отказ", 9],
] as const

function LegendCheck({ label, on, onChange }: { label: string; on: boolean; onChange: (value: boolean) => void }) {
  const { t } = useLanguage()
  return (
    <li className="mb-[10px] flex">
      <button type="button" onClick={() => onChange(!on)} className="my-[10px] flex w-full items-start text-left text-[13px] text-black">
        <svg viewBox="0 0 24 24" className="mr-[16px] h-[20px] w-[20px] shrink-0 fill-[#666]"><path d={on ? MAP_BOX_ON : MAP_BOX} /></svg>
        <span className="relative -left-[10px] block w-[110px] leading-[20px]">{t(label)}</span>
      </button>
    </li>
  )
}

function LegendItem({ label, pin, small, onClick }: { label: string; pin: number; small?: boolean; onClick?: () => void }) {
  const { t } = useLanguage()
  return (
    <li className={`mb-[10px] flex min-h-[41px] ${onClick ? "cursor-pointer" : ""}`} onClick={onClick}>
      <div className="ml-[15px] mr-[10px] shrink-0" style={{ width: small ? 17 : 23 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/tracking-legend/pin${pin}.png`} alt="" className="block w-full" />
      </div>
      <p className="w-[122px] text-[13px] leading-[16.25px] text-[#333]">{t(label)}</p>
    </li>
  )
}

function TrackingLegend({ open, onToggle, legend, onLegend, onFirst, onLast }: { open: boolean; onToggle: () => void; legend: LegendState; onLegend: (legend: LegendState) => void; onFirst: () => void; onLast: () => void }) {
  const { t } = useLanguage()
  return (
    <div className="absolute left-[48px] top-[100px] w-[200px]">
      <button type="button" onClick={onToggle} className="flex h-[48.3px] w-full items-center justify-between rounded-t-[2px] bg-[#f5f5f5] px-[15px] pb-[1px] text-[13px] leading-[16.25px] text-[#212121]">
        <span>{t("Легенда карты")}</span>
        <div style={{ transform: open ? "rotate(270deg)" : "rotate(90deg)" }}>
          <svg viewBox="0 0 24 24" aria-hidden style={{ display: "inline-block", verticalAlign: "baseline", width: 24, height: 24, fill: "#333" }}><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
        </div>
      </button>
      {open && (
        <div className="max-h-[calc(100vh-271px)] overflow-y-auto bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
          <ul className="px-[15px] py-[10px]">
            <LegendCheck label="Фактический мааршрут (трекер)" on={legend.tracker} onChange={(tracker) => onLegend({ ...legend, tracker })} />
            {LEGEND_PINS.map(([label, pin]) => <LegendItem key={pin} label={label} pin={pin} onClick={pin === 1 ? onFirst : pin === 3 ? onLast : undefined} />)}
          </ul>
          <ul className="px-[15px] py-[10px]">
            <LegendCheck label="Факт. маршрут(визит)" on={legend.visit} onChange={(visit) => onLegend({ ...legend, visit })} />
            {LEGEND_VISITS.map(([label, pin]) => <LegendItem key={pin} label={label} pin={pin} />)}
            <LegendCheck label="Факт. визит" on={legend.actual} onChange={(actual) => onLegend({ ...legend, actual })} />
            <LegendItem label="Фактический визит" pin={10} small />
          </ul>
        </div>
      )}
    </div>
  )
}

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`)
const MINUTES = Array.from({ length: 12 }, (_, i) => `00:${String(i * 5).padStart(2, "0")}`)

function TimeSelect({ placeholder, options, left, value, onChange, hours }: { placeholder: string; options: string[]; left: number; value: string; onChange: (value: string) => void; hours?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  // The options read "09:00" / "00:05"; the value kept is the hour or the minute alone ("09", "05").
  const part = (item: string) => (hours ? item.slice(0, 2) : item.slice(-2))
  const shown = value ? options.find((item) => part(item) === value) ?? "" : ""
  return (
    <div className="absolute top-[8.5px] h-[36px] w-[85px]" style={{ left }}>
      {shown && <span className="pointer-events-none absolute -left-[1px] top-[-13px] text-[10px] font-semibold leading-[12.2px] text-black/60">{t(placeholder)}</span>}
      <button type="button" onClick={() => setOpen((v) => !v)} className={`relative flex h-full w-full items-center border-b border-[#e8e8e8] text-left text-[13px] font-semibold text-black ${shown ? "pt-[11px]" : "pt-[7px]"}`}>
        <span className={shown ? "text-[#333]" : undefined}>{shown || t(placeholder)}</span>
        {shown && (
          <span onClick={(event) => { event.stopPropagation(); onChange("") }} className="absolute left-[46.3px] top-[13.4px] text-[18px] font-normal leading-[18px] text-[#999]">×</span>
        )}
        <svg viewBox="0 0 10 5" className="absolute right-[10px] top-[20px] h-[5px] w-[10px] fill-[#999]"><path d={open ? "M0 5l5-5 5 5z" : "M0 0l5 5 5-5z"} /></svg>
      </button>
      {open && (
        <div className="absolute -left-[1px] right-[1px] top-[calc(100%-1px)] z-[800] max-h-[200px] overflow-y-auto bg-white" style={{ boxShadow: "0 3px 10px rgba(0,0,0,.16), 0 3px 10px rgba(0,0,0,.23)" }}>
          {options.map((item, index) => (
            <div key={item} onClick={() => { onChange(part(item)); setOpen(false) }} className={`cursor-pointer px-[10px] py-[8px] text-[13px] font-semibold leading-[16.3px] ${(shown ? shown === item : index === 0) ? "bg-[#e6f2ff] text-[#333]" : "text-[#666]"}`}>{item}</div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The bar that replaces the page title while an agent card is open: "Показать путь" and the start / end time of the route. */
function TimeBar({ filter, onChange }: { filter: TimeFilter; onChange: (filter: TimeFilter) => void }) {
  const { t } = useLanguage()
  return (
    <div className="absolute left-0 top-0 z-[500] h-[60px] w-[800px]">
      <span className="absolute left-[33px] top-[18.3px] text-[18px] font-bold leading-[22.5px] text-[#5d6474]">{t("Показать путь")}</span>
      <span className="absolute left-[233px] top-[11.9px] text-[13px] font-semibold leading-[16.3px] text-[#333]" style={{ paddingTop: 10 }}>{t("Начало")}:</span>
      <TimeSelect hours placeholder="час" options={HOURS} left={305.5} value={filter.hour} onChange={(hour) => onChange({ ...filter, hour })} />
      <TimeSelect placeholder="минута" options={MINUTES} left={410.5} value={filter.minute} onChange={(minute) => onChange({ ...filter, minute })} />
      <span className="absolute left-[515.5px] top-[11.9px] text-[13px] font-semibold leading-[16.3px] text-[#333]" style={{ paddingTop: 10 }}>{t("Конец")}:</span>
      <TimeSelect hours placeholder="час" options={HOURS} left={579.8} value={filter.endHour} onChange={(endHour) => onChange({ ...filter, endHour })} />
      <TimeSelect placeholder="минута" options={MINUTES} left={684.8} value={filter.endMinute} onChange={(endMinute) => onChange({ ...filter, endMinute })} />
    </div>
  )
}
