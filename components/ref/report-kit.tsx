"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"

import { RefButton, RefHeader, RI } from "./list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

/**
 * Shared chrome of the reference app's "dynamic report" pages: title row with
 * the Excel / dashboard actions, a white filter band (4 fields per row, 10px
 * floating labels, 13px values), a green "Применить" bar and the robot
 * empty state.
 */

const FIELD = "relative block h-[54px] border-b border-[#e0e0e0]"
const FLOAT_LABEL = "absolute left-0 top-[7px] text-[10px] font-normal leading-3 text-black"

const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

/** 2026-10-01 -> "1 октября 2026 г." (the reference app's date field format). */
export function formatReportDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number)
  if (!year || !month || !day) return ""
  return `${day} ${MONTHS_RU[month - 1]} ${year} г.`
}

export function ReportPage({ children }: { children: ReactNode }) {
  return <main className="min-h-[calc(100vh-50px)] bg-[#f2f5f8] pt-px font-sans text-[13px] text-[#333]">{children}</main>
}

export function ReportHeader({
  title,
  children,
  onExcel,
  onDashboard,
  inDashboard,
}: {
  title: ReactNode
  children?: ReactNode
  onExcel?: () => void
  onDashboard?: () => void
  inDashboard?: boolean
}) {
  const { t } = useLanguage()
  return (
    <div className="pl-[30px] pr-[38px]">
      <RefHeader title={title}>
        {children}
        {onExcel && (
          <span className="mr-2 flex">
            <RefButton icon={RI.download} label={t("Скачать Excel")} onClick={onExcel} green />
          </span>
        )}
        {onDashboard && <RefButton icon={RI.add} label={inDashboard ? t("Добавлено в дашборд") : t("Добавить в дашборд")} onClick={onDashboard} />}
      </RefHeader>
    </div>
  )
}

/** White full-bleed band holding the filters and the result. */
export function ReportBand({ children }: { children: ReactNode }) {
  return <section className="border-b border-[#d9d9d9] bg-white px-[30px] pb-[1px] pt-[1px]">{children}</section>
}

/** Filter grid + the full-width green apply bar. */
export function ReportFilters({
  children,
  onApply,
  applyDisabled,
  cols = 4,
}: {
  children: ReactNode
  onApply?: () => void
  applyDisabled?: boolean
  cols?: 3 | 4
}) {
  const { t } = useLanguage()
  function submit(event: FormEvent) {
    event.preventDefault()
    onApply?.()
  }
  return (
    <form onSubmit={submit}>
      <div className={`-mt-[2px] grid grid-cols-1 gap-x-[14.67px] gap-y-[28px] sm:grid-cols-2 ${cols === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>{children}</div>
      <button
        type="submit"
        disabled={applyDisabled}
        className="mt-2 block h-9 w-full rounded-[5px] bg-[#71ce87] text-[13px] font-semibold text-white transition-[filter] hover:brightness-95 disabled:opacity-60"
      >
        {t("Применить")}
      </button>
    </form>
  )
}

export function ReportDateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
}) {
  const { t } = useLanguage()
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <label className={`${FIELD} cursor-pointer`} onClick={() => inputRef.current?.showPicker?.()}>
      <span className={FLOAT_LABEL}>{t(label)}</span>
      <span className="absolute inset-x-0 top-[22px] text-[13px] leading-[18px] text-black">{t(formatReportDate(value))}</span>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[8px] right-0 h-5 w-5 fill-[#c4c4c4]" aria-hidden>
        <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" />
      </svg>
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => event.target.value && onChange(event.target.value)}
        className="absolute inset-0 h-full w-full opacity-0"
        aria-label={t(label)}
      />
    </label>
  )
}

const CARET = <path d="M7 10l5 5 5-5z" />

/**
 * Select in the reference style: the field name acts as the placeholder while
 * nothing is picked, then shrinks to a 10px floating label above the value.
 */
export function ReportSelectField({
  label,
  value,
  onChange,
  options,
  clearable = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  clearable?: boolean
}) {
  const { t } = useLanguage()
  const hasValue = value !== ""
  return (
    <label className={FIELD}>
      {hasValue && <span className={FLOAT_LABEL}>{t(label)}</span>}
      <span className={`absolute inset-x-0 text-[13px] leading-[18px] text-black ${hasValue ? "top-[26px]" : "top-[28px] font-semibold"}`}>
        {hasValue ? t(value) : t(label)}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0" aria-label={t(label)}>
        <option value="" />
        {options.map((option) => (
          <option key={option} value={option}>
            {t(option)}
          </option>
        ))}
      </select>
      {hasValue && clearable && (
        <button type="button" aria-label="clear" onClick={() => onChange("")} className="absolute bottom-[8px] right-[22px] z-10 flex h-5 w-5 items-center justify-center text-[18px] leading-none text-[#999]">
          ×
        </button>
      )}
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[6px] right-0 h-6 w-6 fill-[#999]" aria-hidden>
        {CARET}
      </svg>
    </label>
  )
}

/** Single-choice "chip" field (e.g. «Колонка» -> × Визит); optionally switchable. */
export function ReportChipField({
  label,
  value,
  options,
  onChange,
  compact,
}: {
  label: string
  value: string
  options?: string[]
  onChange?: (value: string) => void
  compact?: boolean
}) {
  const { t } = useLanguage()
  return (
    <div className={`${FIELD} ${compact ? "w-[200px]" : ""}`}>
      <span className={FLOAT_LABEL}>{t(label)}</span>
      <span className="absolute left-0 top-[23px] flex h-5 items-stretch overflow-hidden text-[13px] font-semibold leading-5 text-white">
        <span className="border-r border-white/30 bg-[#5c6df3] px-[5px] text-[12px]">×</span>
        <span className="bg-[#5c6df3] px-[5px]">{t(value)}</span>
      </span>
      <span className="absolute bottom-[8px] right-[22px] text-[18px] leading-none text-[#999]">×</span>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[6px] right-0 h-6 w-6 fill-[#999]" aria-hidden>
        {CARET}
      </svg>
      {options && onChange && (
        <select value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0" aria-label={t(label)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {t(option)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

/** Multi-choice chip field (e.g. «Статус» -> × Передан доставщику × Доставлен). */
export function ReportMultiChipField({
  label,
  values,
  options,
  onChange,
}: {
  label: string
  values: string[]
  options: string[]
  onChange: (values: string[]) => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const rest = options.filter((option) => !values.includes(option))
  return (
    <div className={FIELD}>
      <button type="button" aria-label={t(label)} onClick={() => setOpen((current) => !current)} className="absolute inset-0 h-full w-full cursor-pointer" />
      {values.length > 0 && <span className={FLOAT_LABEL}>{t(label)}</span>}
      {values.length === 0 && <span className="absolute inset-x-0 top-[28px] text-[13px] font-semibold leading-[18px] text-black">{t(label)}</span>}
      <span className="absolute left-0 top-[23px] z-10 flex items-center gap-[5px] text-[13px] font-semibold leading-5 text-white">
        {values.map((value) => (
          <span key={value} className="flex h-5 items-stretch overflow-hidden">
            <button type="button" aria-label="remove" onClick={() => onChange(values.filter((item) => item !== value))} className="border-r border-white/30 bg-[#5c6df3] px-[5px] text-[12px]">×</button>
            <span className="bg-[#5c6df3] px-[5px]">{t(value)}</span>
          </span>
        ))}
      </span>
      {values.length > 0 && (
        <button type="button" aria-label="clear" onClick={() => onChange([])} className="absolute bottom-[8px] right-[22px] z-10 text-[18px] leading-none text-[#999]">×</button>
      )}
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[6px] right-0 h-6 w-6 fill-[#999]" aria-hidden>
        {CARET}
      </svg>
      {open && (
        <>
          <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-full z-40 max-h-[205px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
            {rest.length === 0 ? (
              <div className="h-9 px-[10px] text-[13px] leading-9 text-[#999]">{t("Ничего не найдено")}</div>
            ) : (
              rest.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onChange([...values, option])
                    setOpen(false)
                  }}
                  className="block h-9 w-full px-[10px] text-left text-[13px] font-semibold hover:bg-[#f2f5f8]"
                >
                  {t(option)}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function ReportEmpty({ text, className = "pb-[44px] pt-[65px]" }: { text?: ReactNode; className?: string }) {
  const { t } = useLanguage()
  return (
    <div className={`flex flex-col items-center ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="w-[157px]" />
      <span className="mt-[14px] text-[13px] text-[#8c8c8c]">{text ?? t("По вашему запросу ничего не найдено...")}</span>
    </div>
  )
}

/** "Фильтр / 1" button, organisation label and "Скачать" — top row of the profit/summary reports. */
export function ReportTopRow({
  filterLabel,
  scope,
  onFilter,
  onDownload,
}: {
  filterLabel: ReactNode
  scope: ReactNode
  onFilter: () => void
  onDownload: () => void
}) {
  const { t } = useLanguage()
  return (
    <div className="flex h-[34px] items-center pt-0">
      <button type="button" onClick={onFilter} className="flex h-[34px] items-center rounded-[5px] bg-[#4f71dc] pl-[14px] pr-[22px] text-[13px] font-semibold text-white hover:brightness-95">
        <svg viewBox="0 0 24 24" className="mr-[9px] h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.filter} /></svg>
        {typeof filterLabel === "string" ? t(filterLabel) : filterLabel}
      </button>
      <span className="ml-4 text-[13px] font-semibold text-[#4f71dc]">{typeof scope === "string" ? t(scope) : scope}</span>
      <button type="button" onClick={onDownload} className="ml-auto flex h-[34px] items-center rounded-[5px] bg-[#71ce87] pl-[14px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95">
        <svg viewBox="0 0 24 24" className="mr-[9px] h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.chart} /></svg>
        {t("Скачать")}
      </button>
    </div>
  )
}

export function ReportSummaryCard({ label, children, right }: { label: ReactNode; children: ReactNode; right?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className={`border border-[#e8e8e8] px-[15px] pb-[8px] pt-[10px] ${right ? "text-right" : ""}`}>
      <p className="text-[13px] leading-4 text-[#555]">{typeof label === "string" ? t(label) : label}</p>
      <p className="mt-[2px] text-[16px] font-bold leading-[18px] text-black">{children}</p>
    </div>
  )
}

export function ReportSearchBar({
  value,
  onChange,
  pageSize,
  onPageSize,
  rangeLabel,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onFullscreen,
  label = "Поиск",
}: {
  value: string
  onChange: (value: string) => void
  pageSize: number
  onPageSize: (value: number) => void
  rangeLabel: string
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onFullscreen?: () => void
  label?: string
}) {
  const { t } = useLanguage()
  return (
    <div className="flex h-[46px] items-center border-b border-[#e8e8e8]">
      <label className="relative block h-[28px] w-[348px] border-b border-[#e0e0e0]">
        {!value && <span className="pointer-events-none absolute left-0 top-[5px] text-[13px] font-semibold text-black">{t(label)}</span>}
        <input value={value} onChange={(event) => onChange(event.target.value)} className="h-full w-full bg-transparent pr-8 text-[13px] outline-none" aria-label={t(label)} />
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-[2px] top-[2px] h-6 w-6 fill-[#444]" aria-hidden><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
      </label>
      <div className="ml-auto flex items-center text-[13px] text-black">
        <label className="relative mr-[30px] flex h-6 items-center">
          <span>{pageSize}</span>
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#999]" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
          <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} className="absolute inset-0 cursor-pointer appearance-none opacity-0" aria-label={t("Строк на странице")}>
            {[10, 25, 50, 100].map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
        <span className="mr-[10px]">{t(rangeLabel)}</span>
        <button type="button" disabled={!canPrev} onClick={onPrev} aria-label={t("Назад")} className="mr-[10px] disabled:opacity-60">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#999]"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3-12.5l-1.4-1.4L8.7 11l4.9 4.9 1.4-1.4L11.5 11z" fillRule="evenodd" /><path d="M13.5 8L9 12l4.5 4z" /></svg>
        </button>
        <button type="button" disabled={!canNext} onClick={onNext} aria-label={t("Вперед")} className="mr-[30px] disabled:opacity-60">
          <svg viewBox="0 0 24 24" className="h-6 w-6 rotate-180 fill-[#999]"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /><path d="M13.5 8L9 12l4.5 4z" /></svg>
        </button>
        <button type="button" onClick={onFullscreen} aria-label={t("Полный экран")} className="h-6 w-6">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
        </button>
      </div>
    </div>
  )
}

const SHORT_MONTHS_LOWER = ["янв.", "февр.", "март", "апр.", "май", "июнь", "июль", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** 2026-10-01 -> "01 окт. 2026" */
export function formatShortReportDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number)
  if (!year || !month || !day) return ""
  return `${String(day).padStart(2, "0")} ${SHORT_MONTHS_LOWER[month - 1]} ${year}`
}

/** "01 окт. 2026 - 14 окт. 2026" field; each half opens its own date picker. */
export function ReportRangeField({
  label,
  from,
  to,
  onFrom,
  onTo,
  className = "",
}: {
  className?: string
  label: string
  from: string
  to: string
  onFrom: (value: string) => void
  onTo: (value: string) => void
}) {
  const { t } = useLanguage()
  return (
    <div className={`${FIELD} ${className}`}>
      <span className={`${FLOAT_LABEL} flex items-center gap-[2px]`}>
        {t(label)}
        <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-[#c4c4c4]" aria-hidden>
          <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" />
        </svg>
      </span>
      <span className="absolute inset-x-0 top-[22px] text-[13px] leading-[18px] text-black">
        {t(formatShortReportDate(from))} - {t(formatShortReportDate(to))}
      </span>
      <input type="date" aria-label={t("Дата от")} value={from} max={to} onChange={(event) => event.target.value && onFrom(event.target.value)} className="absolute left-0 top-0 h-full w-1/2 cursor-pointer opacity-0" />
      <input type="date" aria-label={t("Дата до")} value={to} min={from} onChange={(event) => event.target.value && onTo(event.target.value)} className="absolute right-0 top-0 h-full w-1/2 cursor-pointer opacity-0" />
    </div>
  )
}

export function ReportCheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const { t } = useLanguage()
  return (
    <label className="flex h-[54px] cursor-pointer items-end gap-[10px] pb-[6px] text-[13px] font-semibold text-black">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mb-[2px] h-[15px] w-[15px] cursor-pointer accent-[#444]" />
      {t(label)}
    </label>
  )
}

/** Dimmed overlay + white filter card used by the statistics reports. */
export function ReportFilterPanel({
  title = "Фильтр",
  tabs,
  onClose,
  onApply,
  children,
}: {
  title?: string
  tabs?: ReactNode
  onClose: () => void
  onApply: () => void
  children: ReactNode
}) {
  const { t } = useLanguage()
  function submit(event: FormEvent) {
    event.preventDefault()
    onApply()
  }
  return (
    <div className="fixed inset-x-0 bottom-0 top-[50px] z-[100] bg-black/[0.13]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={submit} className="mx-[30px] mt-[81px] bg-white px-[30px] pb-[18px] pt-[20px] font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold leading-[18px]">{t(title)}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-6 w-6 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" /></svg>
          </button>
        </div>
        {tabs && <div className="-mx-[25px] mt-[6px]">{tabs}</div>}
        <div className={`${tabs ? "mt-[20px]" : "mt-[18px]"} grid grid-cols-1 gap-x-[10.67px] gap-y-[13px] sm:grid-cols-2 lg:grid-cols-4`}>{children}</div>
        <button type="submit" className="mt-[12px] block h-9 w-full rounded-[5px] bg-[#71ce87] text-[13px] font-semibold text-white transition-[filter] hover:brightness-95">
          {t("Применить")}
        </button>
      </form>
    </div>
  )
}

/** Two-segment tab bar used inside ReportFilterPanel. */
export function ReportSegmentTabs({ labels, value, onChange }: { labels: string[]; value: number; onChange: (index: number) => void }) {
  const { t } = useLanguage()
  return (
    <div className="grid h-8" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
      {labels.map((label, index) => (
        <button key={label} type="button" onClick={() => onChange(index)} className={`text-[13px] transition-colors ${value === index ? "rounded-[3px] bg-[#4f71dc] text-white shadow-[0_2px_5px_rgba(0,0,0,0.25)]" : "border border-[#ececec] bg-white text-black"}`}>
          {t(label)}
        </button>
      ))}
    </div>
  )
}

/** Plain text/number filter: the field name is the bold placeholder until something is typed. */
export function ReportInputField({
  label,
  value,
  onChange,
  type = "number",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "number" | "text"
}) {
  const { t } = useLanguage()
  return (
    <label className={FIELD}>
      {value !== "" && <span className={FLOAT_LABEL}>{t(label)}</span>}
      {value === "" && <span className="pointer-events-none absolute inset-x-0 top-[30px] text-[13px] font-semibold leading-[18px] text-black">{t(label)}</span>}
      <input
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-x-0 bottom-0 h-[30px] bg-transparent text-[13px] text-black outline-none"
        aria-label={t(label)}
      />
    </label>
  )
}

/** Row of plain "label / bold value" metrics separated from the toolbar by a hairline. */
export function ReportMetricRow({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <div className="mt-[10px] flex items-start justify-between border-b border-[#e8e8e8] pb-[10px]">
      {items.map((item, index) => (
        <div key={index} className={index === items.length - 1 ? "text-right" : ""}>
          <p className="text-[13px] leading-4 text-[#555]">{item.label}</p>
          <p className="mt-[2px] text-[16px] font-bold leading-[18px] text-black">{item.value}</p>
        </div>
      ))}
    </div>
  )
}

/** Joined uppercase mode buttons (КОЛ-ВО / СЕБЕСТОИМОСТЬ / ПРАЙС ЛИСТ). */
export function ReportModeButtons({ labels, value, onChange }: { labels: string[]; value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  return (
    <div className="flex">
      {labels.map((label, index) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(label)}
          className={`h-[30px] border px-[16px] text-[13px] uppercase transition-colors ${index === 0 ? "rounded-l-[3px]" : ""} ${index === labels.length - 1 ? "rounded-r-[3px]" : ""} ${value === label ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e0e0e0] bg-white text-black hover:bg-[#f2f5f8]"}`}
        >
          {t(label)}
        </button>
      ))}
    </div>
  )
}

/** Bold-placeholder search field with a magnifier (the reference toolbar search). */
export function ReportSearchField({ value, onChange, width = 280, label = "Поиск", light = false }: { value: string; onChange: (value: string) => void; width?: number; label?: string; light?: boolean }) {
  const { t } = useLanguage()
  return (
    <label className="relative block h-[28px] border-b border-[#e0e0e0]" style={{ width }}>
      {!value && <span className={`pointer-events-none absolute left-0 top-[5px] text-[13px] ${light ? "text-black/30" : "font-semibold text-black"}`}>{t(label)}</span>}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="h-full w-full bg-transparent pr-8 text-[13px] outline-none" aria-label={t(label)} />
      <svg viewBox="0 0 24 24" className={`pointer-events-none absolute right-[2px] top-[2px] h-6 w-6 ${light ? "fill-[#ccc]" : "fill-[#444]"}`} aria-hidden><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
    </label>
  )
}

/** "25 ▾  1 - 25 из N  ◀ ▶" */
export function ReportPager({
  pageSize,
  onPageSize,
  rangeLabel,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  pageSize: number
  onPageSize: (value: number) => void
  rangeLabel: string
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const { t } = useLanguage()
  return (
    <div className="flex items-center text-[13px] text-black">
      <label className="relative mr-[30px] flex h-6 items-center">
        <span>{pageSize}</span>
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#999]" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} className="absolute inset-0 cursor-pointer appearance-none opacity-0" aria-label={t("Строк на странице")}>
          {[10, 25, 50, 100].map((size) => (
            <option key={size}>{size}</option>
          ))}
        </select>
      </label>
      <span className="mr-[10px]">{rangeLabel}</span>
      <button type="button" disabled={!canPrev} onClick={onPrev} aria-label={t("Назад")} className="mr-[10px]">
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${canPrev ? "fill-[#555]" : "fill-[#c4c4c4]"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
      </button>
      <button type="button" disabled={!canNext} onClick={onNext} aria-label={t("Вперед")}>
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${canNext ? "fill-[#555]" : "fill-[#c4c4c4]"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
      </button>
    </div>
  )
}

/**
 * Full-bleed grid table of the statistics reports: bold centred headers with a soft
 * shadow, optional group row, striped body and a "Нет данных" placeholder.
 */
export function ReportGridTable({
  heads,
  groups,
  rows,
  minWidth = 1100,
  colWidths,
  loading,
  emptyText = "Нет данных",
  align = "left",
  headClass = "bg-white",
  headTextClass = "",
}: {
  heads: ReactNode[]
  groups?: { title: ReactNode; span: number }[]
  rows: ReactNode[][]
  minWidth?: number
  colWidths?: string[]
  loading?: boolean
  emptyText?: ReactNode
  align?: "left" | "right"
  headClass?: string
  headTextClass?: string
}) {
  const { t } = useLanguage()
  return (
    <div className="relative overflow-x-auto border-b border-[#e8e8e8]">
      <table className="w-full table-fixed border-collapse text-[13px]" style={{ minWidth }}>
        {colWidths && <colgroup>{colWidths.map((width, index) => <col key={index} style={width ? { width } : undefined} />)}</colgroup>}
        <thead className="shadow-[0_3px_6px_rgba(0,0,0,0.12)]">
          {groups && (
            <tr className="h-[30px] bg-white">
              {groups.map((group, index) => (
                <th key={index} colSpan={group.span} className={`px-2 text-center font-semibold ${index ? "border-l border-[#ececec]" : ""}`}>{group.title}</th>
              ))}
            </tr>
          )}
          <tr className={`h-[40px] ${headClass}`}>
            {heads.map((head, index) => (
              <th key={index} className={`px-2 text-center font-semibold leading-4 ${headTextClass} ${index ? "border-l border-[#ececec]" : ""}`}>{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? [0, 1, 2].map((r) => (
                <tr key={r} className={`h-[31px] ${r === 1 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                  {heads.map((_, c) => <td key={c} className={c ? "border-l border-[#ececec]" : ""} />)}
                </tr>
              ))
            : rows.map((cells, r) => (
                <tr key={r} className={`min-h-[31px] ${r % 2 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                  {cells.map((cell, c) => (
                    <td key={c} className={`px-[6px] py-[6px] ${c ? "border-l border-[#ececec]" : ""} ${align === "right" && c ? "text-right" : ""}`}>{cell}</td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <span className={`absolute left-1/2 -translate-x-1/2 bg-white px-[20px] pb-[16px] pt-[2px] text-[13px] text-[#777] ${groups ? "top-[84px]" : "top-[54px]"}`}>{loading ? t("Загрузка...") : emptyText}</span>
      )}
    </div>
  )
}

/** Bordered metric card: a label over three coloured money lines (Euro / SUM / USD). */
export function ReportMoneyBox({
  title,
  lines,
  right,
  className = "",
}: {
  title: ReactNode
  lines: { text: ReactNode; tone?: "default" | "plus" | "minus" }[]
  right?: boolean
  className?: string
}) {
  const tones = { default: "text-black", plus: "text-[#71ce87]", minus: "text-[#e57373]" }
  return (
    <div className={`border border-[#e8e8e8] bg-white px-[15px] pb-[8px] pt-[12px] ${right ? "text-right" : ""} ${className}`}>
      <p className="text-[13px] leading-4 text-[#333]">{title}</p>
      {lines.map((line, index) => (
        <p key={index} className={`mt-[2px] text-[15px] font-semibold leading-[20px] ${tones[line.tone ?? "default"]}`}>{line.text}</p>
      ))}
    </div>
  )
}

/** "▲▼" sort affordance used by the blue-header balance tables. */
export function ReportSortHead({ label, active, dir, onClick }: { label: ReactNode; active?: boolean; dir?: "asc" | "desc"; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center justify-center gap-[6px] text-center font-semibold leading-4 text-white">
      {label}
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white" aria-hidden>
        <path d="M12 5l4 5H8z" className={active && dir === "desc" ? "opacity-40" : ""} />
        <path d="M12 19l-4-5h8z" className={active && dir === "asc" ? "opacity-40" : ""} />
      </svg>
    </button>
  )
}

export type BalanceTone = "default" | "plus" | "minus"
export type BalanceBlock = { title: ReactNode; lines: { text: ReactNode; tone?: BalanceTone; info?: boolean }[] }

/** Four-column bordered summary strip used by the balance reports (blocks stack inside a column). */
export function ReportBalanceBoxes({ columns, className = "mx-[10px]" }: { columns: { blocks: BalanceBlock[]; right?: boolean }[]; className?: string }) {
  const tones = { default: "text-black", plus: "text-[#71ce87]", minus: "text-[#e57373]" }
  return (
    <div className={`${className} grid grid-cols-1 border border-[#e8e8e8] sm:grid-cols-2 lg:grid-cols-4`}>
      {columns.map((column, index) => (
        <div key={index} className={`px-[15px] pt-[15px] ${index < columns.length - 1 ? "border-r border-[#e8e8e8]" : ""} ${column.right ? "lg:text-right" : ""}`}>
          {column.blocks.map((block, blockIndex) => (
            <div key={blockIndex} className="mb-[10px]">
              <p className="text-[13px] leading-[18px] text-[#333]">{block.title}</p>
              {block.lines.map((line, lineIndex) => (
                <p key={lineIndex} className={`flex items-center gap-[6px] text-[15px] font-semibold leading-[20px] ${tones[line.tone ?? "default"]} ${column.right ? "lg:justify-end" : ""}`}>
                  {line.info && <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-[#666] stroke-2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" strokeLinecap="round" /></svg>}
                  {line.text}
                </p>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Signed money text: green when positive, red when negative, plain 0. */
export function ReportAmount({ value, unit }: { value: number; unit?: string }) {
  const text = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)
  if (value > 0) return <span className="text-[#71ce87]">{text}{unit ? ` ${unit}` : ""}</span>
  if (value < 0) return <span className="text-[#e57373]">{text}{unit ? ` ${unit}` : ""}</span>
  return <span>0</span>
}

/** Row toolbar of the balance reports: link-style filter, search, extras left of the pager. */
export function ReportBalanceToolbar({
  filterLabel = "Показать фильтр",
  onFilter,
  filterAsButton,
  search,
  onSearch,
  searchLeft = 490,
  children,
  pager,
  left,
}: {
  filterLabel?: string
  onFilter?: () => void
  filterAsButton?: boolean
  search: string
  onSearch: (value: string) => void
  searchLeft?: number
  children?: ReactNode
  pager: ReactNode
  /** Replaces the filter link (e.g. mode buttons). */
  left?: ReactNode
}) {
  const { t } = useLanguage()
  return (
    <div className="relative mx-[10px] mt-[16px] flex h-[50px] items-center border-t border-[#e8e8e8]">
      {left ? (
        <div className="pl-[20px]">{left}</div>
      ) : filterAsButton ? (
        <button type="button" onClick={onFilter} className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 pr-4 text-[13px] font-semibold text-white hover:brightness-95">
          <svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.filter} /></svg>{t(filterLabel)}
        </button>
      ) : (
        <button type="button" onClick={onFilter} className="text-[13px] text-[#1ea1f2]">{t(filterLabel)} ⌄</button>
      )}
      <div className="absolute" style={{ left: searchLeft }}><ReportSearchField value={search} onChange={onSearch} width={180} light /></div>
      <div className="ml-auto flex items-center gap-[20px]">
        {children}
        {pager}
      </div>
    </div>
  )
}

const WIDGET_TABS = ["ВИДЖЕТЫ", "KPI", "БАЛАНС", "ОХВАТ", "ФИЛИАЛ", "P&L", "ДОЛГ КЛИЕНТОВ", "ПРОДАЖА", "ГИБКИЙ ДАШБОРД"] as const
const WIDGET_HREF: Record<(typeof WIDGET_TABS)[number], string> = {
  "ВИДЖЕТЫ": "/",
  "KPI": "/analytics/kpi-performance",
  "БАЛАНС": "/analytics/balance-tab",
  "ОХВАТ": "/analytics/coverage-analysis",
  "ФИЛИАЛ": "/analytics/branch-tab",
  "P&L": "/analytics/pnl",
  "ДОЛГ КЛИЕНТОВ": "/analytics/order-debts",
  "ПРОДАЖА": "/analytics/sales-tab",
  "ГИБКИЙ ДАШБОРД": "/analytics/flexible-dashboard",
}

const SHORT_MONTHS_CAP = ["Янв.", "Февр.", "Март", "Апр.", "Май", "Июнь", "Июль", "Авг.", "Сент.", "Окт.", "Нояб.", "Дек."]

/** "01 Окт. 2026 - 31 Окт. 2026" for the current month. */
export function monthRangeLabel(date = new Date()) {
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  const month = SHORT_MONTHS_CAP[date.getMonth()]
  return `01 ${month} ${date.getFullYear()} - ${last} ${month} ${date.getFullYear()}`
}

/** "Виджеты" title row with the shared tab strip of the dashboard widgets. */
export function WidgetHeader({ active }: { active: (typeof WIDGET_TABS)[number] }) {
  const router = useRouter()
  const { t } = useLanguage()
  return (
    <div className="pl-[30px] pr-[30px]">
      <RefHeader title={t("Виджеты")}>
        <nav className="mt-[5px] flex gap-[9px]">
          {WIDGET_TABS.map((tab) => (
            <button key={tab} type="button" onClick={() => router.push(WIDGET_HREF[tab])} className={`h-[30px] min-w-[51px] rounded-[3px] px-[16px] text-[13px] font-normal shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-colors ${tab === active ? "bg-[#2bcd53] text-white" : "bg-white text-black hover:bg-[#f2f5f8]"}`}>{t(tab)}</button>
          ))}
        </nav>
      </RefHeader>
    </div>
  )
}

const PERIODS = ["СЕГОДНЯ", "ВЧЕРА", "ПОСЛ. 7", "МЕСЯЦ", "СВОЯ"]

/** The signed-in user's name (GET /api/auth/me) and this server's address, both filled
 * after mount — never a placeholder person or another company's server. */
export function useSignedInLine(): { name: string; origin: string } {
  const [name, setName] = useState("")
  const [origin, setOrigin] = useState("")
  useEffect(() => {
    let cancelled = false
    setOrigin(window.location.origin)
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { displayName?: string } | null) => {
        if (!cancelled && data?.displayName) setName(data.displayName)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return { name, origin }
}

/** White card with the avatar / server line and (optionally) the date range + period buttons. */
export function WidgetUserCard({
  range,
  period,
  onPeriod,
  showPeriods = true,
  children,
}: {
  range?: string
  period?: string
  onPeriod?: (value: string) => void
  showPeriods?: boolean
  children?: ReactNode
}) {
  const { t } = useLanguage()
  const { name, origin } = useSignedInLine()
  const [inner, setInner] = useState("МЕСЯЦ")
  const current = period ?? inner
  return (
    <section className="mx-[30px] flex h-[76px] items-center bg-white pl-[30px] pr-[38px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <span className="mr-[10px] flex h-[30px] w-[30px] items-center justify-center overflow-hidden rounded-full bg-[#5d6474]">
        <svg viewBox="0 0 24 24" className="mt-[6px] h-[30px] w-[30px] fill-[#cfd3dc]" aria-hidden><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
      </span>
      <span className="mr-[5px] text-[16px] font-semibold text-[#333]">{name}</span>
      {origin && <span className="text-[12px] font-semibold text-[#999]">{t("Сервер")}: ({origin})</span>}
      {showPeriods && (
        <>
          <strong className="ml-auto mr-[15px] text-[12px] font-bold text-[#4f71dc]">{t(range ?? monthRangeLabel())}</strong>
          <div className="mr-[12px] flex overflow-hidden rounded-[3px] shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
            {PERIODS.map((item) => (
              <button key={item} type="button" onClick={() => (onPeriod ? onPeriod(item) : setInner(item))} className={`h-[30px] px-4 text-[13px] font-medium uppercase transition-colors ${current === item ? "bg-[#4f71dc] text-white" : "bg-white text-black hover:bg-[#f2f5f8]"}`}>{t(item)}</button>
            ))}
          </div>
        </>
      )}
      {children}
    </section>
  )
}
