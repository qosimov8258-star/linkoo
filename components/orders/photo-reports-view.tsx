"use client"

import { Download, Filter, Search, X } from "lucide-react"
import { RefHeader, RefPage, RefTabs } from "@/components/ref/list-kit"
import { useState } from "react"
import { useLanguage } from "@/lib/i18n/language-context"

const tabs = ["Ожидает", "Не принят", "Принят", "Все"] as const

const fields = ["Супервайзер", "Создал", "Бренд", "Категория фотоотчета", "Филиалы", "Категория канала", "Тип клиента", "Магазин", "ИНН магазина", "Магазин с оборудованием"]

export function PhotoReportsView() {
  const { t } = useLanguage()
  const [tab, setTab] = useState<(typeof tabs)[number]>("Все")
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [applied, setApplied] = useState(false)

  function download() {
    const blob = new Blob(["Статус,Дата,Фотоотчеты\n" + `${tab},01.08.2026 - 31.08.2026,0\n`], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "fotootchety.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return <RefPage>
    <RefHeader title={t("Фотоотчеты")}>
      <button onClick={download} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95"><Download className="h-4 w-4"/>{t("Скачать Excel")}</button>
    </RefHeader>
    <section className="overflow-hidden bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <RefTabs labels={[...tabs]} value={tab} onChange={(value) => setTab(value as (typeof tabs)[number])} />
      <div className="flex h-[50px] items-center gap-5 px-[10px]">
        <button onClick={() => setFilterOpen(true)} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95"><Filter className="h-4 w-4"/>{t("Фильтр")} / {applied ? 1 : 1}</button>
        <span className="text-[12px] font-bold text-[#4f71dc]">01.10.2026 - 31.10.2026</span>
        <div className="relative mx-auto w-[260px]"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-[#d0d0d0] py-1 text-[13px] outline-none"/><Search className="absolute right-1 top-1 h-4 w-4 text-slate-400"/></div>
        <span className="text-[13px]">{t("Фотоотчеты")}: <b>{query ? 0 : 0} {t("шт")}</b></span>
      </div>
    </section>
    {filterOpen && <FilterDialog close={() => setFilterOpen(false)} apply={() => { setApplied(true); setFilterOpen(false) }} />}
  </RefPage>
}

function FilterDialog({ close, apply }: { close: () => void; apply: () => void }) {
  const { t } = useLanguage()
  return <div className="fixed inset-0 z-[100] bg-black/20 p-8 pt-20"><section className="mx-auto max-w-[1840px] bg-white p-10 shadow-2xl"><div className="mb-10 flex justify-between"><h2 className="text-xl font-semibold">{t("Фильтр")}</h2><button onClick={close} aria-label={t("Закрыть")}><X className="h-7 w-7 text-slate-500"/></button></div><div className="grid grid-cols-4 gap-x-6 gap-y-10"><label className="text-sm">{t("Дата создания")}<input defaultValue={t("01 авг. 2026 - 31 авг. 2026")} className="mt-2 block w-full border-b p-2 text-base outline-none"/></label>{fields.map((field) => <label key={field} className="pt-5 font-semibold">{t(field)}<select className="mt-2 block w-full border-b bg-white p-2 font-normal outline-none"><option>{t("Все")}</option><option>{t("Не указано")}</option></select></label>)}</div><button onClick={apply} className="mt-6 w-full rounded-md bg-[#71ce87] py-3 font-semibold text-white">{t("Применить")}</button></section></div>
}
