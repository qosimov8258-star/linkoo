"use client"

import { ArrowDown, ArrowUp, ChevronDown, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { Modal, SaveLink } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"

/** Shared pieces of the reference's plain settings lists (Смены, Должности, Транспорт, Валюты): toolbar with search, page size and pager, grid, row actions. */

export const PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000]

export const kitHead = "grid h-[50px] items-center bg-[#5d6474] text-[13px] font-semibold text-white"
// Row geometry measured on the reference: 50px minimum, 16px lines (a two-line cell still fits 50px) and the dotted
// separator drawn as an overlay so the text centres on the full row height.
export const kitRow =
  "group relative grid min-h-[50px] items-center leading-[16px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] last:after:hidden hover:bg-[#f2f5f8] [&>span]:!py-px"

export function useListControls(defaultPageSize = 25) {
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)
  return {
    query,
    setQuery: (value: string) => { setQuery(value); setPage(1) },
    page,
    setPage,
    pageSize,
    setPageSize: (value: number) => { setPageSize(value); setPage(1) },
  }
}

export function usePaged<T>(items: T[], page: number, pageSize: number) {
  return useMemo(() => {
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
    const safePage = Math.min(page, pageCount)
    const start = (safePage - 1) * pageSize
    const rows = items.slice(start, start + pageSize)
    return { rows, page: safePage, pageCount, from: items.length ? start + 1 : 0, to: start + rows.length, total: items.length }
  }, [items, page, pageSize])
}

export function PageSizeSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
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
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex items-center gap-[5px] text-[13px]">
        {value}<ChevronDown className="h-4 w-4 fill-current text-[#ccc]" />
      </button>
      {open && (
        <ul className="absolute -left-[1px] -top-[15px] z-30 w-[96px] rounded-[2px] bg-white py-[6px] shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {PAGE_SIZES.map((size) => (
            <li key={size}>
              <button type="button" onClick={() => { onChange(size); setOpen(false) }} className={`block h-[32px] w-full pl-[29px] text-left text-[13px] hover:bg-[#f2f5f8] ${size === value ? "font-semibold" : ""}`}>{size}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function PagerArrow({ dir, onClick }: { dir: "prev" | "next"; onClick?: () => void }) {
  const { t } = useLanguage()
  const path = dir === "prev"
    ? "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z"
    : "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z"
  return (
    <button type="button" onClick={onClick} disabled={!onClick} aria-label={dir === "prev" ? t("Назад") : t("Вперед")} className="flex h-6 w-6 items-center justify-center">
      <svg viewBox="0 0 24 24" className={`h-6 w-6 ${onClick ? "fill-black/70" : "fill-black/30"}`}><path d={path} /></svg>
    </button>
  )
}

export type ListPager = { pageSize: number; onPageSize: (value: number) => void; from: number; to: number; total: number; onPrev?: () => void; onNext?: () => void }

/** "+ add" link, centered search, page size, counter and arrows (60px strip under the top bar). */
export function SettingsToolbar({
  left,
  right,
  query,
  onQuery,
  pager,
  searchClassName = "left-[335px] top-[20px]",
  searchWidth = 295,
  className = "h-[60px] pt-[10px]",
}: {
  left?: ReactNode
  right?: ReactNode
  query: string
  onQuery: (value: string) => void
  pager: ListPager
  searchClassName?: string
  searchWidth?: number
  className?: string
}) {
  const { t } = useLanguage()
  return (
    <div className={`relative flex items-center whitespace-nowrap text-[13px] text-[#333] ${className}`}>
      {left}
      <label style={{ width: searchWidth }} className={`absolute ${searchClassName}`}>
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t("Поиск")} className="h-[30px] w-full border-b border-[#dfe3ea] bg-transparent pr-8 text-[13px] outline-none placeholder:text-[#b9c0cc] focus:border-[#4c6dd4]" />
        <svg viewBox="0 0 24 24" className="absolute right-1 top-1.5 h-[20px] w-[20px] fill-[#c4cad4]"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
      </label>
      <div className="ml-auto flex items-center pr-[4px]">
        <PageSizeSelect value={pager.pageSize} onChange={pager.onPageSize} />
        <span className="ml-[30px] text-[#5d6474]">{pager.from} - {pager.to} {t("из")} {pager.total}</span>
        <span className="ml-[10px] flex items-center gap-[6px]">
          <PagerArrow dir="prev" onClick={pager.onPrev} />
          <PagerArrow dir="next" onClick={pager.onNext} />
        </span>
        {right}
      </div>
    </div>
  )
}

export function AddLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="pl-[20px] pt-[2px] text-[13px] text-[#4f71dc] hover:underline">+ {children}</button>
}

/** Reference multi-column sort: keys are kept in click order, a second click flips the key to descending, a third drops it. */
export function toggleOrdering(ordering: string[], field: string): string[] {
  if (ordering.includes(field)) return [...ordering.filter((key) => key !== field), `-${field}`]
  if (ordering.includes(`-${field}`)) return ordering.filter((key) => key !== `-${field}`)
  return [...ordering, field]
}

export function SortHead({ label, field, ordering, onSort, className = "" }: { label: string; field: string; ordering: string[]; onSort: (field: string) => void; className?: string }) {
  const asc = ordering.includes(field)
  const desc = ordering.includes(`-${field}`)
  return (
    <button type="button" onClick={() => onSort(field)} className={`flex items-center gap-[10px] text-left font-bold ${className}`}>
      {label}
      {asc && <ArrowDown className="h-[14px] w-[14px]" />}
      {desc && <ArrowUp className="h-[14px] w-[14px]" />}
    </button>
  )
}

export function sortRows<T>(rows: T[], ordering: string[], accessors: Record<string, (row: T) => string | number>): T[] {
  if (!ordering.length) return rows
  return [...rows].sort((a, b) => {
    for (const key of ordering) {
      const desc = key.startsWith("-")
      const get = accessors[desc ? key.slice(1) : key]
      if (!get) continue
      const x = get(a)
      const y = get(b)
      if (x === y) continue
      return (x < y ? -1 : 1) * (desc ? -1 : 1)
    }
    return 0
  })
}

const PENCIL = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const TRASH = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"

export function RowIcon({ path, label, onClick }: { path: string; label: string; onClick: () => void }) {
  return (
    <span className="group/icon relative">
      <button type="button" aria-label={label} onClick={(event) => { event.stopPropagation(); onClick() }} className="flex h-[24px] w-[24px] items-center justify-center text-[#666]">
        <svg viewBox="0 0 24 24" className="h-[20px] w-[20px] fill-current"><path d={path} /></svg>
      </button>
      <span className="pointer-events-none absolute left-1/2 top-[34px] z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-[2px] bg-[#616161]/90 px-[14px] py-[7px] text-[13px] font-semibold text-white group-hover/icon:block">{label}</span>
    </span>
  )
}

export const ROW_ICONS = { pencil: PENCIL, trash: TRASH, dollar: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.9 2.02.51 4.18 1.36 4.18 3.88 0 1.84-1.38 2.85-3.12 3.2z" }

/** Pencil / trash (and optional extras) at the right edge of a row; always visible or only while the row is hovered. */
export function RowActions({ onEdit, onDelete, always, right = 66, gap = 7, extra }: { onEdit?: () => void; onDelete?: () => void; always?: boolean; right?: number; gap?: number; extra?: ReactNode }) {
  const { t } = useLanguage()
  return (
    <span style={{ right, gap }} className={`absolute top-1/2 -translate-y-1/2 items-center ${always ? "flex" : "hidden group-hover:flex"}`}>
      {extra}
      {onEdit && <RowIcon path={PENCIL} label={t("Изменить")} onClick={onEdit} />}
      {onDelete && <RowIcon path={TRASH} label={t("Удалить")} onClick={onDelete} />}
    </span>
  )
}

/** "Подтверждение удаления" dialog; `name` is the grey strip with the record title (absent in some lists). */
export function ConfirmDeleteDialog({ name, busy, onConfirm, onClose }: { name?: string; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <Modal
      title={t("Подтверждение удаления")}
      onClose={onClose}
      bodyClassName="h-[210px] text-[13px]"
      footer={<SaveLink disabled={busy} onClick={onConfirm}>{t("Удалить")}</SaveLink>}
    >
      <p className="px-[30px] pt-[18px]">{t("Вы уверены что хотите удалить эти данные?")}</p>
      {name !== undefined && <div className="mt-[18px] flex h-[56px] items-center bg-[#f1f5f8] px-[30px] font-semibold">{name}</div>}
    </Modal>
  )
}

export function EmptyRows() {
  const { t } = useLanguage()
  return (
    <div className="flex h-[276px] flex-col items-center pt-[58px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="h-[162px] w-[162px] object-contain" />
      <p className="mt-[8px] text-[13px] text-[#6b7280]">{t("По вашему запросу ничего не найдено")}</p>
    </div>
  )
}

export type PickItem = { value: string; label: string }

/** Underlined select of the reference's dialogs: floating label, × to clear, ▾, plain option list. */
export function LinePick({
  label,
  value,
  options,
  onChange,
  required,
  clearable = true,
  error,
}: {
  label: string
  value: string
  options: PickItem[]
  onChange: (value: string) => void
  required?: boolean
  clearable?: boolean
  error?: string
}) {
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
  const selected = options.find((option) => option.value === value)
  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} className={`relative block h-[40px] w-full border-b text-left ${error ? "border-[#e57373]" : "border-[#d5dae1]"}`}>
        <span className={`absolute left-0 ${selected ? "-top-[8px] text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>
          {label}{required && <span className="text-red-500"> *</span>}
        </span>
        {selected && <span className="absolute inset-x-0 bottom-[3px] truncate pr-12 text-[13px]">{selected.label}</span>}
        <span className="absolute bottom-[8px] right-0 flex items-center gap-[10px] text-[#999]">
          {selected && clearable && <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange("") }}><X className="h-3.5 w-3.5" /></span>}
          <ChevronDown className="h-4 w-4 fill-current" />
        </span>
      </button>
      {error && <span className="mt-[2px] block text-[12px] text-[#e57373]">{error}</span>}
      {open && (
        <ul className="absolute left-0 right-0 top-[40px] z-20 max-h-[240px] overflow-y-auto bg-white py-[6px] shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {options.map((option) => (
            <li key={option.value}>
              <button type="button" onClick={() => { onChange(option.value); setOpen(false) }} className={`block h-[32px] w-full px-[10px] text-left text-[13px] font-semibold ${option.value === value ? "bg-[#e3effd] text-[#333]" : "text-[#666] hover:bg-[#f2f5f8]"}`}>{option.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
