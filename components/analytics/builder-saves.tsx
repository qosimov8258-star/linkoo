"use client"

import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"

import { RI } from "@/components/ref/list-kit"
import { RefMuiRadio } from "@/components/ref/mui-dialog"
import { LineMultiSearchSelect } from "@/components/settings/user-select"
import { askDelete } from "@/lib/ask-confirm"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  BUILDER_DATE_RANGES,
  type BuilderShare,
  type BuilderShareOption,
  type BuilderShareOptions,
  type NewReportBuilderSave,
} from "@/lib/new-report-builder-types"
import { notify } from "@/lib/notify"
import { currentMonthPeriod, isoParam } from "./builder-period"
import { LineField, Modal, SaveLink } from "./catalog-ui"

// «Сохранить» / «Отчеты» of the constructors (the reference's #/new-quick-report, one page for every model):
// the save dialog «СОХРАНИТЬ ТАБЛИЦУ», the right drawer «ОТЧЕТЫ» listing every saved constructor report, and
// the row actions «ИЗМЕНИЕ ТАБЛИЦЫ № …» (pencil), delete (trash) and «ПОЛЬЗОВАТЕЛИ» (people). Shared by the
// general constructor (NewReportBuilderView) and the visit / sales constructors (VisitBuilderView), so all of
// them save to /api/new-report-builder-saves and behave the same.

/** The constructor pages of this app. */
export type BuilderPage = "visits" | "sales" | "general" | "stock"

export const BUILDER_PAGE_PATHS: Record<BuilderPage, string> = {
  visits: "/analytics/visit-builder",
  sales: "/analytics/sales-builder",
  general: "/analytics/report-builder",
  // «Конструктор отчетов по текущим остаткам» (the reference's #/new-quick-report/?category=remainder).
  stock: "/analytics/current-stock-report-builder",
}

/** Models of the visit constructor (Конструктор по визитам). */
const VISIT_MODELS = ["Визит", "Задачи", "Отказы"]

/** A model as the reference lists it ("ЗАКАЗ И ВОЗВРАТ ПО ДАТЕ РЕАЛИЗАЦИИ" → "Заказ и возврат по дате реализации"). */
export function modelName(type: string): string {
  const text = type.trim()
  return text && text === text.toUpperCase() && /[А-ЯЁA-Z]/.test(text) ? text.charAt(0) + text.slice(1).toLowerCase() : text
}

/** The page a save opens on: the one it was saved from; a save without one by its model. */
export function builderPageOf(save: Pick<NewReportBuilderSave, "reportType" | "config">): BuilderPage {
  const builder = save.config.builder
  if (builder === "visits" || builder === "sales" || builder === "general" || builder === "stock") return builder
  return VISIT_MODELS.includes(modelName(save.reportType)) ? "visits" : "general"
}

type Period = { from: string; to: string }

const pad = (value: number) => String(value).padStart(2, "0")
const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** The period a range preset stands for today (СВОЯ keeps the saved days). */
export function presetPeriod(preset: string, saved: Period | null): Period {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const shift = (days: number) => {
    const day = new Date(today)
    day.setDate(day.getDate() + days)
    return isoOf(day)
  }
  if (preset === "СЕГОДНЯ") return { from: isoOf(today), to: isoOf(today) }
  if (preset === "ВЧЕРА") return { from: shift(-1), to: shift(-1) }
  if (preset === "ПОСЛ. 7") return { from: shift(-7), to: isoOf(today) }
  if (preset === "МЕСЯЦ") return currentMonthPeriod()
  return saved ?? currentMonthPeriod()
}

/** The period of a saved report's config (its preset, else the saved days). */
export function savedPeriod(config: Record<string, unknown>): Period {
  const from = isoParam(typeof config.from === "string" ? config.from : null)
  const to = isoParam(typeof config.to === "string" ? config.to : null)
  return presetPeriod(typeof config.dateRange === "string" ? config.dateRange : "СВОЯ", from && to && from <= to ? { from, to } : null)
}

/** The strings of a saved list setting. */
export function savedList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

/** The text values of a saved record setting (filter values). */
export function savedRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

const PAGE_SIZE = 25

const PEOPLE = "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
const PREV = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z"
const NEXT = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z"

async function errorOf(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null
  return data?.error || fallback
}

/** СЕГОДНЯ | ВЧЕРА | ПОСЛ. 7 | МЕСЯЦ | СВОЯ of the save and edit dialogs. */
function RangePresets({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  return (
    <div role="radiogroup" className="flex flex-wrap justify-center gap-[2px]">
      {BUILDER_DATE_RANGES.map((preset) => (
        <button
          key={preset}
          type="button"
          role="radio"
          aria-checked={value === preset}
          onClick={() => onChange(preset)}
          className={`h-[32px] rounded-[3px] border px-[15px] text-[13px] uppercase transition-colors ${value === preset ? "border-brand-blue bg-brand-blue text-white shadow-[0_2px_5px_rgba(0,0,0,0.2)]" : "border-[#e0e0e0] bg-white text-[#333] hover:bg-[#f2f5f8]"}`}
        >
          {t(preset)}
        </button>
      ))}
    </div>
  )
}

/** Footer of the dialogs: the server's refusal on the left, «СОХРАНИТЬ» on the right. */
function DialogFooter({ error, busy, disabled, onSave }: { error: string; busy: boolean; disabled?: boolean; onSave: () => void }) {
  const { t } = useLanguage()
  return (
    <>
      {error && <span className="mr-auto pl-[30px] text-[13px] text-[#e57373]">{t(error)}</span>}
      <SaveLink disabled={busy || disabled} onClick={onSave}>{busy ? t("Сохранение...") : t("Сохранить")}</SaveLink>
    </>
  )
}

/** Option names made unique ("Имя" twice → "Имя (12)") so the chips map back to ids. */
function optionLabels(options: BuilderShareOption[]): Map<number, string> {
  const count = new Map<string, number>()
  for (const option of options) count.set(option.name, (count.get(option.name) ?? 0) + 1)
  return new Map(options.map((option) => [option.id, (count.get(option.name) ?? 0) > 1 ? `${option.name} (${option.id})` : option.name]))
}

/** «ПОЛЬЗОВАТЕЛИ»: who sees the report (the chosen accounts or access rights). */
function ShareDialog({ save, onClose, onSaved }: { save: NewReportBuilderSave; onClose: () => void; onSaved: (save: NewReportBuilderSave) => void }) {
  const { t } = useLanguage()
  const [options, setOptions] = useState<BuilderShareOptions | null>(null)
  const [mode, setMode] = useState<BuilderShare["mode"]>(save.share?.mode ?? "users")
  // An unrestricted report starts with its author, as the reference shows it.
  const [userIds, setUserIds] = useState<number[]>(save.share ? (save.share.mode === "users" ? save.share.ids : []) : save.createdBy ? [save.createdBy] : [])
  const [rightIds, setRightIds] = useState<number[]>(save.share?.mode === "rights" ? save.share.ids : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/new-report-builder-saves/share-options")
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorOf(response, "Не удалось загрузить данные"))
        return response.json() as Promise<BuilderShareOptions>
      })
      .then((data) => {
        if (!cancelled) setOptions(data)
      })
      .catch((reason: unknown) => {
        // «СОХРАНИТЬ» stays off: without the lists the choice would be lost.
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Не удалось загрузить данные")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const labels = useMemo(() => optionLabels((mode === "users" ? options?.users : options?.rights) ?? []), [mode, options])
  const ids = mode === "users" ? userIds : rightIds
  const setIds = mode === "users" ? setUserIds : setRightIds
  const value = ids.filter((id) => labels.has(id)).map((id) => labels.get(id) as string)
  const change = (next: string[]) => {
    const byLabel = new Map([...labels].map(([id, label]) => [label, id]))
    setIds(next.map((label) => byLabel.get(label)).filter((id): id is number => id !== undefined))
  }

  const submit = async () => {
    setBusy(true)
    setError("")
    try {
      // Nobody chosen: the report is not restricted (every user sees it).
      const chosen = ids.filter((id) => labels.has(id))
      const response = await fetch(`/api/new-report-builder-saves/${save.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share: chosen.length ? { mode, ids: chosen } : null }),
      })
      if (!response.ok) {
        setError(await errorOf(response, "Не удалось сохранить"))
        return
      }
      onSaved((await response.json()) as NewReportBuilderSave)
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="ПОЛЬЗОВАТЕЛИ" width={600} onClose={onClose} bodyClassName="min-h-[300px] px-[30px] pb-[24px] pt-[30px]" footer={<DialogFooter error={error} busy={busy} disabled={!options} onSave={() => void submit()} />}>
      <div role="radiogroup">
        <RefMuiRadio checked={mode === "users"} onChange={() => setMode("users")}>{t("Выбранным сотрудникам")}</RefMuiRadio>
        <RefMuiRadio checked={mode === "rights"} onChange={() => setMode("rights")}>{t("Выбранным доступам")}</RefMuiRadio>
      </div>
      <div className="mt-[16px]">
        <LineMultiSearchSelect key={mode} label={t(mode === "users" ? "Пользователи" : "Права доступа")} value={value} onChange={change} options={[...labels.values()]} />
      </div>
    </Modal>
  )
}

/** «ИЗМЕНИЕ ТАБЛИЦЫ № …»: a new name and the period preset. */
function EditDialog({ save, onClose, onSaved }: { save: NewReportBuilderSave; onClose: () => void; onSaved: (save: NewReportBuilderSave) => void }) {
  const { t } = useLanguage()
  const [range, setRange] = useState(typeof save.config.dateRange === "string" ? save.config.dateRange : "СВОЯ")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const submit = async () => {
    setBusy(true)
    setError("")
    try {
      // An empty "Новое название" keeps the name and changes the period preset only.
      const response = await fetch(`/api/new-report-builder-saves/${save.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateRange: range, ...(name.trim() ? { name: name.trim() } : {}) }),
      })
      if (!response.ok) {
        setError(await errorOf(response, "Не удалось сохранить"))
        return
      }
      onSaved((await response.json()) as NewReportBuilderSave)
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`${t("ИЗМЕНИЕ ТАБЛИЦЫ №")} ${save.id}`} onClose={onClose} bodyClassName="px-[30px] pb-[40px] pt-[15px]" footer={<DialogFooter error={error} busy={busy} onSave={() => void submit()} />}>
      <RangePresets value={range} onChange={setRange} />
      <form className="mt-[23px]" onSubmit={(event) => { event.preventDefault(); if (!busy) void submit() }}>
        <LineField label="Новое название" value={name} onChange={setName} autoFocus />
      </form>
    </Modal>
  )
}

/** «СОХРАНИТЬ ТАБЛИЦУ»: the period preset and the table's name. */
function SaveDialog({ onClose, onSave }: { onClose: () => void; onSave: (name: string, range: string) => Promise<string | null> }) {
  const [range, setRange] = useState("СВОЯ")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError("")
    const failure = await onSave(name.trim(), range)
    setBusy(false)
    if (failure) setError(failure)
  }
  return (
    <Modal title="СОХРАНИТЬ ТАБЛИЦУ" onClose={onClose} bodyClassName="px-[30px] pb-[40px] pt-[15px]" footer={<DialogFooter error={error} busy={busy} disabled={!name.trim()} onSave={() => void submit()} />}>
      <RangePresets value={range} onChange={setRange} />
      <form className="mt-[23px]" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <LineField label="Название таблицы" value={name} onChange={setName} autoFocus />
      </form>
    </Modal>
  )
}

function RowAction({ path, label, onClick }: { path: string; label: string; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      title={t(label)}
      aria-label={t(label)}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="flex h-[25px] w-[30px] items-center justify-center"
    >
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden>
        <path d={path} />
      </svg>
    </button>
  )
}

const ROW_GRID = "grid grid-cols-[62px_minmax(0,246px)_minmax(0,1fr)_100px] items-center gap-x-[8px] pl-[38px] pr-[20px]"

/** «ОТЧЕТЫ»: every saved constructor report the reader may see. */
function ReportsDrawer({
  reports,
  onClose,
  onOpen,
  onEdit,
  onDelete,
  onShare,
  blockEscape,
}: {
  reports: NewReportBuilderSave[] | null
  onClose: () => void
  onOpen: (save: NewReportBuilderSave) => void
  onEdit: (save: NewReportBuilderSave) => void
  onDelete: (save: NewReportBuilderSave) => void
  onShare: (save: NewReportBuilderSave) => void
  /** A dialog over the drawer takes Escape. */
  blockEscape: boolean
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (blockEscape) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [blockEscape, onClose])

  const needle = query.trim().toLocaleLowerCase("ru")
  const list = (reports ?? []).filter((save) => !needle || `${save.id} ${save.name} ${t(modelName(save.reportType))}`.toLocaleLowerCase("ru").includes(needle))
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shown = list.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100]" onMouseDown={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-labelledby="builder-saves-title" className="fixed bottom-0 right-0 top-0 z-[100] flex w-[min(800px,100vw)] flex-col bg-white font-sans text-[13px] text-[#333] shadow-[0_8px_10px_-5px_rgba(0,0,0,0.2),0_16px_24px_2px_rgba(0,0,0,0.14),0_6px_30px_5px_rgba(0,0,0,0.12)] animate-in slide-in-from-right-full duration-200">
        <header className="flex h-[56px] shrink-0 items-center justify-between border-b border-[#e0e0e0] pl-[30px] pr-[13px]">
          <h2 id="builder-saves-title" className="text-[13px] font-bold uppercase">{t("ОТЧЕТЫ")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть отчеты")} className="flex h-12 w-12 items-center justify-center text-[#333] hover:opacity-70">
            <X className="h-6 w-6" strokeWidth={1.6} />
          </button>
        </header>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-y-2 border-b border-[#e8e8e8] py-[14px] pl-[30px] pr-[30px]">
          <label className="relative w-[255px] max-w-[calc(100%-30px)]">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder={t("Поиск таблицы...")} aria-label={t("Поиск таблицы...")} className="h-[32px] w-full border-b border-[#d5d5d5] text-[13px] outline-none placeholder:text-[#999] focus:border-[#129fdd]" />
            <Search className="absolute right-[-22px] top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[#999]" aria-hidden />
          </label>
          <div className="ml-auto flex items-center text-[13px] text-[#555]">
            <span>{list.length ? `${current * PAGE_SIZE + 1} - ${current * PAGE_SIZE + shown.length}` : "0 - 0"} {t("из")} {list.length}</span>
            <button type="button" aria-label={t("Назад")} disabled={current === 0} onClick={() => setPage(current - 1)} className="ml-[14px] flex h-6 w-6 items-center justify-center">
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${current === 0 ? "fill-black/30" : "fill-black/55"}`} aria-hidden><path d={PREV} /></svg>
            </button>
            <button type="button" aria-label={t("Вперед")} disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="ml-[5px] flex h-6 w-6 items-center justify-center">
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${current >= pages - 1 ? "fill-black/30" : "fill-black/55"}`} aria-hidden><path d={NEXT} /></svg>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className={`${ROW_GRID} h-[56px] border-b border-dotted border-[#bbb] font-bold`}>
            <span>№</span>
            <span>{t("Название")}</span>
            <span>{t("Модель")}</span>
            <span />
          </div>
          {reports === null && <p className="py-[40px] text-center text-[#999]">{t("Загрузка...")}</p>}
          {reports !== null &&
            shown.map((save) => (
              <div
                key={save.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(save)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.target === event.currentTarget) onOpen(save)
                }}
                className={`${ROW_GRID} group min-h-[46px] cursor-pointer border-b border-dotted border-[#bbb] py-[6px] outline-none hover:bg-[#f5f5f5] focus-visible:bg-[#f5f5f5]`}
              >
                <span>{save.id}</span>
                <span className="break-words">{save.name}</span>
                <span className="break-words">{t(modelName(save.reportType))}</span>
                <span className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {save.editable && (
                    <>
                      <RowAction path={RI.edit} label="Изменить" onClick={() => onEdit(save)} />
                      <RowAction path={RI.trash} label="Удалить" onClick={() => onDelete(save)} />
                      <RowAction path={PEOPLE} label="Пользователи" onClick={() => onShare(save)} />
                    </>
                  )}
                </span>
              </div>
            ))}
          {reports !== null && shown.length === 0 && <p className="py-[40px] text-center text-[#999]">{t("Отчеты не найдены")}</p>}
        </div>
      </aside>
    </>,
    document.body,
  )
}

/**
 * «Сохранить» and «Отчеты» of a constructor page. `snapshot` is the model and every setting on screen (what is
 * saved), `onLoad` puts a save of this page back on screen; a save of another constructor page opens there
 * (?report=<id>, read on mount by every page). Render `dialogs` once in the page.
 */
export function useBuilderSaves({
  page,
  snapshot,
  onLoad,
  onMessage,
}: {
  page: BuilderPage
  snapshot: () => { reportType: string; config: Record<string, unknown> }
  onLoad: (save: NewReportBuilderSave) => void
  /** The page's status line. */
  onMessage: (text: string) => void
}): { openSave: () => void; openReports: () => void; dialogs: ReactNode } {
  const { t } = useLanguage()
  const router = useRouter()
  const [saveOpen, setSaveOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [reports, setReports] = useState<NewReportBuilderSave[] | null>(null)
  const [editing, setEditing] = useState<NewReportBuilderSave | null>(null)
  const [sharing, setSharing] = useState<NewReportBuilderSave | null>(null)
  const [confirming, setConfirming] = useState(false)

  /** Puts the save on screen, or opens the constructor page it belongs to. */
  const open = (save: NewReportBuilderSave, replace = false) => {
    const target = builderPageOf(save)
    if (target !== page) {
      const url = `${BUILDER_PAGE_PATHS[target]}?report=${save.id}`
      if (replace) router.replace(url)
      else router.push(url)
      return
    }
    setReportsOpen(false)
    onLoad(save)
    onMessage(`${t("Отчет «")}${save.name}${t("» загружен")}`)
  }

  // ?report=<id>: the save chosen in «ОТЧЕТЫ» of another constructor page.
  const openFromUrl = useEffectEvent((save: NewReportBuilderSave | null) => {
    if (save) open(save, true)
    else onMessage(t("Отчет не найден"))
  })
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get("report")
    if (raw === null) return
    let cancelled = false
    fetch(`/api/new-report-builder-saves/${encodeURIComponent(raw)}`)
      .then((response) => (response.ok ? (response.json() as Promise<NewReportBuilderSave>) : null))
      .catch(() => null)
      .then((save) => {
        if (cancelled) return
        const next = new URLSearchParams(window.location.search)
        next.delete("report")
        const query = next.toString()
        window.history.replaceState(window.history.state, "", query ? `${window.location.pathname}?${query}` : window.location.pathname)
        openFromUrl(save)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const openReports = () => {
    setReportsOpen(true)
    setReports(null)
    fetch("/api/new-report-builder-saves")
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorOf(response, "Не удалось загрузить данные"))
        return response.json() as Promise<NewReportBuilderSave[]>
      })
      .then(setReports)
      .catch((reason: unknown) => {
        setReports([])
        notify(reason instanceof Error ? reason.message : "Не удалось загрузить данные")
      })
  }

  /** «СОХРАНИТЬ ТАБЛИЦУ» → the server; the refusal text, or null when saved. */
  const save = async (name: string, dateRange: string): Promise<string | null> => {
    const { reportType, config } = snapshot()
    try {
      const response = await fetch("/api/new-report-builder-saves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, reportType, config: { ...config, builder: page, dateRange } }),
      })
      if (!response.ok) return errorOf(response, "Не удалось сохранить")
      setSaveOpen(false)
      onMessage(t("Настройки отчета сохранены"))
      return null
    } catch {
      return "Сервер недоступен, попробуйте ещё раз"
    }
  }

  const remove = async (target: NewReportBuilderSave) => {
    setConfirming(true)
    const ok = await askDelete(target.name)
    setConfirming(false)
    if (!ok) return
    try {
      const response = await fetch(`/api/new-report-builder-saves/${target.id}`, { method: "DELETE" })
      if (!response.ok) {
        notify(await errorOf(response, "Не удалось удалить"))
        return
      }
      setReports((current) => (current ?? []).filter((item) => item.id !== target.id))
      onMessage(t("Отчет удален"))
    } catch {
      notify("Сервер недоступен, попробуйте ещё раз")
    }
  }

  const replaceSave = (next: NewReportBuilderSave) => setReports((current) => (current ?? []).map((item) => (item.id === next.id ? next : item)))

  const dialogs = (
    <>
      {reportsOpen && (
        <ReportsDrawer
          reports={reports}
          onClose={() => setReportsOpen(false)}
          onOpen={(target) => open(target)}
          onEdit={setEditing}
          onDelete={(target) => void remove(target)}
          onShare={setSharing}
          blockEscape={editing !== null || sharing !== null || confirming}
        />
      )}
      {saveOpen && <SaveDialog onClose={() => setSaveOpen(false)} onSave={save} />}
      {editing && <EditDialog key={editing.id} save={editing} onClose={() => setEditing(null)} onSaved={(next) => { replaceSave(next); setEditing(null) }} />}
      {sharing && <ShareDialog key={sharing.id} save={sharing} onClose={() => setSharing(null)} onSaved={(next) => { replaceSave(next); setSharing(null) }} />}
    </>
  )

  return { openSave: () => setSaveOpen(true), openReports, dialogs }
}
