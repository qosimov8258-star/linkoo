"use client"

import { useEffect, useMemo, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import type { ClientZone } from "./tracking-data"

/** Right-hand "Управлять территориями" drawer: the factory's own zones and their clients. */
export function TerritoryPanel({
  zones,
  loading,
  unassigned,
  unlocated,
  onClose,
  onShow,
  onEdit,
  onDelete,
}: {
  zones: ClientZone[]
  loading: boolean
  /** Clients without a zone / without a location. */
  unassigned: number
  unlocated: number
  onClose: () => void
  onShow: (zone: ClientZone) => void
  onEdit: (zone: ClientZone) => void
  onDelete: (zone: ClientZone) => void
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [menu, setMenu] = useState<number | null>(null)
  const shown = useMemo(() => zones.filter((zone) => zone.name.toLowerCase().includes(query.trim().toLowerCase())), [zones, query])
  const clientsInZones = zones.reduce((sum, zone) => sum + zone.clients, 0)

  useEffect(() => {
    if (menu === null) return
    const close = () => setMenu(null)
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [menu])

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-[600] flex w-[470px] max-w-full flex-col bg-white shadow-[0_0_10px_rgba(0,0,0,0.25)]">
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
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="ml-auto h-[34px] w-[180px] border-b border-[#e0e0e0] text-[13px] font-semibold outline-none placeholder:text-black" />
      </div>
      <div className="mt-[24px] flex h-[50px] shrink-0 items-center justify-between border-b border-dotted border-[#ccc] px-[43px] text-[13px] font-bold">
        <span>{t("Наименование зоны")}</span>
        <span className="pr-[48px]">{t("Клиенты")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !zones.length ? (
          <p className="px-[43px] py-6 text-[13px] text-[#777]">{t("Загрузка...")}</p>
        ) : !zones.length ? (
          <p className="px-[43px] py-6 text-[13px] text-[#777]">{t("Зон пока нет. Добавьте зону кнопкой «Добавить» или укажите зону в карточке клиента")}</p>
        ) : !shown.length ? (
          <p className="px-[43px] py-6 text-[13px] text-[#777]">{t("Зоны не найдены")}</p>
        ) : (
          shown.map((zone) => (
            <div key={zone.id} className="relative flex h-[50px] items-center border-b border-dotted border-[#ddd] pl-[43px] pr-[28px] text-[13px]">
              <button type="button" onClick={() => onShow(zone)} className="min-w-0 flex-1 truncate text-left hover:text-[#4f71dc]" title={zone.parent ? `${zone.parent} / ${zone.name}` : zone.name}>
                {zone.name}
                {zone.branch ? <span className="ml-2 text-[11px] text-[#999]">{zone.branch}</span> : null}
              </button>
              <span className="w-[60px] text-right">{zone.clients}</span>
              <button
                type="button"
                aria-label={t("Действия")}
                onClick={(event) => {
                  event.stopPropagation()
                  setMenu((current) => (current === zone.id ? null : zone.id))
                }}
                className="ml-[24px] flex h-6 w-6 items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
              </button>
              {menu === zone.id && (
                <div role="menu" className="absolute right-[28px] top-[42px] z-10 w-[200px] bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
                  {(
                    [
                      ["Показать на карте", () => onShow(zone)],
                      ["Изменить", () => onEdit(zone)],
                      ["Удалить", () => onDelete(zone)],
                    ] as const
                  ).map(([label, action]) => (
                    <button key={label} type="button" role="menuitem" onClick={action} className={`block w-full px-4 py-2 text-left text-[13px] hover:bg-[#f2f5f8] ${label === "Удалить" ? "text-[#e53935]" : ""}`}>
                      {t(label)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <div className="flex h-[72px] shrink-0 items-center justify-between border-t border-[#efefef] px-[30px]">
        <div className="flex items-center gap-[8px]">
          <span className={`text-[34px] font-light leading-none ${unassigned ? "text-[#ef5350]" : "text-[#27ae60]"}`}>{unassigned}</span>
          <span className="text-[11px] leading-[14px] text-[#4f9bdc]">{t("клиентов не")}<br />{t("распределено")}</span>
        </div>
        <div className="flex items-center gap-[8px]">
          <span className={`text-[34px] font-light leading-none ${unlocated ? "text-[#ef5350]" : "text-[#27ae60]"}`}>{unlocated}</span>
          <span className="w-[90px] text-[11px] leading-[14px] text-[#4f9bdc]">{t("клиентов без координат")}</span>
        </div>
      </div>
    </aside>
  )
}
