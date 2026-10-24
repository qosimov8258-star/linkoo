"use client"

import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { X } from "lucide-react"
import { useLanguage } from "@/lib/i18n/language-context"

const pinIcon = L.divIcon({
  html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:#e53935;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transform:rotate(-45deg);"></div>`,
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
    initialLat != null && initialLng != null ? { lat: initialLat, lng: initialLng } : { lat: 41.3111, lng: 69.2797 },
  )

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const start: [number, number] = point ? [point.lat, point.lng] : [41.3111, 69.2797]
    const map = L.map(containerRef.current, { center: start, zoom: point ? 15 : 11 })
    mapRef.current = map

    L.control.zoom({ position: "bottomright" }).addTo(map)
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
    <div className="fixed inset-0 z-[110] flex items-start justify-center bg-black/50 px-4 pt-[64px]">
      <div className="relative flex w-full max-w-[1000px] flex-col overflow-hidden bg-white shadow-2xl">
        <div ref={containerRef} className="h-[600px] max-h-[calc(100vh-140px)] w-full" />
        <button type="button" onClick={onCancel} aria-label={t("Закрыть")} className="absolute right-[18px] top-[16px] z-[1000] text-[#333] hover:text-black">
          <X className="h-6 w-6" />
        </button>
        <footer className="flex h-[56px] items-center justify-between bg-[#5a5a5a] px-[30px] text-[13px] font-bold text-white">
          <span>{t("Кликните по карте, чтобы обозначить локацию")}</span>
          <button type="button" onClick={() => point && onConfirm(point.lat, point.lng)} className="uppercase hover:opacity-80">
            {t("Сохранить")}
          </button>
        </footer>
      </div>
    </div>
  )
}
