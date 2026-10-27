"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react"

import { useCanManage } from "@/components/analytics/cash-management-shared"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import type { GpsPoint } from "@/lib/field-activity/types"
import { useLanguage } from "@/lib/i18n/language-context"
import type { TrackingAgentRow, TrackingClient, TrackingDay } from "@/lib/tracking-types"

import { AgentDayPanel, eventSummary, matchesStatus } from "./agent-day-panel"
import { AgentsSidebar } from "./agents-sidebar"
import type { LatLng, MapAgentPin, MapDayClient, MapLabels, MapPoint, MapZoneShape } from "./agents-map"
import { ClientDrawer, FieldRecordDialog, LocationLockDialog, OptimizeDialog, OrderSummaryDialog } from "./agents-tracking-dialogs"
import { MAP_COLORS, agentColor, minuteOfDay, timeOf, trackingSearch, type DetailStatus, type TrackingGroup, type TrackingUrlState } from "./agents-tracking-data"

// Отслеживание (Personal → Контроль): the map of the field employees with their live position,
// the sidebar of online / offline agents of a day, and the agent detail ("Показать путь") with
// the day's timeline, the GPS track and the route tools. All data is real: employees and their
// GPS / visits come from lib/field-activity (the mobile app's API), the day's documents from the
// unified field event stream; nothing is shown when there is nothing.

const AgentsMap = dynamic(() => import("./agents-map").then((m) => m.AgentsMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-slate-200" />,
})

const REFRESH_MS = 60_000

type ZoneRow = { id: number; name: string; polygon: LatLng[] | null }

function normalized(text: string) {
  return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase()
}

async function readError(response: Response, t: (text: string) => string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return t(body?.error || "Не удалось загрузить данные")
}

function LegendItem({ color, size = 12, label }: { color: string; size?: number; label: string }) {
  const { t } = useLanguage()
  return (
    <li className="flex items-center gap-[8px] py-[3px] pl-[24px] text-[12px] text-[#555]">
      <span className="inline-block shrink-0 rounded-full border-2 border-white shadow" style={{ background: color, width: size, height: size }} />
      {t(label)}
    </li>
  )
}

function LegendGroup({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (value: boolean) => void; children: React.ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="py-[4px]">
      <label className="flex cursor-pointer items-center gap-[8px] text-[12px] font-semibold text-[#333]">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-[14px] w-[14px]" />
        {t(label)}
      </label>
      <ul>{children}</ul>
    </div>
  )
}

/** Compact clearable select of the track time window. */
function TimeSelect({ placeholder, value, options, onChange }: { placeholder: string; value: number | null; options: number[]; onChange: (value: number | null) => void }) {
  const { t } = useLanguage()
  return (
    <span className="relative inline-flex items-center">
      <select
        value={value === null ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        aria-label={t(placeholder)}
        className="h-[30px] appearance-none rounded-[3px] border border-[#d5dae1] bg-white pl-[8px] pr-[40px] text-[12px] text-[#333] outline-none"
      >
        <option value="">{t(placeholder)}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {placeholder === "час" ? `${String(option).padStart(2, "0")}:00` : `00:${String(option).padStart(2, "0")}`}
          </option>
        ))}
      </select>
      {value !== null && (
        <button type="button" onClick={() => onChange(null)} aria-label={t("Очистить")} className="absolute right-[20px] text-[#777]">
          <X className="h-3 w-3" />
        </button>
      )}
      <ChevronDown className="pointer-events-none absolute right-[4px] h-3.5 w-3.5 text-[#777]" />
    </span>
  )
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

export function AgentsTrackingView({ initial, today }: { initial: TrackingUrlState; today: string }) {
  const { t, language } = useLanguage()
  const router = useRouter()
  const canManage = useCanManage(["clients.manage"])
  const [state, setState] = useState<TrackingUrlState>(initial)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [legendOpen, setLegendOpen] = useState(false)
  const [agents, setAgents] = useState<{ rows: TrackingAgentRow[]; loading: boolean; error: string; key: string }>({ rows: [], loading: true, error: "", key: "" })
  const [day, setDay] = useState<{ data: TrackingDay | null; loading: boolean; error: string }>({ data: null, loading: false, error: "" })
  const [track, setTrack] = useState<{ points: GpsPoint[]; key: string }>({ points: [], key: "" })
  const [zones, setZones] = useState<MapZoneShape[] | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  /** The agent row highlighted after closing its detail. */
  const [highlight, setHighlight] = useState<number | null>(null)
  const [dialog, setDialog] = useState<
    | null
    | { kind: "optimize" }
    | { kind: "lock" }
    | { kind: "record"; record: "refusal" | "photo_report"; id: number }
    | { kind: "order"; id: number }
    | { kind: "client"; id: number }
  >(null)
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null)
  const [tick, setTick] = useState(0)

  const update = useCallback((patch: Partial<TrackingUrlState>) => setState((current) => ({ ...current, ...patch })), [])

  // Mirror the state into the address bar (no navigation).
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    window.history.replaceState(window.history.state, "", `/tracking${trackingSearch(state)}`)
  }, [state])

  // Live data of today: refresh every minute.
  useEffect(() => {
    if (state.date !== today) return
    const timer = window.setInterval(() => setTick((current) => current + 1), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [state.date, today])

  // Sidebar agents of the day.
  const agentsKey = `${state.date}|${state.group}`
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ date: state.date, tracked: "true" })
    if (state.group !== "all") params.set("group", state.group)
    setAgents((current) => ({ ...current, loading: true, error: "" }))
    fetch(`/api/field-activity/employees?${params}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, t))
        return ((await response.json()) as { rows: TrackingAgentRow[] }).rows
      })
      .then((rows) => {
        if (!cancelled) setAgents({ rows, loading: false, error: "", key: agentsKey })
      })
      .catch((reason: unknown) => {
        if (!cancelled) setAgents({ rows: [], loading: false, error: reason instanceof Error ? reason.message : t("Не удалось загрузить данные"), key: agentsKey })
      })
    return () => {
      cancelled = true
    }
  }, [agentsKey, state.date, state.group, tick, t])

  // The selected agent's day.
  useEffect(() => {
    if (state.agent === null) return
    let cancelled = false
    setDay((current) => ({ ...current, loading: true, error: "" }))
    fetch(`/api/tracking/agents/${state.agent}/day?date=${state.date}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, t))
        return (await response.json()) as TrackingDay
      })
      .then((data) => {
        if (!cancelled) setDay({ data, loading: false, error: "" })
      })
      .catch((reason: unknown) => {
        if (!cancelled) setDay({ data: null, loading: false, error: reason instanceof Error ? reason.message : t("Не удалось загрузить данные") })
      })
    return () => {
      cancelled = true
    }
  }, [state.agent, state.date, tick, t])

  // The selected agent's GPS track (the time window is applied below, without a reload).
  const trackKey = state.agent !== null && state.showPolylineTrack ? `${state.agent}|${state.date}` : ""
  useEffect(() => {
    if (!trackKey || state.agent === null) return
    let cancelled = false
    fetch(`/api/field-activity/gps?employeeId=${state.agent}&date=${state.date}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, t))
        return ((await response.json()) as { points: GpsPoint[] }).points
      })
      .then((points) => {
        if (!cancelled) setTrack({ points, key: trackKey })
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setTrack({ points: [], key: trackKey })
        setNotice({ tone: "error", text: reason instanceof Error ? reason.message : t("Не удалось загрузить данные") })
      })
    return () => {
      cancelled = true
    }
  }, [trackKey, state.agent, state.date, tick, t])

  // Zones (loaded once, when first shown).
  useEffect(() => {
    if (!state.showZones || zones !== null) return
    let cancelled = false
    fetch("/api/clients/zones", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, t))
        return (await response.json()) as ZoneRow[]
      })
      .then((rows) => {
        if (cancelled) return
        setZones(rows.filter((zone) => Array.isArray(zone.polygon) && zone.polygon.length >= 3).map((zone) => ({ id: zone.id, name: zone.name, ring: zone.polygon as LatLng[] })))
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setZones([])
        setNotice({ tone: "error", text: reason instanceof Error ? reason.message : t("Не удалось загрузить данные") })
      })
    return () => {
      cancelled = true
    }
  }, [state.showZones, zones, t])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Selection belongs to one agent and day.
  useEffect(() => setSelected([]), [state.agent, state.date])

  const { online, offline } = useMemo(() => {
    const query = normalized(state.search)
    const rows = agents.rows.filter((row) => !query || normalized(row.name).includes(query))
    const byActivity = (a: TrackingAgentRow, b: TrackingAgentRow) => {
      const left = a.location?.lastActivityAt ?? ""
      const right = b.location?.lastActivityAt ?? ""
      return left === right ? a.name.localeCompare(b.name) : left < right ? 1 : -1
    }
    return {
      online: rows.filter((row) => row.location?.online).sort(byActivity),
      offline: rows.filter((row) => !row.location?.online).sort(byActivity),
    }
  }, [agents.rows, state.search])
  const ordered = useMemo(() => [...online, ...offline], [online, offline])

  const current = day.data && state.agent !== null && day.data.employee.employeeId === state.agent && day.data.date === state.date ? day.data : null
  const index = state.agent === null ? -1 : ordered.findIndex((row) => row.employeeId === state.agent)
  const agentName = current?.employee.name ?? ordered[index]?.name ?? ""

  const openAgent = useCallback((employeeId: number) => update({ agent: employeeId, staticStatus: "all", showPlanTrack: false }), [update])

  // --- map data ------------------------------------------------------------------------
  const pins: MapAgentPin[] = useMemo(() => {
    if (state.agent !== null) {
      const point = current?.location?.point
      return point && current
        ? [{ employeeId: current.employee.employeeId, name: current.employee.name, color: agentColor(current.employee.employeeId), lat: point.lat, lng: point.lng, time: timeOf(current.location?.lastActivityAt ?? point.at) }]
        : []
    }
    return ordered.flatMap((row) => {
      const point = row.location?.point
      return point ? [{ employeeId: row.employeeId, name: row.name, color: agentColor(row.employeeId), lat: point.lat, lng: point.lng, time: timeOf(row.location?.lastActivityAt ?? point.at) }] : []
    })
  }, [state.agent, current, ordered])

  const shownClients: TrackingClient[] = useMemo(() => (current ? current.clients.filter((client) => matchesStatus(client, state.staticStatus)) : []), [current, state.staticStatus])

  const mapClients: MapDayClient[] = useMemo(() => {
    if (!current) return []
    return shownClients.flatMap((client) => {
      if (client.lat === null || client.lng === null) return []
      const seq = current.clients.indexOf(client) + 1
      const state: MapDayClient["state"] = client.refused ? "refusal" : client.unplanned ? "unplanned" : client.visited ? "done" : client.planned ? "todo" : "other"
      return [
        {
          key: client.key,
          seq,
          clientId: client.clientId,
          name: client.clientName,
          address: client.address,
          lat: client.lat,
          lng: client.lng,
          state,
          syncedAt: timeOf(client.firstAt),
          distance: client.distanceM !== null ? `${Math.round(client.distanceM)} ${t("м.")}` : "",
          actualLat: client.actualLat,
          actualLng: client.actualLng,
          lines: eventSummary(client, current.date, t, language),
        },
      ]
    })
  }, [current, shownClients, t, language])

  const visits = useMemo(
    () =>
      shownClients
        .flatMap((client) => client.events.filter((event) => event.kind === "visit" && event.visit).map((event) => ({ client, event })))
        .sort((a, b) => (a.event.at < b.event.at ? -1 : a.event.at > b.event.at ? 1 : 0)),
    [shownClients],
  )
  const visitClose: MapPoint[] = useMemo(
    () =>
      visits.flatMap(({ client, event }) => {
        const visit = event.visit!
        const lat = visit.endLat ?? visit.startLat
        const lng = visit.endLng ?? visit.startLng
        return lat !== null && lng !== null ? [{ lat, lng, label: `${timeOf(visit.finishedAt ?? visit.startedAt)} ${client.clientName}` }] : []
      }),
    [visits],
  )
  const actualVisits: MapPoint[] = useMemo(
    () =>
      visits.flatMap(({ client, event }) => {
        const visit = event.visit!
        return visit.startLat !== null && visit.startLng !== null ? [{ lat: visit.startLat, lng: visit.startLng, label: `${timeOf(visit.startedAt)} ${client.clientName}` }] : []
      }),
    [visits],
  )

  const planRoute: LatLng[] | null = useMemo(() => {
    if (!current || !state.showPlanTrack) return null
    return current.clients
      .filter((client) => client.planned && client.lat !== null && client.lng !== null)
      .map((client, position) => ({ client, position }))
      .sort((a, b) => (a.client.routePosition ?? Number.MAX_SAFE_INTEGER) - (b.client.routePosition ?? Number.MAX_SAFE_INTEGER) || a.position - b.position)
      .map(({ client }) => [client.lat as number, client.lng as number] as LatLng)
  }, [current, state.showPlanTrack])

  const windowedTrack = useMemo(() => {
    if (!trackKey || track.key !== trackKey) return []
    const from = state.hour !== null ? state.hour * 60 + (state.minute ?? 0) : null
    const to = state.endHour !== null ? state.endHour * 60 + (state.endMinute ?? 59) : null
    return track.points.filter((point) => {
      const minute = minuteOfDay(point.at)
      return (from === null || minute >= from) && (to === null || minute <= to)
    })
  }, [track, trackKey, state.hour, state.minute, state.endHour, state.endMinute])

  const labels: MapLabels = useMemo(
    () => ({
      synced: t("Синхронизировано:"),
      client: t("Клиент:"),
      distance: t("Расстояние:"),
      actual: t("Фактический:"),
      address: t("Адрес:"),
      showOnMap: t("Показать на карте"),
      showClient: t("Показать клиента"),
    }),
    [t],
  )

  const fitKey = state.agent === null ? `list|${state.date}|${state.group}` : `agent|${state.agent}|${state.date}`
  const openClient = useCallback((clientId: number) => setDialog({ kind: "client", id: clientId }), [])

  const plannedOptions = useMemo(
    () => (current?.clients ?? []).filter((client) => client.planned && client.clientId !== null).map((client) => ({ id: client.clientId as number, label: client.clientName })),
    [current],
  )
  const selectableIds = useMemo(() => shownClients.flatMap((client) => (client.clientId !== null ? [client.clientId] : [])), [shownClients])
  const reloadDay = () => setTick((value) => value + 1)

  const detail = state.agent !== null
  const sidebarWidth = detail ? 530 : 330

  return (
    <div className="flex h-[calc(100vh-50px)] w-full overflow-hidden">
      <div className="relative min-w-0 flex-1">
        <AgentsMap
          agents={pins}
          onAgentClick={openAgent}
          clients={detail ? mapClients : []}
          visitClose={detail ? visitClose : []}
          actualVisits={detail ? actualVisits : []}
          track={detail ? windowedTrack : []}
          planRoute={detail ? planRoute : null}
          zones={zones ?? []}
          layers={{ markets: state.showMarkets, zones: state.showZones, visitTrack: state.showVisitTrack, actualVisits: state.showActualVisitTrack, polyline: state.showPolylineTrack }}
          fitKey={fitKey}
          labels={labels}
          onClientOpen={openClient}
        />

        <div className="pointer-events-none absolute left-[60px] right-[16px] top-[14px] z-[500] flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
          <div className="pointer-events-auto flex items-center gap-[11px]">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
            <span className="h-[21px] w-[2px] bg-[#5d6474]" />
            <h1 className="text-[18px] font-bold text-[#5d6474]">{t(detail ? "Показать путь" : "Отслеживание")}</h1>
          </div>
          {detail && (
            <div className="pointer-events-auto flex flex-wrap items-center gap-[6px] rounded-[4px] bg-white/95 px-[10px] py-[5px] text-[12px] shadow-[0_1px_4px_rgba(0,0,0,0.2)]">
              <span className="font-semibold">{t("Начало:")}</span>
              <TimeSelect placeholder="час" value={state.hour} options={HOURS} onChange={(hour) => update({ hour, ...(hour === null ? { minute: null } : {}) })} />
              <TimeSelect placeholder="минута" value={state.minute} options={MINUTES} onChange={(minute) => update({ minute })} />
              <span className="ml-[8px] font-semibold">{t("Конец:")}</span>
              <TimeSelect placeholder="час" value={state.endHour} options={HOURS} onChange={(endHour) => update({ endHour, ...(endHour === null ? { endMinute: null } : {}) })} />
              <TimeSelect placeholder="минута" value={state.endMinute} options={MINUTES} onChange={(endMinute) => update({ endMinute })} />
            </div>
          )}
        </div>

        <div className="absolute left-[60px] top-[100px] z-[500] w-[230px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.25)]">
          <button type="button" onClick={() => setLegendOpen((open) => !open)} aria-expanded={legendOpen} className="flex h-[42px] w-full items-center justify-between px-[14px] text-[13px] text-[#333]">
            {t("Легенда карты")}
            <ChevronDown className={`h-4 w-4 text-slate-400 transition ${legendOpen ? "rotate-180" : ""}`} />
          </button>
          {legendOpen && (
            <div className="max-h-[50vh] overflow-y-auto border-t border-[#eee] px-[12px] pb-[8px] pt-[4px]">
              <LegendGroup label="Фактический маршрут (трекер)" checked={state.showPolylineTrack} onChange={(value) => update({ showPolylineTrack: value })}>
                <LegendItem color={MAP_COLORS.tracker} size={14} label="Первая координата трекера" />
                <LegendItem color={MAP_COLORS.tracker} size={9} label="Промежуточные координаты трекера" />
                <LegendItem color={MAP_COLORS.tracker} size={14} label="Последняя координата трекера" />
              </LegendGroup>
              <LegendGroup label="Факт. маршрут(визит)" checked={state.showVisitTrack} onChange={(value) => update({ showVisitTrack: value })}>
                <LegendItem color={MAP_COLORS.planned} label="Запланированный маршрут визитов" />
                <LegendItem color={MAP_COLORS.visitClose} size={14} label="Первая точка закрытия визита" />
                <LegendItem color={MAP_COLORS.visitClose} size={9} label="Промежуточные точки закрытия визита" />
                <LegendItem color={MAP_COLORS.visitClose} size={14} label="Последняя точка закрытия визита" />
                <LegendItem color={MAP_COLORS.unplanned} label="Внеплановый визит" />
                <LegendItem color={MAP_COLORS.refusal} label="Отказ" />
              </LegendGroup>
              <LegendGroup label="Факт. визит" checked={state.showActualVisitTrack} onChange={(value) => update({ showActualVisitTrack: value })}>
                <LegendItem color={MAP_COLORS.actual} label="Фактический визит" />
              </LegendGroup>
            </div>
          )}
        </div>

        <div className="absolute bottom-[12px] right-[16px] z-[500] flex gap-[14px] rounded-[3px] bg-white px-[12px] py-[8px] text-[13px] shadow-[0_1px_4px_rgba(0,0,0,0.25)]">
          <label className="flex cursor-pointer items-center gap-[6px]">
            <input type="checkbox" checked={state.showMarkets} onChange={(event) => update({ showMarkets: event.target.checked })} />
            {t("Клиенты")}
          </label>
          <label className="flex cursor-pointer items-center gap-[6px]">
            <input type="checkbox" checked={state.showZones} onChange={(event) => update({ showZones: event.target.checked })} />
            {t("Зоны")}
          </label>
        </div>

        {notice && (
          <div className="absolute bottom-[60px] left-1/2 z-[650] flex max-w-[90%] -translate-x-1/2 items-center gap-3 bg-white px-4 py-3 text-[13px] shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
            <span className={notice.tone === "error" ? "text-[#e53935]" : "text-[#278549]"}>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label={t("Закрыть")}>
              <X className="h-4 w-4 text-[#777]" />
            </button>
          </div>
        )}
      </div>

      <div className="relative shrink-0 bg-white shadow-[-2px_0_6px_rgba(0,0,0,0.15)] transition-[width] duration-200" style={{ width: sidebarOpen ? sidebarWidth : 0 }}>
        <button
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={t(sidebarOpen ? "Скрыть панель" : "Показать панель")}
          className="absolute -left-[22px] top-[14px] z-[600] flex h-[44px] w-[22px] items-center justify-center rounded-l-[4px] bg-white text-[#555] shadow-[-2px_0_4px_rgba(0,0,0,0.15)]"
        >
          {sidebarOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        {sidebarOpen && (
          <div className="h-full overflow-hidden" style={{ width: sidebarWidth }}>
            {detail ? (
              <AgentDayPanel
                employeeId={state.agent as number}
                name={agentName}
                day={current}
                loading={day.loading}
                error={day.error}
                date={state.date}
                onDate={(date) => update({ date })}
                onPrev={index > 0 ? () => openAgent(ordered[index - 1].employeeId) : null}
                onNext={index >= 0 && index < ordered.length - 1 ? () => openAgent(ordered[index + 1].employeeId) : null}
                onClose={() => {
                  setHighlight(state.agent)
                  update({ agent: null, staticStatus: "all", showPlanTrack: false, hour: null, minute: null, endHour: null, endMinute: null })
                }}
                status={state.staticStatus}
                onStatus={(staticStatus: DetailStatus) => update({ staticStatus })}
                selected={selected}
                onToggle={(clientId) => setSelected((list) => (list.includes(clientId) ? list.filter((id) => id !== clientId) : [...list, clientId]))}
                onSelectAll={() => setSelected((list) => (selectableIds.length && selectableIds.every((id) => list.includes(id)) ? [] : selectableIds))}
                canManage={canManage}
                planShown={state.showPlanTrack}
                onTogglePlan={() => update({ showPlanTrack: !state.showPlanTrack })}
                onOptimize={() => setDialog({ kind: "optimize" })}
                onEditRoute={() => router.push(`/clients?select=${selected.join(",")}`)}
                onEditLock={() => setDialog({ kind: "lock" })}
                actions={{
                  onOpenClient: openClient,
                  onOpenOrder: (id) => setDialog({ kind: "order", id }),
                  onOpenRecord: (record, id) => setDialog({ kind: "record", record, id }),
                }}
              />
            ) : (
              <AgentsSidebar
                date={state.date}
                onDate={(date) => update({ date })}
                group={state.group}
                onGroup={(group: TrackingGroup) => update({ group })}
                search={state.search}
                onSearch={(search) => update({ search })}
                online={online}
                offline={offline}
                loading={agents.loading || agents.key !== agentsKey}
                error={agents.error}
                selectedId={highlight}
                onSelect={openAgent}
              />
            )}
          </div>
        )}
      </div>

      {dialog?.kind === "optimize" && state.agent !== null && (
        <OptimizeDialog
          employeeId={state.agent}
          date={state.date}
          clients={plannedOptions}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setNotice({ tone: "info", text: t("Маршрут оптимизирован") })
            update({ showPlanTrack: true })
            reloadDay()
          }}
        />
      )}
      {dialog?.kind === "lock" && (
        <LocationLockDialog
          clientIds={selected}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setSelected([])
            setNotice({ tone: "info", text: t("Изменения сохранены") })
            reloadDay()
          }}
        />
      )}
      {dialog?.kind === "record" && <FieldRecordDialog kind={dialog.record} id={dialog.id} onClose={() => setDialog(null)} onOpenClient={openClient} />}
      {dialog?.kind === "order" && <OrderSummaryDialog orderId={dialog.id} onClose={() => setDialog(null)} onNavigate={(href) => router.push(href)} />}
      {dialog?.kind === "client" && <ClientDrawer clientId={dialog.id} onClose={() => setDialog(null)} onNavigate={(href) => router.push(href)} />}
    </div>
  )
}
