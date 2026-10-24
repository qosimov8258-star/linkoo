"use client"

import { useCallback, useEffect, useState } from "react"

import { ClockTimePicker } from "@/components/analytics/clock-time-picker"
import { Modal, SaveLink } from "@/components/analytics/catalog-ui"
import { AddLink, ConfirmDeleteDialog, EmptyRows, RowActions, SettingsToolbar, kitHead, kitRow, useListControls, usePaged } from "@/components/analytics/settings-list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// "Смены" (demo #/shift, Settings → Персонал; API staff/shift/): work-shift definitions
// Id | Наименование | Время начала | Время окончания with ✎ / 🗑 on every row. The dialog
// has the name and two clock pickers (Начало / Конец), its button is "Применить".

type Shift = { id: number; name: string; beginTime: string; endTime: string }

const COLUMNS = "139fr 405fr 304fr 427fr"

const hhmm = (value: string) => value.slice(0, 5)

function TimeField({ label, value, bold, onPick }: { label: string; value: string; bold?: boolean; onPick: (time: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="relative block h-[40px] w-full border-b border-[#d5dae1] text-left">
        <span className={`absolute left-0 ${value ? "top-0 text-[10px] font-semibold leading-3" : `top-[22px] text-[13px] leading-4 ${bold ? "font-semibold" : ""}`}`}>{label}</span>
        {value && <span className="absolute inset-x-0 bottom-[4px] text-[13px]">{hhmm(value)}</span>}
      </button>
      {open && <ClockTimePicker value={value} onCancel={() => setOpen(false)} onPick={(time) => { onPick(time); setOpen(false) }} />}
    </>
  )
}

function NameField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className="relative h-[40px] border-b border-[#d5dae1]">
      <span className={`pointer-events-none absolute left-0 transition-all ${floating ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent text-[13px] outline-none" />
    </div>
  )
}

function ShiftDialog({ shift, onClose, onSaved }: { shift: Shift | null; onClose: () => void; onSaved: (saved: Shift) => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(shift?.name ?? "")
  const [beginTime, setBeginTime] = useState(shift?.beginTime ?? "")
  const [endTime, setEndTime] = useState(shift?.endTime ?? "")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving || !name.trim() || !beginTime || !endTime) return
    setSaving(true)
    try {
      const response = await fetch(shift ? `/api/work-shifts/${shift.id}` : "/api/work-shifts", {
        method: shift ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), beginTime, endTime }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(data.error || "Не удалось сохранить смену"))
        return
      }
      onSaved((await response.json()) as Shift)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={shift ? t("Редактирование смены") : t("Добавить смену")}
      onClose={onClose}
      bodyClassName="px-[30px] pb-[42px] pt-[18px]"
      footer={<SaveLink disabled={saving} onClick={() => void save()}>{t("Применить")}</SaveLink>}
    >
      <NameField label={t("Наименование")} value={name} onChange={setName} />
      <div className="mt-[10px] grid grid-cols-2 gap-x-[8px]">
        <TimeField label={t("Начало")} value={beginTime} onPick={setBeginTime} />
        <TimeField label={t("Конец")} value={endTime} bold onPick={setEndTime} />
      </div>
    </Modal>
  )
}

export function ShiftsView() {
  const { t } = useLanguage()
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [dialog, setDialog] = useState<{ shift: Shift | null } | null>(null)
  const [deleting, setDeleting] = useState<Shift | null>(null)
  const controls = useListControls()

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/work-shifts", { cache: "no-store" })
      if (!response.ok) throw new Error("load")
      setShifts((await response.json()) as Shift[])
    } catch {
      setShifts([])
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const needle = controls.query.trim().toLowerCase()
  const filtered = (shifts ?? []).filter((shift) => shift.name.toLowerCase().includes(needle))
  const paged = usePaged(filtered, controls.page, controls.pageSize)

  async function remove(shift: Shift) {
    const response = await fetch(`/api/work-shifts/${shift.id}`, { method: "DELETE" })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      notify(t(data.error || "Не удалось удалить смену"))
      return
    }
    setDeleting(null)
    await load()
  }

  return (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <SettingsToolbar
        left={<AddLink onClick={() => setDialog({ shift: null })}>{t("добавить смену")}</AddLink>}
        query={controls.query}
        onQuery={controls.setQuery}
        pager={{
          pageSize: controls.pageSize,
          onPageSize: controls.setPageSize,
          from: paged.from,
          to: paged.to,
          total: paged.total,
          onPrev: paged.page > 1 ? () => controls.setPage(paged.page - 1) : undefined,
          onNext: paged.page < paged.pageCount ? () => controls.setPage(paged.page + 1) : undefined,
        }}
      />
      <div className={kitHead} style={{ gridTemplateColumns: COLUMNS }}>
        <span className="pl-[30px]">Id</span>
        <span>{t("Наименование")}</span>
        <span>{t("Время начала")}</span>
        <span>{t("Время окончания")}</span>
      </div>
      {paged.rows.map((shift) => (
        <div key={shift.id} className={kitRow} style={{ gridTemplateColumns: COLUMNS }}>
          <span className="pl-[30px]">{shift.id}</span>
          <span className="pr-4">{shift.name}</span>
          <span>{hhmm(shift.beginTime)}</span>
          <span>{hhmm(shift.endTime)}</span>
          <RowActions always onEdit={() => setDialog({ shift })} onDelete={() => setDeleting(shift)} />
        </div>
      ))}
      {shifts && paged.rows.length === 0 && <EmptyRows />}

      {dialog && (
        <ShiftDialog
          key={dialog.shift?.id ?? "new"}
          shift={dialog.shift}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load() }}
        />
      )}
      {deleting && <ConfirmDeleteDialog name={deleting.name} onConfirm={() => void remove(deleting)} onClose={() => setDeleting(null)} />}
    </section>
  )
}
