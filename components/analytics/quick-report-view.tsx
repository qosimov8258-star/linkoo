"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { RefHeader } from "@/components/ref/list-kit"
import { formatRangeLabel, parseISODate, toISODate } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"

// "Конструктор отчетов" (demo #/quick-report/): the date range, a model, three parameters and four chart kinds. The model list
// of the reference account is empty, so nothing can be built yet: the card shows "Нет данных" and "ГРАФИКИ" lists no saved charts.
const CARD = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] rounded-[2px]"
const CHARTS = [
  { key: "line", path: "M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" },
  { key: "pie", path: "M11 2v20c-5.07-.5-9-4.79-9-10s3.93-9.5 9-10zm2.03 0v8.99H22c-.47-4.74-4.24-8.52-8.97-8.99zm0 11.01V22c4.74-.47 8.5-4.25 8.97-8.99h-8.97z" },
  { key: "bar", path: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z" },
  { key: "table", path: "M20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM8 20H4v-4h4v4zm0-6H4v-4h4v4zm0-6H4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4zm6 12h-4v-4h4v4zm0-6h-4v-4h4v4zm0-6h-4V4h4v4z" },
] as const

function monthRange() {
  const now = new Date()
  return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
}

export function QuickReportView() {
  const { t } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [range, setRange] = useState(monthRange)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [chart, setChart] = useState<(typeof CHARTS)[number]["key"]>("line")
  const favouritesOpen = searchParams.get("openChartsFavouriteDialog") === "true"

  const setFavourites = (open: boolean) => router.replace(open ? `${pathname}?openChartsFavouriteDialog=true` : pathname)

  useEffect(() => {
    if (!favouritesOpen) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setFavourites(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favouritesOpen])

  const parameter = "flex h-[42.5px] w-[84.4px] items-center justify-between rounded-[4px] bg-[#4f71dc] px-[5px] text-left text-[13px] leading-[16.25px] text-white"

  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#f2f5f8] font-sans text-[13px] text-[#333]">
      <div className="pl-[28px] pr-[36px]">
        <RefHeader title={t("Конструктор отчетов")} />
      </div>

      <section className={`relative mx-[30px] h-[50px] ${CARD}`}>
        <button type="button" onClick={() => setPickerOpen((open) => !open)} className="absolute left-[36px] top-[11px] text-[13px] font-bold text-[#4f71dc]">
          {formatRangeLabel(parseISODate(range.from), parseISODate(range.to))}
        </button>
        {pickerOpen && (
          <DateRangePicker
            positionClassName="left-[8px] top-[42px]"
            begin={range.from}
            end={range.to}
            onClose={() => setPickerOpen(false)}
            onApply={(from, to) => {
              setRange({ from, to })
              setPickerOpen(false)
            }}
          />
        )}
        <div className="absolute left-[513.2px] top-[1.5px] h-[44px] w-[300px] border-b border-[#e8e8e8]">
          <span className="absolute left-0 top-[20px] text-[13px] font-semibold leading-[16.25px] text-black">{t("Модель")}</span>
          <svg viewBox="0 0 24 24" className="absolute right-[5px] top-[22px] h-6 w-6 fill-[#ccc]"><path d="M7 10l5 5 5-5z" /></svg>
        </div>
        <div className="absolute right-[30px] top-[11px] flex">
          {CHARTS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-label={item.key}
              onClick={() => setChart(item.key)}
              className={`flex h-[28px] w-[50px] items-center justify-center rounded-[5px] ${chart === item.key ? "bg-[#4f71dc]" : "bg-[#dadada]"}`}
            >
              <svg viewBox="0 0 24 24" className={`h-[20px] w-[20px] ${chart === item.key ? "fill-white" : "fill-white"}`}><path d={item.path} /></svg>
            </button>
          ))}
        </div>
      </section>

      <section className={`relative mx-[30px] h-[50px] ${CARD}`}>
        <span className="absolute left-[30px] top-[14px] flex items-center text-[13px] text-[#4f71dc]">
          {t("Замеры")}
          <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-[#4f71dc]"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
        </span>
        <svg viewBox="0 0 24 24" className="absolute left-[177px] top-[13px] h-6 w-6 fill-[#555]"><path d="M22 6.92l-1.41-1.41-2.85 3.21C15.68 6.4 12.83 5 9.61 5 6.72 5 4.07 6.16 2 8l1.42 1.42C5.12 7.93 7.27 7 9.61 7c2.74 0 5.09 1.36 6.7 3.51l-2.82 3.18-3.55-3.54L2 17.99 3.41 19.4l5.43-5.43 3.55 3.54z" /></svg>
        <button type="button" aria-label={t("Графики")} onClick={() => setFavourites(true)} className="absolute left-[225px] top-[13px] h-6 w-6">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z" /></svg>
          <svg viewBox="0 0 24 24" className="absolute left-[7px] top-[7px] h-[10px] w-[10px] fill-white"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
        </button>
        <span className="absolute left-[247px] top-[-7px] flex h-[24px] w-[24px] items-center justify-center rounded-full bg-[#009688] text-[11px] font-medium text-white">0</span>
        <div className="absolute left-[1213.3px] top-[3.8px] flex gap-[13px]">
          <span className={parameter}>
            {t("Второй параметр")}
            <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] shrink-0 fill-white"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
          </span>
          <span className={parameter}>
            {t("Третий параметр")}
            <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] shrink-0 fill-white"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
          </span>
        </div>
      </section>

      <section className={`relative mx-[30px] mt-[20px] h-[196.3px] ${CARD}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/robot-empty.png" alt="" className="absolute left-1/2 top-[25px] w-[100px] -translate-x-1/2" />
        <span className="absolute inset-x-0 top-[150px] text-center text-[13px] leading-[16.25px] text-[#999]">{t("Нет данных")}</span>
      </section>

      {favouritesOpen && (
        <div className="fixed inset-0 z-[1200] flex items-start justify-center bg-black/[0.54] pt-[280px]" onMouseDown={(event) => event.target === event.currentTarget && setFavourites(false)}>
          <div className="relative h-[340px] w-[500px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
            <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[20px]">
              <h2 className="text-[15px] font-bold uppercase text-[#333]">{t("Графики")}</h2>
              <button type="button" aria-label={t("Закрыть")} onClick={() => setFavourites(false)} className="flex h-8 w-8 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
              </button>
            </div>
            <div className="flex flex-col items-center pt-[75px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/robot-empty.png" alt="" className="w-[110px]" />
              <span className="mt-[26px] text-[13px] leading-[16.25px] text-[#333]">{t("Ничего не найдено")}</span>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
