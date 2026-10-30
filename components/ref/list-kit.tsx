"use client"

import { Fragment, isValidElement, useEffect, useMemo, useState, type ReactNode } from "react"

import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { usePathname } from "next/navigation"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { REF_COLUMNS } from "@/lib/ref-columns"
import { PageSizeSelect } from "@/components/analytics/settings-list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

/**
 * Building blocks shared by the reference app's list pages: title row, tab strip,
 * summary band, toolbar and the grid-based table (13px base, #5d6474 header).
 */

export const RI = {
  eyeOff: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
  warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  store: "M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z",
  map: "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z",
  card: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  chart: "M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z",
  add: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
  filter: "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z",
  checklist: "M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z",
  autorenew: "M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z",
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

export function RefHeader({ title, children, left, titleTop }: { title: ReactNode; children?: ReactNode; left?: ReactNode; titleTop?: number }) {
  const { t } = useLanguage()
  const heading = typeof title === "string" ? t(title) : title
  return (
    <div className="flex h-[60px] items-center justify-between">
      <div className="flex items-center">
        <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          {titleTop ? <span style={{ position: "relative", top: titleTop }}>{heading}</span> : heading}
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
  exact,
  iconLow,
}: {
  /** With `exact`: icon 1.5px lower (toolbar buttons of the reference have a 4px margin-bottom). */
  iconLow?: boolean
  icon?: string
  label: ReactNode
  onClick?: () => void
  green?: boolean
  red?: boolean
  disabled?: boolean
  type?: "button" | "submit"
  /** Pixel-exact glyph placement of the reference's header buttons (18px line, icon 0.5px above centre). */
  exact?: boolean
}) {
  const { t } = useLanguage()
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-[30px] items-center whitespace-nowrap rounded-[5px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60 ${icon ? "pl-3" : "px-4"} ${green ? "bg-[#71ce87]" : red ? "bg-[#fa8072]" : "bg-[#4f71dc]"}`}
    >
      {icon && (
        <svg viewBox="0 0 24 24" className={`${exact && !iconLow ? "mb-px" : "mb-1"} h-[18px] w-[18px] fill-white`} aria-hidden>
          <path d={icon} />
        </svg>
      )}
      <span className={`${icon ? "pl-2 pr-4" : ""} ${exact ? "leading-[18px]" : ""}`}>{typeof label === "string" ? t(label) : label}</span>
    </button>
  )
}

export function RefIconButton({ path, label, onClick, color = "#666", active, tipSide }: { path: string; label: string; onClick?: () => void; color?: string; active?: boolean; /** Pin the hover hint to the left of the icon (reference plan toolbars). */ tipSide?: "left" }) {
  const { t } = useLanguage()
  return (
    <button type="button" title={t(label)} aria-label={t(label)} data-tip-side={tipSide} onClick={onClick} className={`flex h-12 w-12 items-center justify-center ${active ? "bg-[#e8efff]" : ""}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: color }}>
        <path d={path} />
      </svg>
    </button>
  )
}

export function RefTabs({ labels, value, onChange, separate, stacked }: { labels: string[]; value: string; onChange: (value: string) => void; separate?: boolean; /** Own 40px shadowed card with the indicator below it, then a 1px gap (the salary page of the reference). */ stacked?: boolean }) {
  const { t } = useLanguage()
  const index = Math.max(0, labels.indexOf(value))
  const height = separate ? "h-[52px]" : "h-10"
  if (stacked) {
    return (
      <div className="relative h-[41px]">
        <div className={`flex rounded-[2px] bg-white ${height}`}>
          {labels.map((label) => (
            <button key={label} type="button" onClick={() => onChange(label)} className={`flex-1 whitespace-nowrap text-center text-[13px] font-medium leading-[normal] text-black ${height}`}>
              {t(label)}
            </button>
          ))}
        </div>
        <span className="absolute bottom-0 left-0 z-10 h-[3px] bg-[linear-gradient(to_bottom,#4e6ed8,#4a6ace)] shadow-[0_-3px_10px_0_#5869f0] transition-transform duration-300" style={{ width: `${100 / labels.length}%`, transform: `translateX(${index * 100}%)`, clipPath: "inset(-20px 0 0 0)" }} />
      </div>
    )
  }
  return (
    <div className={`relative flex rounded-[2px] bg-white ${height} ${separate ? REF_SHADOW : ""}`}>
      {labels.map((label) => (
        <button key={label} type="button" onClick={() => onChange(label)} className={`flex-1 whitespace-nowrap text-center text-[13px] font-medium leading-[normal] text-black ${height}`}>
          {t(label)}
        </button>
      ))}
      <span
        className={`absolute left-0 z-10 h-[3px] bg-[#4f71dc] transition-transform duration-300 ${separate ? "bottom-0" : "-bottom-[2px] shadow-[0_-3px_10px_0_#5869f0]"}`}
        style={{ width: `${100 / labels.length}%`, transform: `translateX(${index * 100}%)` }}
      />
    </div>
  )
}

export function RefBand({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return <div className={`flex flex-wrap justify-between gap-x-6 border-b border-[#efefef] bg-[#5869f0] px-[5px] ${compact ? "py-[3px]" : "py-[9px]"} text-[13px] font-semibold text-white`}>{children}</div>
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
  leftSlot,
  filterWidth: filterWidthProp,
  searchWidth: searchWidthProp,
  hideSearch,
  plain,
  thinChevron,
  pageSizeMenu,
  fluid,
}: {
  /** The tabbed lists of the reference: the search field drifts right with the viewport (25% of the extra width). */
  fluid?: boolean
  /** Page-size dropdown of the settings lists (10 … 2000) instead of the native select. */
  pageSizeMenu?: boolean
  /** The 24-viewBox thin chevron of the reference's KPI toolbar (default is the older, larger glyph). */
  thinChevron?: boolean
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
  linkFilter?: boolean | "flush"
  /** Replaces the filter button (e.g. an active-filter chip). */
  leftSlot?: ReactNode
  /** Width of the filter column in px (the reference's narrower cards use less than 355). */
  filterWidth?: number
  /** Width of the search field in px (default 300 / 182). */
  searchWidth?: number
  /** No search field (the reference's "Выбрано: N" mode). */
  hideSearch?: boolean
  /** Transparent bar instead of the white one. */
  plain?: boolean
}) {
  const { t } = useLanguage()
  // The reference's link-style toolbar ("Показать фильтр ⌄" + 285.5px search at x=354.5) is the default for "flush".
  const filterWidth = filterWidthProp ?? (linkFilter === "flush" ? 303.5 : 355)
  const searchWidth = searchWidthProp ?? (linkFilter === "flush" ? 285.5 : undefined)
  return (
    <div className={`relative flex h-[50px] items-center px-[5px] ${plain ? "" : "bg-white"}`}>
      <div className={leftSlot || !hideFilter ? "shrink-0" : "hidden"} style={{ width: leftSlot || !hideFilter ? (fluid ? `calc(${filterWidth}px + max(0px, 100vw - 1296px) * 0.25)` : filterWidth) : undefined }}>
        {leftSlot}
        {!leftSlot && !hideFilter && (
          linkFilter ? (
            <button type="button" onClick={onToggleFilter} className={`${linkFilter === "flush" ? "flex h-[16.3px] w-fit items-center leading-[16.25px] " : "pl-[5px] "}text-[13px] text-[#4f71dc]`}>
              {filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")}
              {linkFilter === "flush" ? (
                thinChevron ? (
                  <svg viewBox="0 0 24 24" className="ml-px h-5 w-[13px] translate-y-[1.9px] shrink fill-[#4f71dc]"><path d="M7.41 7.84L12 12.42l4.59-4.58L18 9.25l-6 6-6-6z" /></svg>
                ) : (
                <svg viewBox="6 2 12 20" className="ml-px h-5 w-[13px] translate-y-[1.9px] fill-[#4f71dc]"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" /></svg>
                )
              ) : (
                " ⌄"
              )}
            </button>
          ) : (
          <button type="button" onClick={onToggleFilter} className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white hover:brightness-95">
            <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white"><path d={RI.filter} /></svg>
            <span className="pl-2 pr-4">{filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")}</span>
          </button>
          )
        )}
      </div>
      {filterOpen && <div className="absolute left-0 top-0 z-30 w-full">{filterPanel}</div>}
      <div className={`relative ${hideSearch ? "hidden" : "flex"} ${linkFilter === "flush" ? "h-[40px] items-start self-start" : "items-center"} border-b border-[#e0e0e0] focus-within:border-[#5d6474] ${leftSlot || !hideFilter ? "ml-[18px] w-[300px]" : "ml-[10px] w-[182px]"}`} style={searchWidth ? { width: fluid ? `calc(${searchWidth}px + max(0px, 100vw - 1296px) * 0.0711)` : searchWidth } : undefined}>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("Поиск")}
          className="h-12 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/30"
        />
        <svg viewBox="0 0 24 24" className={`h-6 w-6 shrink-0 fill-[#ccc] ${linkFilter === "flush" ? "mr-[2px] mt-[12px]" : ""}`}>
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
      </div>
      <div className="ml-auto flex items-center text-[#5d6474]">
        {pageSizeMenu ? (
          <div className="mr-[27px]"><PageSizeSelect value={pageSize} onChange={onPageSize} /></div>
        ) : (
        <div className="relative mr-[27px]">
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="h-12 w-[40px] appearance-none bg-transparent text-[13px] text-[#333] outline-none"
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-3 h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
        </div>
        )}
        <span className="mr-[5px] whitespace-nowrap leading-[16.25px]">{total === 0 ? 1 : from} - {to}  {t("из")}  {total}</span>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("Назад")} className="px-[5px]">
          <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
        </button>
        <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label={t("Вперед")}>
          <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page >= pageCount ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
        </button>
        {icons && <div className="ml-5 flex items-center">{icons}</div>}
        {extra && <div className="ml-[10px] flex items-center gap-[10px]">{extra}</div>}
      </div>
    </div>
  )
}

/** Plain text of a rendered cell, used for client-side column sorting. */
function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join(" ")
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children)
  return ""
}

export function compareText(a: string, b: string): number {
  const parse = (value: string) => {
    const cleaned = value.replace(/\u00a0|\s/g, "").replace(",", ".")
    return /^-?\d+(\.\d+)?/.test(cleaned) ? Number.parseFloat(cleaned) : Number.NaN
  }
  const na = parse(a)
  const nb = parse(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return a.localeCompare(b, "ru", { numeric: true, sensitivity: "base" })
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
  expanded,
  hideBody,
  hideHead,
  headPad,
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
  /** Optional detail panel rendered right under a row. */
  expanded?: (row: T) => ReactNode
  /** Header row only (a detail panel takes the list's place, like the reference's price formation). */
  hideBody?: boolean
  /** Rows only, no column header (the list continues under a detail panel in the reference's production batches). */
  hideHead?: boolean
  /** Right padding of the header cells (the reference reserves room for the sort arrows, so long titles wrap). */
  headPad?: number
}) {
  const pathname = usePathname()
  const { t } = useLanguage()
  const measured = REF_COLUMNS[pathname] ?? REF_COLUMNS[pathname.replace(/\/\d+$/, "")]
  const gridCols = measured && measured.n === heads.length ? measured.cols : cols
  const inset = measured && measured.n === heads.length ? measured.inset : undefined
  const insetRight = measured && measured.n === heads.length ? measured.insetRight : undefined
  const padStyle = inset == null ? undefined : { paddingLeft: inset, ...(insetRight == null ? {} : { paddingRight: insetRight }) }
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null)
  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const keyed = rows.map((row) => ({ row, text: nodeText(render(row)[sort.col]) }))
    keyed.sort((a, b) => (sort.desc ? -1 : 1) * compareText(a.text, b.text))
    return keyed.map((entry) => entry.row)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort])
  const toggleSort = (col: number) => setSort((current) => (current?.col === col ? (current.desc ? null : { col, desc: true }) : { col, desc: false }))
  return (
    <div className={expanded ? "bg-white" : "overflow-x-auto bg-white"}>
      <div style={{ minWidth }}>
        {hideHead ? null : (
        <div className="grid h-[50px] items-center bg-[#5d6474] px-[30px] font-semibold text-white" style={{ gridTemplateColumns: gridCols, ...padStyle }}>
          {heads.map((head, index) => (
            <div key={index} className="px-2 leading-[16px]" style={headPad ? { paddingRight: headPad } : undefined}>
              {typeof head === "string" && head ? (
                <button type="button" onClick={() => toggleSort(index)} className="text-left font-semibold hover:opacity-80">
                  {t(head)}
                  {sort?.col === index ? <span className="ml-1 text-[10px]">{sort.desc ? "▼" : "▲"}</span> : null}
                </button>
              ) : (
                head
              )}
            </div>
          ))}
        </div>
        )}
        {hideBody ? null : sortedRows.length === 0 ? (
          <div className="px-4 py-16 text-center text-[#666]">{empty}</div>
        ) : (
          sortedRows.map((row) => (
            <Fragment key={rowKey(row)}>
              <div
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`group relative grid min-h-[50px] items-center bg-white px-[30px] py-[7px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] hover:bg-[#f2f5f8] ${onRowClick ? "cursor-pointer" : ""} ${rowClass?.(row) ?? ""}`}
                style={{ gridTemplateColumns: gridCols, ...padStyle }}
              >
                {render(row).map((cell, index) => (
                  <div key={index} className="px-2 leading-[16.25px]">{cell}</div>
                ))}
              </div>
              {expanded?.(row)}
            </Fragment>
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
  tabsSeparate,
  onRowClick,
  rowClass,
  empty,
  minWidth,
  loading,
  below,
  expanded,
}: {
  title: ReactNode
  actions?: ReactNode
  cols: string
  heads: ReactNode[]
  rows: T[]
  rowKey: (row: T) => string | number
  render: (row: T) => ReactNode[]
  searchText?: (row: T) => string
  linkFilter?: boolean | "flush"
  filterPanel?: ReactNode | ((close: () => void) => ReactNode)
  icons?: ReactNode
  extra?: ReactNode
  band?: ReactNode
  tabs?: ReactNode
  /** Render the tab strip as its own card with a gap before the list card. */
  tabsSeparate?: boolean
  onRowClick?: (row: T) => void
  rowClass?: (row: T) => string
  empty?: ReactNode
  minWidth?: number
  loading?: boolean
  below?: ReactNode
  /** Detail panel rendered right under a row (see RefTable). */
  expanded?: (row: T) => ReactNode
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
      {tabsSeparate && <div className="mb-5">{tabs}</div>}
      <RefCard>
        {!tabsSeparate && tabs}
        {band}
        <RefToolbar
          linkFilter={linkFilter}
          hideFilter={!filterPanel}
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={typeof filterPanel === "function" ? filterPanel(() => setFilterOpen(false)) : filterPanel}
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
          expanded={expanded}
          empty={loading ? t("Загрузка...") : (empty ?? t("Ничего не найдено"))}
        />
      </RefCard>
      {below}
    </RefPage>
  )
}


/** Compact floating-label select used by report filter forms (4 per row). */
export function RefFilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  const { t } = useLanguage()
  return (
    <label className="relative block h-[52px] border-b border-[#e0e0e0]">
      <span className="absolute left-0 top-0 text-[10px] font-bold leading-3">{t(label)}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-x-0 bottom-0 h-[30px] appearance-none bg-transparent pr-6 text-[13px] font-semibold outline-none">
        {options.map((option) => (
          <option key={option} value={option}>{t(option)}</option>
        ))}
      </select>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-0 right-0 h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
    </label>
  )
}

export function RefFilterDate({ label, value, onChange, min, max }: { label: string; value: string; onChange: (value: string) => void; min?: string; max?: string }) {
  const { t } = useLanguage()
  return (
    <label className="relative block h-[52px] border-b border-[#e0e0e0]">
      <span className="absolute left-0 top-0 text-[10px] font-bold leading-3">{t(label)}</span>
      <input type="date" value={value} min={min} max={max} onChange={(event) => onChange(event.target.value)} className="absolute inset-x-0 bottom-0 h-[30px] bg-transparent text-[13px] font-semibold outline-none" />
    </label>
  )
}

export function RefEmpty({ text }: { text: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col items-center bg-white pb-10 pt-8 text-[#888]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="w-[120px]" />
      <span className="-mt-[22px] text-[13px]">{typeof text === "string" ? t(text) : text}</span>
    </div>
  )
}


/* ---------- Filter panel kit (matches the reference app's "Фильтр" drawer) ---------- */

const FILTER_PANEL_SHADOW = "shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"

export function RefFilterPanel({
  onClose,
  onApply,
  children,
  narrow,
  footer,
  className = "",
  applyClassName = "mt-2",
}: {
  onClose: () => void
  onApply: () => void
  children: ReactNode
  narrow?: boolean
  footer?: ReactNode
  className?: string
  /** Spacing above the "Применить" row (the reference differs per filter). */
  applyClassName?: string
}) {
  const { t } = useLanguage()
  return (
    <div className={`bg-white pt-[10px] ${FILTER_PANEL_SHADOW} ${narrow ? "w-[310px]" : "w-[calc(100%)]"} ${className}`}>
      <div className="mx-5 flex h-[48px] items-center justify-between">
        <span className="text-[15px] text-[#5d6474]">{t("Фильтр")}</span>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="-mr-3 flex h-12 w-12 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8f8f8f]">
            <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.59-13L12 10.59 8.41 7 7 8.41 10.59 12 7 15.59 8.41 17 12 13.41 15.59 17 17 15.59 13.41 12 17 8.41z" />
          </svg>
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onApply()
        }}
        className="px-5 pb-[10px] pt-[5px]"
      >
        {children}
        <div className={`flex items-center gap-[10px] ${applyClassName}`}>
          <button type="submit" className="h-[36px] rounded-[3px] bg-[#5d6474] px-4 text-[13px] font-medium uppercase text-white shadow-[0_2px_5px_rgba(0,0,0,0.3)] hover:brightness-110">
            {t("Применить")}
          </button>
          {footer}
        </div>
      </form>
    </div>
  )
}

function FieldCaret({ compact }: { compact?: boolean }) {
  return (
    <svg viewBox="0 0 10 5" className={`pointer-events-none absolute right-[10px] h-[5px] w-[10px] fill-[#999] ${compact ? "top-[35.4px]" : "top-[39.4px]"}`}>
      <path d="M0 0l5 5 5-5z" />
    </svg>
  )
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  className = "",
  compact,
  emptyText,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  className?: string
  /** 50px pitch (dialogs) instead of 62px (filter panels). */
  compact?: boolean
  /** Text of an empty list ("Ничего не найдено" by default). */
  emptyText?: string
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <div className={`relative ${compact ? "h-[50px]" : "h-[62px]"} ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`absolute inset-x-0 h-[36px] ${compact ? "top-[14px]" : "top-[18px]"} border-b border-[#e8e8e8] text-left text-[13px] font-semibold text-black`}
      >
        {value ? (
          <>
            <span className="absolute left-0 top-[-8px] text-[10px] font-bold leading-3">{t(label)}</span>
            <span className="absolute inset-x-0 top-[10px] truncate pr-8">{value}</span>
          </>
        ) : (
          <span className="absolute left-0 top-[13px] leading-4">{t(label)}</span>
        )}
      </button>
      <FieldCaret compact={compact} />
      {open && (
        <>
          <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className={`absolute inset-x-0 z-50 max-h-[205px] ${compact ? "top-[50px]" : "top-[54px]"} overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]`}>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("")
                  setOpen(false)
                }}
                className="block h-9 w-full px-[10px] text-left text-[13px] text-[#999] hover:bg-[#f2f5f8]"
              >
                {t("Сбросить")}
              </button>
            )}
            {options.length === 0 ? (
              <div className="h-9 px-[10px] text-[13px] leading-9 text-[#999]">{t(emptyText ?? "Ничего не найдено")}</div>
            ) : (
              options.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    onChange(option)
                    setOpen(false)
                  }}
                  className={`block h-9 w-full truncate px-[10px] text-left text-[13px] font-semibold hover:bg-[#f2f5f8] ${option === value ? "text-[#4f71dc]" : ""}`}
                >
                  {option}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function FilterText({
  label,
  value,
  onChange,
  type = "text",
  className = "",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "number"
  className?: string
}) {
  const { t } = useLanguage()
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className={`relative h-[62px] ${className}`}>
      <div className="absolute inset-x-0 top-[18px] h-[36px] border-b border-[#e8e8e8]">
        <span className={`pointer-events-none absolute left-0 font-bold text-black transition-all ${floating ? "top-[-8px] text-[10px] leading-3" : "top-[13px] text-[13px] font-semibold leading-4"}`}>{t(label)}</span>
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent text-[13px] font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
    </div>
  )
}

/** Material-UI style text field of the supplier-incomings filter: 52px pitch, hint label floating to the top. */
export function FilterTextMui({ label, value, onChange, className = "" }: { label: string; value: string; onChange: (value: string) => void; className?: string }) {
  const { t } = useLanguage()
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className={`relative h-[52px] ${className}`}>
      <div className="absolute inset-x-0 top-[7px] h-[45px]">
        <span className={`pointer-events-none absolute left-0 font-semibold text-black transition-all ${floating ? "top-[-1px] text-[10px] leading-[15px]" : "top-[13px] text-[13px] leading-[18px]"}`}>{t(label)}</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-[45px] w-full bg-transparent pt-[16px] text-[13px] font-semibold outline-none"
        />
        <span className="pointer-events-none absolute inset-x-0 top-[36px] h-px bg-[#e0e0e0]" />
      </div>
    </div>
  )
}

export function FilterCaption({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { t } = useLanguage()
  return <div className={`text-[13px] text-[#666] ${className}`}>{typeof children === "string" ? t(children) : children}</div>
}

export function FilterRange({ caption, from, to, onFrom, onTo }: { caption: string; from: string; to: string; onFrom: (value: string) => void; onTo: (value: string) => void }) {
  const { t } = useLanguage()
  return (
    <div>
      <FilterCaption>{caption}</FilterCaption>
      <div className="-mt-[13px] grid grid-cols-2 gap-[15px]">
        <FilterText label={t("От (дней)")} value={from} onChange={onFrom} type="number" />
        <FilterText label={t("До (дней)")} value={to} onChange={onTo} type="number" />
      </div>
    </div>
  )
}

export function FilterCheck({ label, checked, onChange, className = "", compact }: { label: string; checked: boolean; onChange: (value: boolean) => void; className?: string; compact?: boolean }) {
  const { t } = useLanguage()
  return (
    <button type="button" onClick={() => onChange(!checked)} aria-pressed={checked} className={`flex items-start text-left text-[13px] font-semibold text-black ${compact ? "gap-[5.5px]" : "gap-1"} ${className}`}>
      <svg viewBox="0 0 24 24" className={`shrink-0 fill-[#333] ${compact ? "h-5 w-5" : "h-6 w-6"}`}>
        <path d={checked ? "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" : "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"} />
      </svg>
      <span className={`leading-5 ${compact ? "" : "pt-[3px]"}`}>{t(label)}</span>
    </button>
  )
}

const WEEK_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

export function FilterDays({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const { t } = useLanguage()
  return (
    <div>
      <FilterCaption className="mt-[10px] text-[#888]">{t("Показывать по маршруту (дни)")}</FilterCaption>
      <div className="mt-[10px] flex gap-5">
        {WEEK_DAYS.map((day) => {
          const active = value.includes(day)
          return (
            <button
              key={day}
              type="button"
              onClick={() => onChange(active ? value.filter((d) => d !== day) : [...value, day])}
              className={`h-8 w-8 text-[13px] ${active ? "bg-[#4f71dc] text-white" : "bg-[#eceff1] text-[#888]"}`}
            >
              {t(day)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const RU_SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

function formatFilterDate(value: string, words?: string) {
  const [y, m, d] = value.split("-")
  // "01 окт. 2026": the filters of "План приемок и передач" print the month as a word (Russian only).
  if (words === "ru") return `${d} ${RU_SHORT_MONTHS[Number(m) - 1] ?? m} ${y}`
  return `${d}.${m}.${y}`
}

/** Date (range) field: small label with a calendar glyph, value or "Укажите дату" below. */
export function FilterDate({
  label,
  begin,
  end,
  onChange,
  className = "",
  placement = "below",
  iconLeft,
  words,
  mui,
  tall,
  noIcon,
  pickerClassName,
  roomy,
}: {
  label: string
  begin: string
  end: string
  onChange: (begin: string, end: string) => void
  className?: string
  /** Print the months as words ("01 окт. 2026") instead of dd.mm.yyyy. */
  words?: boolean
  placement?: "below" | "above"
  /** Pin the calendar glyph this many px from the field's left edge instead of right after the label. */
  iconLeft?: number
  /** Material-UI geometry (52px pitch, 1px hairline) as in the supplier-incomings filter. */
  mui?: boolean
  /** With `mui`: the label is long enough to push the field down (60px field, label 8px lower). */
  tall?: boolean
  /** Hide the calendar glyph after the label (the activity filter of the reference has none). */
  noIcon?: boolean
  /** 72px block with the value 6px lower and a 41px field (the net cost filter of the reference). */
  roomy?: boolean
  /** Anchor classes of the range picker (the reference right-aligns it under the activity filter). */
  pickerClassName?: string
}) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const wordsLanguage = words ? language : undefined
  return (
    <div className={`relative ${mui ? (tall ? "h-[67px]" : "h-[52px]") : roomy ? "h-[72px]" : "h-[62px]"} ${className}`}>
      <button type="button" onClick={() => setOpen((current) => !current)} className={`absolute inset-x-0 w-full text-left text-[13px] ${mui ? (tall ? "top-[7px] h-[60px]" : "top-[7px] h-[45px]") : `top-[18px] border-b border-[#e8e8e8] ${roomy ? "h-[41px]" : "h-[36px]"}`}`}>
        {mui && <span className={`absolute inset-x-0 h-px bg-[#e0e0e0] ${tall ? "top-[51px]" : "top-[36px]"}`} />}
        <span className={`absolute left-0 flex items-center gap-[2px] text-[10px] font-bold leading-3 text-black ${mui ? (tall ? "top-[7px]" : "top-[-1px]") : "top-[-3px]"}`}>
          {t(label)}
          {!noIcon && <svg viewBox="0 0 24 24" style={iconLeft == null ? undefined : { position: "absolute", left: iconLeft, top: 0 }} className={`fill-[#ccc] ${mui ? "h-[15px] w-[15px]" : "h-[14px] w-[14px]"}`}><path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z" /></svg>}
        </span>
        <span className={`absolute left-0 font-medium text-black ${mui ? (tall ? "top-[29px]" : "top-[13px]") : roomy ? "top-[20px]" : "top-[14px]"}`}>{begin ? `${formatFilterDate(begin, wordsLanguage)} - ${formatFilterDate(end || begin, wordsLanguage)}` : t("Укажите дату")}</span>
      </button>
      {open && (
        <DateRangePicker
          begin={begin || today}
          end={end || today}
          placement={placement}
          positionClassName={pickerClassName}
          onClose={() => setOpen(false)}
          onApply={(b, e) => {
            onChange(b, e)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}


/** "ИМПОРТ С EXCEL" dialog used by the reference app's import buttons. */
export function RefImportDialog({
  file,
  onFile,
  onTemplate,
  onSave,
  onClose,
  title,
  saving,
  error,
  top,
  bigTitle,
}: {
  file: File | null
  onFile: (file: File | null) => void
  onTemplate: () => void
  onSave: () => void
  onClose: () => void
  title?: string
  saving?: boolean
  /** Server / validation messages printed under the drop area. */
  error?: ReactNode
  /** Extra fields above the template / drop area (the reference's salary import asks for month, year, organisation, currency). */
  top?: ReactNode
  /** 15px title and the 48px grey close button (the reference's salary import). */
  bigTitle?: boolean
}) {
  const { t } = useLanguage()
  // Escape closes the dialog (not while saving: the caller would lose which rows were saved).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || saving) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, saving])
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/[0.54] p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={`w-[400px] max-w-full bg-white ${bigTitle ? "shadow-[0_11px_15px_-7px_rgba(0,0,0,0.2),0_24px_38px_3px_rgba(0,0,0,0.14),0_9px_46px_8px_rgba(0,0,0,0.12)]" : "shadow-[0_10px_30px_rgba(0,0,0,0.3)]"}`}>
        <header className={`flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] ${bigTitle ? "pr-[10px]" : "pr-[27px]"}`}>
          <b className={`font-bold uppercase text-[#333] ${bigTitle ? "text-[15px] leading-[20px]" : "text-[13px]"}`}>{title ?? t("Импорт с Excel")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className={bigTitle ? "flex h-12 w-12 items-center justify-center" : undefined}>
            <svg viewBox="0 0 24 24" className={`h-6 w-6 ${bigTitle ? "fill-[#666]" : "fill-[#333]"}`}><path d={RI.close} /></svg>
          </button>
        </header>
        <div className={`pb-5 pr-[30px] pt-[30px] ${bigTitle ? "pl-[30px]" : "pl-[31px]"}`}>
          {top}
          <div className="h-[273px] border border-[#efefef] pt-[5px]">
            <button type="button" onClick={onTemplate} className="block h-9 w-full pt-[3px] text-center text-[13px] uppercase text-black hover:text-[#4f71dc]">
              1. {t("Скачать шаблон")}
            </button>
            <label className={`mt-[5px] flex h-[200px] w-[302px] cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed border-[#efefef] text-[13px] text-[#333] ${bigTitle ? "ml-[20px] pt-[2px]" : "ml-[19px]"}`}>
              <input
                type="file"
                accept=".csv,.xls,.xlsx"
                className="hidden"
                onChange={(event) => {
                  const picked = event.target.files?.[0] ?? null
                  // Cleared at once, so the same (corrected) file can be picked again and still fires a change.
                  event.target.value = ""
                  if (picked) onFile(picked)
                }}
              />
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" /></svg>
              <span>{file ? file.name : t("Добавьте файл Excel или нажмите для выбора")}</span>
            </label>
          </div>
          {error && <div className="mt-3 text-[13px] text-[#e57373]">{error}</div>}
        </div>
        <footer className={`flex justify-end border-t border-[#efefef] p-[10px] ${bigTitle ? "!pb-[9.3px] !pt-[10.7px]" : ""}`}>
          {/* Looks enabled even before a file is chosen (like the reference); it just does nothing until then. */}
          <button
            type="button"
            aria-disabled={!file || saving}
            onClick={() => file && !saving && onSave()}
            className="h-9 bg-[#71ce87] px-4 text-[13px] font-semibold uppercase text-white hover:brightness-95"
          >
            {t("Сохранить")}
          </button>
        </footer>
      </div>
    </div>
  )
}
