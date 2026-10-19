"use client"

import { useEffect, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { mapAgents, mapClients } from "./tracking-data"
import zonePolygons from "./zone-polygons.json"
import { useLanguage } from "@/lib/i18n/language-context"

type TrackingMapProps = {
  showAgents: boolean
  showClients: boolean
  showZones: boolean
}

export function TrackingMap({ showAgents, showClients, showZones }: TrackingMapProps) {
  const { t, language } = useLanguage()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const agentLayerRef = useRef<L.LayerGroup | null>(null)
  const clientLayerRef = useRef<L.LayerGroup | null>(null)
  const zoneLayerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: [41.31, 69.27],
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
    })
    mapRef.current = map

    L.control.zoom({ position: "topleft" }).addTo(map)

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map)

    const agentMarkers = mapAgents.map((agent) => {
      const chips = (agent.chips ?? [])
        .map(
          (c) =>
            `<span style="background:#eb5757;color:#fff;border-radius:6px;padding:1px 8px;font-size:12px;font-weight:700;">${c}</span>`,
        )
        .join("")

      const html = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;transform:translateY(-50%);white-space:nowrap;">
          <div style="background:${agent.color};color:#fff;border-radius:16px;padding:5px 14px;font-size:12px;font-weight:800;letter-spacing:.3px;box-shadow:0 2px 6px rgba(0,0,0,.35);text-transform:uppercase;">
            ${agent.name}
          </div>
          <div style="display:flex;gap:4px;">${chips}</div>
        </div>`

      const icon = L.divIcon({
        html,
        className: "tracking-pill",
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      })

      return L.marker(agent.position as [number, number], { icon }).bindTooltip(agent.name)
    })

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

    agentLayerRef.current = L.layerGroup(agentMarkers)
    clientLayerRef.current = L.layerGroup(clientMarkers)
    zoneLayerRef.current = L.layerGroup(zoneLayers)

    return () => {
      map.remove()
      mapRef.current = null
      agentLayerRef.current = null
      clientLayerRef.current = null
      zoneLayerRef.current = null
    }
  }, [language])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    syncLayer(map, agentLayerRef.current, showAgents)
    syncLayer(map, clientLayerRef.current, showClients)
    syncLayer(map, zoneLayerRef.current, showZones)
  }, [showAgents, showClients, showZones])

  return <div ref={containerRef} className="relative z-0 h-full w-full" />
}

function syncLayer(map: L.Map, layer: L.LayerGroup | null, visible: boolean) {
  if (!layer) return

  if (visible && !map.hasLayer(layer)) {
    layer.addTo(map)
  } else if (!visible && map.hasLayer(layer)) {
    map.removeLayer(layer)
  }
}
