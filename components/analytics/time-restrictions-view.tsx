"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"

import { ClockTimePicker } from "@/components/analytics/clock-time-picker"
import { Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { kitHead, kitRow, ROW_ICONS, SettingsToolbar } from "@/components/analytics/settings-list-kit"
import { RadioRow } from "@/components/settings/settings-list-ui"
import { useLanguage } from "@/lib/i18n/language-context"

type Status = "1" | "2" | "3" | "4"
type TimeRestriction = { id: number; name: string; status: Status; from: string | null; to: string | null; isAll: boolean }

const STATUS_LABELS: Record<Status, string> = {
  "1": "Работает полный день",
  "2": "Не работает в течении дня",
  "3": "Работает в данные часы",
  "4": "Не работает в данные часы",
}
const STATUSES = Object.keys(STATUS_LABELS) as Status[]

function TimeField({ label, value, bold, onPick }: { label: string; value: string; bold?: boolean; onPick: (time: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="relative block h-[41px] w-full border-b border-[#e0e0e0] text-left">
        <span className={`absolute left-0 ${value ? "top-[2px] text-[10px] font-semibold leading-3" : `top-[22px] text-[13px] leading-4 ${bold ? "font-semibold" : ""}`}`}>{label}</span>
        {value && <span className="absolute inset-x-0 bottom-[2px] text-[13px]">{value}</span>}
      </button>
      {open && <ClockTimePicker value={value} onCancel={() => setOpen(false)} onPick={(time) => { onPick(time); setOpen(false) }} />}
    </>
  )
}

/** The reference's "Тип" select: floating bold label, semibold value, × and caret, the list opens flush under the line. */
function TypeSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [lit, setLit] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!lit) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setLit(false)
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [lit])
  const selected = options.find((option) => option.value === value)
  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => { setOpen((current) => !current); setLit(true) }} className={`relative block h-[42px] w-full border-b text-left ${lit ? "border-b-2 !border-[#5d6474]" : "border-[#e8e8e8]"}`}>
        <span className={`absolute left-0 font-semibold ${selected ? "-top-[6px] text-[10px] leading-3" : "top-[19px] text-[13px] leading-4"}`}>{label}</span>
        {selected && <span className="absolute inset-x-0 bottom-[4px] truncate pr-12 text-[13px] font-semibold leading-4 text-[#333]">{selected.label}</span>}
        <span className="absolute bottom-[5px] right-[10px] flex items-center gap-[7px] text-[#999]">
          {selected && <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange(""); setLit(true) }}><X className="h-3.5 w-3.5" /></span>}
          <svg viewBox="0 0 10 5" className={`h-[5px] w-[10px] fill-[#999] ${open ? "rotate-180" : ""}`}><path d="M0 0l5 5 5-5z" /></svg>
        </span>
      </button>
      {open && (
        <ul className="absolute left-0 right-0 top-[42px] z-20 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          {options.map((option, index) => (
            <li key={option.value}>
              <button type="button" onClick={() => { onChange(option.value); setOpen(false) }} className={`block h-[32px] w-full px-[10px] text-left text-[13px] font-semibold ${option.value === value || (!selected && index === 0) ? "bg-[#e6f2ff] text-[#333]" : "text-[#666] hover:bg-[#f2f5f8]"}`}>{option.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function TimeRestrictionsView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<TimeRestriction[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editing, setEditing] = useState<TimeRestriction | null>(null)
  const [draft, setDraft] = useState<{ status: Status | ""; from: string; to: string; isAll: boolean }>({ status: "1", from: "", to: "", isAll: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/order-time-restrictions", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: TimeRestriction[]) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => !needle || t(row.name).toLowerCase().includes(needle) || t(STATUS_LABELS[row.status]).toLowerCase().includes(needle))
  }, [rows, query, t])
  const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, lastPage)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)
  const hours = draft.status === "3" || draft.status === "4"
  const valid = draft.status !== "" && (!hours || (draft.from.length === 5 && draft.to.length === 5))

  function openEdit(row: TimeRestriction) {
    setDraft({ status: row.status, from: row.from ?? "", to: row.to ?? "", isAll: row.isAll })
    setError("")
    setEditing(row)
  }

  async function save() {
    if (!editing || !valid || saving) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/order-time-restrictions/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: draft.status, from: hours ? draft.from : null, to: hours ? draft.to : null, isAll: draft.isAll }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error || "Не удалось сохранить ограничение")
        return
      }
      const saved = (await response.json()) as TimeRestriction
      setRows((list) => list.map((row) => (row.id === saved.id ? saved : row)))
      setEditing(null)
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function timeText(row: TimeRestriction) {
    const label = t(STATUS_LABELS[row.status])
    if (row.status !== "3" && row.status !== "4") return label
    const bound = (value: string | null) => (value ? `${value}:00` : <span className="text-[22px]">∞</span>)
    return <>{label}: {bound(row.from)} - {bound(row.to)}</>
  }

  const columns = "41.667% 41.667% 1fr"
  const from = filtered.length ? (current - 1) * pageSize + 1 : 0
  return (
    <section className={`bg-white text-[13px] text-[#333] ${embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)]"}`}>
      <SettingsToolbar
        query={query}
        onQuery={(value) => { setQuery(value); setPage(1) }}
        searchClassName="left-[15px] top-[21px]"
        searchWidth={182}
        pager={{
          pageSize,
          onPageSize: (size) => { setPageSize(size); setPage(1) },
          from,
          to: from ? from + visible.length - 1 : 0,
          total: filtered.length,
          onPrev: current > 1 ? () => setPage(current - 1) : undefined,
          onNext: current < lastPage ? () => setPage(current + 1) : undefined,
        }}
      />
      <div className={`${kitHead} px-[30px]`} style={{ gridTemplateColumns: columns }}>
        <span>{t("Наименование")}</span>
        <span className="pl-[8px]">{t("Время работы")}</span>
      </div>
      {visible.map((row) => (
        <div key={row.id} className={`${kitRow} px-[30px]`} style={{ gridTemplateColumns: columns }}>
          <span>{t(row.name)}</span>
          <span className="pl-[8px]">{timeText(row)}</span>
          <button type="button" aria-label={t("Изменить")} onClick={() => openEdit(row)} className="absolute right-[30px] top-1/2 flex h-[26px] w-[30px] -translate-y-1/2 items-center justify-end">
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#5d6474]"><path d={ROW_ICONS.pencil} /></svg>
          </button>
        </div>
      ))}

      {editing && (
        <Modal title={t("Время работы")} bodyClassName="px-[30px] pb-[27px] pt-[37px]" onClose={() => setEditing(null)} footer={<SaveButton disabled={!valid || saving} onClick={() => void save()}>{t("Применить")}</SaveButton>}>
          <TypeSelect
            label={t("Тип")}
            value={draft.status}
            options={STATUSES.map((status) => ({ value: status, label: t(STATUS_LABELS[status]) }))}
            onChange={(value) => setDraft((state) => ({ ...state, status: value as Status | "" }))}
          />
          <div className="mt-[9px] grid h-[40px] grid-cols-2 gap-x-[18px]">
            {hours && (
              <>
                <TimeField label={t("Начало")} value={draft.from} onPick={(time) => setDraft((state) => ({ ...state, from: time }))} />
                <TimeField label={t("Конец")} value={draft.to} onPick={(time) => setDraft((state) => ({ ...state, to: time }))} />
              </>
            )}
          </div>
          <div className="ml-[2px] mt-[16px] flex flex-col gap-[14px]">
            <RadioRow checked={draft.isAll} onChange={() => setDraft((value) => ({ ...value, isAll: true }))} label={t("Действует для всех")} />
            <RadioRow checked={!draft.isAll} onChange={() => setDraft((value) => ({ ...value, isAll: false }))} label={t("Действует только для выбранных агентов")} />
          </div>
          {error && <p className="mt-3 text-[13px] text-red-500">{t(error)}</p>}
        </Modal>
      )}
    </section>
  )
}
