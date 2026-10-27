import L from "leaflet"
import "leaflet.markercluster"
import "leaflet.markercluster/dist/MarkerCluster.css"
import "leaflet.markercluster/dist/MarkerCluster.Default.css"
import "./tracking-day.css"

import { filterTrack, sortPlans, type AgentDay, type LegendState, type PlanItem, type PlanTask, type TimeFilter } from "./agent-day"

// The layers of an agent's day, drawn the way the reference's map does: the tracker track (dashed line, numbered pins, clusters), the
// visited / refused / unplanned clients, the clients still to visit and the places where the visits really started.

type T = (text: string) => string
type Marker = L.Marker & { options: L.MarkerOptions & { data?: unknown; index?: number } }

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string)
const hhmm = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : "")
const hhmmss = (iso: string | null | undefined) => (iso ? iso.slice(11, 19) : "")
const yandex = (lat: unknown, lon: unknown) => `https://maps.yandex.ru/?text=${lat},${lon}`

const NOTE_STYLE = "margin: 5px 0 -10px 0;  font-weight: 500; color: #666;"
const GUIDE_STYLE = "margin: 6px 0 10px 0;  font-weight: 500; color: #666;"
const CHIP_STYLE = "margin: 6px 0; padding: 2px 10px; background: #22a6c6; width: fit-content; border-radius: 10px; color: #fff;"
const LIST_STYLE = "width: 30%; padding-right: 10px; min-height: 300px; max-height: 300px; overflow-y: scroll; border-right: 1px solid #ddd;"
const BODY_STYLE = "width: 70%; min-height: 300px;padding: 0 15px;  max-height: 300px; overflow-y: scroll;"
const LINK_STYLE = "margin: 1.3em 0 1.3em 10px; font-weight: 500; color: #5869f0;"

const gap = (value: number | null | undefined) => (value == null ? "" : value >= 50 && value <= 100 ? "rgb(255, 159, 0)" : value > 100 ? "rgb(255, 94, 94)" : "rgb(58, 201, 119)")
const distanceColor = (value: number) => (value >= 50 && value <= 100 ? "#DDE007" : value > 100 ? "rgb(255, 94, 94)" : "rgb(58, 201, 119)")

function icon(html: string) {
  return L.divIcon({ className: "", iconSize: [25, 25], iconAnchor: [10, 38], popupAnchor: [1, -34], tooltipAnchor: [16, -28], html })
}

function taskLines(tasks: PlanTask[], t: T) {
  return tasks
    .map((task) =>
      task.service_time
        ? `<li style='margin: 5px; display: flex; align-items: center;' class="time-row">— ${t("Начало")} <span style="${CHIP_STYLE}">${hhmmss(task.service_time.start_time)}</span> - ${t("Конец")} <span style="${CHIP_STYLE}">${hhmmss(task.service_time.end_time)}</span><div style="margin: 6px 0; padding: 2px 10px; background: #ff5e5e; width: fit-content; border-radius: 10px; color: #fff;">${esc(task.service_time.difference_time)}</div></li>`
        : `<li style='margin: 5px'>— ${esc(task.text)} </li>`,
    )
    .join("")
}

function showClient(t: T) {
  return `<div style="display: flex; flex-direction: row; align-items: center; cursor: pointer; justify-content: center; padding: 12px 32px; gap: 5px; height: 30px; background: #f0f4f8; width: 100%; color: #5869f0; border-radius: 100px; margin-top: 20px;">${t("Показать клиента")}</div>`
}

function mapLink(lat: unknown, lon: unknown, t: T) {
  return `<a style="${LINK_STYLE}" target="_blank" href="${yandex(lat, lon)}">${t("Показать на карте")}</a>`
}

/** "Клиент: lat, lon  Показать на карте" row. */
function coordRow(label: string, lat: unknown, lon: unknown, t: T) {
  return `<div style="margin-top: -20px; display: flex; flex-direction: row;"><p style="font-weight: 500; margin-right: 5px;">${label}: <span>${lat}, ${lon}</span></p>${mapLink(lat, lon, t)}</div>`
}

function firstGap(item: PlanItem) {
  return item.plans.find((task) => task.distance_from_market || task.distance_from_market === 0)?.distance_from_market
}

// ----------------------------------------------------------------------------------------------------------------------------
// The popup that opens on a cluster: the list of its points on the left, the chosen one on the right.
// ----------------------------------------------------------------------------------------------------------------------------

function clusterPopup(map: L.Map, at: L.LatLng, rows: { label: string; detail: string }[]) {
  const render = (active: number) =>
    `<div class="marker-cluster-popup-container"><div style="${LIST_STYLE}"><ul class="marker-cluster-time-list">${rows
      .map((row, index) => `<li data-index="${index}" class="${index === active ? "active" : ""}">${row.label}</li>`)
      .join("")}</ul></div><div style="${BODY_STYLE}">${rows[active].detail}</div></div>`
  const popup = L.popup({ maxWidth: 630, className: "leaflet-markerClusters-popup" }).setLatLng(at).setContent(render(0))
  popup.openOn(map)
  const root = popup.getElement()
  root?.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement).closest("li[data-index]") as HTMLElement | null
    if (!item) return
    popup.setContent(render(Number(item.dataset.index)))
  })
}

// ----------------------------------------------------------------------------------------------------------------------------
// The tracker track.
// ----------------------------------------------------------------------------------------------------------------------------

// The reference puts the first and the last pin straight on the map and the others into a cluster that is added last: the layers come back in that
// order (they are added one by one, so the cluster ends up above the pins of the same height).
function trackLayer(map: L.Map, track: [number, number, string][], t: T): L.Layer[] {
  const ends: L.Layer[] = []
  const cluster = L.markerClusterGroup({ spiderfyOnMaxZoom: false, showCoverageOnHover: false, zoomToBoundsOnClick: false })
  track.forEach((point, index) => {
    const kind = index === 0 ? "polylineMarket-start" : index + 1 === track.length ? "polylineMarket-end" : "polylineMarket"
    const big = kind === "polylineMarket" ? "polylineMarket-number" : "polylineMarket-number-big"
    const marker = L.marker([point[0], point[1]], {
      icon: icon(`<div class="${kind}"><div class="${big}">${index + 1}</div></div>`),
      index,
      data: point,
    } as L.MarkerOptions).bindPopup(
      `<div><div style="font-weight: 500"><p style="font-weight: 500; margin-right: 5px;">${t("Локация")}: <span>${point[0]}, ${point[1]}</span></p><a style="font-weight: 500; color: #5869f0;" target="_blank" href="${yandex(point[0], point[1])}">${t("Показать на карте")}</a></div><p><b>${t("Время")}:</b> ${point[2]}</p></div>`,
    )
    marker.on("click", () => marker.openPopup())
    if (kind === "polylineMarket") cluster.addLayer(marker)
    else ends.push(marker)
  })
  cluster.on("clusterclick", (event: L.LeafletEvent) => {
    const layer = (event as unknown as { layer: L.MarkerCluster; latlng: L.LatLng }).layer
    const markers = (layer.getAllChildMarkers() as Marker[]).sort((a, b) => (a.options.index ?? 0) - (b.options.index ?? 0))
    const html = `<div style="width: 330px; display: flex; padding-top: 15px"><div style="max-height: 300px;"><ul class="leaflet-list">${markers
      .map((marker) => {
        const point = marker.options.data as [number, number, string]
        return `<li style="padding: 5px 15px; display: flex; align-items: flex-end"><span style="margin-right: 5px; padding: 2px 10px; background: #22a6c6; width: fit-content; border-radius: 10px; color: #fff;">${point[2].slice(0, -3)}</span><a target="_blank" href="${yandex(point[0], point[1])}" style="display: flex; align-items: flex-end; cursor: pointer"><img style="width: 30px; height: 27px; margin-right: 5px" src="/tracking-legend/map.png" alt="map"/><p style="font-weight: 500; margin: 0;">${point[0]}, ${point[1]}</p></a></li>`
      })
      .join("")}</ul></div></div>`
    L.popup({ maxWidth: 330, className: "leaflet-markerClusters-popup" }).setLatLng((event as unknown as { latlng: L.LatLng }).latlng).setContent(html).openOn(map)
  })
  return [...ends, cluster, L.polyline(track.map((point) => [point[0], point[1]] as [number, number]), { dashArray: "5, 10", color: "#b51eff" })]
}

// ----------------------------------------------------------------------------------------------------------------------------
// Clients: visited / refused / unplanned ones (orange cluster) and the ones still to visit (green cluster).
// ----------------------------------------------------------------------------------------------------------------------------

type Stop = { item: PlanItem; lat: number; lng: number }

function stopOf(item: PlanItem, firstOfMarket: Map<number, PlanItem>): Stop | null {
  const location = item.market.location
  if (!location) return null
  return { item: firstOfMarket.get(item.market.id) ?? item, lat: location.lat, lng: location.lon }
}

function itemPopup(stop: Stop, t: T, options: { gapRow: boolean }) {
  const { item } = stop
  const tasks = item.plans
  const synced = hhmm(tasks[0]?.done_time)
  const offset = firstGap(item)
  const service = tasks.find((task) => task.service_time_id)
  const start = service?.service_time?.start_location
  let html = `<div><h2>${esc(item.market.name)}</h2>`
  // The visited card shows the note only when there is one; the card of a client still to visit always has the (maybe empty) paragraph.
  if (!options.gapRow || item.market.guide) html += `<p style="${GUIDE_STYLE}">${esc(item.market.guide ?? "")}</p>`
  if (options.gapRow) {
    html += `<div style="margin-top: -5px; display: flex; flex-direction: row;">${offset ? `<p style="font-weight: 500; margin-right: 5px;">${t("Разница")}: <span style="color: ${gap(offset)};">${offset} ${t("м.")}</span></p>` : ""}<p style="font-weight: 500">${t("Синхронизировано")}: <span style="${CHIP_STYLE}">${synced}</span></p></div>`
  }
  html += coordRow(t("Клиент"), stop.lat, stop.lng, t)
  if (options.gapRow && item.distance) {
    html += `<div style="margin-top: -20px; display: flex; flex-direction: row;"><p style="font-weight: 500; margin-right: 5px;">${t("Расстояние")}: <span style="color: ${distanceColor(item.distance)}">${item.distance} ${t("м.")}</span></p></div>`
  }
  if (start) html += coordRow(t("Фактический"), start.lat, start.lon, t)
  html += `<p style="font-weight: 500; margin-top: -3px;">${t("Адрес")}: ${esc(item.market.address ?? "")}</p><ul>${taskLines(tasks, t)}</ul>${showClient(t)}</div>`
  return html
}

function clusterDetail(stop: Stop, t: T, withGap: boolean) {
  const { item } = stop
  const offset = firstGap(item)
  const service = item.plans.find((task) => task.service_time_id)
  const start = service?.service_time?.start_location ?? { lat: stop.lat, lon: stop.lng }
  const lead = withGap
    ? `<div style="margin-top: -5px; display: flex; flex-direction: row;">${item.distance ? `<p style="font-weight: 500; margin-right: 5px;">${t("Расстояние")}: <span style="color: ${distanceColor(item.distance)}">${item.distance} ${t("м.")}</span></p>` : ""}${offset ? `<p style="font-weight: 500; margin-right: 5px;">${t("Разница")}: <span style="color: ${gap(offset)};">${offset} ${t("м.")}</span></p>` : ""}<p style="font-weight: 500">${t("Синхронизировано")}: <span style="${CHIP_STYLE}">${hhmm(item.plans[0]?.done_time)}</span></p></div>`
    : ""
  return `${lead}<div><h2>${esc(item.market.name)}</h2><p style="font-weight: 500;">${t("Адрес")}: ${esc(item.market.address ?? "")}</p>${coordRow(t("Клиент"), stop.lat, stop.lng, t)}${coordRow(t("Фактический"), start.lat, start.lon, t)}</div><ul>${taskLines(item.plans, t)}</ul>`
}

function stopsOf(plans: PlanItem[]): Stop[] {
  const firstOfMarket = new Map<number, PlanItem>()
  plans.forEach((item) => {
    if (!firstOfMarket.has(item.market.id)) firstOfMarket.set(item.market.id, item)
  })
  return sortPlans(plans)
    .map((item) => stopOf(item, firstOfMarket))
    .filter((stop): stop is Stop => stop !== null)
}

const hasType = (item: PlanItem, type: string) => item.plans.some((task) => task.type === type)
const hasDone = (item: PlanItem) => item.plans.some((task) => task.status === "done")
const clusterIcon = (className: string) => (cluster: L.MarkerCluster) =>
  L.divIcon({ html: `<div style="border-radius: 50%; display: flex; align-items: center; justify-content: center">${cluster.getChildCount()}</div>`, className })

function visitLayer(map: L.Map, plans: PlanItem[], t: T, pending: boolean): L.Layer[] {
  // The visited / refused / unplanned clients (pending = false) or the ones still to visit (pending = true), in the order of the visits.
  const all = stopsOf(plans).filter((stop) => {
    const first = stop.item.plans[0]?.status === "pending"
    if (pending) return first
    return !first && (hasType(stop.item, "rejection") || hasType(stop.item, "no_plan_visit") || hasDone(stop.item))
  })
  if (!all.length) return []
  const ends: L.Layer[] = []
  const cluster = L.markerClusterGroup({
    spiderfyOnMaxZoom: false,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: false,
    iconCreateFunction: clusterIcon(pending ? "marker-cluster-must-small" : "marker-cluster-visit-small"),
  })
  const firstDone = all.findIndex((stop) => hasDone(stop.item))
  let lastDone = -1
  all.forEach((stop, index) => {
    if (hasDone(stop.item)) lastDone = index
  })
  all.forEach((stop, index) => {
    const { item } = stop
    const done = item.plans.filter((task) => task.status === "done")
    const kind = hasType(item, "rejection")
      ? "markerReject"
      : hasType(item, "no_plan_visit")
        ? "markerNoPlanVisit"
        : lastDone === index
          ? "markerPlan-end"
          : firstDone === index
            ? "markerPlan-start"
            : done.length === 0
              ? "markerPlanIsDone"
              : "markerPlan"
    const numberClass = lastDone === index || firstDone === index ? "polylineMarket-number-big-new" : "polylineMarket-number"
    const label = done.length > 0 ? index + 1 : (item.route_position ?? "")
    const marker = L.marker([stop.lat, stop.lng], {
      icon: icon(`<div class="${kind}"><div class="${numberClass}">${label}</div></div>`),
      data: stop,
    } as L.MarkerOptions).bindPopup(itemPopup(stop, t, { gapRow: !pending }), { closeButton: false, maxWidth: 630 })
    marker.on("click", () => marker.openPopup())
    if (index === 0 || index + 1 === all.length) ends.push(marker)
    else cluster.addLayer(marker)
  })
  cluster.on("clusterclick", (event: L.LeafletEvent) => {
    const layer = (event as unknown as { layer: L.MarkerCluster }).layer
    const markers = layer.getAllChildMarkers() as Marker[]
    clusterPopup(
      map,
      (event as unknown as { latlng: L.LatLng }).latlng,
      markers.map((marker, index) => {
        const stop = marker.options.data as Stop
        const time = stop.item.plans[0]?.done_time
        return { label: `<b>${index + 1}:</b> ${time ? hhmm(time) : t("Надо посетить")}`, detail: clusterDetail(stop, t, !pending) }
      }),
    )
  })
  return [...ends, cluster]
}

// ----------------------------------------------------------------------------------------------------------------------------
// The places where the visits really started ("Факт. визит"), black pins and a black cluster.
// ----------------------------------------------------------------------------------------------------------------------------

type Actual = { task: PlanTask; item: PlanItem }

function actualLayer(map: L.Map, plans: PlanItem[], t: T): L.Layer[] {
  const rows: Actual[] = plans.flatMap((item) => item.plans.map((task) => ({ task, item }))).filter((row) => row.task.service_time_id)
  if (!rows.length) return []
  const cluster = L.markerClusterGroup({ spiderfyOnMaxZoom: false, showCoverageOnHover: false, zoomToBoundsOnClick: false, iconCreateFunction: clusterIcon("marker-cluster-diff-small") })
  rows.forEach((row, index) => {
    const start = row.task.service_time?.start_location
    if (!start) return
    const { market } = row.item
    const offset = firstGap(row.item)
    const synced = hhmm(row.task.done_time)
    let html = `<div><h2>${esc(market.name)}</h2><p style="${NOTE_STYLE}">${esc(market.guide ?? "")}</p><p style="font-weight: 500;">${t("Адрес")}: ${esc(market.address ?? "")}</p>${market.location ? coordRow(t("Клиент"), market.location.lat, market.location.lon, t) : ""}${coordRow(t("Фактический"), start.lat, start.lon, t)}</div>`
    if (offset || synced) {
      html += `<div style="margin-top: -5px; display: flex; flex-direction: row;"><p style="font-weight: 500; margin-right: 5px;">${t("Разница")}: <span style="color: ${gap(offset)};">${offset} ${t("м.")}</span></p><p style="font-weight: 500">${t("Синхронизировано")}: <span style="${CHIP_STYLE}">${synced}</span></p></div><ul style="font-weight: 500">`
    }
    html += `${taskLines(row.item.plans, t)}${showClient(t)}`
    const marker = L.marker([start.lat, start.lon], {
      icon: icon(`<div class="markerDiff"><div><div class="polylineMarket-number">${index + 1}</div></div></div>`),
      data: row,
    } as L.MarkerOptions).bindPopup(html, { closeButton: false, maxWidth: 500 })
    marker.on("click", () => marker.openPopup())
    cluster.addLayer(marker)
  })
  cluster.on("clusterclick", (event: L.LeafletEvent) => {
    const layer = (event as unknown as { layer: L.MarkerCluster }).layer
    const markers = layer.getAllChildMarkers() as Marker[]
    clusterPopup(
      map,
      (event as unknown as { latlng: L.LatLng }).latlng,
      markers.map((marker) => {
        const row = marker.options.data as Actual
        const start = row.task.service_time?.start_location
        const offset = firstGap(row.item)
        const detail = `<div style="margin-top: -5px; display: flex; flex-direction: row;"><p style="font-weight: 500; margin-right: 5px;">${t("Разница")}: <span style="color: ${gap(offset)};">${offset} ${t("м.")}</span></p><p style="font-weight: 500">${t("Синхронизировано")}: <span style="${CHIP_STYLE}">${hhmm(row.item.plans[0]?.done_time)}</span></p></div><div><h2>${esc(row.item.market.name)}</h2><p style="${NOTE_STYLE}">${esc(row.item.market.guide ?? "")}</p><p style="font-weight: 500;">${t("Адрес")}: ${esc(row.item.market.address ?? "")}</p>${row.item.market.location ? coordRow(t("Клиент"), row.item.market.location.lat, row.item.market.location.lon, t) : ""}${start ? coordRow(t("Фактический"), start.lat, start.lon, t) : ""}</div><ul>${taskLines(row.item.plans, t)}</ul>`
        const time = row.item.plans[0]?.done_time
        return { label: `<b>${row.item.market.id}:</b> ${time ? hhmm(time) : t("Надо посетить")}`, detail }
      }),
    )
  })
  return [cluster]
}

// ----------------------------------------------------------------------------------------------------------------------------

/** The layers of the day for the current legend and time window; the caller adds them to the map and removes them on the next call. */
export function buildDayLayers(map: L.Map, day: AgentDay, legend: LegendState, filter: TimeFilter, t: T): L.Layer[] {
  const layers: L.Layer[] = []
  const track = filterTrack(day.track, filter)
  // The order of the reference: the tracker, the visited clients, the ones to visit, the actual visit places. (The reference's start / finish flags
  // of the route are removed by its own code right after they are drawn, so they never show.)
  if (legend.tracker && track.length) layers.push(...trackLayer(map, track, t))
  if (legend.visit) layers.push(...visitLayer(map, day.plans, t, false), ...visitLayer(map, day.plans, t, true))
  if (legend.actual) layers.push(...actualLayer(map, day.plans, t))
  return layers
}
