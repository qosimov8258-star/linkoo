"use client"

import { useState } from "react"

import { FormField, MultiPick, SearchSelect, inputClass } from "@/components/analytics/cash-management-shared"
import { FilterPopup, FilterToggle } from "@/components/analytics/internal-transfers-filter"
import { filterCount } from "@/components/products/catalog-state"
import { useLanguage } from "@/lib/i18n/language-context"
import type { CatalogFilters, CatalogKind, CatalogOptions } from "@/lib/products-types"

// Demo ProductFilterForm (module 479): Тип продукта → Подкатегория, "Показать только"
// (Можно продать / Нельзя продать), Мера, Бренд, Поставщик, Цвет, Поставка, Организации,
// "Только ММЛ продукты", "Инвентари", "Только Perfect Store продукты" (products only);
// "Применить". Once applied: "Фильтр: N элемента" + edit + clear.

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
  return (
    <div className="relative">
      <FilterToggle count={filterCount(filters)} open={open} onOpen={onOpen} onClose={onClose} onClear={onClear} />
      {open && <CatalogFilterPopup kind={kind} filters={filters} options={options} onClose={onClose} onApply={onApply} />}
    </div>
  )
}

function CatalogFilterPopup({
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
  const pick = (values: string[] | undefined) => (values ?? []).map((value) => ({ value, label: value }))
  const types = options?.types ?? []
  const children = types.find((type) => type.name === draft.typeParent)?.children ?? []
  const check = (key: "isMML" | "isGear" | "isPerfectStore", label: string) => (
    <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
      <input type="checkbox" checked={draft[key]} onChange={(event) => set({ [key]: event.target.checked })} className="h-4 w-4 accent-[rgb(79,113,220)]" />
      {t(label)}
    </label>
  )
  return (
    <FilterPopup onClose={onClose} onSubmit={() => onApply(draft)}>
      <FormField label={t("Тип продукта")}>
        <SearchSelect
          value={draft.typeParent}
          options={types.map((type) => ({ value: type.name, label: type.name }))}
          placeholder={t("Все")}
          onChange={(value) => set({ typeParent: value, typeChild: "" })}
        />
      </FormField>
      {draft.typeParent && (
        <FormField label={t("Подкатегория")}>
          <SearchSelect value={draft.typeChild} options={pick(children)} placeholder={t("Все")} onChange={(value) => set({ typeChild: value })} />
        </FormField>
      )}
      <FormField label={t("Показать только")}>
        <select value={draft.canSell} onChange={(event) => set({ canSell: event.target.value as CatalogFilters["canSell"] })} className={inputClass}>
          <option value="">{t("Все")}</option>
          <option value="1">{t("Можно продать")}</option>
          <option value="2">{t("Нельзя продать")}</option>
        </select>
      </FormField>
      <MultiPick label={t("Мера")} options={pick(options?.units)} value={draft.measurement} onChange={(measurement) => set({ measurement })} />
      <MultiPick label={t("Бренд")} options={pick(options?.filterValues?.brands ?? options?.brands)} value={draft.brand} onChange={(brand) => set({ brand })} />
      <MultiPick label={t("Поставщик")} options={pick(options?.filterValues?.suppliers ?? options?.suppliers)} value={draft.provider} onChange={(provider) => set({ provider })} />
      <MultiPick label={t("Цвет")} options={pick(options?.colors)} value={draft.color} onChange={(color) => set({ color })} />
      <FormField label={t("Поставка")}>
        <SearchSelect
          value={draft.supply}
          options={(options?.supplies ?? []).map((supply) => ({ value: String(supply.id), label: supply.label }))}
          placeholder={t("Все")}
          onChange={(value) => set({ supply: value })}
        />
      </FormField>
      <MultiPick label={t("Организации")} options={pick(options?.filterValues?.organizations ?? options?.organizations)} value={draft.division} onChange={(division) => set({ division })} />
      {check("isMML", "Только ММЛ продукты")}
      {check("isGear", "Инвентари")}
      {kind === "product" && check("isPerfectStore", "Только Perfect Store продукты")}
    </FilterPopup>
  )
}
