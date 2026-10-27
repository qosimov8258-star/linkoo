"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

import { MAP_COLORS } from "./agents-tracking-data"

// Leaflet map of Отслеживание (agents): the agent pills (list and detail), and in the detail the
// day's clients, the visit track, the actual check-ins, the GPS track and the planned route;
// zones in both. Every name / address is data: markers and popups are built from DOM text nodes
// (never HTML strings of data), so names with markup stay text.

export type LatLng = [number, number]

export type MapAgentPin = { employeeId: number; name: string; color: string; lat: number; lng: number; time: string }

export type MapClientState = "todo" | "done" | "refusal" | "unplanned" | "other"

export type MapDayClient = {
  key: string
  seq: number
  clientId: number | null
  name: string
  address: string
  lat: number
  lng: number
  state: MapClientState
  syncedAt: string
  distance: string
  actualLat: number | null
  actualLng: number | null
  lines: string[]
}

export type MapPoint = { lat: number; lng: number; label: string }

export type MapZoneShape = { id: number; name: string; ring: LatLng[] }

export type MapLabels = {
  synced: string
  client: string
  distance: string
  actual: string
  address: string
  showOnMap: string
  showClient: string
}

type AgentsMapProps = {
  agents: MapAgentPin[]
  onAgentClick: (employeeId: number) => void
  clients: MapDayClient[]
  /** Visit closing points in time order ("Факт. маршрут(визит)"). */
  visitClose: MapPoint[]
  /** Actual check-in positions ("Факт. визит"). */
  actualVisits: MapPoint[]
  /** GPS track (already limited to the time window). */
  track: Array<{ lat: number; lng: number; at: string }>
  /** Planned clients in route order ("Показать маршрут"); null = hidden. */
  planRoute: LatLng[] | null
  zones: MapZoneShape[]
  layers: { markets: boolean; zones: boolean; visitTrack: boolean; actualVisits: boolean; polyline: boolean }
  /** Fits the map to the shown data whenever it changes. */
  fitKey: string
  labels: MapLabels
  onClientOpen: (clientId: number) => void
}

const DEFAULT_CENTER: LatLng = [41.31, 69.27]

function element(tag: string, style: Partial<CSSStyleDeclaration> = {}, text?: string): HTMLElement {
  const node = document.createElement(tag)
  Object.assign(node.style, style)
  if (text !== undefined) node.textContent = text
  return node
}

/** Tooltip content as a text node (a string would be set as HTML by Leaflet). */
const text = (value: string) => element("span", {}, value)

function agentIcon(agent: MapAgentPin): L.DivIcon {
  const wrap = element("div", { display: "flex", flexDirection: "column", alignItems: "center", transform: "translate(-50%, -100%)", whiteSpace: "nowrap", cursor: "pointer" })
  const pill = element("div", { borderRadius: "20px", padding: "5px", width: "max-content", background: agent.color, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,.35)" })
  pill.appendChild(element("div", { color: "#fff", fontSize: "10px", fontWeight: "500", textTransform: "uppercase", padding: "0 4px" }, agent.name))
  pill.appendChild(element("div", { background: "#ff0000", color: "#fff", fontSize: "10px", borderRadius: "8px", padding: "0 5px", marginTop: "2px", display: "inline-block" }, agent.time || "—"))
  wrap.appendChild(pill)
  return L.divIcon({ html: wrap, className: "tracking-agent-pill", iconSize: [0, 0], iconAnchor: [0, 0] })
}

const STATE_COLOR: Record<MapClientState, string> = {
  todo: MAP_COLORS.planned,
  done: MAP_COLORS.visitClose,
  refusal: MAP_COLORS.refusal,
  unplanned: MAP_COLORS.unplanned,
  other: "#5d6474",
}

function pinIcon(color: string, label: string, size = 30): L.DivIcon {
  const pin = element("div", {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: `${size}px`,
    height: `${size}px`,
    border: "2px solid #fff",
    borderRadius: "50% 50% 50% 0",
    background: color,
    boxShadow: "0 2px 6px rgba(0,0,0,.35)",
    transform: "rotate(-45deg)",
  })
  pin.appendChild(element("span", { color: "#fff", fontSize: size > 24 ? "12px" : "10px", fontWeight: "700", transform: "rotate(45deg)" }, label))
  return L.divIcon({ html: pin, className: "tracking-pin", iconSize: [size, size], iconAnchor: [size / 2, size] })
}

const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`

function popupOf(client: MapDayClient, labels: MapLabels, onOpen: (id: number) => void): HTMLElement {
  const root = element("div", { fontSize: "12px", minWidth: "220px", maxWidth: "300px" })
  root.appendChild(element("h2", { fontSize: "15px", fontWeight: "700", margin: "0 0 6px" }, client.name))
  const line = (label: string, value: string, link?: string) => {
    if (!value) return
    const row = element("div", { margin: "2px 0" })
    row.appendChild(element("b", {}, `${label} `))
    row.appendChild(document.createTextNode(value))
    if (link) {
      const anchor = element("a", { color: "#4f71dc", marginLeft: "6px" }, labels.showOnMap) as HTMLAnchorElement
      anchor.href = link
      anchor.target = "_blank"
      anchor.rel = "noopener noreferrer"
      row.appendChild(anchor)
    }
    root.appendChild(row)
  }
  line(labels.synced, client.syncedAt)
  line(labels.client, `${client.lat.toFixed(6)}, ${client.lng.toFixed(6)}`, mapsLink(client.lat, client.lng))
  line(labels.distance, client.distance)
  if (client.actualLat !== null && client.actualLng !== null) {
    line(labels.actual, `${client.actualLat.toFixed(6)}, ${client.actualLng.toFixed(6)}`, mapsLink(client.actualLat, client.actualLng))
  }
  line(labels.address, client.address)
  if (client.lines.length) {
    const list = element("ul", { margin: "6px 0", paddingLeft: "0", listStyle: "none" })
    for (const text of client.lines) list.appendChild(element("li", { margin: "2px 0" }, `— ${text}`))
    root.appendChild(list)
  }
  if (client.clientId !== null) {
    const id = client.clientId
    const button = element("button", { color: "#4f71dc", fontWeight: "600", background: "none", border: "0", padding: "0", cursor: "pointer" }, labels.showClient)
    button.addEventListener("click", () => onOpen(id))
    root.appendChild(button)
  }
  return root
}

export function AgentsMap({ agents, onAgentClick, clients, visitClose, actualVisits, track, planRoute, zones, layers, fitKey, labels, onClientOpen }: AgentsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const groups = useRef<Record<"agents" | "markets" | "zones" | "visitTrack" | "actualVisits" | "polyline" | "plan", L.LayerGroup> | null>(null)
  const agentClickRef = useRef(onAgentClick)
  const clientOpenRef = useRef(onClientOpen)
  useEffect(() => {
    agentClickRef.current = onAgentClick
    clientOpenRef.current = onClientOpen
  }, [onAgentClick, onClientOpen])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { center: DEFAULT_CENTER, zoom: 12, zoomControl: false, attributionControl: false, preferCanvas: true })
    mapRef.current = map
    L.control.zoom({ position: "topleft" }).addTo(map)
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map)
    groups.current = {
      zones: L.layerGroup(),
      plan: L.layerGroup().addTo(map),
      polyline: L.layerGroup(),
      visitTrack: L.layerGroup(),
      actualVisits: L.layerGroup(),
      markets: L.layerGroup(),
      agents: L.layerGroup().addTo(map),
    }
    return () => {
      map.remove()
      mapRef.current = null
      groups.current = null
    }
  }, [])

  // Agent pills.
  useEffect(() => {
    const layer = groups.current?.agents
    if (!layer) return
    layer.clearLayers()
    for (const agent of agents) {
      L.marker([agent.lat, agent.lng], { icon: agentIcon(agent), zIndexOffset: 1000 })
        .on("click", () => agentClickRef.current(agent.employeeId))
        .addTo(layer)
    }
  }, [agents])

  // The day's clients ("Клиенты").
  useEffect(() => {
    const layer = groups.current?.markets
    if (!layer) return
    layer.clearLayers()
    for (const client of clients) {
      L.marker([client.lat, client.lng], { icon: pinIcon(STATE_COLOR[client.state], String(client.seq)) })
        .bindPopup(() => popupOf(client, labels, (id) => clientOpenRef.current(id)), { maxWidth: 320 })
        .addTo(layer)
    }
  }, [clients, labels])

  // "Факт. маршрут(визит)": planned clients (green) and the visit closing points (dark blue).
  useEffect(() => {
    const layer = groups.current?.visitTrack
    if (!layer) return
    layer.clearLayers()
    for (const client of clients) {
      if (client.state !== "todo") continue
      L.circleMarker([client.lat, client.lng], { radius: 6, color: "#fff", weight: 2, fillColor: MAP_COLORS.planned, fillOpacity: 1 }).addTo(layer)
    }
    if (visitClose.length > 1) {
      L.polyline(
        visitClose.map((point) => [point.lat, point.lng] as LatLng),
        { color: MAP_COLORS.visitClose, weight: 3, opacity: 0.8 },
      ).addTo(layer)
    }
    visitClose.forEach((point, index) => {
      const edge = index === 0 || index === visitClose.length - 1
      L.circleMarker([point.lat, point.lng], { radius: edge ? 8 : 5, color: "#fff", weight: 2, fillColor: MAP_COLORS.visitClose, fillOpacity: 1 })
        .bindTooltip(text(point.label))
        .addTo(layer)
    })
  }, [clients, visitClose])

  // "Факт. визит": where the check-ins really happened (grey).
  useEffect(() => {
    const layer = groups.current?.actualVisits
    if (!layer) return
    layer.clearLayers()
    for (const point of actualVisits) {
      L.circleMarker([point.lat, point.lng], { radius: 6, color: "#fff", weight: 2, fillColor: MAP_COLORS.actual, fillOpacity: 1 })
        .bindTooltip(text(point.label))
        .addTo(layer)
    }
  }, [actualVisits])

  // "Фактический маршрут (трекер)": the GPS track.
  useEffect(() => {
    const layer = groups.current?.polyline
    if (!layer) return
    layer.clearLayers()
    if (!track.length) return
    const line = track.map((point) => [point.lat, point.lng] as LatLng)
    if (line.length > 1) L.polyline(line, { color: MAP_COLORS.trackerLine, weight: 3, dashArray: "5, 10" }).addTo(layer)
    track.forEach((point, index) => {
      if (index === 0 || index === track.length - 1) return
      L.circleMarker([point.lat, point.lng], { radius: 3, color: MAP_COLORS.tracker, weight: 1, fillColor: MAP_COLORS.tracker, fillOpacity: 0.8 })
        .bindTooltip(text(point.at.slice(11, 16)))
        .addTo(layer)
    })
    const start = track[0]
    const end = track[track.length - 1]
    L.marker([start.lat, start.lng], { icon: pinIcon(MAP_COLORS.tracker, "1", 26) }).bindTooltip(text(start.at.slice(11, 16))).addTo(layer)
    if (track.length > 1) L.marker([end.lat, end.lng], { icon: pinIcon(MAP_COLORS.tracker, String(track.length), 26) }).bindTooltip(text(end.at.slice(11, 16))).addTo(layer)
  }, [track])

  // "Показать маршрут": straight segments through the planned clients in route order.
  useEffect(() => {
    const layer = groups.current?.plan
    if (!layer) return
    layer.clearLayers()
    if (!planRoute || planRoute.length < 2) return
    L.polyline(planRoute, { color: MAP_COLORS.planRoute, weight: 8, opacity: 0.9 }).addTo(layer)
    L.polyline(planRoute, { color: "#fff", weight: 6, opacity: 0.5 }).addTo(layer)
  }, [planRoute])

  // "Зоны"
  useEffect(() => {
    const layer = groups.current?.zones
    if (!layer) return
    layer.clearLayers()
    for (const zone of zones) {
      L.polygon(zone.ring, { color: "#3388ff", weight: 3, fillColor: "#3388ff", fillOpacity: 0.2 })
        .bindTooltip(text(zone.name), { permanent: true, direction: "center" })
        .addTo(layer)
    }
  }, [zones])

  useEffect(() => {
    const map = mapRef.current
    const all = groups.current
    if (!map || !all) return
    sync(map, all.markets, layers.markets)
    sync(map, all.zones, layers.zones)
    sync(map, all.visitTrack, layers.visitTrack)
    sync(map, all.actualVisits, layers.actualVisits)
    sync(map, all.polyline, layers.polyline)
  }, [layers.markets, layers.zones, layers.visitTrack, layers.actualVisits, layers.polyline])

  // Fit to the shown data when the view changes (agent, date, mode).
  const lastFit = useRef("")
  useEffect(() => {
    const map = mapRef.current
    if (!map || lastFit.current === fitKey) return
    const points: LatLng[] = [
      ...agents.map((agent) => [agent.lat, agent.lng] as LatLng),
      ...clients.map((client) => [client.lat, client.lng] as LatLng),
      ...(layers.polyline ? track.map((point) => [point.lat, point.lng] as LatLng) : []),
      ...visitClose.map((point) => [point.lat, point.lng] as LatLng),
    ]
    if (!points.length) return
    lastFit.current = fitKey
    if (points.length === 1) map.setView(points[0], 15)
    else map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 16 })
  }, [fitKey, agents, clients, track, visitClose, layers.polyline])

  return <div ref={containerRef} className="relative z-0 h-full w-full" />
}

function sync(map: L.Map, layer: L.LayerGroup, visible: boolean) {
  if (visible && !map.hasLayer(layer)) layer.addTo(map)
  else if (!visible && map.hasLayer(layer)) map.removeLayer(layer)
}
