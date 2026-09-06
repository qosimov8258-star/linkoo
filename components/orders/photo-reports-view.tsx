"use client"

import { Download, Filter, Search, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
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

  return <main className="min-h-screen bg-slate-100 text-slate-800">
    <header className="flex items-center justify-between bg-slate-50 px-10 py-4">
      <h1 className="text-[27px] font-bold text-slate-600"><FavoritesButton className="text-[#5271df]" /> <span className="font-normal">|</span> {t("Фотоотчеты")}</h1>
      <button onClick={download} className="rounded-md bg-[#70cf84] px-5 py-2.5 font-semibold text-white"><Download className="mr-2 inline h-5"/>{t("Скачать Excel")}</button>
    </header>
    <section className="mx-9 mt-1 overflow-hidden rounded-t-lg bg-white shadow-sm">
      <div className="grid grid-cols-4 border-b">{tabs.map((item) => <button key={item} onClick={() => setTab(item)} className={`py-4 text-[17px] ${tab === item ? "border-b-4 border-[#586ce8]" : ""}`}>{t(item)}</button>)}</div>
      <div className="flex h-16 items-center gap-5 px-3">
        <button onClick={() => setFilterOpen(true)} className="rounded-md bg-[#5271df] px-4 py-3 font-semibold text-white"><Filter className="mr-2 inline h-4"/>{t("Фильтр")} / {applied ? 1 : 1}</button>
        <span className="font-medium text-[#5271df]">01.08.2026 - 31.08.2026</span>
        <div className="relative mx-auto w-80"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 outline-none"/><Search className="absolute right-1 top-2 text-slate-400"/></div>
        <span>{t("Фотоотчеты")}: <b>{query ? 0 : 0} {t("шт")}</b></span>
      </div>
    </section>
    {filterOpen && <FilterDialog close={() => setFilterOpen(false)} apply={() => { setApplied(true); setFilterOpen(false) }} />}
  </main>
}

function FilterDialog({ close, apply }: { close: () => void; apply: () => void }) {
  const { t } = useLanguage()
  return <div className="fixed inset-0 z-[100] bg-black/20 p-8 pt-20"><section className="mx-auto max-w-[1840px] bg-white p-10 shadow-2xl"><div className="mb-10 flex justify-between"><h2 className="text-xl font-semibold">{t("Фильтр")}</h2><button onClick={close} aria-label={t("Закрыть")}><X className="h-7 w-7 text-slate-500"/></button></div><div className="grid grid-cols-4 gap-x-6 gap-y-10"><label className="text-sm">{t("Дата создания")}<input defaultValue="01 авг. 2026 - 31 авг. 2026" className="mt-2 block w-full border-b p-2 text-base outline-none"/></label>{fields.map((field) => <label key={field} className="pt-5 font-semibold">{t(field)}<select className="mt-2 block w-full border-b bg-white p-2 font-normal outline-none"><option>{t("Все")}</option><option>{t("Не указано")}</option></select></label>)}</div><button onClick={apply} className="mt-6 w-full rounded-md bg-[#70cf84] py-3 font-semibold text-white">{t("Применить")}</button></section></div>
}
