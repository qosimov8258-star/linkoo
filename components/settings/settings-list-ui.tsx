"use client"

import { ChevronDown } from "lucide-react"
import { ReactNode, useEffect, useRef, useState } from "react"

import { Modal, SaveLink } from "@/components/analytics/catalog-ui"
import { formatReportDate, ReportCalendar } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"

/** Toolbar of the reference's plain settings lists: left slot, search, page-size menu, counter and arrows. */

export const SETTINGS_PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000] as const

export function SettingsPageSize({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex h-8 items-center gap-1 text-[#333]">
        {value}
        <ChevronDown className="h-3.5 w-3.5 text-slate-300" />
      </button>
      {open && (
        <ul className="absolute -left-4 top-[-6px] z-30 w-[60px] bg-white py-2 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {SETTINGS_PAGE_SIZES.map((size) => (
            <li key={size}>
              <button
                type="button"
                onClick={() => {
                  onChange(size)
                  setOpen(false)
                }}
                className={`block h-8 w-full px-4 text-left ${size === value ? "text-[#5d6474]" : "text-[#333]"} hover:bg-[#f4f6f8]`}
              >
                {size}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function SettingsPager({ page, pageSize, count, onPage, onPageSize }: { page: number; pageSize: number; count: number; onPage: (page: number) => void; onPageSize: (size: number) => void }) {
  const { t } = useLanguage()
  const lastPage = Math.max(1, Math.ceil(count / pageSize))
  const current = Math.min(page, lastPage)
  const from = (current - 1) * pageSize + 1
  const to = Math.min(current * pageSize, count)
  const prev = current > 1
  const next = current < lastPage
  return (
    <div className="ml-auto flex items-center pr-[7px] text-[13px] text-[#333]">
      <SettingsPageSize value={pageSize} onChange={onPageSize} />
      <span className="ml-[34px]">{from} - {to} {t("из")} {count}</span>
      <button type="button" onClick={() => prev && onPage(current - 1)} disabled={!prev} aria-label={t("Назад")} className="ml-[22px] flex h-6 w-6 items-center justify-center">
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${prev ? "fill-black/55" : "fill-black/30"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
      </button>
      <button type="button" onClick={() => next && onPage(current + 1)} disabled={!next} aria-label={t("Вперед")} className="ml-[5px] flex h-6 w-6 items-center justify-center">
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${next ? "fill-black/55" : "fill-black/30"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
      </button>
    </div>
  )
}

export function SettingsSearch({ value, onChange, className = "w-[182px]" }: { value: string; onChange: (value: string) => void; className?: string }) {
  const { t } = useLanguage()
  return (
    <label className={`relative block ${className}`}>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={t("Поиск")} className="h-[30px] w-full border-b border-[#e0e0e0] bg-transparent pr-8 text-[13px] outline-none placeholder:text-[#b9c0cc] focus:border-[#5d6474] focus:shadow-[inset_0_-1px_0_#5d6474]" />
      <svg viewBox="0 0 24 24" className="absolute right-2 top-1.5 h-[18px] w-[18px] fill-[#c4cad4]"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
    </label>
  )
}

/** 60px strip: optional left content, search, then the pager on the right. */
export function SettingsToolbar({ left, search, pager, className = "h-[60px] pl-[15px] pt-[4px]" }: { left?: ReactNode; search: ReactNode; pager: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center whitespace-nowrap ${className}`}>
      {left}
      {search}
      {pager}
    </div>
  )
}

/** Dark pencil of the reference's non-hover row actions. */
export function RowPencil({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="absolute right-[34px] top-1/2 -translate-y-1/2 text-[#5d6474] hover:text-[#3f4757]">
      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
    </button>
  )
}

/** Round radio of the reference dialogs (dark ring, filled dot when chosen). */
export function RadioRow({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-[18px] text-[13px]">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${checked ? "border-[#5d6474]" : "border-[#555]"}`}>
        {checked && <span className="h-[10px] w-[10px] rounded-full bg-[#5d6474]" />}
        <input type="radio" checked={checked} onChange={onChange} className="sr-only" />
      </span>
      {label}
    </label>
  )
}

/** Underlined date field of the reference dialogs: the label is the placeholder, a calendar icon opens the date picker. */
export function DateLineField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  const { language } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative h-[40px] cursor-pointer border-b border-[#d5dae1]" onClick={() => setOpen(true)}>
      <span className={`pointer-events-none absolute left-0 ${value ? "top-0 text-[10px] font-semibold leading-3" : "top-[16px] text-[13px] leading-4"}`}>
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      {value && <span className="absolute inset-x-0 bottom-[6px] text-[13px]">{formatReportDate(value, language)}</span>}
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[2px] right-0 h-5 w-5 fill-[#c4c4c4]" aria-hidden>
        <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" />
      </svg>
      {open && (
        <ReportCalendar
          value={value || new Date().toISOString().slice(0, 10)}
          onCancel={() => setOpen(false)}
          onPick={(picked) => {
            onChange(picked)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

/** "Подтверждение удаления" dialog of the reference (question, grey band with the item name, blue УДАЛИТЬ link). */
export function ConfirmDeleteDialog({ name, busy, error, onConfirm, onClose }: { name: string; busy?: boolean; error?: string; onConfirm: () => void; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <Modal title={t("Подтверждение удаления")} onClose={onClose} footer={<SaveLink disabled={busy} onClick={onConfirm}>{t("Удалить")}</SaveLink>}>
      <div className="-mt-[4px] min-h-[166px]">
        <p className="text-[13px]">{t("Вы уверены что хотите удалить эти данные?")}</p>
        <div className="-mx-[30px] mt-[21px] flex h-[55px] items-center bg-[#f2f5f8] px-[30px] font-semibold">{name}</div>
        {error && <p className="mt-3 text-[13px] text-red-500">{t(error)}</p>}
      </div>
    </Modal>
  )
}
