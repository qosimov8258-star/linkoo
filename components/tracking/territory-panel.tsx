"use client"

import { useEffect, useMemo, useState } from "react"

import { RI } from "@/components/ref/list-kit"
import { ConfirmDeleteDialog } from "@/components/settings/settings-list-ui"
import { useLanguage } from "@/lib/i18n/language-context"
import zonePolygons from "./zone-polygons.json"

type Zone = { id: number; name: string; count: number; sub: string; depth: number }

const CHECK_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const CHECK_ON = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const CHILD_ARROW = "M19 15l-6 6-1.42-1.42L15.17 16H4V4h2v10h9.17l-3.59-3.58L13 9l6 6z"
const CHILD_NAME_LEFT = [65, 87, 96]
const CHILD_CHECK_LEFT = [10, 28, 28]
const CHILD_ARROW_LEFT = [0, 51, 61]

type BindKind = "agent" | "unbind" | "branch"
type ZoneState = { bindings: { zoneId: number; kind: "agent" | "unbind-agent" | "branch"; value: string }[]; removed: number[] }

const BIND_DIALOGS: Record<BindKind, { title: string; field: string; save: string; warning?: string }> = {
  agent: {
    title: "Привязать агента",
    field: "Агент",
    save: "Сохранить",
    warning: "При изменении агентов зоны агенты которые видят клиенты в своих зонах должны будут выйти с программы и заново синхронизироваться для корректного отображения списка клиентов",
  },
  unbind: {
    title: "Удалить агента",
    field: "Агент для удаления",
    save: "Удалить",
    warning: "При удалении агента из зоны, клиенты больше не смогут видеть этого агента в своих зонах.",
  },
  branch: { title: "Привязать филиал", field: "Филиал", save: "Сохранить" },
}

function BindDialog({ kind, zoneIds, onSaved, onClose }: { kind: BindKind; zoneIds: number[]; onSaved: (state: ZoneState) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const config = BIND_DIALOGS[kind]
  const [options, setOptions] = useState<string[] | null>(null)
  const [value, setValue] = useState("")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!value || busy) return
    setBusy(true)
    try {
      const action = kind === "agent" ? "bind-agent" : kind === "unbind" ? "unbind-agent" : "bind-branch"
      const response = await fetch("/api/zone-bindings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, zoneIds, value }),
      })
      if (response.ok) onSaved((await response.json()) as ZoneState)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const url = kind === "branch" ? "/api/branches?sort=created" : "/api/employees"
    fetch(url)
      .then(async (response) => (response.ok ? ((await response.json()) as { name?: string; active?: boolean }[]) : []))
      .then((rows) => {
        if (cancelled) return
        setOptions(Array.isArray(rows) ? rows.filter((row) => row.active !== false).map((row) => row.name ?? "").filter(Boolean) : [])
      })
      .catch(() => !cancelled && setOptions([]))
    return () => {
      cancelled = true
    }
  }, [kind])

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={t(config.title)} onMouseDown={(event) => event.stopPropagation()} className="w-[500px] bg-white text-[13px] shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
          <b className="uppercase">{t(config.title)}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
          </button>
        </header>
        <div className={`px-[30px] pt-[50px] ${config.warning ? "pb-[41px]" : "pb-[134px]"}`}>
          <div className="relative">
            <button type="button" onClick={() => setOpen((current) => !current)} className="relative flex h-[28px] w-full items-center border-b border-[#e0e0e0] text-left text-[13px] font-semibold text-black">
              <span>{value || t(config.field)}</span>
              <svg viewBox="0 0 10 7" className={`absolute right-[0px] top-[10px] h-[7px] w-[10px] fill-[#888] ${open ? "rotate-180" : ""}`}><path d="M0 0l5 5.5L10 0z" /></svg>
            </button>
            {open && (
              <div className="absolute left-0 right-0 top-full z-10 max-h-[102px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_4px_12px_rgba(0,0,0,0.2)]">
                {options === null && <div className="px-[10px] py-[8px] text-[#999]">{t("Загрузка...")}</div>}
                {options?.map((option, index) => (
                  <button
                    key={`${option}-${index}`}
                    type="button"
                    onClick={() => {
                      setValue(option)
                      setOpen(false)
                    }}
                    className={`block w-full px-[10px] py-[8px] text-left font-semibold text-[#666] hover:bg-[#e8f1fd] ${value === option ? "bg-[#e8f1fd]" : ""}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
          </div>
          {config.warning && <p className="mt-[29px] text-[13px] leading-[16px] text-[#f00]">{t(config.warning)}</p>}
        </div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#efefef] pr-[10px]">
          <button type="button" onClick={() => void save()} disabled={!value || busy} className="h-9 rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-semibold uppercase text-white hover:brightness-95 disabled:opacity-60">
            {t(config.save)}
          </button>
        </footer>
      </section>
    </div>
  )
}

/** Right-hand "Управлять территориями" drawer of the reference territory page. */
export function TerritoryPanel({ onClose, onEdit, extraZones = [] }: { onClose: () => void; onEdit: (name: string) => void; extraZones?: { id: number; title: string; parent: string; branch: string }[] }) {
  const { t } = useLanguage()
  const allZones = zonePolygons as unknown as Zone[]
  const [state, setState] = useState<ZoneState>({ bindings: [], removed: [] })
  const [deleting, setDeleting] = useState<Zone | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/zone-bindings")
      .then((response) => (response.ok ? response.json() : null))
      .then((next: ZoneState | null) => !cancelled && next && setState(next))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  // The newest branch link of a zone replaces the branch name shown under it; removed zones are hidden.
  const zones = useMemo(() => {
    const branchOf = new Map<number, string>()
    for (const binding of state.bindings) if (binding.kind === "branch") branchOf.set(binding.zoneId, binding.value)
    const base = allZones.filter((zone) => !state.removed.includes(zone.id)).map((zone) => (branchOf.has(zone.id) ? { ...zone, sub: branchOf.get(zone.id) as string } : zone))
    // Zones drawn on the page: a child sits right under its parent (one level deeper), the others close the list.
    const drawn: Zone[] = extraZones
      .filter((zone) => !state.removed.includes(zone.id))
      .map((zone) => ({ id: zone.id, name: zone.title, count: 0, sub: branchOf.get(zone.id) ?? zone.branch, depth: 0 }))
    const parentOf = new Map(extraZones.map((zone) => [zone.id, zone.parent]))
    const out: Zone[] = []
    const put = (zone: Zone, depth: number) => {
      out.push({ ...zone, depth })
      for (const child of drawn) if (parentOf.get(child.id) === zone.name && !out.some((entry) => entry.id === child.id)) put(child, Math.min(depth + 1, 2))
    }
    for (const zone of base) put(zone, zone.depth)
    for (const zone of drawn) if (!out.some((entry) => entry.id === zone.id)) put(zone, 0)
    return out
  }, [allZones, state, extraZones])
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<number[]>([])
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const [bind, setBind] = useState<BindKind | null>(null)
  const shown = useMemo(() => zones.filter((zone) => zone.name.toLowerCase().includes(query.toLowerCase())), [zones, query])
  const clientsInZones = zones.reduce((sum, zone) => sum + zone.count, 0)

  return (
    <aside className="absolute bottom-0 right-0 top-0 z-[600] flex w-[470px] flex-col bg-white font-sans text-[13px] text-[#333] shadow-[0_0_10px_rgba(0,0,0,0.25)]">
      <div className="flex h-[89px] shrink-0 items-center border-b border-[#efefef] pl-[30px] pr-[30px]">
        <div className="flex items-start">
          <span className="text-[28px] leading-[28px]">{zones.length}</span>
          <span className="ml-[10px] text-[12px] leading-[14px]">{t("активных")}<br />{t("зон")}</span>
        </div>
        <div className="ml-[59px] flex items-start">
          <span className="text-[28px] leading-[28px]">{clientsInZones}</span>
          <span className="ml-[10px] text-[12px] leading-[14px]">{t("клиентов")}<br />{t("в зонах")}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="ml-auto flex h-12 w-12 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
        </button>
      </div>
      <div className="flex shrink-0 items-end px-[30px] pt-[27px]">
        <span className="w-[85px] pb-[12px] text-[13px] font-semibold">{t("Зоны")}</span>
        <button type="button" className="relative h-[37px] w-[205px] border-b border-[#e0e0e0] pb-[0px] text-left text-[13px] font-semibold text-black">
          {t("Ответственный персонал")}
          <svg viewBox="0 0 10 7" className="absolute right-[3px] top-[16px] h-[5px] w-[10px] fill-[#888]"><path d="M0 0l5 5.5L10 0z" /></svg>
        </button>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="ml-[10px] h-[37px] w-[98px] border-b border-[#e0e0e0] text-[13px] font-semibold text-black outline-none placeholder:text-black" />
      </div>
      <div className="shrink-0 border-b border-dotted border-[#ccc] px-[30px] pb-[14px] pt-[19px]">
        <div className="flex gap-[10px]">
          <button type="button" onClick={() => setBind("agent")} className="h-[37.5px] flex-1 rounded-[2px] bg-[#4f71dc] text-[13px] font-semibold text-white hover:brightness-95">{t("Привязать агента")}</button>
          <button type="button" onClick={() => setBind("unbind")} className="h-[37.5px] w-[195px] rounded-[2px] bg-[#4f71dc] text-[13px] font-semibold text-white hover:brightness-95">{t("Отвязать агента")}</button>
        </div>
        <button type="button" onClick={() => setBind("branch")} className="mt-[10px] h-[37.5px] w-full rounded-[2px] bg-[#4f71dc] text-[13px] font-semibold text-white hover:brightness-95">{t("Привязать филиал")}</button>
      </div>
      <div className="mt-[28px] flex h-[57px] shrink-0 items-start justify-between border-b border-dotted border-[#ddd] pl-[35px] pr-[40px] pt-[13px] text-[13px] font-bold">
        <span>{t("Наименование зоны")}</span>
        <span>{t("Клиенты")}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" onClick={() => setMenuFor(null)}>
        {shown.map((zone) => {
          const checked = picked.includes(zone.id)
          const child = zone.depth > 0
          return (
            <div key={zone.id} className="relative flex h-[50px] items-center border-b border-dotted border-[#ddd] text-[13px]">
              <button
                type="button"
                onClick={() => setPicked((current) => (checked ? current.filter((id) => id !== zone.id) : [...current, zone.id]))}
                aria-label={zone.name}
                className="absolute top-[10px] flex h-5 w-5 items-center justify-center"
                style={{ left: child ? CHILD_CHECK_LEFT[zone.depth] ?? 28 : 10 }}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d={checked ? CHECK_ON : CHECK_EMPTY} /></svg>
              </button>
              {child && (
                <svg viewBox="0 0 24 24" className="absolute top-[13px] h-6 w-6 fill-[#666]" style={{ left: CHILD_ARROW_LEFT[zone.depth] ?? 61 }}><path d={CHILD_ARROW} /></svg>
              )}
              <div className="absolute" style={{ left: child ? CHILD_NAME_LEFT[zone.depth] ?? 87 : 35 }}>
                <div className="truncate leading-[16.3px]">{zone.name}</div>
                {zone.sub && <p className="m-0 truncate leading-[16.3px] text-[#237bde]">{zone.sub}</p>}
              </div>
              <span className="absolute right-[80px] leading-[16.3px]">{zone.count}</span>
              <button
                type="button"
                aria-label={t("Действия")}
                onClick={(event) => {
                  event.stopPropagation()
                  setMenuFor((current) => (current === zone.id ? null : zone.id))
                }}
                className="absolute right-[19.5px] top-0 flex h-[45px] w-[45px] items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-[21px] fill-[#666]"><path d={RI.more} /></svg>
              </button>
              {menuFor === zone.id && (
                <div role="menu" className="absolute right-[19.5px] top-[-6px] z-20 w-[168px] bg-white py-[6px] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_4px_12px_rgba(0,0,0,0.2)]">
                  <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onEdit(zone.name) }} className="flex h-12 w-full items-center pl-[22px] text-left text-[13px] hover:bg-[#f2f5f8]">
                    <svg viewBox="0 0 24 24" className="mr-[24px] h-6 w-6 fill-[#666]"><path d={RI.edit} /></svg>
                    {t("Изменить")}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setMenuFor(null); setDeleting(zone) }} className="flex h-12 w-full items-center pl-[22px] text-left text-[13px] hover:bg-[#f2f5f8]">
                    <svg viewBox="0 0 24 24" className="mr-[24px] h-6 w-6 fill-[#666]"><path d={RI.trash} /></svg>
                    {t("Удалить")}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex h-[69px] shrink-0 items-center justify-between border-t border-[#efefef] px-[30px]">
        <div className="flex items-center gap-[8px]">
          <span className="text-[34px] font-light leading-none text-[#ef5350]">0</span>
          <span className="text-[11px] leading-[14px] text-[#4f9bdc]">{t("клиентов не")}<br />{t("распределено")}</span>
        </div>
        <div className="flex items-center gap-[8px]">
          <span className="text-[34px] font-light leading-none text-[#ef5350]">0</span>
          <span className="text-[11px] leading-[14px] text-[#4f9bdc]">{t("агентов не")}<br />{t("распределено")}</span>
        </div>
      </div>
      {bind && (
        <BindDialog
          kind={bind}
          zoneIds={(picked.length ? picked : zones.map((zone) => zone.id)).filter((id) => zones.some((zone) => zone.id === id))}
          onSaved={setState}
          onClose={() => setBind(null)}
        />
      )}
      {deleting && (
        <ConfirmDeleteDialog
          name={deleting.name}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const response = await fetch("/api/zone-bindings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "remove-zone", zoneIds: [deleting.id] }),
            })
            if (response.ok) setState((await response.json()) as ZoneState)
            setPicked((current) => current.filter((id) => id !== deleting.id))
            setDeleting(null)
          }}
        />
      )}
    </aside>
  )
}
