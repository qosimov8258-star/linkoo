"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"

import { useDirectoryNames } from "@/components/clients/use-directory"
import { FilterSelect } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import type { ClientZone } from "./tracking-data"

type ZoneAgentsState = { agents: { id: number; name: string }[]; bindings: Record<number, number[]>; unbound: number }
type BulkDialog = "bind-agent" | "unbind-agent" | "bind-branch"

const DIALOG_TITLE: Record<BulkDialog, string> = { "bind-agent": "Привязать агента", "unbind-agent": "Отвязать агента", "bind-branch": "Привязать филиал" }

/** The zones in tree order (a sub-zone right under its parent) with their depth, like Linko's list. */
function zoneTree(zones: ClientZone[]): { zone: ClientZone; depth: number }[] {
  const ids = new Set(zones.map((zone) => zone.id))
  const children = new Map<number, ClientZone[]>()
  for (const zone of zones) if (zone.parentId !== null && ids.has(zone.parentId)) children.set(zone.parentId, [...(children.get(zone.parentId) ?? []), zone])
  const out: { zone: ClientZone; depth: number }[] = []
  const seen = new Set<number>()
  const walk = (zone: ClientZone, depth: number) => {
    if (seen.has(zone.id)) return
    seen.add(zone.id)
    out.push({ zone, depth })
    for (const child of children.get(zone.id) ?? []) walk(child, depth + 1)
  }
  for (const zone of zones) if (zone.parentId === null || !ids.has(zone.parentId)) walk(zone, 0)
  for (const zone of zones) walk(zone, 0)
  return out
}

/** Right-hand "Управлять территориями" drawer, as Linko's zone info panel: counts, the agent / branch bulk actions on
 * the checked zones, the «Ответственный персонал» filter, the zone tree and the unassigned clients / agents. */
export function TerritoryPanel({
  zones,
  loading,
  unassigned,
  onClose,
  onShow,
  onEdit,
  onDelete,
  onChanged,
}: {
  zones: ClientZone[]
  loading: boolean
  /** Clients without a zone. */
  unassigned: number
  onClose: () => void
  onShow: (zone: ClientZone) => void
  onEdit: (zone: ClientZone) => void
  onDelete: (zone: ClientZone) => void
  /** A zone's branch changed: reload the zones. */
  onChanged: () => void
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [staff, setStaff] = useState("")
  const [menu, setMenu] = useState<number | null>(null)
  const [checked, setChecked] = useState<number[]>([])
  const [state, setState] = useState<ZoneAgentsState>({ agents: [], bindings: {}, unbound: 0 })
  const [dialog, setDialog] = useState<BulkDialog | null>(null)

  const loadState = useCallback(() => {
    fetch("/api/clients/zones/agents")
      .then((response) => (response.ok ? (response.json() as Promise<ZoneAgentsState>) : null))
      .then((data) => data && setState(data))
      .catch(() => {})
  }, [])
  useEffect(loadState, [loadState])

  const staffId = state.agents.find((agent) => agent.name === staff)?.id
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return zoneTree(zones).filter(({ zone }) => {
      if (needle && !zone.name.toLowerCase().includes(needle)) return false
      if (staffId !== undefined && !(state.bindings[zone.id] ?? []).includes(staffId)) return false
      return true
    })
  }, [zones, query, staffId, state.bindings])
  const clientsInZones = zones.reduce((sum, zone) => sum + zone.clients, 0)

  useEffect(() => {
    if (menu === null) return
    const close = () => setMenu(null)
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [menu])

  const toggle = (id: number) => setChecked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  const button = "h-[38px] rounded-[3px] bg-[#1E4A9A] text-[13px] font-semibold text-white shadow-[0_1px_4px_rgba(0,0,0,0.2)] hover:brightness-110"

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-[600] flex w-[470px] max-w-full flex-col bg-white shadow-[0_0_10px_rgba(0,0,0,0.25)]">
      <div className="flex h-[88px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[40px]">
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
      <div className="mt-[14px] flex items-end gap-[20px] px-[30px]">
        <span className="pb-[12px] text-[13px] font-semibold text-[#555]">{t("Зоны")}</span>
        <FilterSelect className="w-[205px]" compact label={t("Ответственный персонал")} value={staff} onChange={setStaff} options={state.agents.map((agent) => agent.name)} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="mb-[2px] h-[34px] min-w-0 flex-1 border-b border-[#e0e0e0] text-[13px] font-semibold outline-none placeholder:text-black" />
      </div>
      <div className="mt-[16px] grid shrink-0 grid-cols-2 gap-[10px] border-b border-dotted border-[#ccc] px-[30px] pb-[14px]">
        <button type="button" className={button} onClick={() => setDialog("bind-agent")}>{t("Привязать агента")}</button>
        <button type="button" className={button} onClick={() => setDialog("unbind-agent")}>{t("Отвязать агента")}</button>
        <button type="button" className={`${button} col-span-2`} onClick={() => setDialog("bind-branch")}>{t("Привязать филиал")}</button>
      </div>
      <div className="flex h-[50px] shrink-0 items-center justify-between border-b border-dotted border-[#ccc] pl-[43px] pr-[30px] text-[13px] font-bold">
        <span>{t("Наименование зоны")}</span>
        <span className="pr-[18px]">{t("Клиенты")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !zones.length ? (
          <p className="px-[43px] py-6 text-[13px] text-[#777]">{t("Загрузка...")}</p>
        ) : !zones.length ? (
          <p className="px-[43px] py-6 text-[13px] text-[#777]">{t("Зон пока нет. Добавьте зону кнопкой «Добавить» или укажите зону в карточке клиента")}</p>
        ) : !shown.length ? (
          <p className="px-[43px] py-6 text-[13px] text-[#777]">{t("Зоны не найдены")}</p>
        ) : (
          shown.map(({ zone, depth }) => (
            <div key={zone.id} className="relative flex min-h-[50px] items-center border-b border-dotted border-[#ddd] pr-[20px] text-[13px]" style={{ paddingLeft: 12 + depth * 15 }}>
              <input type="checkbox" checked={checked.includes(zone.id)} onChange={() => toggle(zone.id)} aria-label={zone.name} className="mr-[14px] h-4 w-4 shrink-0 accent-[#1E4A9A]" />
              {depth > 0 && <span className="mr-[10px] text-[18px] leading-none text-[#555]" aria-hidden>↳</span>}
              <button type="button" onClick={() => onShow(zone)} className="min-w-0 flex-1 py-[6px] text-left leading-[17px] hover:text-[#1E4A9A]" title={zone.parent ? `${zone.parent} / ${zone.name}` : zone.name}>
                <span className="block truncate">{zone.name}</span>
                {zone.branch ? <span className="block truncate text-[#1E4A9A]">{zone.branch}</span> : null}
              </button>
              <span className="w-[50px] text-right">{zone.clients}</span>
              <button
                type="button"
                aria-label={t("Действия")}
                onClick={(event) => {
                  event.stopPropagation()
                  setMenu((current) => (current === zone.id ? null : zone.id))
                }}
                className="ml-[20px] flex h-6 w-6 items-center justify-center"
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
          <span className={`text-[34px] font-light leading-none ${state.unbound ? "text-[#ef5350]" : "text-[#27ae60]"}`}>{state.unbound}</span>
          <span className="text-[11px] leading-[14px] text-[#4f9bdc]">{t("агентов не")}<br />{t("распределено")}</span>
        </div>
      </div>
      {dialog && (
        <ZoneBulkDialog
          kind={dialog}
          zoneIds={checked}
          agents={state.agents}
          onClose={() => setDialog(null)}
          onSaved={(next) => {
            setDialog(null)
            if (next) setState(next)
            else loadState()
            if (dialog === "bind-branch") onChanged()
          }}
        />
      )}
    </aside>
  )
}

function ZoneBulkDialog({
  kind,
  zoneIds,
  agents,
  onClose,
  onSaved,
}: {
  kind: BulkDialog
  zoneIds: number[]
  agents: { id: number; name: string }[]
  onClose: () => void
  onSaved: (state: ZoneAgentsState | null) => void
}) {
  const { t } = useLanguage()
  const branches = useDirectoryNames("branches")
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const isBranch = kind === "bind-branch"

  async function save() {
    if (!zoneIds.length) return setError(t("Выберите зоны в списке"))
    const agentId = agents.find((agent) => agent.name === value)?.id
    if (isBranch ? !value : !agentId) return setError(t("Это поле обязательно к заполнению"))
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/clients/zones/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isBranch ? { action: kind, zoneIds, branch: value } : { action: kind, zoneIds, agentId }),
      })
      const body = (await response.json().catch(() => null)) as (ZoneAgentsState & { error?: string }) | null
      if (!response.ok) return setError(t(body?.error ?? "Не удалось сохранить"))
      onSaved(body)
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t(DIALOG_TITLE[kind])} className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="w-[500px] max-w-full bg-white text-[13px] shadow-[0_5px_20px_rgba(0,0,0,0.3)]">
        <div className="flex h-[60px] items-center justify-between border-b border-[#e8e8e8] px-[30px]">
          <h2 className="font-bold uppercase">{t(DIALOG_TITLE[kind])}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-6 w-6 text-[#555]" /></button>
        </div>
        <div className="px-[30px] pb-[24px] pt-[24px]">
          <FilterSelect label={t(isBranch ? "Филиал" : "Агент")} value={value} onChange={setValue} options={isBranch ? branches : agents.map((agent) => agent.name)} />
          {!isBranch && (
            <p className="mt-[24px] text-[#e53935]">
              {t("При изменении агентов зоны агенты которые видят клиенты в своих зонах должны будут выйти с программы и заново синхронизироваться для корректного отображения списка клиентов")}
            </p>
          )}
          {error && <p role="alert" className="mt-[12px] text-[#e53935]">{error}</p>}
        </div>
        <div className="flex justify-end border-t border-[#e8e8e8] px-[10px] py-[10px]">
          <button type="button" disabled={saving} onClick={() => void save()} className="h-[36px] rounded-[3px] bg-[#71ce87] px-[16px] font-semibold uppercase text-white hover:brightness-95 disabled:opacity-60">
            {t("Сохранить")}
          </button>
        </div>
      </div>
    </div>
  )
}
