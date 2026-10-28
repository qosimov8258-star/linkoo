"use client"

import { useEffect, useRef, useState } from "react"

import { FilterToggle } from "@/components/analytics/internal-transfers-filter"
import { FilterCheck, FilterSelect, RefFilterPanel } from "@/components/ref/list-kit"
import { filterCount } from "@/components/products/catalog-state"
import { useLanguage } from "@/lib/i18n/language-context"
import type { CatalogFilters, CatalogKind, CatalogOptions } from "@/lib/products-types"

// Demo ProductFilterForm (module 479): Тип продукта → Подкатегория, "Показать только"
// (Можно продать / Нельзя продать), Мера, Бренд, Поставщик, Цвет, Поставка, Организации,
// "Только ММЛ продукты", "Инвентари", "Только Perfect Store продукты" (products only);
// "Применить". Once applied: "Фильтр: N элемента" + edit + clear. The panel is the reference's
// left "Фильтр" drawer (kit RefFilterPanel); the multi fields show chips like its react-select.

export function CatalogFilterBar({
  kind,
  filters,
  options,
  open,
  onOpen,
  onClose,
  onClear,
  onApply,
}: {
  kind: CatalogKind
  filters: CatalogFilters
  options: CatalogOptions | null
  open: boolean
  onOpen: () => void
  onClose: () => void
  onClear: () => void
  onApply: (filters: CatalogFilters) => void
}) {
  const { t } = useLanguage()
  const count = filterCount(filters)
  return (
    <>
      {count > 0 ? (
        <FilterToggle count={count} open={open} onOpen={onOpen} onClose={onClose} onClear={onClear} />
      ) : (
        <button type="button" onClick={open ? onClose : onOpen} className="flex items-center text-[13px] text-[#4f71dc]">
          {t("Показать фильтр")}
          <svg viewBox="0 0 24 24" className="h-5 w-[13px] fill-[#4f71dc]"><path d="M7.41 7.84L12 12.42l4.59-4.58L18 9.25l-6 6-6-6z" /></svg>
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-0 z-30">
          <CatalogFilterPanel kind={kind} filters={filters} options={options} onClose={onClose} onApply={onApply} />
        </div>
      )}
    </>
  )
}

function CatalogFilterPanel({
  kind,
  filters,
  options,
  onClose,
  onApply,
}: {
  kind: CatalogKind
  filters: CatalogFilters
  options: CatalogOptions | null
  onClose: () => void
  onApply: (filters: CatalogFilters) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<CatalogFilters>(filters)
  const set = (patch: Partial<CatalogFilters>) => setDraft((current) => ({ ...current, ...patch }))
  const types = options?.types ?? []
  const children = types.find((type) => type.name === draft.typeParent)?.children ?? []
  const canSell = [t("Можно продать"), t("Нельзя продать")]
  const supplies = options?.supplies ?? []

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <RefFilterPanel narrow onClose={onClose} onApply={() => onApply(draft)} applyClassName="mt-[25px]">
      <div className="-mt-px">
        <FilterSelect label={t("Тип продукта")} value={draft.typeParent} onChange={(value) => set({ typeParent: value, typeChild: "" })} options={types.map((type) => type.name)} />
        {draft.typeParent && <FilterSelect label={t("Подкатегория")} value={draft.typeChild} onChange={(value) => set({ typeChild: value })} options={children} />}
        <FilterSelect
          label={t("Показать только")}
          value={draft.canSell === "1" ? canSell[0] : draft.canSell === "2" ? canSell[1] : ""}
          onChange={(value) => set({ canSell: value === canSell[0] ? "1" : value === canSell[1] ? "2" : "" })}
          options={canSell}
        />
        <FilterMulti label={t("Мера")} value={draft.measurement} onChange={(measurement) => set({ measurement })} options={options?.units ?? []} />
        <FilterMulti label={t("Бренд")} value={draft.brand} onChange={(brand) => set({ brand })} options={options?.filterValues?.brands ?? options?.brands ?? []} />
        <FilterMulti label={t("Поставщик")} value={draft.provider} onChange={(provider) => set({ provider })} options={options?.filterValues?.suppliers ?? options?.suppliers ?? []} />
        <FilterMulti label={t("Цвет")} value={draft.color} onChange={(color) => set({ color })} options={options?.colors ?? []} />
        <FilterSelect
          label={t("Поставка")}
          value={supplies.find((supply) => String(supply.id) === draft.supply)?.label ?? ""}
          onChange={(value) => set({ supply: value ? String(supplies.find((supply) => supply.label === value)?.id ?? "") : "" })}
          options={supplies.map((supply) => supply.label)}
        />
        <FilterMulti label={t("Организации")} value={draft.division} onChange={(division) => set({ division })} options={options?.filterValues?.organizations ?? options?.organizations ?? []} />
      </div>
      <div className="mt-[3px] flex flex-col gap-[10px]">
        <FilterCheck compact label={t("Только ММЛ продукты")} checked={draft.isMML} onChange={(isMML) => set({ isMML })} />
        <FilterCheck compact label={t("Инвентари")} checked={draft.isGear} onChange={(isGear) => set({ isGear })} />
        {kind === "product" && <FilterCheck compact label={t("Только Perfect Store продукты")} checked={draft.isPerfectStore} onChange={(isPerfectStore) => set({ isPerfectStore })} />}
      </div>
    </RefFilterPanel>
  )
}

/** Multi-select styled after the reference's react-select: chips with a leading ×, menu without the chosen ones. */
function FilterMulti({ label, value, onChange, options }: { label: string; value: string[]; onChange: (value: string[]) => void; options: string[] }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [focused, setFocused] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const shown = options.filter((option) => !value.includes(option) && option.toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const choose = (option: string) => {
    onChange([...value, option])
    setSearch("")
    setFocused(0)
  }

  return (
    <div ref={rootRef} className="relative min-h-[62px] pb-[7px] pt-[18px]">
      <div className={`relative min-h-[36px] border-b ${open ? "border-[#d9d9d9] shadow-[0_1px_0_rgba(0,0,0,0.06)]" : "border-[#e8e8e8]"}`}>
        {value.length > 0 && <span className="absolute left-0 top-[-8px] text-[10px] font-bold leading-3 text-black">{label}</span>}
        <div
          onClick={() => setOpen(true)}
          className="flex min-h-[36px] cursor-pointer flex-wrap items-center pr-[44px]"
        >
          {value.length === 0 && !open && <span className="absolute left-0 top-[13px] text-[13px] font-semibold leading-4 text-black">{label}</span>}
          {value.map((item) => (
            <span key={item} className="mr-[5px] mt-[5px] mb-[4px] flex items-center rounded-[2px] border border-[#5868f0] bg-[#5868f0] text-[11.7px] font-semibold leading-[16.38px] text-white">
              <button
                type="button"
                aria-label={t("Удалить")}
                onClick={(event) => {
                  event.stopPropagation()
                  onChange(value.filter((current) => current !== item))
                }}
                className="px-[5px] py-[2px] hover:bg-[#4a58d8]"
              >
                ×
              </button>
              <span className="px-[5px] py-[2px]">{item}</span>
            </span>
          ))}
          {open && (
            <input
              autoFocus
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setFocused(0)
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  setFocused((current) => Math.min(shown.length - 1, current + 1))
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setFocused((current) => Math.max(0, current - 1))
                }
                if (event.key === "Enter" && shown[focused]) {
                  event.preventDefault()
                  choose(shown[focused])
                }
                if (event.key === "Backspace" && !search && value.length) onChange(value.slice(0, -1))
                if (event.key === "Escape") {
                  event.stopPropagation()
                  setOpen(false)
                }
              }}
              placeholder={value.length === 0 ? label : ""}
              className="h-[34px] min-w-[40px] flex-1 bg-transparent text-[13px] font-semibold text-black outline-none placeholder:text-black"
            />
          )}
        </div>
        {value.length > 0 && (
          <span role="button" aria-label={t("Очистить фильтр")} onClick={() => onChange([])} className="absolute right-[34px] top-[10px] cursor-pointer text-[18px] leading-[18px] text-[#999] hover:text-[#d0021b]">×</span>
        )}
        <span
          aria-hidden
          className={`pointer-events-none absolute right-[10px] top-[15px] h-0 w-0 border-x-[5px] border-x-transparent ${open ? "border-b-[5px] border-b-[#999]" : "border-t-[5px] border-t-[#999]"}`}
        />
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 -mt-[7px] max-h-[200px] overflow-y-auto rounded-b-[4px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
          {shown.length === 0 ? (
            <div className="px-[10px] py-2 text-[13px] font-semibold text-[#999]">{t("Ничего не найдено")}</div>
          ) : (
            shown.map((option, index) => (
              <button
                key={option}
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
