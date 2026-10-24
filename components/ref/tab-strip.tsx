"use client"

import { useLanguage } from "@/lib/i18n/language-context"

/**
 * The reference app's tab strip: equal-width tabs, 40px high, with the 3px indicator sitting on a 1px
 * spacer line so the toolbar underneath starts at +41px.
 */
export function RefTabStrip<T extends string>({ tabs, value, onChange }: { tabs: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  const { t } = useLanguage()
  const index = Math.max(0, tabs.findIndex((tab) => tab.value === value))
  return (
    <div className="relative flex h-[41px] bg-white">
      {tabs.map((tab) => (
        <button key={tab.value || "all"} type="button" onClick={() => onChange(tab.value)} className="h-10 flex-1 whitespace-nowrap text-center text-[13px] font-normal leading-[18px] text-black">
          {t(tab.label)}
        </button>
      ))}
      <span
        className="absolute bottom-0 left-0 z-10 h-[3px] bg-[#4f71dc] shadow-[0_-3px_10px_0_#5869f0] transition-transform duration-300"
        style={{ width: `${100 / tabs.length}%`, transform: `translateX(${index * 100}%)` }}
      />
    </div>
  )
}
