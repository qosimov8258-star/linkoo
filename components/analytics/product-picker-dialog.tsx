"use client"

import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

export type PickerItem = { id: number; name: string; type?: string; brand?: string; organization?: string }

const PAGE_SIZES = [10, 25, 50, 100]

/** Full-screen "Добавление продуктов" list with filters and checkboxes, as in the original app. */
export function ProductPickerDialog({
  items,
  selected,
  filters = true,
  onSave,
  onClose,
}: {
  items: PickerItem[] | null
  selected: string[]
  filters?: boolean
  onSave: (names: string[]) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [checked, setChecked] = useState<string[]>(selected)
  const [query, setQuery] = useState("")
  const [type, setType] = useState("")
  const [brand, setBrand] = useState("")
  const [organization, setOrganization] = useState("")
  const [pageSize, setPageSize] = useState(50)
  const [pageSizeOpen, setPageSizeOpen] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const unique = (pick: (item: PickerItem) => string | undefined) =>
    Array.from(new Set((items ?? []).map(pick).filter((value): value is string => Boolean(value)))).sort()
  const types = useMemo(() => unique((item) => item.type), [items])
  const brands = useMemo(() => unique((item) => item.brand), [items])
  const organizations = useMemo(() => unique((item) => item.organization), [items])

  const filtered = useMemo(
    () =>
      (items ?? [])
        .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
        .filter((item) => !type || item.type === type)
        .filter((item) => !brand || item.brand === brand)
        .filter((item) => !organization || item.organization === organization),
    [items, query, type, brand, organization],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const allVisibleChecked = visible.length > 0 && visible.every((item) => checked.includes(item.name))

  function toggle(name: string) {
    setChecked((current) => (current.includes(name) ? current.filter((value) => value !== name) : [...current, name]))
  }

  function toggleVisible() {
    const names = visible.map((item) => item.name)
    setChecked((current) => (allVisibleChecked ? current.filter((value) => !names.includes(value)) : Array.from(new Set([...current, ...names]))))
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[22px]">
        <h2 className="text-[13px] font-bold uppercase">{t("Добавление продуктов")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800"><X className="h-6 w-6" /></button>
      </header>

      <div className="flex h-[56px] shrink-0 items-end gap-[25px] border-b border-[#e8ebf0] pl-[30px] pr-[12px] pb-[1px]">
        {filters && (
          <>
            <FilterSelect label={t("Фильтр по типу")} value={type} onChange={(value) => { setType(value); setPage(1) }} options={types} />
            <FilterSelect label={t("Фильтр по бренду")} value={brand} onChange={(value) => { setBrand(value); setPage(1) }} options={brands} />
            <FilterSelect label={t("Фильтр по организацию")} value={organization} onChange={(value) => { setOrganization(value); setPage(1) }} options={organizations} />
          </>
        )}
        <div className="ml-auto flex items-center self-center">
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1) }}
            placeholder={t("Поиск товаров...")}
            className="mr-[141px] h-10 w-[280px] border border-[#dfe4ea] bg-[#eef1f5] px-[10px] text-[12px] outline-none placeholder:text-[#9aa3b0]"
          />
          <div className="relative">
            <button type="button" onClick={() => setPageSizeOpen((open) => !open)} className="flex items-center gap-1 text-[13px]">
              {pageSize}<ChevronDown className="h-3.5 w-3.5 text-slate-300" />
            </button>
            {pageSizeOpen && (
              <ul className="absolute left-0 top-6 z-10 w-16 bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
                {PAGE_SIZES.map((size) => (
                  <li key={size}>
                    <button type="button" onClick={() => { setPageSize(size); setPage(1); setPageSizeOpen(false) }} className={`block w-full px-3 py-1.5 text-left font-semibold ${size === pageSize ? "bg-[#e3effd]" : "text-slate-500 hover:bg-slate-50"}`}>{size}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <span className="ml-[33px] text-[13px]">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {filtered.length}
          </span>
          <button type="button" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} aria-label={t("Назад")} className="ml-[12px] text-slate-400 disabled:opacity-40"><ChevronLeft className="h-5 w-5 rounded-full border border-slate-300 p-0.5" /></button>
          <button type="button" onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount} aria-label={t("Вперед")} className="ml-[9px] text-slate-700 disabled:opacity-40"><ChevronRight className="h-5 w-5 rounded-full border border-slate-700 p-0.5" /></button>
          <Search className="ml-[4px] h-4 w-4 text-slate-300" />
        </div>
      </div>

      <div className="flex h-[50px] shrink-0 items-center border-b border-[#e8ebf0] px-[30px] font-bold">
        <span className="flex-1">{t("Наименование")}</span>
        <button type="button" onClick={toggleVisible} aria-label={t("Выбрать все")} className="mr-[19px] ml-auto flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border-2 border-dotted border-slate-700">
          <span className="h-[8px] w-[8px] bg-slate-700" />
        </button>
        <span className="w-[465px] shrink-0">{t("Статус")}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!items ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#4f6fe0]" /></div>
        ) : visible.length === 0 ? (
          <p className="mt-24 text-center text-slate-400">{t("По вашему запросу ничего не найдено...")}</p>
        ) : (
          visible.map((item) => (
            <label key={item.id} className="flex h-10 cursor-pointer items-center px-[30px] hover:bg-slate-50">
              <span className="flex-1">{item.name}</span>
              <span className={`mr-[19px] ml-auto flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border-2 ${checked.includes(item.name) ? "border-[#5d6474] bg-[#5d6474]" : "border-[#333]"}`}>
                {checked.includes(item.name) && <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="#fff" strokeWidth="2" /></svg>}
                <input type="checkbox" checked={checked.includes(item.name)} onChange={() => toggle(item.name)} className="sr-only" />
              </span>
              <span className="w-[465px] shrink-0" />
            </label>
          ))
        )}
      </div>

      <footer className="flex h-[60px] shrink-0 items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
        <button type="button" onClick={() => onSave(checked)} className="rounded-[3px] px-[16px] py-[8px] text-[13px] font-bold uppercase text-[#0a9bd9] hover:bg-[#ececec]">{t("Сохранить")}</button>
      </footer>
    </div>,
    document.body,
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
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
    <div ref={rootRef} className="relative w-[240px] shrink-0">
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex h-[34px] w-full items-center justify-between border-b border-[#d5dae1] text-left font-bold">
        <span className="truncate">{value || label}</span>
        <span className="flex items-center gap-2 text-slate-500">
          {value && <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange("") }}><X className="h-3.5 w-3.5" /></span>}
          <ChevronDown className="h-4 w-4 fill-current" />
        </span>
      </button>
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-72 overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {options.length === 0 ? (
            <li className="px-3 py-2 font-semibold text-slate-400">—</li>
          ) : (
            options.map((option, index) => (
              <li key={`${option}-${index}`}>
                <button type="button" onClick={() => { onChange(option); setOpen(false) }} className={`block w-full px-3 py-2 text-left font-semibold ${option === value ? "bg-[#e3effd] text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}>{option}</button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
