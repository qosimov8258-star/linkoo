"use client"

import { ChevronDown, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

export type UserOption = { id: number; name: string }

type EmployeeRow = { id: number; firstName: string; lastName: string }

let cache: UserOption[] | null = null

/** Users of the company ("Имя Фамилия"), loaded once from /api/employees. */
export function useUserOptions(): { users: UserOption[]; loading: boolean } {
  const [users, setUsers] = useState<UserOption[]>(cache ?? [])
  const [loading, setLoading] = useState(!cache)
  useEffect(() => {
    if (cache) return
    let cancelled = false
    fetch("/api/employees", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: EmployeeRow[]) => {
        cache = rows.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim() })).sort((a, b) => a.id - b.id)
        if (!cancelled) setUsers(cache)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return { users, loading }
}

export type SelectOption<V extends string | number> = { value: V; label: string }

/** Underlined select with type-to-search, like the reference's "Тип" / "Пользователь" dialog fields (48px, label floats once chosen). */
export function LineSearchSelect<V extends string | number>({ label, value, onChange, options, loading, required }: { label: string; value: V | null; onChange: (value: V | null) => void; options: SelectOption<V>[]; loading?: boolean; required?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const selected = options.find((option) => option.value === value)
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options
  }, [options, query])
  const floating = open || Boolean(selected)
  return (
    <div ref={rootRef} className="relative">
      <div onClick={() => setOpen(true)} className="relative block h-[48px] w-full cursor-pointer border-b border-[#d5dae1]">
        <span className={`pointer-events-none absolute left-0 ${floating ? "top-0 text-[10px] font-semibold leading-3" : "top-[26px] text-[13px] font-bold leading-4"}`}>
          {label}{required && <span className="text-red-500"> *</span>}
        </span>
        {open ? (
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} className="absolute inset-x-0 bottom-[4px] h-[20px] bg-transparent pr-12 text-[13px] outline-none" />
        ) : (
          selected && <span className="absolute inset-x-0 bottom-[4px] truncate pr-12 text-[13px]">{selected.label}</span>
        )}
        <span className="absolute bottom-[8px] right-0 flex items-center gap-[10px] text-slate-500">
          {selected && !open && <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange(null) }}><X className="h-3.5 w-3.5" /></span>}
          <ChevronDown className="h-4 w-4 fill-current" />
        </span>
      </div>
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-[205px] overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {visible.length === 0 ? (
            <li className="px-3 py-2 font-semibold text-slate-400">{loading ? t("Загрузка...") : "—"}</li>
          ) : (
            visible.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                    setQuery("")
                  }}
                  className={`block w-full px-[10px] py-2 text-left font-semibold ${option.value === value ? "bg-[#e3effd] text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

export function UserSelect({ label, value, onChange, users, loading, required }: { label: string; value: number | null; onChange: (id: number | null) => void; users: UserOption[]; loading?: boolean; required?: boolean }) {
  const options = useMemo(() => users.map((user) => ({ value: user.id, label: user.name })), [users])
  return <LineSearchSelect label={label} value={value} onChange={onChange} options={options} loading={loading} required={required} />
}

/** Underlined multi select with blue chips (reference "Права доступа"): 48px field, clear-all cross, checkable list. */
export function LineMultiSearchSelect({ label, value, onChange, options }: { label: string; value: string[]; onChange: (value: string[]) => void; options: string[] }) {
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
  const toggle = (option: string) => onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])
  const listed = useMemo(() => [...options, ...value.filter((item) => !options.includes(item))], [options, value])
  return (
    <div ref={rootRef} className="relative">
      <div role="button" tabIndex={0} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === "Enter") setOpen((current) => !current) }} className="relative block min-h-[48px] w-full cursor-pointer border-b border-[#d5dae1] pr-[46px]">
        <span className={`pointer-events-none absolute left-0 ${value.length ? "top-0 text-[10px] font-semibold leading-3" : "top-[26px] text-[13px] font-bold leading-4"}`}>{label}</span>
        {value.length > 0 && (
          <span className="flex flex-wrap gap-[6px] pb-[4px] pt-[19px]">
            {value.map((item) => (
              <span key={item} className="flex h-[22px] items-center overflow-hidden rounded-[2px] bg-[#5868f0] text-[12px] font-semibold leading-none text-white">
                <button type="button" aria-label={t("Удалить")} onClick={(event) => { event.stopPropagation(); toggle(item) }} className="h-full border-r border-white/30 px-[6px]">×</button>
                <span className="px-[6px]">{item}</span>
              </span>
            ))}
          </span>
        )}
        <span className="absolute bottom-[8px] right-0 flex items-center gap-[10px] text-slate-500">
          {value.length > 0 && <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange([]) }}><X className="h-3.5 w-3.5" /></span>}
          <ChevronDown className="h-4 w-4 fill-current" />
        </span>
      </div>
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-60 overflow-y-auto bg-white shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {listed.length === 0 ? (
            <li className="px-[10px] py-[10px] text-slate-400">—</li>
          ) : (
            listed.map((option) => (
              <li key={option}>
                <button type="button" onClick={() => toggle(option)} className={`block w-full px-[10px] py-[10px] text-left font-semibold text-[#333] ${value.includes(option) ? "bg-[#e6f0ff]" : "hover:bg-slate-50"}`}>{option}</button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
