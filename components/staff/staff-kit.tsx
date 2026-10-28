"use client"

import { Pencil, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

/** Shared pieces of the Персонал settings pages (Сотрудники, Подписки, Сессия). */

/** Applied-filter chip that replaces "Показать фильтр": "Фильтр: N", pencil to edit, × to clear. */
export function FilterChip({ count, onEdit, onClear }: { count: number; onEdit: () => void; onClear: () => void }) {
  const { t } = useLanguage()
  return (
    <div className="ml-[0px] flex h-[40px] w-[242px] items-center bg-[#efefef] text-[13px] text-[#666]">
      <span className="flex-1 pl-[28px]">{t("Фильтр")}: {count}</span>
      <button type="button" onClick={onEdit} aria-label={t("Изменить фильтр")} title={t("Изменить фильтр")} className="flex h-[40px] w-[48px] items-center justify-center border-l border-white text-[#8f8f8f] hover:text-[#17233b]">
        <Pencil className="h-5 w-5" />
      </button>
      <button type="button" onClick={onClear} aria-label={t("Очистить фильтр")} title={t("Очистить фильтр")} className="flex h-[40px] w-[48px] items-center justify-center border-l border-white text-[#8f8f8f] hover:text-[#17233b]">
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}

/** "Показать фильтр ⌄" link of the settings toolbars. */
export function FilterLink({ onClick }: { onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button type="button" onClick={onClick} className="relative top-[1.9px] flex text-[13px] leading-[16.25px] text-[#4f71dc]">
      <span>{t("Показать фильтр")}</span>
      <svg viewBox="0 0 24 24" className="ml-px h-[20px] w-[13px] shrink fill-[#4f71dc]" aria-hidden><path d="M7.41 7.84L12 12.42l4.59-4.58L18 9.25l-6 6-6-6z" /></svg>
    </button>
  )
}

export type Option = { value: string; label: string }

/** Closes a popup on outside mouse down. */
export function useOutsideClose(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open, onClose])
  return ref
}

/** Underlined multi-select with × chips (reference react-select multi): `Филиалы`, `Точки локации`, ... */
export function MultiSelectField({
  label,
  options,
  value,
  onChange,
  required,
  searchable = true,
  placeholder,
  error,
  flush = false,
  pills = false,
}: {
  /** Reference "Какие кассы будут доступны?" look: caption on a line, picked items as grey ⊗ pills below. */
  pills?: boolean
  /** Reference look: flat 36px menu that keeps picked items (highlighted), caret flips while open. */
  flush?: boolean
  label: string
  options: Option[]
  value: string[]
  onChange: (value: string[]) => void
  required?: boolean
  searchable?: boolean
  /** Grey hint shown inside while nothing is chosen (the label then stays above). */
  placeholder?: string
  error?: string
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const ref = useOutsideClose(open, () => setOpen(false))
  const selected = value.map((id) => options.find((option) => option.value === id)).filter((option): option is Option => Boolean(option))
  const rest = options.filter((option) => (flush || pills || !value.includes(option.value)) && option.label.toLowerCase().includes(search.trim().toLowerCase()))
  if (pills) {
    return (
      <div ref={ref} className="relative pt-[40px]">
        <div onClick={() => setOpen(true)} className="relative cursor-pointer border-b border-[#e0e0e0] pb-[5px] pr-[30px] text-[13px] leading-[16px]">
          {label}
          <svg viewBox="0 0 10 5" className={`absolute right-[10px] top-[5px] h-[5px] w-[10px] fill-[#ccc] ${open ? "rotate-180" : ""}`}><path d="M0 0l5 5 5-5z" /></svg>
        </div>
        <div className="flex flex-wrap pt-[10px]">
          {selected.map((option) => (
            <span key={option.value} className="mb-[7px] mr-[6px] inline-flex h-[32px] items-center rounded-full border border-[#ddd] bg-[#eee] pl-[13px] pr-[5px] text-[13px] text-[#666]">
              {option.label}
              <button type="button" aria-label={t("Удалить")} onClick={() => onChange(value.filter((id) => id !== option.value))} className="ml-[6px] flex h-[20px] w-[20px] items-center justify-center rounded-full bg-[#bdbdbd] text-[14px] leading-none text-white">×</button>
            </span>
          ))}
        </div>
        {open && (
          <ul className="absolute left-0 right-0 top-[63px] z-30 max-h-[240px] overflow-y-auto bg-white py-0 [box-shadow:0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
            {rest.length === 0 && <li className="h-[36px] px-[10px] text-[13px] leading-[36px] text-[#999]">{t("Ничего не найдено")}</li>}
            {rest.map((option) => (
              <li key={option.value}>
                <button type="button" onClick={() => { onChange(value.includes(option.value) ? value.filter((id) => id !== option.value) : [...value, option.value]); setSearch("") }} className={`block h-[36px] w-full truncate px-[10px] text-left text-[13px] font-semibold ${value.includes(option.value) ? "bg-[#e3effd] text-[#333]" : "text-[#333] hover:bg-[#f2f5f8]"}`}>{option.label}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
  return (
    <div ref={ref} className="relative min-h-[56px]">
      <div onClick={() => setOpen(true)} className={`relative min-h-[56px] cursor-pointer border-b pb-[6px] pr-[50px] ${open && flush ? "border-[#5d6474] shadow-[0_1px_0_#5d6474]" : "border-[#d5dae1]"} ${flush && selected.length ? "pt-[26px]" : "pt-[16px]"}`}>
        <span className={`absolute left-0 ${selected.length || placeholder ? `${flush && selected.length ? "top-[8.2px]" : "top-0"} text-[10px] font-semibold leading-3` : "top-[33px] text-[13px] font-semibold leading-4"}`}>
          {label}{required && <span className="text-[#e57373]"> *</span>}
        </span>
        {placeholder && selected.length === 0 && !open && <span className="absolute left-0 top-[26px] text-[13px] text-[#999]">{placeholder}</span>}
        <div className={`flex flex-wrap ${flush ? "" : "gap-[6px]"}`}>
          {selected.map((option) => (
            <span key={option.value} className={flush ? "mr-[5px] mt-[5px] flex h-[22.4px] items-center rounded-[2px] bg-[#5868f0] text-[11.7px] font-semibold leading-[16.38px] text-white" : "flex items-center bg-[#5869f0] text-[12px] font-semibold text-white"}>
              <button type="button" aria-label={t("Удалить")} onClick={(event) => { event.stopPropagation(); onChange(value.filter((id) => id !== option.value)) }} className={flush ? "px-[5px] py-[2px]" : "px-[6px] py-[3px] hover:bg-[#4658d8]"}>×</button>
              <span className={flush ? "my-[2px] border-l border-white px-[5px] py-0 leading-[17px]" : "border-l border-white/30 py-[3px] pl-[6px] pr-[8px]"}>{option.label}</span>
            </span>
          ))}
          {open && searchable && (
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} className="h-[24px] min-w-[80px] flex-1 bg-transparent text-[13px] outline-none" />
          )}
        </div>
        <span className="absolute bottom-[8.6px] right-[10px] flex items-center gap-[10px] text-[#999]">
          {selected.length > 0 && <button type="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange([]) }}><X className="h-3.5 w-3.5" /></button>}
          <svg viewBox="0 0 10 5" className={`h-[5px] w-[10px] fill-[#999] ${flush && open ? "rotate-180" : ""}`}><path d="M0 0l5 5 5-5z" /></svg>
        </span>
      </div>
      {error && <span className="mt-[2px] block text-[12px] text-[#e57373]">{error}</span>}
      {open && (
        <ul className={`absolute left-0 right-0 top-full z-30 max-h-[240px] overflow-y-auto bg-white ${flush ? "py-0 [box-shadow:0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]" : "py-[6px] shadow-[0_2px_10px_rgba(0,0,0,0.2)]"}`}>
          {rest.length === 0 && <li className="h-[32px] px-[10px] text-[13px] leading-[32px] text-[#999]">{t("Ничего не найдено")}</li>}
          {rest.map((option) => (
            <li key={option.value}>
              <button type="button" onClick={() => { if (flush && value.includes(option.value)) onChange(value.filter((id) => id !== option.value)); else onChange([...value, option.value]); setSearch("") }} className={`block w-full truncate px-[10px] text-left text-[13px] font-semibold ${flush ? `h-[36px] ${value.includes(option.value) ? "bg-[#e3effd] text-[#333]" : "text-[#333] hover:bg-[#f2f5f8]"}` : "h-[32px] text-[#666] hover:bg-[#f2f5f8]"}`}>{option.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Square checkbox of the reference (grey frame, dark tick). */
export function Check({ checked, onChange, label, className = "" }: { checked: boolean; onChange: (value: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={`flex cursor-pointer items-center gap-[6px] text-[13px] font-semibold ${className}`}>
      <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className="flex h-5 w-5 shrink-0 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
          <path d={checked ? "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" : "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"} />
        </svg>
      </button>
      {label}
    </label>
  )
}

/** Full-width two/three-tab strip with the sliding blue underline of the reference. */
export function StaffTabs({ labels, value, onChange, height = 40 }: { labels: string[]; value: string; onChange: (value: string) => void; height?: number }) {
  const { t } = useLanguage()
  const index = Math.max(0, labels.indexOf(value))
  return (
    <div className="relative flex bg-white" style={{ height }}>
      {labels.map((label) => (
        <button key={label} type="button" onClick={() => onChange(label)} className={`flex-1 whitespace-nowrap text-center text-[13px] font-medium text-black ${height > 40 ? "pt-[10px]" : ""}`}>
          {t(label)}
        </button>
      ))}
      <span
        className="absolute bottom-0 left-0 z-10 h-[3px] bg-[#4f71dc] shadow-[0_-3px_10px_0_#5869f0] transition-transform duration-300"
        style={{ width: `${100 / labels.length}%`, transform: `translateX(${index * 100}%)` }}
      />
    </div>
  )
}

function PickCaret() {
  return (
    <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[39.4px] h-[5px] w-[10px] fill-[#999]">
      <path d="M0 0l5 5 5-5z" />
    </svg>
  )
}

/** Filter-panel select over {value, label} options (the list-kit FilterSelect works on plain strings, which breaks on duplicate names). */
export function FilterPick({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const ref = useOutsideClose(open, () => setOpen(false))
  const selected = options.find((option) => option.value === value)
  const shown = options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <div ref={ref} className="relative h-[62px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className="absolute inset-x-0 top-[18px] h-[36px] border-b border-[#e8e8e8] text-left text-[13px] font-semibold text-black">
        {selected ? (
          <>
            <span className="absolute left-0 top-[-8px] text-[10px] font-bold leading-3">{label}</span>
            <span className="absolute inset-x-0 top-[10px] truncate pr-8">{selected.label}</span>
          </>
        ) : (
          <span className="absolute left-0 top-[13px] leading-4">{label}</span>
        )}
      </button>
      <PickCaret />
      {open && (
        <div className="absolute inset-x-0 top-[54px] z-50 max-h-[205px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
          {options.length > 12 && (
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Поиск")} className="mb-1 block h-9 w-full border-b border-[#e8e8e8] px-[10px] text-[13px] outline-none" />
          )}
          {selected && (
            <button type="button" onClick={() => { onChange(""); setOpen(false) }} className="block h-9 w-full px-[10px] text-left text-[13px] text-[#999] hover:bg-[#f2f5f8]">{t("Сбросить")}</button>
          )}
          {shown.length === 0 ? (
            <div className="h-9 px-[10px] text-[13px] leading-9 text-[#999]">{t("Ничего не найдено")}</div>
          ) : (
            shown.map((option) => (
              <button key={option.value} type="button" onClick={() => { onChange(option.value); setOpen(false); setSearch("") }} className={`block h-9 w-full truncate px-[10px] text-left text-[13px] font-semibold hover:bg-[#f2f5f8] ${option.value === value ? "text-[#4f71dc]" : ""}`}>
                {option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Material switch with a coloured caption ("Проверка GPS включена" green / "отключено" red). */
export function Switch({ checked, onChange, label, hint, tone }: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-[10px]">
      <span className={`relative inline-block h-[14px] w-[34px] shrink-0 rounded-full ${checked ? "bg-[#9fb1f5]" : "bg-[#bdbdbd]"}`}>
        <span className={`absolute top-[-3px] h-[20px] w-[20px] rounded-full [box-shadow:0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] transition-all ${checked ? "left-[16px] bg-[#4f71dc]" : "left-[-2px] bg-[#f1f5f8]"}`} />
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      </span>
      <span className="text-[13px] font-semibold leading-[16px] text-[#333]" style={tone ? { color: tone } : undefined}>
        {label}
        {hint && <span className="block text-[13px] font-normal text-[#333]">{hint}</span>}
      </span>
    </label>
  )
}
