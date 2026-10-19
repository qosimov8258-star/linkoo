"use client"

import type { CategoryOptionKey } from "@/lib/cash/types"
import { categoryOptionItem, categoryOptionItems, type CategoryKind } from "@/lib/category-options"
import { useLanguage } from "@/lib/i18n/language-context"

// Option pieces of the categories pages: the grey chips of the "Параметры" column
// (demo: a tag per option with the option description as a tooltip; ours opens above
// the chip so the horizontally scrollable table does not clip it on the last row) and
// the single-choice list of the dialog (demo module 4282: RadioButtonGroup "options").

export function CategoryOptionChips({ options }: { options: readonly CategoryOptionKey[] }) {
  const { t } = useLanguage()
  if (!options.length) return null
  return (
    <div className="flex flex-wrap items-center">
      {options.map((key) => {
        const item = categoryOptionItem(key)
        return (
          <span key={key} className="group/chip relative my-[5px] mr-[10px] inline-flex">
            <span tabIndex={0} className="inline-flex h-7 items-center rounded-[2px] bg-[#e9ecef] px-[10px] text-[13px] leading-none text-[#333] outline-none">
              {t(item.title)}
            </span>
            {item.description && (
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max max-w-[260px] -translate-x-1/2 rounded bg-[#616161] px-2 py-1 text-center text-[12px] font-normal leading-4 text-white shadow group-hover/chip:block group-focus-within/chip:block"
              >
                {t(item.description)}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

export function CategoryOptionsPicker({
  kind,
  value,
  onChange,
  error,
}: {
  kind: CategoryKind
  value: CategoryOptionKey | ""
  onChange: (value: CategoryOptionKey) => void
  /** Already translated. */
  error?: string
}) {
  const { t } = useLanguage()
  return (
    <fieldset>
      <legend className="text-[14px] font-semibold text-[#333]">{t("Дополнительные параметры")}</legend>
      <div role="radiogroup" className="flex flex-wrap pt-1">
        {categoryOptionItems(kind).map((item) => (
          <label key={item.key} title={t(item.description)} className="mr-4 mt-2.5 inline-flex cursor-pointer items-center gap-2 whitespace-nowrap text-[14px] text-[#333]">
            <input
              type="radio"
              name={`${kind}-category-option`}
              value={item.key}
              checked={value === item.key}
              onChange={() => onChange(item.key)}
              className="h-[18px] w-[18px] accent-[#4f70e7]"
            />
            {t(item.title)}
          </label>
        ))}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-rose-500">{error}</p>}
    </fieldset>
  )
}
