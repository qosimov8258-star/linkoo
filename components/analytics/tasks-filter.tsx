"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { FilterDate, RefFilterPanel } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { elementWord, type TaskOption } from "./tasks-data"

// "Фильтр" of the task list: collapsed it is the link "Показать фильтр ▾", or the grey chip
// "Фильтр: N элемент(а)" with ✎ (reopen) and ⊗ (clear everything); open it is the 300px panel with
// Ответственный пользователь / Создал / Магазин (multi-selects), Период создания and Период задачи.

export type TaskFilterValue = {
  responsible: string[]
  createdBy: string[]
  client: string[]
  createdFrom: string
  createdTo: string
  taskFrom: string
  taskTo: string
}

export const EMPTY_TASK_FILTER: TaskFilterValue = { responsible: [], createdBy: [], client: [], createdFrom: "", createdTo: "", taskFrom: "", taskTo: "" }

/** How many of the five filter fields are set. */
export function taskFilterCount(value: TaskFilterValue): number {
  return [value.responsible.length > 0, value.createdBy.length > 0, value.client.length > 0, Boolean(value.createdFrom || value.createdTo), Boolean(value.taskFrom || value.taskTo)].filter(Boolean).length
}

function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open, close])
  return ref
}

/** Underlined multi-select with search (the reference app's filter field look). */
export function TaskMultiSelect({ label, options, value, onChange }: { label: string; options: TaskOption[]; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useOutsideClose(open, () => setOpen(false))
  const names = useMemo(() => new Map(options.map((option) => [String(option.id), option.name])), [options])
  const needle = query.trim().toLowerCase()
  const visible = (needle ? options.filter((option) => `${option.name} ${option.hint ?? ""}`.toLowerCase().includes(needle)) : options).slice(0, 300)
  const selectedText = value.map((id) => names.get(id) ?? `#${id}`).join(", ")
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  return (
    <div ref={ref} className="relative h-[62px]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="absolute inset-x-0 top-[18px] h-[36px] border-b border-[#e8e8e8] text-left text-[13px] font-semibold text-black"
      >
        {value.length ? (
          <>
            <span className="absolute left-0 top-[-8px] text-[10px] font-bold leading-3">{t(label)}</span>
            <span className="absolute inset-x-0 top-[10px] truncate pr-8">{selectedText}</span>
          </>
        ) : (
          <span className="absolute left-0 top-[13px] leading-4">{t(label)}</span>
        )}
      </button>
      <svg viewBox="0 0 10 7" className="pointer-events-none absolute right-[14px] top-[36px] h-[7px] w-[10px] fill-[#888]" aria-hidden>
        <path d="M0 0l5 5.5L10 0z" />
      </svg>
      {open && (
        <div className="absolute inset-x-0 top-[54px] z-50 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation()
                setOpen(false)
              }
            }}
            placeholder={t("Поиск")}
            aria-label={t("Поиск")}
            className="h-9 w-full border-b border-[#eee] px-[10px] text-[13px] outline-none"
          />
          <div className="max-h-[205px] overflow-y-auto py-1">
            {value.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="block h-9 w-full px-[10px] text-left text-[13px] text-[#999] hover:bg-[#f2f5f8]">
                {t("Сбросить")}
              </button>
            )}
            {visible.length === 0 ? (
              <div className="h-9 px-[10px] text-[13px] leading-9 text-[#999]">{t("Ничего не найдено")}</div>
            ) : (
              visible.map((option) => {
                const id = String(option.id)
                const checked = value.includes(id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggle(id)}
                    aria-pressed={checked}
                    className="flex min-h-9 w-full items-center gap-2 px-[10px] py-[6px] text-left text-[13px] hover:bg-[#f2f5f8]"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-[#5d6474]" aria-hidden>
                      <path d={checked ? "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" : "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"} />
                    </svg>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${checked ? "font-semibold text-[#4f71dc]" : "font-semibold"}`}>{option.name}</span>
                      {option.hint && <span className="block truncate text-[11px] text-[#999]">{option.hint}</span>}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** A date range field with a ✕ that clears it. */
function RangeField({ label, from, to, onChange }: { label: string; from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useLanguage()
  return (
    <div className="relative">
      <FilterDate label={label} begin={from} end={to} onChange={onChange} />
      {(from || to) && (
        <button type="button" onClick={() => onChange("", "")} aria-label={t("Очистить")} className="absolute right-0 top-[26px] flex h-6 w-6 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#999]" aria-hidden>
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      )}
    </div>
  )
}

export function TaskFilterControl({
  value,
  employees,
  creators,
  clients,
  onApply,
}: {
  value: TaskFilterValue
  employees: TaskOption[]
  creators: TaskOption[]
  clients: TaskOption[]
  onApply: (next: TaskFilterValue) => void
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<TaskFilterValue>(value)
  const count = taskFilterCount(value)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const openPanel = () => {
    setDraft(value)
    setOpen(true)
  }

  return (
    <div className="relative">
      {count === 0 ? (
        <button type="button" onClick={openPanel} className="flex items-center pl-[5px] text-[13px] text-[#4f71dc]">
          {t("Показать фильтр")}
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#4f71dc]" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
        </button>
      ) : (
        <div className="flex h-[40px] items-center bg-[#f2f5f8] pl-[12px] text-[13px] text-[#5d6474]">
          <span className="whitespace-nowrap">
            {t("Фильтр")}: {count} {t(elementWord(count))}
          </span>
          <button type="button" onClick={openPanel} aria-label={t("Изменить фильтр")} title={t("Изменить фильтр")} className="ml-[8px] flex h-[40px] w-[36px] items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-[#5d6474]" aria-hidden>
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
            </svg>
          </button>
          <button type="button" onClick={() => onApply(EMPTY_TASK_FILTER)} aria-label={t("Очистить фильтр")} title={t("Очистить фильтр")} className="flex h-[40px] w-[36px] items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]" aria-hidden>
              <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.59-13L12 10.59 8.41 7 7 8.41 10.59 12 7 15.59 8.41 17 12 13.41 15.59 17 17 15.59 13.41 12 17 8.41z" />
            </svg>
          </button>
        </div>
      )}
      {open && (
        <div className="absolute left-0 top-[-5px] z-40">
          <RefFilterPanel
            narrow
            onClose={() => setOpen(false)}
            onApply={() => {
              onApply(draft)
              setOpen(false)
            }}
          >
            <TaskMultiSelect label="Ответственный пользователь" options={employees} value={draft.responsible} onChange={(responsible) => setDraft((current) => ({ ...current, responsible }))} />
            <TaskMultiSelect label="Создал" options={creators} value={draft.createdBy} onChange={(createdBy) => setDraft((current) => ({ ...current, createdBy }))} />
            <TaskMultiSelect label="Магазин" options={clients} value={draft.client} onChange={(client) => setDraft((current) => ({ ...current, client }))} />
            <RangeField label="Период создания" from={draft.createdFrom} to={draft.createdTo} onChange={(createdFrom, createdTo) => setDraft((current) => ({ ...current, createdFrom, createdTo }))} />
            <RangeField label="Период задачи" from={draft.taskFrom} to={draft.taskTo} onChange={(taskFrom, taskTo) => setDraft((current) => ({ ...current, taskFrom, taskTo }))} />
          </RefFilterPanel>
        </div>
      )}
    </div>
  )
}
