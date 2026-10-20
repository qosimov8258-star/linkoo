"use client"

import { useState } from "react"
import Image from "next/image"
import { ChevronDown, Pencil, X } from "lucide-react"
import { ReportPage, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { useLanguage } from "@/lib/i18n/language-context"


type Period = "СЕГОДНЯ" | "ВЧЕРА" | "ПОСЛ. 7" | "МЕСЯЦ" | "СВОЯ"
const metrics = ["АКБ", "ОКБ", "ИНДЕКС АКБ", "ПРОДАЖИ"] as const
const salesRanges = ["ПО ДНЯМ", "ПО НЕДЕЛЯМ", "ПО МЕСЯЦАМ"] as const

type BreakdownKey = "type" | "territory" | "user" | "product"
const breakdownSections: { key: BreakdownKey; title: string; totalOkb: number }[] = [
  { key: "type", title: "Продажи по типу клиента", totalOkb: 0 },
  { key: "territory", title: "Продажи по территории", totalOkb: 0 },
  { key: "user", title: "Продажи по пользователям", totalOkb: 0 },
  { key: "product", title: "Продажи по типу продукта", totalOkb: 0 },
]

function EmptyBlock({ label }: { label: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col items-center justify-center py-14">
      <Image src="/robot-empty.png" alt={t("Робот-помощник")} width={96} height={96} className="h-24 w-24 object-contain" />
      <p className="mt-3 text-[#9aa3b6]">{t(label)}</p>
    </div>
  )
}

function SortableTh({ label, sortKey, active, onSort }: { label: string; sortKey: string; active: boolean; onSort: (key: string) => void }) {
  const { t } = useLanguage()
  return (
    <th
      role="button"
      tabIndex={0}
      onClick={() => onSort(sortKey)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSort(sortKey) } }}
      className={`cursor-pointer select-none whitespace-nowrap px-4 py-3 text-left font-semibold ${active ? "text-[#4f71dc]" : "text-[#586174]"} hover:text-[#4f71dc]`}
    >
      <span className="inline-flex items-center gap-1.5">{t(label)}<ChevronDown className="h-3.5 w-3.5" /></span>
    </th>
  )
}

export function SalesTabView() {
  const { t } = useLanguage()
  // Branches of the factory itself (never another tenant's names).
  const branches = useDirectoryNames("branches")
  const [period, setPeriod] = useState<Period>("МЕСЯЦ")
  const [metric, setMetric] = useState<(typeof metrics)[number]>("ПРОДАЖИ")
  const [filterActive, setFilterActive] = useState(true)
  const [filterLabel, setFilterLabel] = useState("Все филиалы")
  const [filterEditOpen, setFilterEditOpen] = useState(false)
  const [salesRange, setSalesRange] = useState<(typeof salesRanges)[number]>("ПО ДНЯМ")
  const [sortState, setSortState] = useState<Record<BreakdownKey, string | null>>({ type: null, territory: null, user: null, product: null })

  const sortBy = (key: BreakdownKey, column: string) => {
    setSortState((current) => ({ ...current, [key]: current[key] === column ? null : column }))
  }

  return (
    <ReportPage>
      <WidgetHeader active="ПРОДАЖА" />
      <WidgetUserCard period={period} onPeriod={(value) => setPeriod(value as Period)} />


      <section className="mx-[30px] mt-[20px] flex flex-wrap items-center gap-[1px]">
        {metrics.map((item) => (
          <button
            key={item}
            onClick={() => setMetric(item)}
            className={`h-[30px] rounded-[3px] px-[22px] text-[13px] font-medium uppercase shadow-[0_1px_3px_rgba(0,0,0,0.12)] ${metric === item ? "bg-[#2bcd53] text-white" : "bg-white text-black hover:bg-[#f2f5f8]"}`}
          >
            {t(item)}
          </button>
        ))}
        {filterActive && (
          <div className="relative ml-auto flex h-[46px] items-stretch gap-[1px] text-[13px] text-[#555]">
            <span className="flex items-center bg-[#e8e8e8] px-[28px]">{t("Фильтр: 1 элемента")}</span>
            <button type="button" onClick={() => setFilterEditOpen((value) => !value)} aria-label={t("Изменить фильтр")} className="flex w-[48px] items-center justify-center bg-[#e8e8e8]"><Pencil className="h-5 w-5 text-[#586174] hover:text-[#4f71dc]" /></button>
            <button type="button" aria-label={t("Очистить фильтр")} onClick={() => setFilterActive(false)} className="flex w-[46px] items-center justify-center bg-[#e8e8e8]"><X className="h-5 w-5 rounded-full border border-[#586174] p-0.5 text-[#586174] hover:text-[#e5484d]" /></button>
            {filterEditOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-64 border border-[#e1e5eb] bg-white p-4 shadow-xl">
                <label className="block text-xs font-medium text-[#586174]">
                  {t("Филиал")}
                  <select value={filterLabel} onChange={(event) => setFilterLabel(event.target.value)} className="mt-1 block w-full border-b border-[#dbe0e8] bg-white py-2 text-sm outline-none">
                    <option value="Все филиалы">{t("Все филиалы")}</option>
                    {branches.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setFilterEditOpen(false)} className="mt-4 w-full rounded bg-[#5470e8] py-2 text-sm font-semibold text-white">{t("Применить")}</button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mx-[30px] mt-[20px] grid grid-cols-1 gap-[16px] sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-h-[410px] rounded-[12px] bg-white p-[20px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          <h3 className="mb-4 text-[16px] font-semibold">{t("Продажи по территории")}</h3>
        </div>
        <div className="min-h-[410px] rounded-[12px] bg-white p-[20px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          <h3 className="mb-4 text-[16px] font-semibold">{t("Продажи по пользователям")}</h3>
        </div>
        <div className="min-h-[410px] rounded-[12px] bg-white p-[20px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          <h3 className="mb-4 text-[16px] font-semibold">{t("Продажи по типу продукта")}</h3>
        </div>
      </section>

      <section className="mx-[30px] mt-[16px] rounded-[12px] bg-white p-[20px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[18px] font-semibold">{t("Продажа")}</h2>
          <div className="flex items-center gap-6">
            <div className="flex overflow-hidden rounded-sm">
              {salesRanges.map((item) => (
                <button key={item} onClick={() => setSalesRange(item)} className={`h-[30px] border px-[16px] text-[13px] font-medium uppercase ${salesRange === item ? "border-[#2bcd53] bg-[#2bcd53] text-white" : "border-[#e8e8e8] bg-white text-black"}`}>{t(item)}</button>
              ))}
            </div>
            <h2 className="text-[18px] font-semibold">{t("По типам оплаты")}</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <EmptyBlock label="Ничего не найдено" />
          <EmptyBlock label="Ничего не найдено" />
        </div>
        <div className="relative mt-6 h-[170px]">
          {[5, 4, 3, 2, 1, 0].map((tick, index) => (
            <div key={tick} className="absolute left-0 right-[24px] border-t border-[#e8ecf1]" style={{ top: index * 30 }}>
              <span className="absolute -top-[8px] -right-[24px] w-[20px] text-[11px] text-[#777]">{tick}</span>
            </div>
          ))}
        </div>
      </section>

      {breakdownSections.map((section) => (
        <section key={section.key} className="mx-[30px] mt-[20px]">
          <h2 className="mb-[10px] text-[18px] font-semibold">{t(section.title)}</h2>
          <div className="grid grid-cols-1 overflow-hidden rounded-[12px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] lg:grid-cols-[3fr_1fr]">
            <div className="min-h-[360px]">
              <table className="w-full border-collapse text-[13px]">
                <thead className="bg-[#f2f5f8]">
                  <tr>
                    <SortableTh label="Название" sortKey="name" active={sortState[section.key] === "name"} onSort={(key) => sortBy(section.key, key)} />
                    <SortableTh label="ОКБ" sortKey="okb" active={sortState[section.key] === "okb"} onSort={(key) => sortBy(section.key, key)} />
                    <SortableTh label="АКБ" sortKey="akb" active={sortState[section.key] === "akb"} onSort={(key) => sortBy(section.key, key)} />
                    <SortableTh label="Индекс АКБ" sortKey="index" active={sortState[section.key] === "index"} onSort={(key) => sortBy(section.key, key)} />
                    <SortableTh label="Продажи" sortKey="sales" active={sortState[section.key] === "sales"} onSort={(key) => sortBy(section.key, key)} />
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={5}><EmptyBlock label="Нет данных" /></td></tr>
                </tbody>
                <tfoot>
                  <tr className="border-t border-[#e1e5eb] font-semibold">
                    <td className="px-4 py-3">{t("Итого")}</td>
                    <td className="px-4 py-3">{section.totalOkb}</td>
                    <td className="px-4 py-3">0</td>
                    <td className="px-4 py-3">0 %</td>
                    <td className="px-4 py-3">0</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex flex-col items-center justify-center text-center">
              <span className="text-[12px] font-bold">0</span>
              <span className="text-[10px] lowercase text-[#555]">{t("итого")}</span>
            </div>
          </div>
        </section>
      ))}
    </ReportPage>
  )
}
