"use client"

import { useMemo, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import zonePolygons from "./zone-polygons.json"

type Zone = { id: number; name: string; count: number }

const CHECK_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const CHECK_ON = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

/** Right-hand "Управлять территориями" drawer of the reference territory page. */
export function TerritoryPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const zones = zonePolygons as unknown as Zone[]
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<number[]>([])
  const shown = useMemo(() => zones.filter((zone) => zone.name.toLowerCase().includes(query.toLowerCase())), [zones, query])
  const clientsInZones = zones.reduce((sum, zone) => sum + zone.count, 0)

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-[600] flex w-[470px] flex-col bg-white shadow-[0_0_10px_rgba(0,0,0,0.25)]">
      <div className="flex h-[88px] shrink-0 items-center justify-between pl-[30px] pr-[40px]">
        <div className="flex items-center gap-[10px]">
          <span className="text-[28px] font-light leading-none">{zones.length}</span>
          <span className="text-[11px] leading-[14px] text-[#555]">{t("активных")}<br />{t("зон")}</span>
        </div>
        <div className="flex items-center gap-[10px]">
          <span className="text-[28px] font-light leading-none">{clientsInZones}</span>
          <span className="text-[11px] leading-[14px] text-[#555]">{t("клиентов")}<br />{t("в зонах")}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
        </button>
      </div>
      <div className="mt-[22px] flex items-end gap-[24px] px-[30px]">
        <span className="pb-[6px] text-[13px] font-semibold text-[#555]">{t("Зоны")}</span>
        <button type="button" className="relative h-[34px] w-[205px] border-b border-[#e0e0e0] text-left text-[13px] font-semibold">
          {t("Ответственный персонал")}
          <svg viewBox="0 0 10 7" className="absolute right-0 top-[14px] h-[7px] w-[10px] fill-[#888]"><path d="M0 0l5 5.5L10 0z" /></svg>
        </button>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="h-[34px] w-[110px] border-b border-[#e0e0e0] text-[13px] font-semibold outline-none placeholder:text-black" />
      </div>
      <div className="mt-[24px] flex gap-[10px] border-b border-dotted border-[#ccc] px-[44px] pb-[28px]">
        {["Привязать", "Отвязать", "Привязать"].map((label, index) => (
          <button key={index} type="button" className="h-[30px] rounded-[5px] bg-[#4f71dc] px-[16px] text-[13px] font-semibold text-white hover:brightness-95">{t(label)}</button>
        ))}
      </div>
      <div className="mt-[24px] flex h-[50px] shrink-0 items-center justify-between border-b border-dotted border-[#ccc] px-[43px] text-[13px] font-bold">
        <span>{t("Наименование зоны")}</span>
        <span className="pr-[0px]">{t("Клиенты")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((zone) => {
          const checked = picked.includes(zone.id)
          return (
            <div key={zone.id} className="flex h-[50px] items-center border-b border-dotted border-[#ddd] pl-[20px] pr-[28px] text-[13px]">
              <button type="button" onClick={() => setPicked((current) => (checked ? current.filter((id) => id !== zone.id) : [...current, zone.id]))} aria-label={zone.name} className="mr-[8px] flex h-6 w-6 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d={checked ? CHECK_ON : CHECK_EMPTY} /></svg>
              </button>
              <span className="flex-1 truncate">{zone.name}</span>
              <span className="w-[60px] text-right">{zone.count}</span>
              <svg viewBox="0 0 24 24" className="ml-[24px] h-6 w-6 fill-[#333]"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
            </div>
          )
        })}
      </div>
      <div className="flex h-[72px] shrink-0 items-center justify-between border-t border-[#efefef] px-[30px]">
        <div className="flex items-center gap-[8px]">
          <span className="text-[34px] font-light leading-none text-[#ef5350]">0</span>
          <span className="text-[11px] leading-[14px] text-[#4f9bdc]">{t("клиентов не")}<br />{t("распределено")}</span>
        </div>
        <div className="flex items-center gap-[8px]">
          <span className="text-[34px] font-light leading-none text-[#ef5350]">0</span>
          <span className="text-[11px] leading-[14px] text-[#4f9bdc]">{t("агентов не")}<br />{t("распределено")}</span>
        </div>
      </div>
    </aside>
  )
}
