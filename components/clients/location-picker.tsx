"use client"

import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { X } from "lucide-react"
import { useLanguage } from "@/lib/i18n/language-context"

const pinIcon = L.divIcon({
  html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#4f71dc;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transform:rotate(-45deg);"></div>`,
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 18],
})

type LocationPickerProps = {
  initialLat?: number
  initialLng?: number
  onCancel: () => void
  onConfirm: (lat: number, lng: number) => void
}

// Reuses the same raw-Leaflet + OSM tiles setup as components/tracking/tracking-map.tsx,
// loaded via next/dynamic(ssr:false) by the caller since Leaflet touches `window`.
export function LocationPicker({ initialLat, initialLng, onCancel, onConfirm }: LocationPickerProps) {
  const { t } = useLanguage()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(
    initialLat != null && initialLng != null ? { lat: initialLat, lng: initialLng } : null,
  )

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const start: [number, number] = point ? [point.lat, point.lng] : [41.3111, 69.2797]
    const map = L.map(containerRef.current, { center: start, zoom: point ? 15 : 11 })
    mapRef.current = map

    L.control.zoom({ position: "topright" }).addTo(map)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map)

    if (point) markerRef.current = L.marker([point.lat, point.lng], { icon: pinIcon }).addTo(map)

    map.on("click", (event: L.LeafletMouseEvent) => {
      const { lat, lng } = event.latlng
      setPoint({ lat, lng })
      if (markerRef.current) markerRef.current.setLatLng([lat, lng])
      else markerRef.current = L.marker([lat, lng], { icon: pinIcon }).addTo(map)
    })

    // Leaflet sizes its canvas from the container's dimensions at init time;
    // the modal's mount transition can finish a frame later, so re-measure once settled.
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 80)

    return () => {
      window.clearTimeout(resizeTimer)
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b p-4">
          <b className="uppercase">{t("Отметить местоположение на карте")}</b>
          <button type="button" onClick={onCancel} aria-label={t("Закрыть")}>
            <X className="h-5 w-5" />
          </button>
        </header>
        <div ref={containerRef} className="h-[420px] w-full" />
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
          <span className="text-sm text-slate-500">
            {point ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : t("Нажмите на карту, чтобы выбрать точку")}
          </span>
          <div className="flex gap-3">
            <button type="button" onClick={onCancel} className="rounded border px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50">
              {t("Отмена")}
            </button>
            <button
              type="button"
              disabled={!point}
              onClick={() => point && onConfirm(point.lat, point.lng)}
              className="rounded bg-[#71ce87] px-5 py-2 font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("Сохранить")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
