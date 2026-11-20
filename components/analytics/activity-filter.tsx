"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { KitMultiSelect, KitSingleSelect } from "@/components/orders/field-filter-kit"
import { isActivityPeriod, type ActivityState } from "@/lib/activity-types"
import { todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// "Показать фильтр" card of the Активность page, as Linko's (#/activity): «Фильтр» with the round ×, «Дата» (the
// shared range picker with its presets), «Тип клиента» (multi select with chips), «Подкатегория» (only after a type
// is chosen), «Магазин с оборудованием» (Да / Нет) and ПРИМЕНИТЬ. The card covers the «Показать фильтр» button while
// open. Escape closes it (an open list or picker first).

export type ClientTypeOption = { id: number; name: string }

type Draft = Pick<ActivityState, "from" | "to" | "clientTypes" | "withGear">

/** Linko's «Дата» of this filter: the small label, the period, a × that empties it (no calendar glyph); a click opens
 * the range picker below the field, its right edge on the field's. */
function PeriodField({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const day = (iso: string) => formatDateText(iso, language, { withTime: false })
  return (
    <div className="relative h-[72px]">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-haspopup="dialog" aria-expanded={open} className="absolute inset-x-0 top-0 h-[64px] w-full cursor-pointer text-left">
        <span className="absolute left-0 top-[12px] text-[12px] font-semibold leading-[16px] text-black/60">{t("Дата")}</span>
        <span className="absolute left-0 right-[30px] top-[36px] truncate text-[13px] leading-[18px] text-[#2d3037]">{from ? `${day(from)} – ${day(to || from)}` : ""}</span>
        <span className={`absolute inset-x-0 top-[63px] ${open ? "h-[2px] bg-[#1E4A9A]" : "h-px bg-[#e0e0e0]"}`} />
      </button>
      {from && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("", "")} className="absolute right-0 top-[33px] flex h-6 w-6 items-center justify-center">
          <X className="h-[16px] w-[16px] text-[#8a90a0]" />
        </button>
      )}
      {open && (
        <DateRangePicker
          begin={from || todayIso()}
          end={to || from || todayIso()}
          highlightPreset={false}
          positionClassName="right-0 top-[76px]"
          onClose={() => setOpen(false)}
          onApply={(begin, end) => {
            onChange(begin, end)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

export function ActivityFilterPanel({
  state,
  initialPeriod,
  today,
  clientTypes,
  onApply,
  onClose,
}: {
  state: ActivityState
  /** The period the «Дата» field opens with: the page's when the URL names one, else the current month (Linko). */
  initialPeriod: { from: string; to: string }
  today: string
  clientTypes: ClientTypeOption[]
  onApply: (draft: Draft) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<Draft>({ ...initialPeriod, clientTypes: state.clientTypes, withGear: state.withGear })
  const [error, setError] = useState("")

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const gearOptions = [
    { value: "yes", label: t("Да") },
    { value: "no", label: t("Нет") },
  ]
  const known = new Set(clientTypes.map((type) => type.id))
  const typeOptions = clientTypes.map((type) => ({ value: String(type.id), label: type.name }))
  // A type removed meanwhile (stale URL) stays removable as a chip but is not sent on apply.
  const chosen = draft.clientTypes

  return (
    <section
      role="dialog"
      aria-label={t("Фильтр")}
      className="absolute right-[52px] top-[calc(100%+22px)] z-50 w-[300px] max-w-[calc(100vw-32px)] rounded-[2px] bg-white px-[20px] pb-[10px] pt-[20px] text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-[15px] text-[#5d6474]">{t("Фильтр")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="-mr-[2px] flex h-6 w-6 items-center justify-center text-[#8a90a0] hover:text-[#5d6474]">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden="true">
            <path d="M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          // Without a period the page falls back to today, its default.
          const from = draft.from || today
          const to = draft.from ? draft.to || draft.from : today
          if (!isActivityPeriod(from, to)) {
            setError("Период не может быть больше 366 дней")
            return
          }
          onApply({ ...draft, from, to, clientTypes: draft.clientTypes.filter((id) => known.has(id)) })
        }}
      >
        <PeriodField
          from={draft.from}
          to={draft.to}
          onChange={(from, to) => {
            setError("")
            setDraft((current) => ({ ...current, from, to }))
          }}
        />
        {error && <p className="-mt-[6px] text-[12px] leading-4 text-[#e57373]">{t(error)}</p>}
        <KitMultiSelect
          label="Тип клиента"
          options={typeOptions}
          value={chosen.map(String)}
          onChange={(next) => setDraft((current) => ({ ...current, clientTypes: next.map(Number).filter((id) => Number.isInteger(id) && id > 0) }))}
          className="mt-[8px]"
        />
        {chosen.length > 0 && (
          // Linko shows «Подкатегория» once a type is picked; our client types have no sub-types, so it stays empty.
          <KitSingleSelect label="Подкатегория" options={[]} value="" onChange={() => {}} />
        )}
        <div className="mt-[8px]">
          <KitSingleSelect
            label="Магазин с оборудованием"
            options={gearOptions}
            value={draft.withGear === null ? "" : draft.withGear ? "yes" : "no"}
            onChange={(value) => setDraft((current) => ({ ...current, withGear: value === "yes" ? true : value === "no" ? false : null }))}
          />
        </div>
        <button type="submit" className="mt-[15px] h-9 min-w-[88px] rounded-[2px] bg-[#5d6474] px-4 text-[13px] uppercase text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:brightness-95">
          {t("Применить")}
        </button>
      </form>
    </section>
  )
}
