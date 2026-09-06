"use client"

import { ChevronLeft, ChevronRight, Filter, Search } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useMemo, useState } from "react"
import { useLanguage } from "@/lib/i18n/language-context"

type Refusal = { id: number; date: string; agent: string; client: string; reason: string }

const rows: Refusal[] = []

export function RefusalsView() {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [showFilter, setShowFilter] = useState(false)
  const visible = useMemo(() => rows.filter((row) => `${row.id} ${row.client} ${row.agent} ${row.reason}`.toLowerCase().includes(query.toLowerCase())), [query])

  return <main className="min-h-screen bg-slate-100 pb-8 text-slate-800">
    <header className="flex items-center bg-slate-50 px-10 py-4">
      <h1 className="text-[27px] font-bold text-slate-600"><FavoritesButton className="text-[#5271df]" /> <span className="font-normal">|</span> {t("Отказы")}</h1>
    </header>
    <section className="mx-9 mt-1 bg-white shadow">
      <div className="flex min-h-16 items-center gap-5 px-2">
        <button onClick={() => setShowFilter(!showFilter)} className="text-[17px] text-[#5271df]">{t("Показать фильтр")}⌄</button>
        <div className="relative ml-48 w-[380px]"><input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full border-b border-slate-300 px-2 py-2 pr-9 outline-none" placeholder={t("Поиск")}/><Search className="absolute right-1 top-2 text-slate-300"/></div>
        <div className="ml-auto flex items-center gap-5 text-slate-600"><span>25⌄</span><span>1 - {Math.min(25, visible.length)} {t("из")} {visible.length}</span><ChevronLeft className="rounded-full border"/><ChevronRight className="rounded-full border"/></div>
      </div>
      {showFilter && <div className="grid grid-cols-4 gap-5 border-t bg-slate-50 px-6 py-4 text-sm"><label>{t("Агент")}<input className="mt-2 block w-full border-b bg-transparent p-2" placeholder={t("Все агенты")}/></label><label>{t("Клиент")}<input className="mt-2 block w-full border-b bg-transparent p-2" placeholder={t("Все клиенты")}/></label><label>{t("Причина")}<input className="mt-2 block w-full border-b bg-transparent p-2" placeholder={t("Все причины")}/></label><button onClick={() => setQuery("")} className="mt-5 h-10 rounded bg-[#5271df] px-5 font-semibold text-white"><Filter className="mr-2 inline h-4"/>{t("Сбросить")}</button></div>}
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left"><thead className="bg-[#626b7e] text-white"><tr>{["№", "Дата создания", "Агент", "Клиент", "Причина"].map((title) => <th key={title} className="px-9 py-4 text-[17px]">{t(title)}</th>)}</tr></thead><tbody>{visible.map((row) => <tr key={row.id} className="border-b-2 border-dotted border-slate-200 hover:bg-blue-50"><td className="px-9 py-4">{row.id}</td><td className="px-9">{row.date}</td><td className="px-9">{row.agent}</td><td className="px-9">{row.client}</td><td className="px-9">{row.reason}</td></tr>)}</tbody></table></div>
    </section>
  </main>
}
