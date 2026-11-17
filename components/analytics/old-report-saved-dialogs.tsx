"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Loader2, Search, X } from "lucide-react"
import { ConfirmDialog } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"

// The saved reports of the old builder as Linko shows them (#/quick-report): «Сохранить» (СОХРАНИТЬ ТАБЛИЦУ: the period
// kind and the name), the «Отчеты» / «Виджеты» list (five tabs, a «Выбрать» hint on every cell, «Изменить» / «Удалить» /
// «Пользователи» on the row under the pointer), «Измение таблицы № …» (Linko's spelling), the delete confirmation
// «Удаление таблицы № …» and «Пользователи» (to the chosen employees or the chosen access rights).

/** Linko's period kinds of a saved report (REPORT_PERIOD_TYPES); «Своя» keeps the dates the report was saved with. */
export type PeriodType = "today" | "yesterday" | "week" | "month" | "ownDate"
export const PERIOD_TYPES: Array<{ id: PeriodType; name: string }> = [
  { id: "today", name: "Сегодня" },
  { id: "yesterday", name: "Вчера" },
  { id: "week", name: "Посл. 7" },
  { id: "month", name: "Месяц" },
  { id: "ownDate", name: "Своя" },
]

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

/** The dates a saved report opens with (Linko's periodTypeDates): today; yesterday; the seven days before today;
 * this month; null = the dates saved with it. */
export function periodTypeDates(type: unknown, now = new Date()): { from: string; to: string } | null {
  const day = (offset: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset))
  switch (type) {
    case "today":
      return { from: day(0), to: day(0) }
    case "yesterday":
      return { from: day(-1), to: day(-1) }
    case "week":
      return { from: day(-7), to: day(-1) }
    case "month":
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
    default:
      return null
  }
}

export type SavedReport = { id: number; name: string; config: unknown; reportType: "table" | "widget" }
type StaticWidget = { id: number; name: string; device: string }
type ModelRef = { key: string; name: string }
type Sharing = { type: "user" | "position"; users: number[]; positions: number[]; options: { users: Option[]; positions: Option[] } }
type Option = { id: number; name: string }

const SHOWS = ["own", "other", "all", "pattern", "static_widget"] as const
const TABS = {
  reports: ["Мои отчеты", "Отчеты сотрудников", "Все", "Шаблоны отчетов", "Статические виджеты"],
  widgets: ["Мои виджеты", "Виджеты сотрудников", "Все", "Шаблоны виджетов", "Статические виджеты"],
}
/** Linko's chart kinds (REPORT_TYPES_CHARTS), by the builder's view index. */
const CHARTS = ["Линейный", "Круговая диаграмма", "Гистограмма"]
const PAGE = 25
const TEXT_BUTTON = "text-[13px] font-semibold uppercase text-[#1E4A9A] hover:brightness-125 disabled:text-[#bbb]"

/** Linko's dialog: a 60 px title row with ×, the body and a footer with its action on the right. Modal: only × closes it. */
function Dialog({ title, width, onClose, footer, children }: { title: string; width: number; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full rounded-[2px] bg-white shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)]" style={{ maxWidth: width }}>
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
          <h2 className="text-[13px] font-bold uppercase text-black">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#666] hover:text-black"><X className="h-[22px] w-[22px]" /></button>
        </header>
        {children}
        <footer className="flex h-[56px] items-center justify-end border-t border-[#efefef] px-[26px]">{footer}</footer>
      </div>
    </div>
  )
}

/**
 * «СОХРАНИТЬ ТАБЛИЦУ» / «ИЗМЕНИЕ ТАБЛИЦЫ № …»: the period kind (СЕГОДНЯ … СВОЯ, «Своя» first chosen) and the name
 * («Название таблицы», for a change «Новое название»).
 */
export function SaveTableDialog({ id, busy, onClose, onSave }: { id?: number; busy?: boolean; onClose: () => void; onSave: (name: string, periodType: PeriodType) => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState("")
  const [periodType, setPeriodType] = useState<PeriodType>("ownDate")
  const [missing, setMissing] = useState(false)
  const update = id !== undefined
  // As in Linko СОХРАНИТЬ is always on; without a name the field says what is missing.
  const submit = () => {
    if (busy) return
    if (!name.trim()) {
      setMissing(true)
      return
    }
    onSave(name.trim(), periodType)
  }
  return (
    <Dialog
      title={update ? `${t("Измение таблицы")} № ${id}` : t("Сохранить таблицу")}
      width={500}
      onClose={onClose}
      footer={<button type="button" disabled={busy} onClick={submit} className={TEXT_BUTTON}>{t("Сохранить")}</button>}
    >
      <form onSubmit={(event) => { event.preventDefault(); submit() }} className="min-h-[150px] px-[30px] pb-[20px] pt-[15px]">
        <div role="radiogroup" aria-label={t("Период")} className="flex justify-center gap-[1px]">
          {PERIOD_TYPES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={periodType === item.id}
              onClick={() => setPeriodType(item.id)}
              className={`h-[32px] rounded-[3px] px-[15px] text-[13px] uppercase shadow-[0_1px_3px_rgba(0,0,0,0.12)] ${periodType === item.id ? "bg-[#1E4A9A] text-white" : "border border-[#e6e6e6] bg-white text-black hover:bg-[#f5f5f5]"}`}
            >
              {t(item.name)}
            </button>
          ))}
        </div>
        <label className="relative mt-[22px] block h-[50px]">
          <input
            value={name}
            placeholder=" "
            maxLength={255}
            aria-invalid={missing}
            onChange={(event) => { setName(event.target.value); setMissing(false) }}
            className={`peer absolute bottom-0 left-0 h-[32px] w-full border-b bg-transparent text-[14px] outline-none ${missing ? "border-[#f44336]" : "border-[#e0e0e0] focus:border-[#1E4A9A]"}`}
          />
          <span className="pointer-events-none absolute left-0 top-[2px] text-[11px] font-semibold text-[#555] transition-all peer-placeholder-shown:top-[24px] peer-placeholder-shown:text-[13px] peer-placeholder-shown:text-black peer-focus:top-[2px] peer-focus:text-[11px] peer-focus:text-[#1E4A9A]">
            {t(update ? "Новое название" : "Название таблицы")}
          </span>
        </label>
        {missing && <p role="alert" className="mt-[4px] text-[12px] text-[#f44336]">{t("Обязательное поле")}</p>}
      </form>
    </Dialog>
  )
}

/** Linko's multi-select of the «Пользователи» dialog: the chosen entries as chips, × clears them, ▾ opens the list. */
function ChipSelect({ label, options, value, onChange }: { label: string; options: Option[]; value: number[]; onChange: (next: number[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const names = new Map(options.map((option) => [option.id, option.name]))
  const needle = query.trim().toLocaleLowerCase("ru")
  const shown = options.filter((option) => !needle || option.name.toLocaleLowerCase("ru").includes(needle)).slice(0, 300)
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  return (
    <div ref={ref} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false) }} className="relative">
      <span className="block text-[11px] font-semibold text-black">{label}</span>
      <div className="flex min-h-[34px] items-center gap-[6px] border-b border-[#e0e0e0] py-[4px]">
        <div role="button" tabIndex={0} aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setOpen(!open) }} className="flex min-h-[24px] flex-1 cursor-pointer flex-wrap items-center gap-[4px]">
          {value.map((id) => (
            <span key={id} className="inline-flex h-[22px] items-center rounded-[2px] bg-[#1E4A9A] text-[12px] font-semibold text-white">
              <button type="button" aria-label={t("Удалить")} onClick={(event) => { event.stopPropagation(); toggle(id) }} className="h-full border-r border-white/40 px-[5px] hover:bg-black/15">×</button>
              <span className="px-[6px]">{names.get(id) ?? `№${id}`}</span>
            </span>
          ))}
        </div>
        {value.length > 0 && <button type="button" aria-label={t("Очистить")} onClick={() => onChange([])} className="text-[#999] hover:text-black"><X className="h-[14px] w-[14px]" /></button>}
        <button type="button" aria-label={label} onClick={() => setOpen(!open)} className="text-[#999] hover:text-black"><svg viewBox="0 0 10 6" className="h-[6px] w-[10px] fill-current" aria-hidden><path d="M0 0h10L5 6z" /></svg></button>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[10] mt-[2px] rounded-[2px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
          <div className="flex items-center gap-[8px] border-b border-[#eee] px-[12px]">
            <Search className="h-[15px] w-[15px] shrink-0 text-[#999]" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="h-[36px] w-full text-[13px] outline-none" />
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-[180px] overflow-y-auto py-[4px]">
            {shown.map((option) => (
              <li key={option.id} role="option" aria-selected={value.includes(option.id)}>
                <button type="button" onClick={() => toggle(option.id)} className={`flex w-full items-center px-[14px] py-[7px] text-left text-[13px] hover:bg-[#f2f5f8] ${value.includes(option.id) ? "font-semibold text-[#1E4A9A]" : "text-black"}`}>{option.name}</button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-[14px] py-[10px] text-[13px] text-[#999]">{t("Ничего не найдено")}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

/** «ПОЛЬЗОВАТЕЛИ»: who the report (or the static widget) is given to — «Выбранным сотрудникам» (Пользователи) or
 * «Выбранным доступам» (Права доступа). */
function ReportUsersDialog({ kind, id, onClose, onSaved, onError }: { kind: "report" | "static"; id: number; onClose: () => void; onSaved: () => void; onError: (message: string) => void }) {
  const { t } = useLanguage()
  const [data, setData] = useState<Sharing | null>(null)
  const [busy, setBusy] = useState(false)
  const url = `/api/old-saved-reports/${id}/users${kind === "static" ? "?kind=static" : ""}`
  // The latest callbacks, so the parent's renders do not load the dialog again.
  const handlers = useRef({ onClose, onError })
  useEffect(() => {
    handlers.current = { onClose, onError }
  })

  useEffect(() => {
    let cancelled = false
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (Sharing & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || "Не удалось загрузить данные")
        if (!cancelled) setData(body)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        handlers.current.onError(reason instanceof Error ? reason.message : String(reason))
        handlers.current.onClose()
      })
    return () => { cancelled = true }
  }, [url])

  const save = async () => {
    if (!data || busy) return
    setBusy(true)
    try {
      const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: data.type, users: data.users, positions: data.positions }) })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || "Не удалось сохранить")
      onSaved()
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={t("Пользователи")} width={600} onClose={onClose} footer={<button type="button" disabled={!data || busy} onClick={() => void save()} className={TEXT_BUTTON}>{t("Сохранить")}</button>}>
      {/* Tall enough for the open list to stay above СОХРАНИТЬ. */}
      <div className="min-h-[370px] px-[30px] py-[14px]">
        {!data ? (
          <div className="flex h-[260px] items-center justify-center"><Loader2 className="h-[26px] w-[26px] animate-spin text-[#1E4A9A]" /></div>
        ) : (
          <>
            <div role="radiogroup" aria-label={t("Пользователи")} className="flex flex-col gap-[14px] pb-[16px] pt-[6px]">
              {(["user", "position"] as const).map((type) => (
                <label key={type} className="flex cursor-pointer items-center gap-[14px] text-[13px] text-black">
                  <input type="radio" name="report-users-type" checked={data.type === type} onChange={() => setData({ ...data, type })} className="h-[20px] w-[20px] accent-[#666]" />
                  {t(type === "user" ? "Выбранным сотрудникам" : "Выбранным доступам")}
                </label>
              ))}
            </div>
            {data.type === "user" ? (
              <ChipSelect label={t("Пользователи")} options={data.options.users} value={data.users} onChange={(users) => setData({ ...data, users })} />
            ) : (
              <ChipSelect label={t("Права доступа")} options={data.options.positions} value={data.positions} onChange={(positions) => setData({ ...data, positions })} />
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

/** A cell of a list row: a click chooses the report, the pointer on it shows Linko's «Выбрать» on its left. */
function PickCell({ span, align = "center", onPick, children }: { span: string; align?: "left" | "center"; onPick: () => void; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div onClick={onPick} className={`${span} flex cursor-pointer items-center ${align === "left" ? "justify-start" : "justify-center"}`}>
      <span className="group/cell relative">
        {children}
        <span role="tooltip" className="pointer-events-none absolute right-full top-1/2 z-20 mr-[12px] hidden -translate-y-1/2 whitespace-nowrap rounded-[3px] bg-[#41444a] px-[20px] py-[7px] text-[13px] leading-[20px] text-white group-hover/cell:block">{t("Выбрать")}</span>
      </span>
    </div>
  )
}

/** An icon button of a row with its hint under it. */
function RowIcon({ label, disabled, onClick, path }: { label: string; disabled?: boolean; onClick: () => void; path: string }) {
  return (
    <span className="group/icon relative">
      <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="flex h-[30px] w-[30px] items-center justify-center text-[#666] hover:text-black disabled:cursor-default disabled:opacity-30">
        <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current" aria-hidden><path d={path} /></svg>
      </button>
      {!disabled && <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-20 mt-[4px] hidden -translate-x-1/2 whitespace-nowrap rounded-[3px] bg-[#41444a] px-[12px] py-[5px] text-[12px] text-white group-hover/icon:block">{label}</span>}
    </span>
  )
}

const EDIT_PATH = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const DELETE_PATH = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
const USERS_PATH = "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"

/**
 * «ОТЧЕТЫ» / «ВИДЖЕТЫ» (both list the same saved reports, as in Linko): Мои / сотрудников / Все / Шаблоны / Статические
 * виджеты, the name search, 25 a page. A click on a row's cell opens the report; «Изменить» re-saves it with the
 * builder's current settings (Linko's update), not for a widget; templates are read-only.
 */
export function SavedReportsDialog({
  kind,
  models,
  selectedId,
  onClose,
  onOpen,
  onUpdate,
  onSnack,
}: {
  kind: "reports" | "widgets"
  models: ModelRef[]
  selectedId: number | null
  onClose: () => void
  onOpen: (report: SavedReport, pattern: boolean) => void
  onUpdate: (id: number, name: string, periodType: PeriodType) => Promise<boolean>
  onSnack: (message: string) => void
}) {
  const { t } = useLanguage()
  const [tab, setTab] = useState(0)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Array<SavedReport | StaticWidget> | null>(null)
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [sharing, setSharing] = useState<{ id: number; kind: "report" | "static" } | null>(null)
  const [busy, setBusy] = useState(false)
  const show = SHOWS[tab]
  const isStatic = show === "static_widget"
  const isPattern = show === "pattern"

  useEffect(() => {
    let cancelled = false
    setRows(null)
    fetch(`/api/old-saved-reports?show=${show}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Array<SavedReport | StaticWidget>>) : Promise.reject()))
      .then((data) => { if (!cancelled) setRows(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [show, reload])

  // Escape closes the list unless one of its dialogs is open. Listened to while capturing: the delete confirmation
  // closes itself on the same key further on, and must not take the list with it.
  const anyOpen = editing !== null || deleting !== null || sharing !== null
  useEffect(() => {
    if (anyOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose, anyOpen])

  const needle = query.trim().toLocaleLowerCase("ru")
  const list = useMemo(() => (rows ?? []).filter((row) => !needle || row.name.toLocaleLowerCase("ru").includes(needle)), [rows, needle])
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const current = Math.min(page, pages - 1)
  const shown = list.slice(current * PAGE, current * PAGE + PAGE)

  // The model's name as the report was saved with it (Linko prints code.model.name: «Трансакции» of a template while
  // its builder says «Транзакция»), else the builder's name, else the key.
  const modelOf = (report: SavedReport) => {
    const config = (report.config ?? {}) as { model?: unknown; modelName?: unknown }
    const model = typeof config.model === "string" ? config.model : ""
    if (typeof config.modelName === "string" && config.modelName) return config.modelName
    return models.find((item) => item.key === model)?.name ?? model
  }
  // «Тип графика»: the chart of a widget (a table saved with «Сохранить» has none, as in Linko).
  const chartOf = (report: SavedReport) => {
    const view = (report.config as { view?: unknown } | null)?.view
    return report.reportType === "widget" && typeof view === "number" && CHARTS[view] ? CHARTS[view] : "Отсутствует"
  }

  const remove = async () => {
    if (deleting === null || busy) return
    setBusy(true)
    try {
      const response = await fetch(`/api/old-saved-reports/${deleting}`, { method: "DELETE" })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error || "Не удалось удалить")
      setDeleting(null)
      setReload((value) => value + 1)
      onSnack(t("Успешно удалено"))
    } catch (reason) {
      onSnack(t(reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setBusy(false)
    }
  }

  const update = async (name: string, periodType: PeriodType) => {
    if (editing === null || busy) return
    setBusy(true)
    try {
      if (await onUpdate(editing, name, periodType)) {
        setEditing(null)
        setReload((value) => value + 1)
      }
    } finally {
      setBusy(false)
    }
  }

  const grid = "grid grid-cols-12 items-center px-[30px]"
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="old-reports-title" className="fixed inset-0 z-[110] flex flex-col bg-white">
      <header className="flex h-[56px] shrink-0 items-center justify-between border-b border-[#e0e0e0] px-[30px]">
        <h2 id="old-reports-title" className="text-[13px] font-bold uppercase">{t(kind === "reports" ? "Отчеты" : "Виджеты")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#555] hover:text-black"><X className="h-[22px] w-[22px]" /></button>
      </header>
      <nav className="grid shrink-0 grid-cols-5 shadow-[0_2px_4px_rgba(0,0,0,0.08)]">
        {TABS[kind].map((item, index) => (
          <button key={item} type="button" onClick={() => { setTab(index); setPage(0) }} className={`h-[52px] border-b-[3px] text-[13px] ${tab === index ? "border-[#1E4A9A] text-black" : "border-transparent text-[#333]"}`}>{t(item)}</button>
        ))}
      </nav>
      <div className="flex shrink-0 items-center justify-between border-b border-[#e8e8e8] px-[30px] py-[14px]">
        <label className="relative w-[256px]">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder={`${t("Поиск таблицы")}...`} className="h-[32px] w-full border-b border-[#d5d5d5] pr-[30px] text-[13px] outline-none placeholder:text-[#999]" />
          <Search className="absolute right-[-20px] top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-[#999]" />
        </label>
        <div className="flex items-center gap-[10px] text-[13px] text-[#555]">
          <span>{list.length ? `${current * PAGE + 1} - ${current * PAGE + shown.length}` : "0 - 0"} {t("из")} {list.length}</span>
          <button type="button" aria-label={t("Назад")} disabled={current === 0} onClick={() => setPage(current - 1)} className="flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 border-current text-[#777] disabled:text-[#ccc]"><svg viewBox="0 0 24 24" className="h-[12px] w-[12px] fill-current"><path d="M15 6v12l-8-6z" /></svg></button>
          <button type="button" aria-label={t("Вперед")} disabled={current >= pages - 1} onClick={() => setPage(current + 1)} className="flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 border-current text-[#777] disabled:text-[#ccc]"><svg viewBox="0 0 24 24" className="h-[12px] w-[12px] fill-current"><path d="M9 6v12l8-6z" /></svg></button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null ? (
          <div className="flex h-[100px] items-center justify-center"><Loader2 className="h-[26px] w-[26px] animate-spin text-[#1E4A9A]" /></div>
        ) : list.length === 0 ? (
          <p className="py-[40px] text-center text-[13px] text-[#999]">{t("Ничего не найдено")}</p>
        ) : isStatic ? (
          <>
            <div className={`${grid} border-b border-dotted border-[#bbb] py-[18px] text-[13px] font-bold`}>
              <span className="col-span-1">№</span>
              <span className="col-span-5 text-center">{t("Название")}</span>
              <span className="col-span-3 text-center">{t("Устройство")}</span>
            </div>
            {(shown as StaticWidget[]).map((widget) => (
              <div key={widget.id} className={`group ${grid} min-h-[45px] border-b border-dotted border-[#bbb] py-[6px] text-[13px] hover:bg-[#f2f5f8]`}>
                <span className="col-span-1">{widget.id}</span>
                <span className="col-span-5 text-center">{widget.name}</span>
                <span className="col-span-3 text-center">{t(widget.device)}</span>
                <span className="col-span-1" />
                <div className="col-span-2 flex justify-end opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                  <RowIcon label={t("Пользователи")} path={USERS_PATH} onClick={() => setSharing({ id: widget.id, kind: "static" })} />
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className={`${grid} border-b border-dotted border-[#bbb] py-[18px] text-[13px] font-bold`}>
              <span className="col-span-1">№</span>
              <span className="col-span-3 text-center">{t("Название")}</span>
              <span className="col-span-2 text-center">{t("Модель")}</span>
              <span className="col-span-2 text-center">{t("Тип")}</span>
              <span className="col-span-2 text-center">{t("Тип графика")}</span>
            </div>
            {(shown as SavedReport[]).map((report) => {
              const pick = () => onOpen(report, isPattern)
              const model = modelOf(report)
              return (
                <div key={report.id} className={`group ${grid} min-h-[45px] border-b border-dotted border-[#bbb] py-[6px] text-center text-[13px] hover:bg-[#f2f5f8] ${!isPattern && selectedId === report.id ? "bg-[#eef1f6]" : ""}`}>
                  <PickCell span="col-span-1" align="left" onPick={pick}>{report.id}</PickCell>
                  <PickCell span="col-span-3" onPick={pick}>{report.name}</PickCell>
                  <PickCell span="col-span-2" onPick={pick}>{model ? t(model) : ""}</PickCell>
                  <PickCell span="col-span-2" onPick={pick}>{t(report.reportType === "widget" ? "Виджеты" : "Таблица")}</PickCell>
                  <PickCell span="col-span-2" onPick={pick}>{t(chartOf(report))}</PickCell>
                  <div className="col-span-2 flex justify-end opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                    {!isPattern && (
                      <>
                        <RowIcon label={t("Изменить")} path={EDIT_PATH} disabled={report.reportType === "widget"} onClick={() => setEditing(report.id)} />
                        <RowIcon label={t("Удалить")} path={DELETE_PATH} onClick={() => setDeleting(report.id)} />
                        <RowIcon label={t("Пользователи")} path={USERS_PATH} onClick={() => setSharing({ id: report.id, kind: "report" })} />
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {editing !== null && <SaveTableDialog id={editing} busy={busy} onClose={() => setEditing(null)} onSave={(name, periodType) => void update(name, periodType)} />}
      {deleting !== null && (
        <ConfirmDialog title={`${t("Удаление таблицы")} № ${deleting}`} busy={busy} onConfirm={() => void remove()} onClose={() => setDeleting(null)} />
      )}
      {sharing && (
        <ReportUsersDialog
          kind={sharing.kind}
          id={sharing.id}
          onClose={() => setSharing(null)}
          onSaved={() => { setSharing(null); onSnack(t("Успешно сохранено")) }}
          onError={(message) => onSnack(t(message))}
        />
      )}
    </div>
  )
}
