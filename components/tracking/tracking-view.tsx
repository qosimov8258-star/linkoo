"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import {
  ChevronLeft,
  ChevronRight,
  MapPinned,
  Route,
  Trash2,
  X,
} from "lucide-react"
import { FilterCheck, FilterDate, FilterRange, FilterSelect, RI, RefButton, RefHeader } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import type { Client } from "@/components/clients/clients-data"
import { invalidateDirectory, useDirectoryNames } from "@/components/clients/use-directory"
import { TerritoryPanel } from "./territory-panel"
import { hasZone, isLocated, mapClientsOf, mapZonesOf, zoneColors, zoneKey, type ClientZone, type LatLng } from "./tracking-data"

const TrackingMap = dynamic(() => import("./tracking-map").then((m) => m.TrackingMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-200" />,
})

// The Территория page (clients and zones on the map). The agents tracking page
// (/tracking?view=agents) is AgentsTrackingView.
type TrackingViewProps = {
  view?: "clients"
}

// Fixed choices; people, clients, types, zones and branches come from the
// factory's own directories (see DIRECTORY below).
const selectOptions: Record<string, string[]> = {
  "Частота посещения": ["Каждый день", "Раз в неделю", "Раз в месяц"],
  "Маршрут агента": ["Без маршрута"],
  "Класс клиента": ["A", "B", "C"],
  "Последнее посещение": ["Сегодня", "Последние 7 дней", "Последние 30 дней"],
  "Тип отказа": ["Нет клиента", "Закрыто", "Отказ от заказа"],
}

const DIRECTORY: Record<string, "clients" | "clientTypes" | "zones" | "employees" | "branches"> = {
  Клиент: "clients",
  "Тип клиента": "clientTypes",
  Зона: "zones",
  "Ответственный агент": "employees",
  "Ответственные доставщики": "employees",
  Филиалы: "branches",
  Филиал: "branches",
  "Родительская зона": "zones",
}

function SelectLine({
  label,
  value: controlled,
  onChange,
  options: given,
}: {
  label: string
  value?: string
  onChange?: (value: string) => void
  /** Overrides the directory / fixed choices of `label`. */
  options?: string[]
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [internal, setInternal] = useState("")
  const directory = useDirectoryNames(DIRECTORY[label] ?? "zones")
  const options = given ?? (DIRECTORY[label] ? directory : (selectOptions[label] ?? ["Да", "Нет"]))
  const value = controlled ?? internal
  const setValue = (next: string) => (onChange ? onChange(next) : setInternal(next))

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-[36px] w-full items-center border-b border-[#e8e8e8] text-left text-[13px] font-semibold text-black"
      >
        <span>{t(value) || t(label)}</span>
        <svg viewBox="0 0 10 7" className="absolute right-[14px] top-[14px] h-[7px] w-[10px] fill-[#888]"><path d="M0 0l5 5.5L10 0z" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[800] max-h-48 overflow-auto bg-white py-1 shadow-xl">
          {value !== "" && (
            <button
              type="button"
              onClick={() => {
                setValue("")
                setOpen(false)
              }}
              className="block w-full px-3 py-2.5 text-left text-[13px] font-semibold text-[#999] hover:bg-[#f2f5f8]"
            >
              {t("Не указано")}
            </button>
          )}
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

const EMPTY_MAP_FILTER = {
  createdBegin: "", createdEnd: "",
  lastOrderFrom: "", lastOrderTo: "", lastPaymentFrom: "", lastPaymentTo: "",
  lastRefusalFrom: "", lastRefusalTo: "", lastVisitFrom: "", lastVisitTo: "",
  agent: "", deliverer: "", branch: "", refusalType: "",
  frequency: "", agentRoute: "", client: "", clientType: "", clientClass: "", zone: "", lastVisit: "",
  noRoute: false, equipment: false, zoneUndefined: false, unlimitedDebt: false, wrongZones: false,
}
type MapFilter = typeof EMPTY_MAP_FILTER

/** The filters of "Показать клиентов" that the client card holds (the others need visit / route data). */
function matchesMapFilter(client: Client, filter: MapFilter): boolean {
  const same = (value: string | undefined, wanted: string) => !wanted || zoneKey(value) === zoneKey(wanted)
  const day = (client.createdAt ?? "").slice(0, 10)
  if (filter.createdBegin && (!day || day < filter.createdBegin)) return false
  if (filter.createdEnd && (!day || day > filter.createdEnd)) return false
  if (!same(client.agent, filter.agent) || !same(client.deliverer, filter.deliverer) || !same(client.branch, filter.branch)) return false
  if (!same(client.name, filter.client) || !same(client.type, filter.clientType) || !same(client.zone, filter.zone)) return false
  if (filter.noRoute && client.inRoute) return false
  if (filter.zoneUndefined && hasZone(client)) return false
  if (filter.unlimitedDebt && !client.unlimitedDebt) return false
  return true
}

function ClientsFilterModal({ value, onApply, onClose }: { value: MapFilter; onApply: (filter: MapFilter) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const empty = EMPTY_MAP_FILTER
  const [draft, setDraft] = useState(value)
  const [days, setDays] = useState<string[]>([])
  const set = <K extends keyof typeof empty>(key: K) => (value: (typeof empty)[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const directories = {
    clients: useDirectoryNames("clients"),
    clientTypes: useDirectoryNames("clientTypes"),
    zones: useDirectoryNames("zones"),
    employees: useDirectoryNames("employees"),
    branches: useDirectoryNames("branches"),
  }
  const options = (label: string) => (DIRECTORY[label] ? directories[DIRECTORY[label]] : (selectOptions[label] ?? []))

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
          <h2 className="text-[15px] font-medium uppercase text-[#333]">{t("Показать на карте")}</h2>
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
              <div className="h-[3px]" />
              <FilterRange caption={t("Прошло дней с последней оплаты")} from={draft.lastPaymentFrom} to={draft.lastPaymentTo} onFrom={set("lastPaymentFrom")} onTo={set("lastPaymentTo")} />
              <div className="h-[3px]" />
              <FilterRange caption={t("Прошло дней с последнего отказа")} from={draft.lastRefusalFrom} to={draft.lastRefusalTo} onFrom={set("lastRefusalFrom")} onTo={set("lastRefusalTo")} />
              <div className="h-[3px]" />
              <FilterRange caption={t("Прошло дней с последнего визита")} from={draft.lastVisitFrom} to={draft.lastVisitTo} onFrom={set("lastVisitFrom")} onTo={set("lastVisitTo")} />
            </div>
            <div className="-mt-[5px]">
              <FilterSelect label={t("Ответственный агент")} value={draft.agent} onChange={set("agent")} options={options("Ответственный агент")} className="mb-0" />
              <FilterSelect label={t("Ответственные доставщики")} value={draft.deliverer} onChange={set("deliverer")} options={options("Ответственные доставщики")} />
              <FilterSelect label={t("Филиалы")} value={draft.branch} onChange={set("branch")} options={options("Филиалы")} />
              <FilterSelect label={t("Тип отказа")} value={draft.refusalType} onChange={set("refusalType")} options={options("Тип отказа")} />
            </div>
            <div className="space-y-[6px]">
              <FilterCheck label={t("Маршрут не установлен")} checked={draft.noRoute} onChange={set("noRoute")} />
              <FilterCheck label={t("Показать оборудование")} checked={draft.equipment} onChange={set("equipment")} />
            </div>
          </div>
          <div className="pb-5 pl-[26px] pr-[24px]">
            <div className="pt-[18px]">
              <div className="text-[13px] font-medium text-[#333]">{t("Показывать по маршруту (дни)")}</div>
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
            <div className="space-y-[6px]">
              <FilterCheck label={t("Зона не определена")} checked={draft.zoneUndefined} onChange={set("zoneUndefined")} />
              <FilterCheck label={t("Неограниченный долг")} checked={draft.unlimitedDebt} onChange={set("unlimitedDebt")} />
              <FilterCheck label={t("Неправильно присвоенные зоны(зона агента не совпадает с зоной клиента)")} checked={draft.wrongZones} onChange={set("wrongZones")} />
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
            className="h-9 rounded-[3px] bg-[#fa6e65] px-[16px] text-[13px] font-bold uppercase tracking-wide text-white hover:brightness-95"
          >
            {t("Очистить")}
          </button>
          <button
            type="button"
            onClick={() => {
              onApply(draft)
              onClose()
            }}
            className="h-9 rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-bold uppercase tracking-wide text-white hover:brightness-95"
          >
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
        <div className="px-[30px] py-[40px]">
          <div className="h-[250px] w-full bg-black" />
        </div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#efefef] pr-[26px]">
          <button type="button" onClick={onClose} className="font-semibold uppercase text-[#0a9ddb]">{t("Закрыть")}</button>
        </footer>
      </section>
    </div>
  )
}

type ZoneEditor = { zone: ClientZone | null }

/** "Добавить" / "Изменить" zone: name, branch, parent and the outline drawn on the map. */
function ZoneModal({
  zone,
  zones,
  ring,
  drawing,
  onDrawingChange,
  onClearRing,
  onClose,
  onSaved,
}: {
  zone: ClientZone | null
  zones: ClientZone[]
  ring: LatLng[]
  drawing: boolean
  onDrawingChange: (drawing: boolean) => void
  onClearRing: () => void
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(zone?.name ?? "")
  const [branch, setBranch] = useState(zone?.branch ?? "")
  const [parent, setParent] = useState(zone?.parent ?? "")
  const [reassign, setReassign] = useState(false)
  const [video, setVideo] = useState(false)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const parentOptions = zones.filter((item) => item.id !== zone?.id).map((item) => item.name)

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return setError(t("Укажите название зоны"))
    if (ring.length > 0 && ring.length < 3) return setError(t("Контур зоны должен содержать не менее 3 точек"))
    if (reassign && ring.length < 3) return setError(t("Нарисуйте контур зоны, чтобы переназначить клиентов"))
    const parentId = parent ? (zones.find((item) => item.name === parent)?.id ?? null) : null
    setSaving(true)
    setError("")
    try {
      const response = await fetch(zone ? `/api/clients/zones/${zone.id}` : "/api/clients/zones", {
        method: zone ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, branch, parentId, polygon: ring.length >= 3 ? ring : null, reassignClients: reassign }),
      })
      const body = (await response.json().catch(() => null)) as { error?: string; reassigned?: number } | null
      if (!response.ok) {
        setError(body?.error ? t(body.error) : t("Не удалось сохранить"))
        return
      }
      invalidateDirectory("zones")
      onSaved(reassign ? t(`Зона сохранена. Переназначено клиентов: ${body?.reassigned ?? 0}`) : t("Зона сохранена"))
    } catch {
      setError(t("Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="absolute left-1/2 top-0 z-[700] w-[550px] max-w-full -translate-x-1/2 bg-white pb-[10px] text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="flex items-center px-[30px] pt-[12px]">
        <label className="relative block h-[48px] w-[270px] border-b border-[#e0e0e0]">
          <span className={`pointer-events-none absolute left-0 font-semibold ${name ? "top-[3px] text-[10px]" : "top-[26px] text-[13px]"}`}>{t("Наименование зоны")}<span className="text-[#e57373]">*</span></span>
          <input value={name} maxLength={200} onChange={(event) => { setName(event.target.value); setError("") }} className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent font-semibold outline-none" />
        </label>
        <div className="ml-[22px] flex items-center gap-[10px]">
          <button type="button" onClick={() => onDrawingChange(true)} title={t("Рисовать")} aria-label={t("Рисовать")} aria-pressed={drawing} className={`flex h-[48px] w-[48px] items-center justify-center ${drawing ? "bg-[#f0f0f0]" : ""}`}><Route className="h-6 w-6 text-[#333]" strokeWidth={1.5} /></button>
          <button type="button" onClick={() => onDrawingChange(false)} title={t("Выбрать")} aria-label={t("Выбрать")} aria-pressed={!drawing} className={`flex h-[48px] w-[48px] items-center justify-center ${!drawing ? "bg-[#f0f0f0]" : ""}`}><MapPinned className="h-6 w-6 text-[#333]" strokeWidth={1.5} /></button>
          <button type="button" title={t("Очистить зону")} aria-label={t("Очистить зону")} onClick={onClearRing} className="flex h-[48px] w-[48px] items-center justify-center"><Trash2 className="h-6 w-6 text-[#333]" strokeWidth={1.5} /></button>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="ml-auto flex h-[48px] w-[48px] items-center justify-center"><X className="h-6 w-6 text-[#555]" /></button>
      </div>
      <div className="px-[30px]">
        <p className="mt-[8px] text-[12px] text-[#777]">
          {drawing ? t("Нажимайте на карту, чтобы добавить точки контура") : t("Нажмите «Рисовать», чтобы обвести зону на карте")}
          {ring.length > 0 && <span className="ml-2 font-semibold text-[#333]">{t(`Точек контура: ${ring.length}`)}</span>}
        </p>
        <div className="mt-[10px] w-[270px]"><SelectLine label="Филиал" value={branch} onChange={setBranch} /></div>
        <div className="mt-[6px] flex items-end gap-[20px]">
          <div className="w-[270px]"><SelectLine label="Родительская зона" value={parent} onChange={setParent} options={parentOptions} /></div>
          <button type="button" onClick={() => setVideo(true)} className="pb-[10px] text-[13px] font-medium text-[#1b8fd6]">{t("Видеоурок по созданию зоны")}</button>
        </div>
        <label className="mt-[14px] flex cursor-pointer items-center gap-[8px] text-[13px] font-semibold">
          <input type="checkbox" checked={reassign} onChange={(event) => setReassign(event.target.checked)} className="h-[18px] w-[18px] accent-[#536fe1]" />
          {t("Переназначить зоны клиентов")}
        </label>
        {error && <p role="alert" className="mt-[10px] text-[13px] text-[#e53935]">{error}</p>}
        <div className="mt-[22px] text-right">
          <button type="button" onClick={() => void save()} disabled={saving} className="font-semibold uppercase text-[#0a9ddb] disabled:opacity-60">{saving ? t("Сохранение...") : t("Сохранить")}</button>
        </div>
      </div>
      {video && <VideoLessonDialog onClose={() => setVideo(false)} />}
    </div>
  )
}

type TerritoryData = { clients: Client[]; zones: ClientZone[]; loading: boolean; error: string }

/** The factory's clients (with their locations) and zone directory. */
function useTerritoryData(): TerritoryData & { reload: () => void } {
  const { t } = useLanguage()
  const [data, setData] = useState<TerritoryData>({ clients: [], zones: [], loading: true, error: "" })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let cancelled = false
    setData((current) => ({ ...current, loading: true }))
    Promise.all([fetch("/api/clients?balances=0"), fetch("/api/clients/zones")])
      .then(async ([clientsRes, zonesRes]) => {
        if (!clientsRes.ok || !zonesRes.ok) throw new Error("load")
        const [clients, zones] = (await Promise.all([clientsRes.json(), zonesRes.json()])) as [Client[], ClientZone[]]
        if (!cancelled) setData({ clients, zones, loading: false, error: "" })
      })
      .catch(() => {
        if (!cancelled) setData((current) => ({ ...current, loading: false, error: t("Не удалось загрузить данные территории") }))
      })
    return () => {
      cancelled = true
    }
  }, [version, t])
  const reload = useCallback(() => setVersion((current) => current + 1), [])
  return { ...data, reload }
}

function MapNotice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "error" }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[80px] z-[500] flex justify-center px-4">
      <div className={`pointer-events-auto max-w-[460px] bg-white px-5 py-4 text-center text-[13px] shadow-[0_2px_8px_rgba(0,0,0,0.25)] ${tone === "error" ? "text-[#e53935]" : "text-[#555]"}`}>{children}</div>
    </div>
  )
}

export function TrackingView({ view = "clients" }: TrackingViewProps) {
  const { t } = useLanguage()
  const [showClients, setShowClients] = useState(true)
  const [showZones, setShowZones] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [managePanel, setManagePanel] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [editor, setEditor] = useState<ZoneEditor | null>(null)
  const [ring, setRing] = useState<LatLng[]>([])
  const [drawing, setDrawing] = useState(false)
  const [searchOpen, setSearchOpen] = useState(true)
  const [search, setSearch] = useState("")
  const [mapFilter, setMapFilter] = useState<MapFilter>(EMPTY_MAP_FILTER)
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null)
  const [focus, setFocus] = useState<{ key: number; points: LatLng[] } | null>(null)
  const territory = useTerritoryData()

  useEffect(() => {
    if (view !== "clients") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("openFilterDialog") === "true") setFilterOpen(true)
    if (params.get("openInfo") === "true") setManagePanel(true)
  }, [view])

  const query = search.trim().toLowerCase()
  const shownClients = useMemo(
    () =>
      territory.clients.filter(
        (client) =>
          matchesMapFilter(client, mapFilter) &&
          (!query || [client.name, client.address ?? "", client.zone, client.phone].some((value) => value.toLowerCase().includes(query))),
      ),
    [territory.clients, mapFilter, query],
  )
  const colorOf = useMemo(() => zoneColors([...territory.zones.map((zone) => zone.name), ...territory.clients.map((client) => client.zone)]), [territory.zones, territory.clients])
  const mapClients = useMemo(() => mapClientsOf(shownClients, colorOf), [shownClients, colorOf])
  const mapZones = useMemo(() => mapZonesOf(territory.zones, mapClientsOf(territory.clients, colorOf), colorOf), [territory.zones, territory.clients, colorOf])
  const unassigned = territory.clients.filter((client) => !hasZone(client)).length
  const unlocated = territory.clients.filter((client) => !isLocated(client)).length
  const located = territory.clients.length - unlocated
  const onMapClick = useCallback((point: LatLng) => setRing((current) => [...current, point]), [])

  function openEditor(zone: ClientZone | null) {
    setEditor({ zone })
    setRing(zone?.polygon ?? [])
    setDrawing(!zone?.polygon)
    setNotice(null)
  }

  function closeEditor() {
    setEditor(null)
    setRing([])
    setDrawing(false)
  }

  function showZone(zone: ClientZone) {
    const shape = mapZones.find((item) => zoneKey(item.name) === zoneKey(zone.name))
    const points = shape?.ring ?? mapClientsOf(territory.clients.filter((client) => zoneKey(client.zone) === zoneKey(zone.name)), colorOf).map((client) => client.position)
    if (!points.length) {
      setNotice({ tone: "info", text: t("У клиентов этой зоны нет координат") })
      return
    }
    setShowZones(true)
    setFocus((current) => ({ key: (current?.key ?? 0) + 1, points }))
  }

  async function deleteZone(zone: ClientZone) {
    if (!window.confirm(`${t("Удалить зону")} «${zone.name}»?`)) return
    try {
      const response = await fetch(`/api/clients/zones/${zone.id}`, { method: "DELETE" })
      const body = (await response.json().catch(() => null)) as { error?: string; usage?: Array<{ label: string; count: number }> } | null
      if (!response.ok) {
        const usage = body?.usage?.map((entry) => `${t(entry.label)}: ${entry.count}`).join(", ")
        setNotice({ tone: "error", text: body?.error ? `${t(body.error)}${usage ? ` (${usage})` : ""}` : t("Не удалось удалить") })
        return
      }
      invalidateDirectory("zones")
      setNotice({ tone: "info", text: t("Зона удалена") })
      territory.reload()
    } catch {
      setNotice({ tone: "error", text: t("Не удалось удалить") })
    }
  }

  const empty = !territory.loading && !territory.error && territory.zones.length === 0 && located === 0
  const statusNotice = territory.error ? (
    <MapNotice tone="error">{territory.error}</MapNotice>
  ) : empty ? (
    <MapNotice>
      <b className="block text-[14px] text-[#333]">{t("Зон и клиентов с координатами пока нет")}</b>
      <span className="mt-1 block">{t("Добавьте зону кнопкой «Добавить» или отметьте местоположение клиента в его карточке")}</span>
    </MapNotice>
  ) : !territory.loading && located === 0 && territory.clients.length > 0 ? (
    <MapNotice>{t("У клиентов нет координат: отметьте местоположение в карточке клиента")}</MapNotice>
  ) : null

  const map = (
    <TrackingMap
      showClients={showClients}
      showZones={showZones}
      clients={mapClients}
      zones={mapZones}
      draft={editor ? ring : null}
      onMapClick={editor && drawing ? onMapClick : undefined}
      focus={focus}
    />
  )

  if (view === "clients") {
    return (
      <main className="flex h-[calc(100vh-50px)] flex-col overflow-hidden bg-[#f2f5f8]">
        <div className="bg-[#f2f5f8] pl-[30px] pr-[38px]">
          <RefHeader title={t("Территория")}>
            <RefButton icon={RI.filter} label={t("Показать клиентов")} onClick={() => setFilterOpen(true)} />
            <RefButton icon={RI.trend} label={t("Установить маршрут")} onClick={() => setVideoOpen(true)} />
            <RefButton icon={RI.filter} label={t("Управлять территориями")} onClick={() => setManagePanel((open) => !open)} />
            <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => openEditor(null)} />
          </RefHeader>
        </div>
        <div className="relative min-h-0 flex-1">
          {map}
          {statusNotice}
          {notice && (
            <div className="absolute bottom-[14px] left-1/2 z-[650] flex max-w-[90%] -translate-x-1/2 items-center gap-3 bg-white px-4 py-3 text-[13px] shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
              <span className={notice.tone === "error" ? "text-[#e53935]" : "text-[#278549]"}>{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label={t("Закрыть")}><X className="h-4 w-4 text-[#777]" /></button>
            </div>
          )}
          <div className="absolute right-[14px] top-[18px] z-[500] flex h-[48px] w-[264px] items-center bg-white shadow-[0_2px_6px_rgba(0,0,0,0.2)]">
            {searchOpen && (
              <label className="flex h-full flex-1 items-center px-[22px]">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Поиск")} className="w-full text-[15px] outline-none placeholder:text-[#999]" />
              </label>
            )}
            <button type="button" onClick={() => setSearchOpen((current) => !current)} className="h-full px-[18px] text-[#333]">
              {searchOpen ? <ChevronLeft className="h-4 w-4 fill-current" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
          <div className="absolute bottom-0 right-0 z-[500] w-[230px] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
            <button type="button" onClick={() => setFilterOpen(true)} className="flex h-[30px] w-full items-center gap-[10px] bg-[#4f71dc] px-[14px] text-[13px] font-semibold text-white"><svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.filter} /></svg>{t("Показать клиентов")}</button>
            <div className="space-y-[8px] px-[14px] pb-[8px] pt-[10px]">
              <CheckLine label="Клиенты" checked={showClients} onChange={setShowClients} />
              <CheckLine label="Зоны" checked={showZones} onChange={setShowZones} />
            </div>
          </div>
          {editor && (
            <ZoneModal
              key={editor.zone?.id ?? "new"}
              zone={editor.zone}
              zones={territory.zones}
              ring={ring}
              drawing={drawing}
              onDrawingChange={setDrawing}
              onClearRing={() => setRing([])}
              onClose={closeEditor}
              onSaved={(message) => {
                closeEditor()
                setNotice({ tone: "info", text: message })
                territory.reload()
              }}
            />
          )}
          {managePanel && (
            <TerritoryPanel
              zones={territory.zones}
              loading={territory.loading}
              unassigned={unassigned}
              unlocated={unlocated}
              onClose={() => setManagePanel(false)}
              onShow={showZone}
              onEdit={(zone) => openEditor(zone)}
              onDelete={(zone) => void deleteZone(zone)}
            />
          )}
        </div>
        {filterOpen && <ClientsFilterModal value={mapFilter} onApply={setMapFilter} onClose={() => setFilterOpen(false)} />}
        {videoOpen && <VideoLessonDialog onClose={() => setVideoOpen(false)} />}
      </main>
    )
  }

  return null
}
