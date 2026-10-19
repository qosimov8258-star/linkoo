"use client"

import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react"
import { ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

/** Shared pieces of the reference's settings/catalog pages (link + pager header, dotted table, 700px dialog). */
export function CatalogHeader({ addLabel, onAdd, from, to, total, onPrev, onNext, extra }: { addLabel: string; onAdd: () => void; from: number; to: number; total: number; onPrev?: () => void; onNext?: () => void; extra?: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="flex h-[65px] items-center justify-between border-b border-[#eef0f4] pt-[14px]">
      <div className="flex items-center">
        <button type="button" onClick={onAdd} className="pl-[15px] text-[13px] text-[#4f71dc] hover:underline">+ {addLabel}</button>
        {extra}
      </div>
      <div className="flex items-center pr-[3px] text-[13px]">
        <span>{from} - {to} {t("из")} {total}</span>
        <button type="button" onClick={onPrev} disabled={!onPrev} aria-label={t("Назад")} className="ml-[22px] flex h-6 w-6 items-center justify-center">
          <svg viewBox="0 0 24 24" className={`h-6 w-6 ${onPrev ? "fill-black/55" : "fill-black/30"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
        </button>
        <button type="button" onClick={onNext} disabled={!onNext} aria-label={t("Вперед")} className="ml-[5px] flex h-6 w-6 items-center justify-center">
          <svg viewBox="0 0 24 24" className={`h-6 w-6 ${onNext ? "fill-black/55" : "fill-black/30"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
        </button>
      </div>
    </div>
  )
}

export const dottedRow = "border-b-2 border-dotted border-[#d9e0e5]"

export function Modal({ title, onClose, footer, children }: { title: string; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  const { t } = useLanguage()
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-[500px] max-w-full bg-white text-[13px] text-[#333] shadow-xl">
        <header className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[28px]">
          <h3 className="text-[13px] font-bold uppercase">{title}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800"><X className="h-6 w-6" /></button>
        </header>
        <div className="px-[30px] pb-[24px] pt-[24px]">{children}</div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#e8ebf0] pr-[10px]">{footer}</footer>
      </div>
    </div>,
    document.body,
  )
}

export function SaveButton({ disabled, onClick, children }: { disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type={onClick ? "button" : "submit"} onClick={onClick} disabled={disabled} className="h-9 min-w-[111px] rounded-[3px] bg-[#71ce87] px-[16px] text-[12px] font-bold uppercase text-white hover:brightness-95 disabled:bg-[#ade3b9]">
      {children}
    </button>
  )
}

export function SaveLink({ disabled, onClick, children }: { disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type={onClick ? "button" : "submit"} onClick={onClick} disabled={disabled} className="h-9 px-[16px] text-[12px] font-bold uppercase text-[#1ea1f2] hover:opacity-80 disabled:opacity-40">
      {children}
    </button>
  )
}

export function ToggleRow({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-[10px] text-[13px] font-semibold">
      <span className={`relative inline-block h-[14px] w-[34px] rounded-full ${checked ? "bg-[#9fb1f5]" : "bg-[#c8c8c8]"}`}>
        <span className={`absolute top-[-3px] h-[20px] w-[20px] rounded-full shadow ${checked ? "left-[16px] bg-[#4f71dc]" : "left-[-2px] bg-[#f1f1f1]"}`} />
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      </span>
      {label}
    </label>
  )
}

/** Underlined input; the label sits inside while empty and floats above once filled. */
export function LineField({ label, value, onChange, required, autoFocus }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; autoFocus?: boolean }) {
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className="relative h-[40px] border-b border-[#d5dae1]">
      <span className={`pointer-events-none absolute left-0 transition-all ${floating ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      <input value={value} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent text-[13px] outline-none" />
    </div>
  )
}

export function LineSelect({ label, value, onChange, options, onClear, required, tall }: { label: string; value: string; onChange: (value: string) => void; options: string[]; onClear?: () => void; required?: boolean; tall?: boolean }) {
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
      <button type="button" onClick={() => setOpen((current) => !current)} className={`relative block w-full border-b border-[#d5dae1] text-left ${tall ? "h-[56px]" : "h-[40px]"}`}>
        <span className={`absolute left-0 ${value ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>
          {label}{required && <span className="text-red-500"> *</span>}
        </span>
        {value && <span className={`absolute inset-x-0 truncate pr-12 text-[13px] ${tall ? "bottom-[10px]" : "bottom-[6px]"}`}>{value}</span>}
        <span className={`absolute right-0 flex items-center gap-[10px] text-slate-500 ${tall ? "bottom-[12px]" : "bottom-[8px]"}`}>
          {value && onClear && <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onClear() }}><X className="h-3.5 w-3.5" /></span>}
          <ChevronDown className="h-4 w-4 fill-current" />
        </span>
      </button>
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-60 overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {options.length === 0 ? (
            <li className="px-3 py-2 font-semibold text-slate-400">—</li>
          ) : (
            options.map((option, index) => (
              <li key={`${option}-${index}`}>
                <button type="button" onClick={() => { onChange(option); setOpen(false) }} className={`block w-full px-3 py-2 text-left font-semibold ${option === value ? "bg-[#e3effd] text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}>{option}</button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

export function CheckBox({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-[8px] text-[13px] font-semibold">
      <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border-2 ${checked ? "border-[#5d6474] bg-[#5d6474]" : "border-[#555]"}`}>
        {checked && <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="#fff" strokeWidth="2" /></svg>}
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      </span>
      {label}
    </label>
  )
}

/** Top bar of the reference's catalog lists: "+ add" link, optional search, page size, counter and arrows. */
export function ListToolbar({
  addLabel,
  onAdd,
  bigPlus,
  query,
  onQuery,
  pageSize,
  from,
  to,
  total,
  onPrev,
  onNext,
  extra,
  hideAdd,
  compact,
  slim,
}: {
  addLabel: string
  onAdd: () => void
  hideAdd?: boolean
  compact?: boolean
  /** 50px strip with the add-link near the top (client types). */
  slim?: boolean
  bigPlus?: boolean
  query?: string
  onQuery?: (value: string) => void
  pageSize?: number
  from?: number
  to?: number
  total?: number
  onPrev?: () => void
  onNext?: () => void
  extra?: ReactNode
}) {
  const { t } = useLanguage()
  return (
    <div className={`relative flex items-center whitespace-nowrap pr-[7px] text-[13px] text-[#333] ${slim ? "h-[50px]" : compact ? "h-[51px]" : "h-[60px]"}`}>
      {!hideAdd && (
        <button type="button" onClick={onAdd} className={`flex items-center gap-[6px] pl-[20px] text-[13px] text-[#4f71dc] hover:underline ${slim ? "pt-[4px]" : "pt-[8px]"}`}>
          <span className={bigPlus ? "text-[26px] font-light leading-none" : ""}>+</span>
          {addLabel}
        </button>
      )}
      {extra}
      {onQuery && (
        <label className="absolute left-[360px] top-[15px] w-[300px]">
          <input value={query ?? ""} onChange={(event) => onQuery(event.target.value)} placeholder={t("Поиск")} className="h-[30px] w-full border-b border-[#dfe3ea] bg-transparent pr-8 text-[13px] outline-none placeholder:text-[#b9c0cc] focus:border-[#4c6dd4]" />
          <svg viewBox="0 0 24 24" className="absolute right-2 top-1.5 h-[18px] w-[18px] fill-[#c4cad4]"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
        </label>
      )}
      <div className="ml-auto flex items-center pt-[4px]">
        {pageSize !== undefined && (
          <span className="flex items-center gap-1">
            {pageSize}<ChevronDown className="h-3.5 w-3.5 text-slate-300" />
          </span>
        )}
        {total !== undefined && <span className="ml-[34px]">{from} - {to} {t("из")} {total}</span>}
        {total !== undefined && (
          <>
            <button type="button" onClick={onPrev} disabled={!onPrev} aria-label={t("Назад")} className="ml-[12px] flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-slate-400"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={onNext} disabled={!onNext} aria-label={t("Вперед")} className="ml-[9px] flex h-5 w-5 items-center justify-center rounded-full border border-slate-700 text-slate-700 disabled:border-slate-300 disabled:text-slate-400"><ChevronRight className="h-4 w-4" /></button>
          </>
        )}
      </div>
    </div>
  )
}

export const grayHead = "grid h-[50px] items-center bg-[#5d6474] pl-[30px] font-bold text-white"
export const listRow = "group relative grid min-h-[50px] items-center border-b-2 border-dotted border-[#d9e0e5] pl-[30px] hover:bg-[#f8f9fb]"

/** Pencil + trash that appear on row hover, like the reference. */
export function HoverActions({ onEdit, onDelete, offset = 34 }: { onEdit: () => void; onDelete?: () => void; offset?: number }) {
  const { t } = useLanguage()
  return (
    <span style={{ right: offset }} className="absolute top-1/2 hidden -translate-y-1/2 items-center gap-[10px] text-[#bdbdbd] group-hover:flex">
      <button type="button" onClick={(event) => { event.stopPropagation(); onEdit() }} aria-label={t("Изменить")} className="hover:text-[#757575]"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg></button>
      {onDelete && <button type="button" onClick={(event) => { event.stopPropagation(); onDelete() }} aria-label={t("Удалить")} className="hover:text-[#757575]"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg></button>}
    </span>
  )
}

export function EmptyState() {
  const { t } = useLanguage()
  return (
    <div className="flex h-[276px] flex-col items-center pt-[58px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="h-[162px] w-[162px] object-contain" />
      <p className="mt-[8px] text-[13px] text-[#6b7280]">{t("По вашему запросу ничего не найдено")}</p>
    </div>
  )
}

/** Small "Импорт с excel" modal used by the catalog pages. */
export function ImportDialog({ file, onFile, onTemplate, onSave, saving, onClose }: { file: File | null; onFile: (file: File | null) => void; onTemplate: () => void; onSave: () => void; saving: boolean; onClose: () => void }) {
  const { t } = useLanguage()
  const inputRef = useRef<HTMLInputElement>(null)
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-[400px] bg-white text-[13px] text-[#333] shadow-xl">
        <header className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[27px]">
          <h3 className="text-[13px] font-bold uppercase">{t("Импорт с excel")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800"><X className="h-6 w-6" /></button>
        </header>
        <div className="p-[30px]">
          <div className="border border-[#e8ebf0] px-[20px] pb-[20px] pt-[18px]">
            <button type="button" onClick={onTemplate} className="block w-full text-center text-[13px] uppercase hover:text-[#4f71dc]">{t("1. Скачать шаблон")}</button>
            <div onClick={() => inputRef.current?.click()} className="mt-[10px] flex h-[200px] cursor-pointer flex-col items-center justify-center gap-[10px] border border-dashed border-[#c9ced6] text-center">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-black"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" /></svg>
              <span className="whitespace-nowrap text-[13px]">{file ? file.name : t("Добавьте файл Excel или нажмите для выбора")}</span>
            </div>
            <input ref={inputRef} type="file" accept=".csv,.xls,.xlsx" onChange={(event) => { onFile(event.target.files?.[0] ?? null); event.target.value = "" }} className="hidden" />
          </div>
        </div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
          <SaveButton disabled={!file || saving} onClick={onSave}>{saving ? t("Импорт...") : t("Сохранить")}</SaveButton>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
