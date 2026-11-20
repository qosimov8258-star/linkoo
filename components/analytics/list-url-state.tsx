"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

// List state of the reference's grid lists («Рассылка», «Страницы телеграм бота») kept in the URL, like its hash routes:
// the opened record is a path segment (#/telegram-mailing/25 → /analytics/mailing/25), the rest are query parameters
// (pageSize, page, search, ordering, openCreateDialog / openUpdateDialog), written in key order. Opening or closing a
// record adds a history entry (Back closes it again); the other changes replace the current one. The page reads the URL
// once it is mounted and again on Back / Forward.

export type ListUrlState = {
  pageSize: number
  page: number
  search: string
  /** The reference's `ordering`: fields in click order, "-" = descending. */
  ordering: string[]
  /** The dialog flag: null until the dialog was first opened (the reference then keeps "=false" after closing it). */
  dialog: boolean | null
  /** The opened record (path segment after the list's address). */
  id: string | null
}

const MAX_PAGE_SIZE = 2000

function positiveInt(value: string | null, fallback: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function readUrl(base: string, dialogParam: string, orderings: readonly string[]): ListUrlState {
  const params = new URLSearchParams(window.location.search)
  const path = window.location.pathname.replace(/\/+$/, "")
  let id: string | null = null
  if (path.startsWith(`${base}/`)) {
    try {
      id = decodeURIComponent(path.slice(base.length + 1)) || null
    } catch {
      id = null
    }
  }
  const allowed = new Set(orderings.flatMap((field) => [field, `-${field}`]))
  const ordering: string[] = []
  for (const item of (params.get("ordering") ?? "").split(",")) {
    const field = item.replace(/^-/, "")
    if (allowed.has(item) && !ordering.some((current) => current.replace(/^-/, "") === field)) ordering.push(item)
  }
  const dialog = params.get(dialogParam)
  return {
    pageSize: Math.min(MAX_PAGE_SIZE, positiveInt(params.get("pageSize"), 25)),
    page: positiveInt(params.get("page"), 1),
    search: params.get("search") ?? "",
    ordering,
    dialog: dialog === "true" ? true : dialog === "false" ? false : null,
    id,
  }
}

function buildUrl(base: string, dialogParam: string, state: ListUrlState): string {
  const params = new URLSearchParams()
  if (state.dialog !== null) params.set(dialogParam, state.dialog ? "true" : "false")
  if (state.ordering.length) params.set("ordering", state.ordering.join(","))
  if (state.page > 1) params.set("page", String(state.page))
  params.set("pageSize", String(state.pageSize))
  if (state.search) params.set("search", state.search)
  params.sort()
  return `${state.id ? `${base}/${encodeURIComponent(state.id)}` : base}?${params.toString()}`
}

export function useListUrlState({ base, dialogParam, orderings, initialId = null }: { base: string; dialogParam: string; orderings: readonly string[]; initialId?: string | null }) {
  const [state, setState] = useState<ListUrlState>({ pageSize: 25, page: 1, search: "", ordering: [], dialog: null, id: initialId })
  const [ready, setReady] = useState(false)
  const written = useRef<{ url: string; id: string | null } | null>(null)
  const orderingsRef = useRef(orderings)

  useEffect(() => {
    const sync = () => {
      const next = readUrl(base, dialogParam, orderingsRef.current)
      written.current = { url: buildUrl(base, dialogParam, next), id: next.id }
      setState(next)
    }
    sync()
    setReady(true)
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [base, dialogParam])

  useEffect(() => {
    if (!ready) return
    const url = buildUrl(base, dialogParam, state)
    const current = `${window.location.pathname}${window.location.search}`
    if (url === current) {
      written.current = { url, id: state.id }
      return
    }
    // A record opened or closed is a step Back can undo; everything else rewrites the current entry.
    if (written.current && written.current.id !== state.id) window.history.pushState(null, "", url)
    else window.history.replaceState(window.history.state, "", url)
    written.current = { url, id: state.id }
  }, [base, dialogParam, ready, state])

  const update = useCallback((patch: Partial<ListUrlState>) => setState((current) => ({ ...current, ...patch })), [])
  return { state, update }
}

/** The reference's header click: a new field is added ascending at the end, an ascending one turns descending (and moves
 * to the end), a descending one is dropped. */
export function toggleOrdering(ordering: string[], field: string): string[] {
  const rest = ordering.filter((item) => item.replace(/^-/, "") !== field)
  if (ordering.includes(field)) return [...rest, `-${field}`]
  if (ordering.includes(`-${field}`)) return rest
  return [...ordering, field]
}

/** Sorts `rows` by the ordering's fields in turn; rows equal on all of them keep the list's own order. */
export function sortByOrdering<T>(rows: T[], ordering: string[], compare: Record<string, (a: T, b: T) => number>): T[] {
  const keys = ordering.flatMap((item) => {
    const field = item.replace(/^-/, "")
    return compare[field] ? [{ by: compare[field], sign: item.startsWith("-") ? -1 : 1 }] : []
  })
  if (!keys.length) return rows
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const key of keys) {
        const result = key.by(a.row, b.row)
        if (result) return key.sign * result
      }
      return a.index - b.index
    })
    .map((entry) => entry.row)
}

const ARROW_DOWN = "M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z"
const ARROW_UP = "M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z"

/** Sortable column title: ↓ while ascending, ↑ while descending, 6px from the text (before it in a right-aligned column). */
export function SortHead({ label, field, ordering, onSort, right = false, className = "" }: { label: ReactNode; field: string; ordering: string[]; onSort: (field: string) => void; right?: boolean; className?: string }) {
  const dir = ordering.includes(field) ? "asc" : ordering.includes(`-${field}`) ? "desc" : null
  const icon = dir ? (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 translate-y-[5px] fill-white" aria-hidden>
      <path d={dir === "asc" ? ARROW_DOWN : ARROW_UP} />
    </svg>
  ) : null
  return (
    <button type="button" onClick={() => onSort(field)} className={`inline-flex cursor-pointer items-center gap-[6px] font-semibold leading-4 text-white ${right ? "ml-auto" : ""} ${className}`}>
      {right && icon}
      {label}
      {!right && icon}
    </button>
  )
}
