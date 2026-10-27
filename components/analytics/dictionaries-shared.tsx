"use client"

import { ArrowDown, ArrowUp, Loader2, X } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react"

import { useJsonList, type Named, type PickOption } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { DICTIONARY_IMAGE_MAX_SIDE, dictionaryUsageText, type DictionaryErrorBody, type DictionaryListState, type DictionaryUsage } from "./dictionaries-data"

// Shared UI of the dictionary pages (Типы продуктов, Ед.измерения, Бренд): the URL state
// (demo filter params ?search ?ordering ?page ?pageSize ?openCreateDialog=true and
// ?<item>=<id>&openUpdateDialog=true | openDeleteDialog=true), the list fetch, the grid
// toolbar ("+ добавить …", search, paginator), sortable headers, the dialog shell, the
// picture field (resized in the browser, stored as a data URL) and the delete confirm
// (demo ConfirmDialog "delete"; a refused delete shows "Удаление невозможно из-за связи с
// другими данными" and where the entry is used).

export type DictionaryDialog = { kind: "create" } | { kind: "update"; id: number } | { kind: "delete"; id: number; name?: string } | null

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

/** Grid + dialog state mirrored into the URL (replaceState, like the other rebuilt pages). */
export function useDictionaryUrlState(idParam: string, orderings: readonly string[], defaultPageSize: number) {
  const searchParams = useSearchParams()
  const [state, setState] = useState<DictionaryListState>(() => {
    const ordering = searchParams.get("ordering") ?? ""
    const allowed = orderings.flatMap((field) => [field, `-${field}`])
    return {
      search: searchParams.get("search") ?? "",
      ordering: allowed.includes(ordering) ? ordering : "",
      page: positiveInt(searchParams.get("page"), 1),
      pageSize: Math.min(2000, positiveInt(searchParams.get("pageSize"), defaultPageSize)),
    }
  })
  const [dialog, setDialog] = useState<DictionaryDialog>(() => {
    if (searchParams.get("openCreateDialog") === "true") return { kind: "create" }
    const id = positiveInt(searchParams.get(idParam), 0)
    if (!id) return null
    if (searchParams.get("openUpdateDialog") === "true") return { kind: "update", id }
    if (searchParams.get("openDeleteDialog") === "true") return { kind: "delete", id }
    return null
  })

  useEffect(() => {
    const params = new URLSearchParams()
    params.set("pageSize", String(state.pageSize))
    if (state.page > 1) params.set("page", String(state.page))
    if (state.search) params.set("search", state.search)
    if (state.ordering) params.set("ordering", state.ordering)
    if (dialog?.kind === "create") params.set("openCreateDialog", "true")
    if (dialog && dialog.kind !== "create") {
      params.set(idParam, String(dialog.id))
      params.set(dialog.kind === "update" ? "openUpdateDialog" : "openDeleteDialog", "true")
    }
    const search = params.toString()
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state, dialog, idParam])

  const update = useCallback((patch: Partial<DictionaryListState>) => setState((current) => ({ ...current, ...patch })), [])
  return { state, update, dialog, setDialog }
}

/** ?view=tree&page&pageSize&search&ordering of a dictionary API. */
export function dictionaryListUrl(api: string, state: DictionaryListState, tree: boolean): string {
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) })
  if (tree) params.set("view", "tree")
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  return `${api}?${params.toString()}`
}

/** GET of the grid; `reload()` refetches. Keeps the previous data while loading. */
export function useDictionaryList<T extends { count: number }>(url: string) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as T & DictionaryErrorBody
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить данные")
        setData(body)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [url, version])
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { data, loading, error, reload }
}

/** A page past the end (stale URL, deleted rows) jumps to the last page. */
export function useClampPage(count: number | undefined, loading: boolean, state: DictionaryListState, update: (patch: Partial<DictionaryListState>) => void) {
  useEffect(() => {
    if (count === undefined || loading || state.page <= 1) return
    const lastPage = Math.max(1, Math.ceil(count / state.pageSize))
    if (state.page > lastPage) update({ page: lastPage })
  }, [count, loading, state.page, state.pageSize, update])
}

const DICT_ARROW_PREV = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z"
const DICT_ARROW_NEXT = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z"
const DICT_PAGE_SIZES = [10, 25, 50, 100] as const

/** Page body of the reference's dictionary lists: white, full width next to the settings menu. */
export function DictionaryPage({ children }: { children: ReactNode }) {
  return <section className="min-w-0 flex-1 bg-white pb-6 text-[13px] text-[#333]">{children}</section>
}

/** Table header bar (50 px, 30 px inset) and body row with the reference's dotted separator. */
export const DICT_HEAD = "grid h-[50px] items-center bg-[#5d6474] px-[30px] pt-[2px] font-semibold text-white"
export const DICT_ROW =
  "group relative grid min-h-[50px] items-center px-[30px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] hover:bg-[#f2f5f8]"

/** Hover ✎ / 🗑 of a row (22 px glyphs, 8 px apart, 34 px from the right edge). */
export function DictionaryRowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useLanguage()
  const glyph = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
  const bin = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
  return (
    <div className="absolute right-[34px] top-1/2 flex -translate-y-1/2 gap-[8px] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button type="button" onClick={onEdit} title={t("Изменить")} aria-label={t("Изменить")}>
        <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#5d6474] hover:fill-[#4f71dc]"><path d={glyph} /></svg>
      </button>
      <button type="button" onClick={onDelete} title={t("Удалить")} aria-label={t("Удалить")}>
        <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#5d6474] hover:fill-[#e57373]"><path d={bin} /></svg>
      </button>
    </div>
  )
}

/** "+ добавить …", the search box (500 ms debounce / Enter) and the paginator (reference: 60 px bar). */
export function DictionaryToolbar({
  addLabel,
  onAdd,
  state,
  update,
  count,
  bare = false,
  hidePagination = false,
  plus = "thin",
  hideTotal = false,
}: {
  addLabel: string | null
  onAdd: () => void
  state: DictionaryListState
  update: (patch: Partial<DictionaryListState>) => void
  count: number
  /** Only the add button (the demo's Типы продуктов has no search and no paginator). */
  bare?: boolean
  /** Search without the paginator (Тип ячейки). */
  hidePagination?: boolean
  /** "thin" = 14 px "+" next to a lower-case link, "icon" = 24 px "+" next to a capitalised one. */
  plus?: "thin" | "icon"
  /** The reference prints "1 - 25 из" without the total on some lists (units of measure). */
  hideTotal?: boolean
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(state.search)
  useEffect(() => {
    const value = draft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => update({ search: value, page: 1 }), 500)
    return () => window.clearTimeout(timer)
  }, [draft, state.search, update])
  function submit(event: FormEvent) {
    event.preventDefault()
    update({ search: draft.trim(), page: 1 })
  }
  const pageCount = Math.max(1, Math.ceil(count / state.pageSize))
  const from = count === 0 ? 0 : (state.page - 1) * state.pageSize + 1
  const to = Math.min(count, state.page * state.pageSize)
  const go = (page: number) => update({ page })
  return (
    <div className="relative flex h-[60px] items-center">
      {addLabel && (
        <button type="button" onClick={onAdd} className={`absolute left-[17px] flex items-center text-[13px] text-[#4f71dc] hover:underline ${plus === "icon" ? "top-[25px]" : "top-[27px]"}`}>
          <svg viewBox="0 0 24 24" className={`fill-[#4f71dc] ${plus === "icon" ? "h-6 w-6" : "h-[14px] w-[14px]"}`}><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
          <span className={plus === "icon" ? "ml-px" : "ml-[2px]"}>{addLabel}</span>
        </button>
      )}
      {!bare && (
        <>
          <form onSubmit={submit} className="absolute left-[335px] top-[21px] flex h-7 w-[295px] items-center border-b border-[#e0e0e0] focus-within:border-[#5d6474]">
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("Поиск")} className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/30" />
            <button type="submit" aria-label={t("Поиск")} className="mr-[2px] shrink-0">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
            </button>
          </form>
          {!hidePagination && (
            <div className="absolute right-[5px] top-[5px] flex h-[60px] items-center text-[#5d6474]">
              <div className="relative mr-[27px]">
                <select
                  value={state.pageSize}
                  onChange={(event) => update({ pageSize: Number(event.target.value), page: 1 })}
                  aria-label={t("Размер страницы")}
                  className="h-12 w-[40px] appearance-none bg-transparent text-[13px] text-[#333] outline-none"
                >
                  {[...new Set([...DICT_PAGE_SIZES, state.pageSize])].sort((x, y) => x - y).map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-3 h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
              </div>
              <span className="mr-[5px] whitespace-nowrap">{from} - {to} {t("из")}{hideTotal ? "" : ` ${count}`}</span>
              <button type="button" disabled={state.page <= 1} onClick={() => go(state.page - 1)} aria-label={t("Назад")} className="px-[5px]">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${state.page <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d={DICT_ARROW_PREV} /></svg>
              </button>
              <button type="button" disabled={state.page >= pageCount} onClick={() => go(state.page + 1)} aria-label={t("Вперед")}>
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${state.page >= pageCount ? "fill-black/30" : "fill-black/55"}`}><path d={DICT_ARROW_NEXT} /></svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Demo header sorting: none → ↑ → ↓ → none. */
export function SortHeader({
  label,
  field,
  ordering,
  onSort,
  className = "",
  as: Tag = "th",
}: {
  label: string
  field: string
  ordering: string
  onSort: (next: string) => void
  className?: string
  as?: "th" | "div"
}) {
  const next = ordering === field ? `-${field}` : ordering === `-${field}` ? "" : field
  const icon = ordering === field ? <ArrowUp className="h-4 w-4" /> : ordering === `-${field}` ? <ArrowDown className="h-4 w-4" /> : null
  return (
    <Tag className={`${Tag === "th" ? "px-4 py-4 font-semibold " : ""}${className}`}>
      <button type="button" onClick={() => onSort(next)} className="inline-flex items-center gap-1 font-semibold">
        {label} {icon}
      </button>
    </Tag>
  )
}

export function MessageRow({ colSpan, children, tone }: { colSpan: number; children: ReactNode; tone?: "error" }) {
  return (
    <tr>
      <td colSpan={colSpan} className={`px-9 py-10 text-center ${tone === "error" ? "text-red-600" : "text-slate-400"}`}>
        {children}
      </td>
    </tr>
  )
}

/** Field errors + a general message of a failed write. */
export function requestErrors(body: DictionaryErrorBody, fallback: string): { fields: Record<string, string>; general: string } {
  const fields = body.fields ?? {}
  return { fields, general: Object.keys(fields).length ? "" : body.error || fallback }
}

/** Escape closes; returns nothing. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
}

/** Demo dialog: title bar with ✕, body, green "Сохранить". */
export function DictionaryFormShell({
  title,
  busy,
  saving,
  loadError,
  error,
  onClose,
  onSubmit,
  children,
  width = 500,
  bodyMinHeight = 300,
  linkSave = false,
  narrow = true,
}: {
  /** Blue text "СОХРАНИТЬ" link instead of the green button (reference cell dialogs). */
  linkSave?: boolean
  /** Inputs stop 52 px (47 px in 400 px dialogs) short of the right edge, as in the reference. */
  narrow?: boolean
  width?: 400 | 500
  /** Reference body height (dialog height minus the 60 px header and 57 px footer). */
  bodyMinHeight?: number
  title: string
  busy: boolean
  saving: boolean
  loadError: string
  error: string
  onClose: () => void
  onSubmit: (event: FormEvent) => void
  children: ReactNode
}) {
  const { t } = useLanguage()
  useEscape(onClose)
  return (
    <div className="fixed inset-0 z-[70] flex justify-center overflow-y-auto bg-black/45 p-4" onMouseDown={onClose}>
      {/* centered like the reference dialogs (my-auto keeps a tall dialog scrollable from its top) */}
      <form onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()} className={`relative my-auto w-full rounded bg-white shadow-2xl ${width === 400 ? "max-w-[400px]" : "max-w-[500px]"}`} aria-busy={busy} noValidate>
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[15px]">
          <b className="text-[13px] font-bold uppercase text-[#333]">{title}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#333] hover:opacity-70">
            <X className="h-6 w-6" strokeWidth={1.6} />
          </button>
        </header>
        <div className={`relative pb-6 pl-[30px] pt-[40px] ${narrow ? (width === 400 ? "pr-[47px]" : "pr-[52px]") : "pr-[30px]"}`} style={{ minHeight: bodyMinHeight }}>
          {busy && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          {loadError ? <p className="py-10 text-center text-[14px] text-[#f44336]">{t(loadError)}</p> : children}
          {error && <p className="text-sm font-medium text-rose-600">{t(error)}</p>}
        </div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#efefef] px-[10px]">
          <button type="submit" disabled={busy || Boolean(loadError)} className={linkSave ? "h-9 px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:opacity-80 disabled:opacity-60" : "h-9 rounded bg-[#6ccd8b] px-4 text-[13px] font-semibold uppercase text-white hover:brightness-95 disabled:opacity-60"}>
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </footer>
      </form>
    </div>
  )
}

/** Underlined text input of the dictionary dialogs (demo material fields). */
export const dictionaryInputClass = "h-9 w-full min-w-0 border-0 border-b border-[#e0e0e0] bg-transparent px-0 pt-[12px] text-[13px] font-semibold text-[#333] outline-none focus:border-[#4f70e7]"

/** Material floating-label field: the bold label sits on the empty input and shrinks above a filled one. */
export function Field({ label, required, error, filled = false, select = false, className = "", children }: { label: string; required?: boolean; error?: string; filled?: boolean; /** Select blocks are 42 px tall with the label 9 px from the top (text blocks 43 px / 20 px). */ select?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={`relative min-w-0 ${select ? "h-[42px]" : "h-[43px]"} ${className}`}>
      <span className={`pointer-events-none absolute left-0 z-10 font-semibold text-black transition-all ${filled ? (select ? "top-[-16px] text-[10px]" : "top-[-1px] text-[10px]") : select ? "top-[9px] text-[13px]" : "top-[20px] text-[13px]"}`}>
        {label}
        {required && <span className="text-[#e57373]"> *</span>}
      </span>
      <div className={`absolute inset-x-0 text-[13px] font-semibold ${select ? "-top-[3px] [&_*]:!text-[13px] [&_button]:font-medium" : "top-[7px]"}`}>{children}</div>
      {error && <span className="absolute left-0 top-[46px] text-[12px] text-[#e57373]">{error}</span>}
    </div>
  )
}

/** Demo toggle with a title and a sub-title ("Показывать в боте" / "Показывать в телеграм боте"). */
export function Toggle({ title, subTitle, checked, onChange }: { title: string; subTitle?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 pt-[15px]">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative h-5 w-9 shrink-0"
      >
        <span className={`absolute left-0 top-[3px] h-[14px] w-9 rounded-full transition-colors ${checked ? "bg-[#9fb0f1]" : "bg-[#dcdcdc]"}`} />
        <span className={`absolute top-0 h-5 w-5 rounded-full shadow transition-all ${checked ? "left-[16px] bg-[#4f70e7]" : "left-0 bg-white"}`} />
      </button>
      <span>
        <span className="block text-[13px] font-semibold leading-[16px] text-[#333]">{title}</span>
        {subTitle && <span className="block text-[13px] text-[#333]">{subTitle}</span>}
      </span>
    </label>
  )
}

/** Picture → data URL with the longest side ≤ DICTIONARY_IMAGE_MAX_SIDE (transparent pictures stay PNG/WebP). */
export async function resizeDictionaryImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image()
      element.onload = () => resolve(element)
      element.onerror = reject
      element.src = url
    })
    const scale = Math.min(1, DICTIONARY_IMAGE_MAX_SIDE / Math.max(image.width, image.height, 1))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)
    return /png|gif|webp|svg/.test(file.type) ? canvas.toDataURL("image/webp", 0.9) : canvas.toDataURL("image/jpeg", 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Demo ImageUploadField: a dashed drop zone "Добавьте фото" showing the picture.
 * `value` = the stored picture URL, `pending` = a new data URL (null = removed, undefined = unchanged).
 */
export function ImageField({ value, pending, onChange, error, className = "mt-[22px]" }: { value: string | null; pending: string | null | undefined; onChange: (next: string | null | undefined) => void; error?: string; className?: string }) {
  const { t } = useLanguage()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState("")
  const shown = pending === undefined ? value : pending

  async function pick(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith("image/")) return setLocalError(t("Неверный формат изображения"))
    setBusy(true)
    setLocalError("")
    try {
      onChange(await resizeDictionaryImage(file))
    } catch {
      setLocalError(t("Неверный формат изображения"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => { void pick(event.target.files?.[0]); event.target.value = "" }} />
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") input.current?.click() }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void pick(event.dataTransfer.files?.[0]) }}
        className="relative mx-auto flex h-[200px] w-full max-w-[200px] cursor-pointer items-center justify-center overflow-hidden border-2 border-dashed border-[#efefef] text-[#333] hover:border-[#4f70e7]"
      >
        {busy ? (
          <Loader2 className="h-7 w-7 animate-spin" />
        ) : shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URLs / private API pictures
          <img src={shown} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-[10px] text-[13px]">
            <svg viewBox="0 0 24 24" className="h-[30px] w-[30px] fill-[#bdbdbd]" aria-hidden>
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
            </svg>
            {t("Добавьте фото")}
          </span>
        )}
        {shown && !busy && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onChange(value ? null : undefined) }}
            aria-label={t("Удалить")}
            title={t("Удалить")}
            className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-[#666] shadow hover:text-[#e57373]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {(localError || error) && <span className="text-center text-[12px] text-[#e57373]">{localError || error}</span>}
    </div>
  )
}

/** Организация options: GET /api/organizations + the stored value when it is not listed. */
export function useOrganizationOptions(stored: string): { options: PickOption[]; required: boolean; loading: boolean } {
  const { items, loading } = useJsonList<Named>("/api/organizations")
  const options = useMemo(() => {
    const list = items.map((item) => ({ value: item.name, label: item.name }))
    if (stored && !list.some((option) => option.value === stored)) list.unshift({ value: stored, label: stored })
    return list
  }, [items, stored])
  return { options, required: items.length > 0, loading }
}

/** Demo ConfirmDialog type "delete": "Подтверждение удаления" + the name; shows where a refused entry is used. */
export function DictionaryDeleteDialog({
  api,
  id,
  name,
  onClose,
  onDeleted,
  onFailed,
}: {
  api: string
  id: number
  /** Known name (grid row); otherwise read from GET {api}/[id]. */
  name?: string
  onClose: () => void
  onDeleted: () => void
  /** Already translated snackbar message. */
  onFailed: (message: string) => void
}) {
  const { t } = useLanguage()
  const [loadedName, setLoadedName] = useState("")
  const [loading, setLoading] = useState(!name)
  const [loadError, setLoadError] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [blockedBy, setBlockedBy] = useState<DictionaryUsage[]>([])
  useEscape(onClose)

  useEffect(() => {
    if (name) return
    const controller = new AbortController()
    fetch(`${api}/${id}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { name?: string } & DictionaryErrorBody
        if (!response.ok) throw new Error(data.error || "Не найдено")
        setLoadedName(data.name ?? "")
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [api, id, name])

  async function remove() {
    if (deleting || loading || loadError) return
    setDeleting(true)
    try {
      const response = await fetch(`${api}/${id}`, { method: "DELETE" })
      if (response.ok) return onDeleted()
      const data = (await response.json().catch(() => ({}))) as DictionaryErrorBody
      const usage = data.usage ?? []
      setBlockedBy(usage)
      const base = t(data.error || "Удаление невозможно из-за связи с другими данными")
      onFailed(usage.length ? `${base}: ${dictionaryUsageText(usage, t)}` : base)
    } catch {
      onFailed(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setDeleting(false)
    }
  }

  const busy = loading || deleting
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4" onMouseDown={onClose}>
      <div onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-[500px] rounded bg-white shadow-2xl">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[15px]">
          <b className="text-[13px] font-bold uppercase text-[#333]">{t("Подтверждение удаления")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="relative min-h-[210px] px-[30px] text-[13px] text-[#333]">
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          <p className="py-5 leading-4">{t("Вы уверены что хотите удалить эти данные?")}</p>
          {loadError ? <p className="pb-5 text-[#f44336]">{t(loadError)}</p> : <div className="-mx-[30px] bg-[#f1f5f8] px-[30px] py-5 font-semibold leading-4">{name || loadedName}</div>}
          {blockedBy.length > 0 && (
            <div className="py-5 text-[#f44336]">
              <p>{t("Удаление невозможно из-за связи с другими данными")}:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {blockedBy.map((item) => (
                  <li key={item.table}>
                    {t(item.label)} — {item.count}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <footer className="flex h-[57px] items-center justify-end border-t border-[#efefef] px-[10px]">
          <button
            type="button"
            onClick={remove}
            disabled={busy || Boolean(loadError) || blockedBy.length > 0}
            className="rounded py-2.5 pl-5 pr-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#129fdd]/10 disabled:opacity-50"
          >
            {t("Удалить")}
          </button>
        </footer>
      </div>
    </div>
  )
}
