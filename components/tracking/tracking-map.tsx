"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { mapClients, type Agent } from "./tracking-data"
import { isoDay, useWayAgents } from "./use-way-agents"
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
  /** Zone drawing: every map click adds a vertex of `draftRing` (shown as the polygon in progress). */
  drawing?: boolean
  draftRing?: [number, number][]
  onAddPoint?: (point: [number, number]) => void
}

export function TrackingMap({ showAgents, showClients, showZones, zoomControl = true, initialView, extraZones = [], drawing = false, draftRing = [], onAddPoint }: TrackingMapProps) {
  const { t, language } = useLanguage()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const agentLayerRef = useRef<L.LayerGroup | null>(null)
  const clientLayerRef = useRef<L.LayerGroup | null>(null)
  const zoneLayerRef = useRef<L.LayerGroup | null>(null)
  const extraLayerRef = useRef<L.LayerGroup | null>(null)
  const draftLayerRef = useRef<L.LayerGroup | null>(null)
  const addPointRef = useRef(onAddPoint)
  const { agents: wayAgents } = useWayAgents("agents", isoDay(new Date()), language)
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

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
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

    const zoneLayers = (zonePolygons as unknown as { id: number; name: string; ring: [number, number][] }[])
      .filter((zone) => {
        const lats = zone.ring.map((point) => point[0])
        const lngs = zone.ring.map((point) => point[1])
        return Math.max(...lats) - Math.min(...lats) < 0.12 && Math.max(...lngs) - Math.min(...lngs) < 0.12
      })
      .map((zone) =>
      L.polygon(zone.ring, { color: "#1b3a6b", weight: 2, fillColor: "#5aaee8", fillOpacity: 0.38 }).bindTooltip(zone.name, {
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

  // The agents of the day (last known positions) — the same list as the panel on the right.
  const wayKey = wayAgents.map((agent) => `${agent.id}:${agent.position?.join(",") ?? ""}`).join("|")
  useEffect(() => {
    const map = mapRef.current
    const layer = agentLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    wayAgents.filter((agent) => agent.position).forEach((agent) => layer.addLayer(agentMarker(agent)))
    syncLayer(map, layer, showAgents)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wayKey, language])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    syncLayer(map, agentLayerRef.current, showAgents)
    syncLayer(map, clientLayerRef.current, showClients)
    syncLayer(map, zoneLayerRef.current, showZones)
  }, [showAgents, showClients, showZones])

  return <div ref={containerRef} className="relative z-0 h-full w-full" />
}

function agentMarker(agent: Agent) {
  const chips = (agent.chips ?? [])
    .map((c) => `<span style="background:#eb5757;color:#fff;border-radius:6px;padding:1px 8px;font-size:12px;font-weight:700;">${c}</span>`)
    .join("")
  const name = agent.name.replace(/[<>&]/g, "")
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:3px;transform:translateY(-50%);white-space:nowrap;">
      <div style="background:${agent.color};color:#fff;border-radius:16px;padding:5px 14px;font-size:12px;font-weight:800;letter-spacing:.3px;box-shadow:0 2px 6px rgba(0,0,0,.35);text-transform:uppercase;">
        ${name}
      </div>
      <div style="display:flex;gap:4px;">${chips}</div>
    </div>`
  const icon = L.divIcon({ html, className: "tracking-pill", iconSize: [0, 0], iconAnchor: [0, 0] })
  return L.marker(agent.position as [number, number], { icon }).bindTooltip(name)
}

function syncLayer(map: L.Map, layer: L.LayerGroup | null, visible: boolean) {
  if (!layer) return

  if (visible && !map.hasLayer(layer)) {
    layer.addTo(map)
  } else if (!visible && map.hasLayer(layer)) {
    map.removeLayer(layer)
  }
}
