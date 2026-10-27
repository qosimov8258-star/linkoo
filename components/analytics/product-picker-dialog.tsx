"use client"

import { Loader2, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { RefPager } from "@/components/ref/pager-controls"
import { useLanguage } from "@/lib/i18n/language-context"

export type PickerItem = { id: number; name: string; type?: string; brand?: string; organization?: string }

const ICON_SELECT_ALL = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const ICON_DONE_ALL = "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"
const ICON_CHECK_BOX_BLANK = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const ICON_CHECK_BOX = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

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
  // As in the original, the product-type list (no filters) renders every row; only the counter is paged.
  const visible = filters ? filtered.slice((safePage - 1) * pageSize, safePage * pageSize) : filtered
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

      <div className="flex h-[56px] shrink-0 items-start gap-[25px] border-b border-[#e8ebf0] pl-[30px] pt-[17px]">
        {filters && (
          <>
            <FilterSelect label={t("Фильтр по типу")} value={type} onChange={(value) => { setType(value); setPage(1) }} options={types} />
            <FilterSelect label={t("Фильтр по бренду")} value={brand} onChange={(value) => { setBrand(value); setPage(1) }} options={brands} />
            <FilterSelect label={t("Фильтр по организацию")} value={organization} onChange={(value) => { setOrganization(value); setPage(1) }} options={organizations} />
          </>
        )}
        <div className="-mt-[17px] ml-auto flex h-[56px] items-center self-start text-[#5d6474]">
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1) }}
            placeholder={t("Поиск товаров...")}
            className="relative -left-[0.6px] -top-[0.5px] mr-[91px] h-[42px] w-[280px] border border-[#d9e0e5] bg-[#f2f5f8] px-[10px] text-[13px] text-black outline-none placeholder:text-black/30"
          />
          <RefPager
            pageSize={pageSize}
            onPageSize={(size) => { setPageSize(size); setPage(1) }}
            from={filtered.length ? (safePage - 1) * pageSize + 1 : 0}
            to={Math.min(safePage * pageSize, filtered.length)}
            total={filtered.length}
            page={safePage}
            pageCount={pageCount}
            onPage={setPage}
          />
          <span className="-ml-[10px] flex h-10 w-10 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#bac6ce]"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
          </span>
        </div>
      </div>

      <div className="flex h-[50px] shrink-0 items-center border-b border-[#e8ebf0] px-[30px] pt-[6px] font-semibold">
        <span className="w-2/3 shrink-0">{t("Наименование")}</span>
        <button type="button" onClick={toggleVisible} aria-label={t("Выбрать все")} className="ml-[8px] flex h-6 w-[40px] items-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={allVisibleChecked ? ICON_DONE_ALL : ICON_SELECT_ALL} /></svg>
        </button>
        <span>{t("Статус")}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!items ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#4f71dc]" /></div>
        ) : visible.length === 0 ? (
          <p className="mt-24 text-center text-slate-400">{t("По вашему запросу ничего не найдено...")}</p>
        ) : (
          visible.map((item) => (
            <label key={item.id} className="flex h-10 cursor-pointer items-center px-[30px] hover:bg-[#f2f5f8]">
              <span className="w-2/3 shrink-0 leading-[16.25px]">{item.name}</span>
              <span className="ml-[8px] flex h-6 w-[40px] items-center">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${checked.includes(item.name) ? "fill-[#5d6474]" : "fill-[#333]"}`}>
                  <path d={checked.includes(item.name) ? ICON_CHECK_BOX : ICON_CHECK_BOX_BLANK} />
                </svg>
                <input type="checkbox" checked={checked.includes(item.name)} onChange={() => toggle(item.name)} className="sr-only" />
              </span>
            </label>
          ))
        )}
      </div>

      <footer className="flex h-[60px] shrink-0 items-center justify-end border-t border-[#e8ebf0] pb-[2px] pr-[26px]">
        <button type="button" onClick={() => onSave(checked)} className="text-[13px] font-semibold uppercase leading-[16.25px] text-[#129fdd] hover:bg-[#ececec]">{t("Сохранить")}</button>
      </footer>
    </div>,
    document.body,
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [focused, setFocused] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const shown = options.filter((option) => option.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  function toggleOpen() {
    setOpen((current) => !current)
    setSearch("")
    setFocused(0)
  }

  function choose(option: string) {
    onChange(option)
    setOpen(false)
    setSearch("")
  }

  return (
    <div ref={rootRef} className="relative w-[240px] shrink-0">
      <div className={`relative h-[36px] border-b ${open ? "border-[#d9d9d9] shadow-[0_1px_0_rgba(0,0,0,0.06)]" : "border-[#e8e8e8]"}`}>
        <button type="button" onClick={toggleOpen} className="absolute inset-0 text-left text-[13px] font-semibold leading-[34px] text-black">
          {open && search ? "" : <span className="relative top-[2.5px] block truncate pr-[10px]">{value || label}</span>}
        </button>
        {open && (
          <input
            autoFocus
            value={search}
            onChange={(event) => { setSearch(event.target.value); setFocused(0) }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setFocused((current) => Math.min(shown.length - 1, current + 1)) }
              if (event.key === "ArrowUp") { event.preventDefault(); setFocused((current) => Math.max(0, current - 1)) }
              if (event.key === "Enter" && shown[focused]) { event.preventDefault(); choose(shown[focused]) }
              if (event.key === "Escape") { event.stopPropagation(); setOpen(false) }
            }}
            className="absolute inset-y-0 left-0 right-[40px] bg-transparent text-[13px] font-semibold text-black outline-none"
          />
        )}
        {value && (
          <span role="button" aria-label="clear" onClick={() => onChange("")} className="absolute right-[24px] top-[9px] cursor-pointer text-[18px] leading-[18px] text-[#999] hover:text-[#d0021b]">×</span>
        )}
        <span
          aria-hidden
          className={`pointer-events-none absolute right-[10px] top-[21.4px] h-0 w-0 border-x-[5px] border-x-transparent ${open ? "-mt-[5px] border-b-[5px] border-b-[#999]" : "border-t-[5px] border-t-[#999]"}`}
        />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-[35px] z-20 max-h-[200px] overflow-y-auto rounded-b-[4px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
          {shown.length === 0 ? (
            <div className="px-[10px] py-2 text-[13px] font-semibold text-[#999]">—</div>
          ) : (
            shown.map((option, index) => (
              <button
                key={`${option}-${index}`}
                type="button"
                onMouseEnter={() => setFocused(index)}
                onClick={() => choose(option)}
                className={`block w-full px-[10px] py-2 text-left text-[13px] font-semibold leading-[16.25px] ${index === focused ? "bg-[#e6f2ff] text-[#333]" : "text-[#666]"}`}
              >
                {option}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
