"use client"

import { useState, type ReactNode } from "react"

import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

/**
 * Building blocks shared by the reference app's list pages: title row, tab strip,
 * summary band, toolbar and the grid-based table (13px base, #5d6474 header).
 */

export const RI = {
  warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  store: "M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z",
  map: "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z",
  card: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  chart: "M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z",
  add: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
  filter: "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z",
  checklist: "M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z",
  sync: "M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z",
  print: "M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z",
  download: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  trash: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  trend: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  undo: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  dollar: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
}

export function RefPage({ children }: { children: ReactNode }) {
  return <main className="min-h-screen bg-[#f2f5f8] px-7 pb-7 font-sans text-[13px] text-[#333]">{children}</main>
}

export function RefHeader({ title, children, left }: { title: ReactNode; children?: ReactNode; left?: ReactNode }) {
  return (
    <div className="flex h-[60px] items-center justify-between">
      <div className="flex items-center">
        <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          {title}
        </h1>
        {left}
      </div>
      <div className="flex items-center gap-[10px]">{children}</div>
    </div>
  )
}

export function RefButton({
  icon,
  label,
  onClick,
  green,
  red,
  disabled,
  type = "button",
}: {
  icon?: string
  label: ReactNode
  onClick?: () => void
  green?: boolean
  red?: boolean
  disabled?: boolean
  type?: "button" | "submit"
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-[30px] items-center whitespace-nowrap rounded-[5px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60 ${icon ? "pl-3" : "px-4"} ${green ? "bg-[#71ce87]" : red ? "bg-[#fa8072]" : "bg-[#4f71dc]"}`}
    >
      {icon && (
        <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white" aria-hidden>
          <path d={icon} />
        </svg>
      )}
      <span className={icon ? "pl-2 pr-4" : ""}>{label}</span>
    </button>
  )
}

export function RefIconButton({ path, label, onClick, color = "#666", active }: { path: string; label: string; onClick?: () => void; color?: string; active?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={`flex h-12 w-12 items-center justify-center ${active ? "bg-[#e8efff]" : ""}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: color }}>
        <path d={path} />
      </svg>
    </button>
  )
}

export function RefTabs({ labels, value, onChange }: { labels: string[]; value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  const index = Math.max(0, labels.indexOf(value))
  return (
    <div className="relative flex h-10 rounded-[2px] bg-white">
      {labels.map((label) => (
        <button key={label} type="button" onClick={() => onChange(label)} className="h-10 flex-1 whitespace-nowrap text-center text-[13px] font-medium text-black">
          {t(label)}
        </button>
      ))}
      <span
        className="absolute -bottom-[2px] left-0 h-[3px] bg-[#4f71dc] shadow-[0_-3px_10px_0_#5869f0] transition-transform duration-300"
        style={{ width: `${100 / labels.length}%`, transform: `translateX(${index * 100}%)` }}
      />
    </div>
  )
}

export function RefBand({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-x-6 border-b border-[#efefef] bg-[#5869f0] px-[5px] py-[9px] text-[13px] font-semibold text-white">{children}</div>
}

export const REF_SHADOW = "shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"

export function RefCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`${REF_SHADOW} ${className}`}>{children}</section>
}

export function RefToolbar({
  filterOpen,
  onToggleFilter,
  filterPanel,
  query,
  onQuery,
  pageSize,
  onPageSize,
  from,
  to,
  total,
  page,
  pageCount,
  onPage,
  icons,
  extra,
  hideFilter,
  linkFilter,
}: {
  filterOpen?: boolean
  onToggleFilter?: () => void
  filterPanel?: ReactNode
  query: string
  onQuery: (value: string) => void
  pageSize: number
  onPageSize: (value: number) => void
  from: number
  to: number
  total: number
  page: number
  pageCount: number
  onPage: (page: number) => void
  icons?: ReactNode
  extra?: ReactNode
  hideFilter?: boolean
  linkFilter?: boolean
}) {
  const { t } = useLanguage()
  return (
    <div className="relative flex h-[50px] items-center bg-white px-[5px]">
      <div className="w-[318px] shrink-0">
        {!hideFilter && (
          linkFilter ? (
            <button type="button" onClick={onToggleFilter} className="pl-[5px] text-[13px] text-[#4f71dc]">
              {filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")} ⌄
            </button>
          ) : (
          <button type="button" onClick={onToggleFilter} className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white hover:brightness-95">
            <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white"><path d={RI.filter} /></svg>
            <span className="pl-2 pr-4">{filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")}</span>
          </button>
          )
        )}
      </div>
      {filterOpen && <div className="absolute left-[5px] top-[46px] z-20">{filterPanel}</div>}
      <div className="relative ml-[18px] flex w-[248px] items-center">
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("Поиск")}
          className="h-12 w-full border-b border-[#e0e0e0] bg-transparent text-[13px] outline-none placeholder:text-black/30 focus:border-[#5d6474]"
        />
        <svg viewBox="0 0 24 24" className="absolute -right-[34px] h-6 w-6 fill-[#ccc]">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
      </div>
      <div className="ml-auto flex items-center text-[#5d6474]">
        <div className="relative mr-[15px]">
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="h-12 w-[52px] appearance-none border-b border-[#e0e0e0] bg-transparent text-[13px] text-[#333] outline-none"
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-3 h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
        </div>
        <span className="mr-2 whitespace-nowrap">{from} - {to}  {t("из")}  {total}</span>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="prev" className="px-[5px]">
          <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
        </button>
        <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="next">
          <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page >= pageCount ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
        </button>
        {icons && <div className="ml-5 flex items-center">{icons}</div>}
        {extra && <div className="ml-[10px] flex items-center gap-[10px]">{extra}</div>}
      </div>
    </div>
  )
}

/** Grid table: `cols` is a grid-template-columns string (use minmax(0,Nfr)). */
export function RefTable<T>({
  cols,
  heads,
  rows,
  rowKey,
  render,
  onRowClick,
  empty,
  rowClass,
  minWidth = 1100,
}: {
  cols: string
  heads: ReactNode[]
  rows: T[]
  rowKey: (row: T) => string | number
  render: (row: T) => ReactNode[]
  onRowClick?: (row: T) => void
  empty?: ReactNode
  rowClass?: (row: T) => string
  minWidth?: number
}) {
  return (
    <div className="overflow-x-auto bg-white">
      <div style={{ minWidth }}>
        <div className="grid h-[50px] items-center bg-[#5d6474] px-[30px] font-semibold text-white" style={{ gridTemplateColumns: cols }}>
          {heads.map((head, index) => (
            <div key={index} className="px-2 leading-[16px]">{head}</div>
          ))}
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center text-[#666]">{empty}</div>
        ) : (
          rows.map((row) => (
            <div
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`grid min-h-[50px] items-center border-b border-dotted border-[#d6d6d6] bg-white px-[30px] py-[7px] hover:bg-[#f2f5f8] ${onRowClick ? "cursor-pointer" : ""} ${rowClass?.(row) ?? ""}`}
              style={{ gridTemplateColumns: cols }}
            >
              {render(row).map((cell, index) => (
                <div key={index} className="px-2 leading-[16.25px]">{cell}</div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function usePaging(total: number, initialSize = 25) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialSize)
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  return {
    page: safePage,
    pageSize,
    pageCount,
    start,
    end: Math.min(start + pageSize, total),
    setPage,
    setPageSize: (size: number) => {
      setPageSize(size)
      setPage(1)
    },
  }
}


/** A complete simple list page: title, optional actions, card with toolbar and grid table. */
export function SimpleListPage<T>({
  title,
  actions,
  cols,
  heads,
  rows,
  rowKey,
  render,
  searchText,
  linkFilter,
  filterPanel,
  icons,
  extra,
  band,
  tabs,
  onRowClick,
  rowClass,
  empty,
  minWidth,
  loading,
  below,
}: {
  title: ReactNode
  actions?: ReactNode
  cols: string
  heads: ReactNode[]
  rows: T[]
  rowKey: (row: T) => string | number
  render: (row: T) => ReactNode[]
  searchText?: (row: T) => string
  linkFilter?: boolean
  filterPanel?: ReactNode
  icons?: ReactNode
  extra?: ReactNode
  band?: ReactNode
  tabs?: ReactNode
  onRowClick?: (row: T) => void
  rowClass?: (row: T) => string
  empty?: ReactNode
  minWidth?: number
  loading?: boolean
  below?: ReactNode
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const filtered = searchText ? rows.filter((row) => searchText(row).toLowerCase().includes(query.toLowerCase())) : rows
  const paging = usePaging(filtered.length)
  const pageRows = filtered.slice(paging.start, paging.end)
  return (
    <RefPage>
      <RefHeader title={title}>{actions}</RefHeader>
      <RefCard>
        {tabs}
        {band}
        <RefToolbar
          linkFilter={linkFilter}
          hideFilter={!filterPanel}
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={filterPanel}
          query={query}
          onQuery={(value) => {
            setQuery(value)
            paging.setPage(1)
          }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={filtered.length ? paging.start + 1 : 0}
          to={paging.end}
          total={filtered.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
          icons={icons}
          extra={extra}
        />
        <RefTable
          cols={cols}
          heads={heads}
          rows={pageRows}
          rowKey={rowKey}
          render={render}
          onRowClick={onRowClick}
          rowClass={rowClass}
          minWidth={minWidth}
          empty={loading ? t("Загрузка...") : (empty ?? t("Ничего не найдено"))}
        />
      </RefCard>
      {below}
    </RefPage>
  )
}


/** Compact floating-label select used by report filter forms (4 per row). */
export function RefFilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label className="relative block h-[52px] border-b border-[#e0e0e0]">
      <span className="absolute left-0 top-0 text-[10px] font-bold leading-3">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-x-0 bottom-0 h-[30px] appearance-none bg-transparent pr-6 text-[13px] font-semibold outline-none">
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-0 right-0 h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
    </label>
  )
}

export function RefFilterDate({ label, value, onChange, min, max }: { label: string; value: string; onChange: (value: string) => void; min?: string; max?: string }) {
  return (
    <label className="relative block h-[52px] border-b border-[#e0e0e0]">
      <span className="absolute left-0 top-0 text-[10px] font-bold leading-3">{label}</span>
      <input type="date" value={value} min={min} max={max} onChange={(event) => onChange(event.target.value)} className="absolute inset-x-0 bottom-0 h-[30px] bg-transparent text-[13px] font-semibold outline-none" />
    </label>
  )
}

export function RefEmpty({ text }: { text: ReactNode }) {
  return (
    <div className="flex flex-col items-center bg-white pb-10 pt-8 text-[#888]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="w-[120px]" />
      <span className="-mt-[22px] text-[13px]">{text}</span>
    </div>
  )
}
