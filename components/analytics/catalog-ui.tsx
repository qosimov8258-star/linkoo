"use client"

import { ChevronDown, X } from "lucide-react"
import { ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

/** Shared pieces of the reference's settings/catalog pages (link + pager header, dotted table, 700px dialog). */
export function CatalogHeader({ addLabel, onAdd, from, to, total, onPrev, onNext, extra, tight }: { addLabel: string; onAdd: () => void; from: number; to: number; total: number; onPrev?: () => void; onNext?: () => void; extra?: ReactNode; /** Pager hugs the right edge with a 10 px gap before the arrows (client attribute pages). */ tight?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="flex h-[65px] items-center justify-between border-b border-[#eef0f4] pt-[14px]">
      <div className="flex items-center">
        <button type="button" onClick={onAdd} className="pl-[15px] text-[13px] text-[#4f71dc] hover:underline">+ {t(addLabel)}</button>
        {extra}
      </div>
      <div className={`flex items-center text-[13px] ${tight ? "" : "pr-[3px]"}`}>
        <span>{from} - {to} {t("из")} {total}</span>
        <button type="button" onClick={onPrev} disabled={!onPrev} aria-label={t("Назад")} className={`${tight ? "ml-[10px]" : "ml-[22px]"} flex h-6 w-6 items-center justify-center`}>
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

/** True when no other overlay covers `root` (a dialog opened on top of this one gets Escape first). */
function isTopmost(root: HTMLElement | null): boolean {
  if (!root) return false
  const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
  return !top || root.contains(top)
}

export function Modal({ title, onClose, footer, children, width = 500, bodyClassName = "px-[30px] pb-[24px] pt-[24px]", titleClassName = "text-[13px]", headerClassName = "pl-[30px]", anchorTop = false, scrollAll = false, closeInset = "pr-[15px]", footerClassName = "", escapeCloses = true }: { escapeCloses?: boolean; footerClassName?: string; closeInset?: string; title: string; onClose: () => void; footer: ReactNode; children: ReactNode; width?: number; bodyClassName?: string; titleClassName?: string; headerClassName?: string; anchorTop?: boolean | number; scrollAll?: boolean }) {
  const { t } = useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  // The reference's modal dialogs (Должности, Кассы, Права доступа, Типы клиентов) ignore clicks on the dim backdrop:
  // they close with × / Cancel. Escape closes the topmost dialog (app rule); `escapeCloses={false}` opts out.
  useEffect(() => {
    if (!escapeCloses) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented && isTopmost(rootRef.current)) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, escapeCloses])
  return createPortal(
    // Reference rule (old Material-UI Dialog, measured on 25 dialogs from 267 px to 1905 px): the dialog is centered by its
    // height at open time and never closer than 80 px to the top (tall ones: y = 80 and the page scrolls). So the default is
    // centered; `anchorTop` is only for the few dialogs that were measured while taller than they end up (Категории
    // приходов/расходов y=64, Права доступа y=50, Тип отказа y=263.5, Настройка EXCEL y=80).
    <div ref={rootRef} className={`fixed inset-0 z-[100] flex justify-center bg-black/[0.54] ${anchorTop ? "items-start overflow-y-auto" : "items-center"}`} style={anchorTop ? { paddingTop: typeof anchorTop === "number" ? anchorTop : 64 } : undefined}>
      {/* scrollAll: like the reference's long dialogs (Настройка EXCEL): the whole card scrolls (max 100vh − 128px), the title stays, the footer sits at the end of the content */}
      <div style={{ width }} className={`max-w-full bg-white text-[13px] text-black shadow-[0_11px_15px_-7px_rgba(0,0,0,0.2),0_24px_38px_3px_rgba(0,0,0,0.14),0_9px_46px_8px_rgba(0,0,0,0.12)] ${scrollAll ? "max-h-[calc(100vh-128px)] overflow-y-auto" : ""}`}>
        <header className={`flex h-[60px] items-center justify-between border-b border-[#e8ebf0] ${headerClassName} ${closeInset} ${scrollAll ? "sticky top-0 z-[1] bg-white" : ""}`}>
          <h3 className={`${titleClassName} font-bold uppercase text-[#333]`}>{t(title)}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#333] hover:opacity-70"><X className="h-6 w-6" strokeWidth={1.6} /></button>
        </header>
        <div className={bodyClassName}>{children}</div>
        <footer className={`flex h-[57px] items-center justify-end border-t border-[#e8ebf0] pr-[10px] ${footerClassName}`}>{footer}</footer>
      </div>
    </div>,
    document.body,
  )
}

export function SaveButton({ disabled, onClick, children }: { disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type={onClick ? "button" : "submit"} onClick={onClick} disabled={disabled} className="h-9 min-w-[111px] cursor-pointer rounded-[5px] bg-[#71ce87] px-[16px] text-[13px] font-semibold uppercase text-white hover:brightness-95 disabled:cursor-default">
      {children}
    </button>
  )
}

export function SaveLink({ disabled, onClick, children }: { disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type={onClick ? "button" : "submit"} onClick={onClick} disabled={disabled} className="h-9 px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:opacity-80 disabled:opacity-40">
      {children}
    </button>
  )
}

export function ToggleRow({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  const { t } = useLanguage()
  return (
    <label className="flex cursor-pointer items-center gap-[10px] text-[13px] font-semibold">
      <span className={`relative inline-block h-[14px] w-[34px] rounded-full ${checked ? "bg-[#9fb1f5]" : "bg-[#c8c8c8]"}`}>
        <span className={`absolute top-[-3px] h-[20px] w-[20px] rounded-full shadow ${checked ? "left-[16px] bg-[#4f71dc]" : "left-[-2px] bg-[#f1f1f1]"}`} />
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      </span>
      {t(label)}
    </label>
  )
}

/** Underlined input; the label sits inside while empty and floats above once filled. */
export function LineField({ label, value, onChange, required, autoFocus, flush }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; autoFocus?: boolean; flush?: boolean }) {
  const { t } = useLanguage()
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className="relative h-[40px] border-b border-[#d5dae1]">
      <span className={`pointer-events-none absolute left-0 transition-all ${floating ? `${flush ? "-top-[1.2px]" : "top-0"} text-[10px] font-semibold leading-3` : "top-[18px] text-[13px] font-semibold leading-4"}`}>
        {t(label)}{required && <span className="font-semibold text-[#e57373]"> *</span>}
      </span>
      <input value={value} autoFocus={autoFocus} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className={`absolute inset-x-0 h-[26px] bg-transparent text-[13px] font-semibold outline-none ${flush ? "-bottom-px" : "bottom-0"}`} />
    </div>
  )
}

export function LineSelect({ label, value, onChange, options, onClear, required, tall }: { label: string; value: string; onChange: (value: string) => void; options: string[]; onClear?: () => void; required?: boolean; tall?: boolean }) {
  const { t } = useLanguage()
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
        <span className={`absolute left-0 ${value ? "top-0 text-[10px] font-semibold leading-3" : `${tall ? "top-[33px]" : "top-[18px]"} text-[13px] font-semibold leading-4`}`}>
          {t(label)}{required && <span className="font-semibold text-[#e57373]"> *</span>}
        </span>
        {value && <span className={`absolute inset-x-0 truncate pr-12 text-[13px] font-semibold ${tall ? "bottom-[10px]" : "bottom-[6px]"}`}>{value}</span>}
        <span className={`absolute right-0 flex items-center gap-[10px] text-slate-500 ${tall ? "bottom-[12px]" : "bottom-[8px]"}`}>
          {value && onClear && <span role="button" aria-label={t("Очистить")} onClick={(event) => { event.stopPropagation(); onClear() }}><X className="h-3.5 w-3.5" /></span>}
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
  const { t } = useLanguage()
  return (
    <label className="flex cursor-pointer items-center gap-[8px] text-[13px] font-semibold">
      <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border-2 ${checked ? "border-[#5d6474] bg-[#5d6474]" : "border-[#555]"}`}>
        {checked && <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="#fff" strokeWidth="2" /></svg>}
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      </span>
      {t(label)}
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
  onPageSize,
  pageSizes = [10, 25, 50, 100, 200, 500, 1000, 2000],
  searchPos,
  addPad,
  hideTotal,
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
  /** Makes the "25 ▾" page-size indicator a menu (10 … 2000, like the reference). */
  onPageSize?: (size: number) => void
  pageSizes?: number[]
  /** Overrides the search box position (px from the toolbar's left / top). */
  searchPos?: { left: number; top: number }
  /** Top padding of the add link in px (default 4 for `slim`, else 8). */
  addPad?: number
  /** "1 - 25 из" without the total (a few reference lists). */
  hideTotal?: boolean
}) {
  const { t } = useLanguage()
  const [sizeOpen, setSizeOpen] = useState(false)
  const sizeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sizeOpen) return
    function onDown(event: MouseEvent) {
      if (!sizeRef.current?.contains(event.target as Node)) setSizeOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [sizeOpen])
  return (
    <div className={`relative flex items-center whitespace-nowrap pr-[5px] text-[13px] text-[#333] ${slim ? "h-[50px]" : compact ? "h-[51px]" : "h-[60px]"}`}>
      {!hideAdd && (
        <button type="button" onClick={onAdd} style={addPad !== undefined ? { paddingTop: addPad } : undefined} className={`flex items-center gap-[6px] pl-[20px] text-[13px] text-[#4f71dc] hover:underline ${addPad !== undefined ? "" : slim ? "pt-[4px]" : "pt-[8px]"}`}>
          <span className={bigPlus ? "text-[26px] font-light leading-none" : ""}>+</span>
          {t(addLabel)}
        </button>
      )}
      {extra}
      {onQuery && (
        <label style={{ left: searchPos?.left ?? 360, top: searchPos?.top ?? 15 }} className="absolute w-[300px]">
          <input value={query ?? ""} onChange={(event) => onQuery(event.target.value)} placeholder={t("Поиск")} className="h-[30px] w-full border-b border-[#e0e0e0] bg-transparent pr-8 text-[13px] outline-none placeholder:text-[#b9c0cc] focus:border-[#5d6474] focus:shadow-[inset_0_-1px_0_#5d6474]" />
          <svg viewBox="0 0 24 24" className="absolute right-2 top-1.5 h-[18px] w-[18px] fill-[#c4cad4]"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
        </label>
      )}
      <div className="ml-auto flex items-center pt-[4px]">
        {pageSize !== undefined && (
          <div ref={sizeRef} className="relative">
            <button type="button" onClick={() => onPageSize && setSizeOpen((open) => !open)} className={`flex items-center gap-1 ${onPageSize ? "" : "cursor-default"}`}>
              {pageSize}<ChevronDown className="h-3.5 w-3.5 text-slate-300" />
            </button>
            {sizeOpen && onPageSize && (
              <ul className="absolute left-[1px] top-[-15px] z-30 w-[96px] rounded-[2px] bg-white py-[4px] shadow-[0_2px_10px_rgba(0,0,0,0.25)]">
                {pageSizes.map((size) => (
                  <li key={size}>
                    <button type="button" onClick={() => { onPageSize(size); setSizeOpen(false) }} className={`block h-[32px] w-full pl-[28px] text-left ${size === pageSize ? "bg-[#e3effd]" : "hover:bg-[#f5f6f8]"}`}>{size}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {total !== undefined && <span className="ml-[34px]">{from} - {to} {t("из")}{hideTotal ? "" : ` ${total}`}</span>}
        {total !== undefined && (
          <>
            <button type="button" onClick={onPrev} disabled={!onPrev} aria-label={t("Назад")} className="ml-[10px] flex h-6 w-6 items-center justify-center"><svg viewBox="0 0 24 24" className={`h-6 w-6 ${onPrev ? "fill-black/55" : "fill-black/30"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg></button>
            <button type="button" onClick={onNext} disabled={!onNext} aria-label={t("Вперед")} className="ml-[5px] flex h-6 w-6 items-center justify-center"><svg viewBox="0 0 24 24" className={`h-6 w-6 ${onNext ? "fill-black/55" : "fill-black/30"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg></button>
          </>
        )}
      </div>
    </div>
  )
}

export const grayHead = "grid h-[50px] items-center bg-[#5d6474] pl-[30px] font-semibold text-white"
export const listRow = "group relative grid min-h-[50px] items-center border-b-2 border-dotted border-[#d9e0e5] pl-[30px] hover:bg-[#f2f5f8]"

/** Pencil + trash that appear on row hover, like the reference. */
export function HoverActions({ onEdit, onDelete, offset = 34 }: { onEdit: () => void; onDelete?: () => void; offset?: number }) {
  const { t } = useLanguage()
  return (
    <span style={{ right: offset }} className="absolute top-1/2 hidden -translate-y-1/2 items-center gap-[10px] text-[#666] group-hover:flex">
      <button type="button" onClick={(event) => { event.stopPropagation(); onEdit() }} aria-label={t("Изменить")} className="-mx-[5px] flex h-[25px] w-[30px] items-start justify-center hover:text-[#333]"><svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg></button>
      {onDelete && <button type="button" onClick={(event) => { event.stopPropagation(); onDelete() }} aria-label={t("Удалить")} className="-mx-[5px] flex h-[25px] w-[30px] items-start justify-center hover:text-[#333]"><svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg></button>}
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
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented && isTopmost(rootRef.current)) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/[0.54]">
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

/** The reference's modal alert for failed saves ("name: Это поле обязательно к заполнению" + OK). */
export function ErrorAlert({ message, onClose }: { message: string; onClose: () => void }) {
  const { t } = useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && isTopmost(rootRef.current)) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/[0.54]">
      <div className="flex h-[300px] w-[400px] max-w-full flex-col items-center bg-white px-[15px] pt-[24px] text-center text-[#333] shadow-xl">
        <span className="flex h-[48px] w-[48px] items-center justify-center rounded-full border-[3px] border-[#4f71dc] text-[30px] font-bold leading-none text-[#4f71dc]">!</span>
        <p className="mt-[13px] self-stretch whitespace-pre-line px-[5px] text-left text-[15px] font-semibold">{message}</p>
        <button type="button" autoFocus onClick={onClose} className="mb-[20px] mt-auto h-[40px] w-full rounded-[2px] bg-[#4f71dc] text-[13px] font-bold uppercase text-white hover:brightness-95">{t("Ок")}</button>
      </div>
    </div>,
    document.body,
  )
}

/** "Подтверждение удаления" dialog shared by the catalog lists. */
export function ConfirmDelete({ name, busy, onConfirm, onClose }: { name: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <Modal title={t("Подтверждение удаления")} onClose={onClose} bodyClassName="min-h-[210px] px-[30px] pt-[20px]" footer={<SaveLink disabled={busy} onClick={onConfirm}>{t("Удалить")}</SaveLink>}>
      <p className="pb-[20px]">{t("Вы уверены что хотите удалить эти данные?")}</p>
      {name && <div className="-mx-[30px] bg-[#f1f5f8] px-[30px] py-[20px] font-semibold">{name}</div>}
    </Modal>
  )
}
