"use client"

import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Search, X } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react"

import { BalancePagination } from "@/components/analytics/balance/pagination"
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

/** "+ добавить …", the search box (500 ms debounce / Enter) and the paginator. */
export function DictionaryToolbar({
  addLabel,
  onAdd,
  state,
  update,
  count,
}: {
  addLabel: string | null
  onAdd: () => void
  state: DictionaryListState
  update: (patch: Partial<DictionaryListState>) => void
  count: number
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
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      {addLabel && (
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 text-[16px] text-[#4f71dc] hover:underline">
          <Plus className="h-4 w-4" /> {addLabel}
        </button>
      )}
      <form onSubmit={submit} className="relative mx-auto w-full max-w-[300px]">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
        <button type="submit" aria-label={t("Поиск")} className="absolute right-1 top-1.5 text-slate-300 hover:text-[#4f70e7]">
          <Search className="h-5 w-5" />
        </button>
      </form>
      <BalancePagination page={state.page} pageSize={state.pageSize} count={count} onChange={(next) => update(next)} />
    </div>
  )
}

/** Demo header sorting: none → ↑ → ↓ → none. */
export function SortHeader({ label, field, ordering, onSort, className = "" }: { label: string; field: string; ordering: string; onSort: (next: string) => void; className?: string }) {
  const next = ordering === field ? `-${field}` : ordering === `-${field}` ? "" : field
  const icon = ordering === field ? <ArrowUp className="h-4 w-4" /> : ordering === `-${field}` ? <ArrowDown className="h-4 w-4" /> : null
  return (
    <th className={`px-4 py-4 font-semibold ${className}`}>
      <button type="button" onClick={() => onSort(next)} className="inline-flex items-center gap-1 font-semibold">
        {label} {icon}
      </button>
    </th>
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
}: {
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
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:py-10" onMouseDown={onClose}>
      <form onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()} className="relative w-full max-w-[500px] rounded bg-white shadow-2xl" aria-busy={busy} noValidate>
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-3">
          <b className="text-[14px] uppercase text-[#333]">{title}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="relative min-h-[160px] space-y-4 px-[30px] pb-6 pt-5">
          {busy && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          {loadError ? <p className="py-10 text-center text-[14px] text-[#f44336]">{t(loadError)}</p> : children}
          {error && <p className="text-sm font-medium text-rose-600">{t(error)}</p>}
        </div>
        <footer className="flex justify-end border-t border-[#efefef] p-4">
          <button type="submit" disabled={busy || Boolean(loadError)} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </footer>
      </form>
    </div>
  )
}

export function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[13px] text-[#586174]">
      <span>
        {label}
        {required && <span className="text-[#e57373]"> *</span>}
      </span>
      {children}
      {error && <span className="text-[12px] text-[#e57373]">{error}</span>}
    </div>
  )
}

/** Demo toggle with a title and a sub-title ("Показывать в боте" / "Показывать в телеграм боте"). */
export function Toggle({ title, subTitle, checked, onChange }: { title: string; subTitle?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 pt-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-[#4f70e7]" : "bg-slate-300"}`}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
      </button>
      <span>
        <span className="block text-[14px] text-[#333]">{title}</span>
        {subTitle && <span className="block text-[12px] text-[#9aa3b6]">{subTitle}</span>}
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
export function ImageField({ value, pending, onChange, error }: { value: string | null; pending: string | null | undefined; onChange: (next: string | null | undefined) => void; error?: string }) {
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
    <div className="flex flex-col gap-1">
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => { void pick(event.target.files?.[0]); event.target.value = "" }} />
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") input.current?.click() }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); void pick(event.dataTransfer.files?.[0]) }}
        className="relative mx-auto flex h-[200px] w-full max-w-[300px] cursor-pointer items-center justify-center overflow-hidden border-2 border-dashed border-[#efefef] text-[#9aa3b6] hover:border-[#4f70e7] hover:text-[#4f70e7]"
      >
        {busy ? (
          <Loader2 className="h-7 w-7 animate-spin" />
        ) : shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URLs / private API pictures
          <img src={shown} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-2 text-[13px]">
            <ImagePlus className="h-8 w-8" />
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
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-3">
          <b className="text-[14px] uppercase text-[#333]">{t("Подтверждение удаления")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="relative min-h-[150px] px-[30px] text-[14px] text-[#333]">
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          <p className="py-5">{t("Вы уверены что хотите удалить эти данные?")}</p>
          {loadError ? <p className="pb-5 text-[#f44336]">{t(loadError)}</p> : <div className="-mx-[30px] bg-[#f1f5f8] px-[30px] py-5 font-semibold">{name || loadedName}</div>}
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
        <footer className="flex justify-end border-t border-[#efefef] p-[10px]">
          <button
            type="button"
            onClick={remove}
            disabled={busy || Boolean(loadError) || blockedBy.length > 0}
            className="rounded px-5 py-2.5 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#129fdd]/10 disabled:opacity-50"
          >
            {t("Удалить")}
          </button>
        </footer>
      </div>
    </div>
  )
}
