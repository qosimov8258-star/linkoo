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
  // "Поставка" implies the provider pick in the cash core, but the demo lists one chip.
  const shown = options.includes("supply") ? options.filter((key) => key !== "provider") : options
  if (!shown.length) return null
  return (
    <div className="flex flex-wrap items-center">
      {shown.map((key) => {
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
  // Reference geometry (Material-UI radio group): 10 px under the checkboxes, a 24 px radio icon, the label 16 px after
  // it in regular weight, 20 px of padding and 16 px of margin after each item, rows 34 px apart.
  return (
    <fieldset className="-mt-[2px]">
      <legend className="text-[13px] font-semibold leading-4 text-[#333]">{t("Дополнительные параметры")}</legend>
      <div role="radiogroup" className="flex flex-wrap pt-[10px]">
        {categoryOptionItems(kind).map((item) => {
          const checked = value === item.key
          return (
            <label key={item.key} title={t(item.description)} className="relative mr-4 mt-[10px] inline-flex h-6 cursor-pointer items-center pr-5 text-[13px] text-black">
              <input type="radio" name={`${kind}-category-option`} value={item.key} checked={checked} onChange={() => onChange(item.key)} className="peer absolute inset-0 cursor-pointer opacity-0" />
              <svg viewBox="0 0 24 24" className={`h-6 w-6 shrink-0 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-[#5d6474]/40 ${checked ? "fill-[#5d6474]" : "fill-[#333]"}`} aria-hidden>
                <path d={checked ? "M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" : "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"} />
              </svg>
              <span className="ml-4">{t(item.title)}</span>
            </label>
          )
        })}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-rose-500">{error}</p>}
    </fieldset>
  )
}
