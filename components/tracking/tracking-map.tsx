"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { LatLng, MapClient, MapZone } from "./tracking-data"
import { useLanguage } from "@/lib/i18n/language-context"

type TrackingMapProps = {
  showClients: boolean
  showZones: boolean
  /** The factory's clients with a location. */
  clients: MapClient[]
  /** Zone outlines (drawn, or around the zone's clients). */
  zones: MapZone[]
  /** Outline being drawn in the zone editor. */
  draft?: LatLng[] | null
  /** Map clicks while drawing (adds a point to the draft outline). */
  onMapClick?: (point: LatLng) => void
  /** Fits the map to `points` whenever `key` changes. */
  focus?: { key: number; points: LatLng[] } | null
}

const DEFAULT_CENTER: LatLng = [41.31, 69.27]

/** Names and addresses are data: never let them become markup inside Leaflet's HTML. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char)
}

export function TrackingMap({ showClients, showZones, clients, zones, draft, onMapClick, focus }: TrackingMapProps) {
  const { t } = useLanguage()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const clientLayerRef = useRef<L.LayerGroup | null>(null)
  const zoneLayerRef = useRef<L.LayerGroup | null>(null)
  const draftLayerRef = useRef<L.LayerGroup | null>(null)
  const clickRef = useRef(onMapClick)
  const fittedRef = useRef(false)

  useEffect(() => {
    clickRef.current = onMapClick
    const container = containerRef.current
    if (container) container.style.cursor = onMapClick ? "crosshair" : ""
  }, [onMapClick])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
    })
    mapRef.current = map

    L.control.zoom({ position: "topleft" }).addTo(map)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map)
    map.on("click", (event: L.LeafletMouseEvent) => clickRef.current?.([Number(event.latlng.lat.toFixed(6)), Number(event.latlng.lng.toFixed(6))]))

    clientLayerRef.current = L.layerGroup()
    zoneLayerRef.current = L.layerGroup()
    draftLayerRef.current = L.layerGroup().addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
      clientLayerRef.current = null
      zoneLayerRef.current = null
      draftLayerRef.current = null
      fittedRef.current = false
    }
  }, [])

  // Client markers (colored by zone).
  useEffect(() => {
    const layer = clientLayerRef.current
    if (!layer) return
    layer.clearLayers()
    for (const client of clients) {
      const status = client.problem ? t("Требует внимания") : t("Активный клиент")
      const html = `
        <div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border:3px solid ${client.problem ? "#f2994a" : "#fff"};border-radius:50% 50% 50% 0;background:${client.color};box-shadow:0 2px 7px rgba(0,0,0,.35);transform:rotate(-45deg);">
          <span style="color:#fff;font-size:13px;font-weight:800;transform:rotate(45deg);">${escapeHtml(client.name.charAt(0).toUpperCase())}</span>
        </div>`
      const icon = L.divIcon({ html, className: "tracking-client-marker", iconSize: [30, 30], iconAnchor: [15, 30] })
      const lines = [
        `<strong>${escapeHtml(client.name)}</strong>`,
        client.address ? escapeHtml(client.address) : "",
        `${escapeHtml(t("Зона"))}: ${escapeHtml(client.zone || t("Не указано"))}`,
        `<span style="color:${client.problem ? "#f2994a" : "#27ae60"};font-weight:600">${escapeHtml(status)}</span>`,
      ].filter(Boolean)
      L.marker(client.position, { icon }).bindPopup(lines.join("<br>")).addTo(layer)
    }
  }, [clients, t])

  // Zone outlines: drawn ones solid, the ones around the clients dashed.
  useEffect(() => {
    const layer = zoneLayerRef.current
    if (!layer) return
    layer.clearLayers()
    for (const zone of zones) {
      L.polygon(zone.ring, {
        color: zone.color,
        weight: 2,
        dashArray: zone.derived ? "6 6" : undefined,
        fillColor: zone.color,
        fillOpacity: zone.derived ? 0.12 : 0.25,
      })
        .bindTooltip(escapeHtml(zone.name), { permanent: true, direction: "center", className: "zone-label" })
        .addTo(layer)
    }
  }, [zones])

  // The outline being drawn.
  useEffect(() => {
    const layer = draftLayerRef.current
    if (!layer) return
    layer.clearLayers()
    if (!draft?.length) return
    const style = { color: "#e53935", weight: 2, fillColor: "#e53935", fillOpacity: 0.15 }
    if (draft.length >= 3) L.polygon(draft, style).addTo(layer)
    else if (draft.length === 2) L.polyline(draft, style).addTo(layer)
    for (const point of draft) L.circleMarker(point, { radius: 4, color: "#e53935", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(layer)
  }, [draft])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    syncLayer(map, clientLayerRef.current, showClients)
    syncLayer(map, zoneLayerRef.current, showZones)
  }, [showClients, showZones])

  // First data: show all of it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || fittedRef.current) return
    const points: LatLng[] = [...clients.map((client) => client.position), ...zones.flatMap((zone) => zone.ring)]
    if (!points.length) return
    fittedRef.current = true
    fit(map, points)
  }, [clients, zones])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus?.points.length) return
    fit(map, focus.points)
  }, [focus])

  return <div ref={containerRef} className="relative z-0 h-full w-full" />
}

function fit(map: L.Map, points: LatLng[]) {
  if (points.length === 1) map.setView(points[0], 15)
  else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 })
}

function syncLayer(map: L.Map, layer: L.LayerGroup | null, visible: boolean) {
  if (!layer) return
  if (visible && !map.hasLayer(layer)) {
    layer.addTo(map)
  } else if (!visible && map.hasLayer(layer)) {
    map.removeLayer(layer)
  }
}
