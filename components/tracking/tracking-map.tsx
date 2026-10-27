"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { mapClients, type Agent, type AgentCategory } from "./tracking-data"
import { isoDay, useWayAgents } from "./use-way-agents"
import { DEFAULT_LEGEND, EMPTY_TIME_FILTER, type AgentDay, type LegendState, type TimeFilter } from "./agent-day"
import { buildDayLayers } from "./tracking-day-layers"
import zonePolygons from "./zone-polygons.json"
import { useLanguage } from "@/lib/i18n/language-context"

type TrackingMapProps = {
  showAgents: boolean
  showClients: boolean
  showZones: boolean
  /** Leaflet zoom +/- buttons; the reference territory map has none. */
  zoomControl?: boolean
  /** Opening viewport; defaults to the whole-city view of the tracking page. */
  initialView?: { center: [number, number]; zoom: number }
  /** Zones drawn on the territory page, shown next to the reference zones. */
  extraZones?: { id: number; title: string; ring: [number, number][] }[]
  /** Plain OpenStreetMap colours (the agents map of the reference); the territory map is toned down. */
  plain?: boolean
  /** Show only this agent's marker (the agent card is open). */
  onlyAgent?: number | null
  /** Panel tab whose agents are on the map. */
  tab?: "agents" | AgentCategory
  /** The applied search of the agents panel: only the agents whose name contains it are on the map. */
  search?: string
  /** The day of the open agent card: what its legend checkboxes and time window put on the map. */
  day?: AgentDay | null
  legend?: LegendState
  timeFilter?: TimeFilter
  /** A place to show (the number or the distance of a client was clicked): the map goes there at street level. */
  focus?: { lat: number; lon: number; n: number } | null
  /** Changes whenever the reference re-creates its map (another day, a legend checkbox): the view returns to the agent. */
  recenterKey?: string
  /** Zone drawing: every map click adds a vertex of `draftRing` (shown as the polygon in progress). */
  drawing?: boolean
  draftRing?: [number, number][]
  onAddPoint?: (point: [number, number]) => void
}

export function TrackingMap({ showAgents, showClients, showZones, zoomControl = true, plain = false, onlyAgent = null, tab = "agents", search = "", initialView, extraZones = [], drawing = false, draftRing = [], onAddPoint, focus = null, day = null, legend = DEFAULT_LEGEND, timeFilter = EMPTY_TIME_FILTER, recenterKey = "" }: TrackingMapProps) {
  const { t, language } = useLanguage()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const agentLayerRef = useRef<L.LayerGroup | null>(null)
  const clientLayerRef = useRef<L.LayerGroup | null>(null)
  const zoneLayerRef = useRef<L.LayerGroup | null>(null)
  const extraLayerRef = useRef<L.LayerGroup | null>(null)
  const draftLayerRef = useRef<L.LayerGroup | null>(null)
  const dayLayersRef = useRef<L.Layer[]>([])
  const addPointRef = useRef(onAddPoint)
  const { agents: wayAgents } = useWayAgents(tab, isoDay(new Date()), language)
  useEffect(() => {
    addPointRef.current = onAddPoint
  })

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: initialView?.center ?? [41.31, 69.27],
      zoom: initialView?.zoom ?? 12,
      zoomControl: false,
      attributionControl: false,
    })
    mapRef.current = map

    if (zoomControl) L.control.zoom({ position: "topleft" }).addTo(map)

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map)

    const clientMarkers = mapClients.map((client) => {
      const isActive = client.status === "active"
      const color = isActive ? "#27ae60" : "#f2994a"
      const status = isActive ? t("Активный клиент") : t("Требует внимания")
      const html = `
        <div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border:3px solid #fff;border-radius:50% 50% 50% 0;background:${color};box-shadow:0 2px 7px rgba(0,0,0,.35);transform:rotate(-45deg);">
          <span style="color:#fff;font-size:13px;font-weight:800;transform:rotate(45deg);">${client.name.charAt(0)}</span>
        </div>`
      const icon = L.divIcon({
        html,
        className: "tracking-client-marker",
        iconSize: [30, 30],
        iconAnchor: [15, 30],
      })

      return L.marker(client.position, { icon }).bindPopup(
        `<strong>${client.name}</strong><br>${client.address}<br><span style="color:${color};font-weight:600">${status}</span>`,
      )
    })

    // The agents map of the reference draws every border with Leaflet's default blue style and plain tooltips.
    const zoneLayers = (zonePolygons as unknown as { id: number; name: string; ring: [number, number][] }[])
      .filter((zone) => {
        if (plain) return true
        const lats = zone.ring.map((point) => point[0])
        const lngs = zone.ring.map((point) => point[1])
        return Math.max(...lats) - Math.min(...lats) < 0.12 && Math.max(...lngs) - Math.min(...lngs) < 0.12
      })
      .map((zone) =>
        plain
          ? L.polygon(zone.ring, { color: "#3388ff", weight: 3, fillColor: "#3388ff", fillOpacity: 0.2 }).bindTooltip(zone.name, { permanent: true, direction: "center" })
          : L.polygon(zone.ring, { color: "#1b3a6b", weight: 2, fillColor: "#5aaee8", fillOpacity: 0.38 }).bindTooltip(zone.name, {
              permanent: true,
              direction: "center",
              className: "zone-label",
            }),
      )

    agentLayerRef.current = L.layerGroup([])
    clientLayerRef.current = L.layerGroup(clientMarkers)
    zoneLayerRef.current = L.layerGroup(zoneLayers)

    return () => {
      map.remove()
      mapRef.current = null
      agentLayerRef.current = null
      clientLayerRef.current = null
      zoneLayerRef.current = null
      extraLayerRef.current = null
      draftLayerRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  // Zones drawn on the page (zone_extra).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (extraLayerRef.current && map.hasLayer(extraLayerRef.current)) map.removeLayer(extraLayerRef.current)
    extraLayerRef.current = L.layerGroup(
      extraZones
        .filter((zone) => zone.ring.length >= 3)
        .map((zone) =>
          L.polygon(zone.ring, { color: "#1b3a6b", weight: 2, fillColor: "#5aaee8", fillOpacity: 0.38 }).bindTooltip(zone.title, { permanent: true, direction: "center", className: "zone-label" }),
        ),
    )
    syncLayer(map, extraLayerRef.current, showZones)
  }, [extraZones, showZones, language])

  // The zone being drawn: vertices, the line through them and, from three points on, the filled polygon.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!draftLayerRef.current) draftLayerRef.current = L.layerGroup().addTo(map)
    const layer = draftLayerRef.current
    layer.clearLayers()
    draftRing.forEach((point) => L.circleMarker(point, { radius: 5, color: "#129fdd", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(layer))
    if (draftRing.length >= 3) L.polygon(draftRing, { color: "#129fdd", weight: 2, fillColor: "#129fdd", fillOpacity: 0.25 }).addTo(layer)
    else if (draftRing.length === 2) L.polyline(draftRing, { color: "#129fdd", weight: 2 }).addTo(layer)
  }, [draftRing, language])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !drawing) return
    const container = map.getContainer()
    const previous = container.style.cursor
    container.style.cursor = "crosshair"
    const onClick = (event: L.LeafletMouseEvent) => addPointRef.current?.([Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6))])
    map.on("click", onClick)
    return () => {
      map.off("click", onClick)
      container.style.cursor = previous
    }
  }, [drawing, language])

  useEffect(() => {
    if (focus) mapRef.current?.setView([focus.lat, focus.lon], 18, { animate: false })
  }, [focus])

  // The day of the open agent card: tracker track, visits, actual visit places.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    dayLayersRef.current.forEach((layer) => map.removeLayer(layer))
    dayLayersRef.current = []
    if (onlyAgent === null || !day) return
    map.closePopup()
    dayLayersRef.current = buildDayLayers(map, day, legend, timeFilter, t)
    dayLayersRef.current.forEach((layer) => layer.addTo(map))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, legend, timeFilter, onlyAgent, language])

  // The agents of the day (last known positions) — the same list as the panel on the right.
  const needle = search.trim().toLowerCase()
  const visibleAgents = needle ? wayAgents.filter((agent) => agent.name.toLowerCase().includes(needle)) : wayAgents
  const wayKey = visibleAgents.map((agent) => `${agent.id}:${agent.position?.join(",") ?? ""}`).join("|") + `#${onlyAgent}#${tab}#${recenterKey}#${needle}`
  useEffect(() => {
    const map = mapRef.current
    const layer = agentLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    // The reference adds the markers in the order of the agents' ids.
    visibleAgents
      .filter((agent) => agent.position && (onlyAgent === null || agent.id === onlyAgent))
      .sort((a, b) => a.id - b.id)
      .forEach((agent) => layer.addLayer(agentMarker(agent)))
    syncLayer(map, layer, showAgents)
    // The agent card centres the map on its agent.
    const chosen = onlyAgent === null ? undefined : wayAgents.find((agent) => agent.id === onlyAgent)
    if (chosen?.position) map.setView(chosen.position as [number, number], 11, { animate: false })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wayKey, language])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    syncLayer(map, agentLayerRef.current, showAgents)
    syncLayer(map, clientLayerRef.current, showClients)
    syncLayer(map, zoneLayerRef.current, showZones)
  }, [showAgents, showClients, showZones])

  return <div ref={containerRef} className={`relative z-0 h-full w-full ${plain ? "tracking-plain" : ""}`} />
}

// The reference's marker: a 40x40 anchor with a rounded colour box (agent name, 10px caps) and the red time badge hanging
// from its bottom edge.
function agentMarker(agent: Agent) {
  const name = agent.name.replace(/[<>&]/g, "")
  const time = agent.timestamp ? agent.timestamp.slice(-5) : ""
  const html = `<div><div style="position:relative;display:flex;align-items:center;justify-content:center;box-sizing:border-box;height:45px;width:max-content;padding:5px;border-radius:20px;background:${agent.color};opacity:.8;color:#fff;font-size:10px;font-weight:500;line-height:15px;text-transform:uppercase"><p style="margin:0">${name}</p><div style="position:absolute;bottom:-10px;left:0;right:0;margin:0 auto;width:55px;box-sizing:border-box;padding:5px 0;border-radius:10px;background:#ff0000;text-align:center">${time || "Invalid date"}</div></div></div>`
  const icon = L.divIcon({ html, className: "", iconSize: [40, 40], iconAnchor: [20, 20] })
  return L.marker(agent.position as [number, number], { icon })
}

function syncLayer(map: L.Map, layer: L.LayerGroup | null, visible: boolean) {
  if (!layer) return

  if (visible && !map.hasLayer(layer)) {
    layer.addTo(map)
  } else if (!visible && map.hasLayer(layer)) {
    map.removeLayer(layer)
  }
}
