"use client"

import Image from "next/image"
import { Filter, Star, X } from "lucide-react"
import { useMemo, useState } from "react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useDirectoryNames } from "@/components/clients/use-directory"

// Agents and client types come from the factory's own directories; visits
// have no data source yet, so every counter is 0 and the list stays empty.
const equipmentStores = ["Все магазины", "С оборудованием", "Без оборудования"]

function inputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function monthStart() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth(), 1))
}

function monthEnd() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth() + 1, 0))
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-")
  const months = ["", "янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
  return `${day} ${months[Number(month)]} ${year}`
}

export function ActivityView() {
  const agents = useDirectoryNames("employees")
  const clientTypes = ["Все типы клиентов", ...useDirectoryNames("clientTypes")]
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [draftFrom, setDraftFrom] = useState(monthStart)
  const [draftTo, setDraftTo] = useState(monthEnd)
  const [clientType, setClientType] = useState("Все типы клиентов")
  const [equipmentStore, setEquipmentStore] = useState(equipmentStores[0])
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  function applyFilters() {
    setFrom(draftFrom)
    setTo(draftTo)
    setFilterOpen(false)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-300 px-5 py-4 sm:px-10">
        <div className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
          <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
          <span className="text-slate-500">|</span>
          <h1 className="text-slate-600">Активность</h1>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <strong className="text-[#5470e8]">
            {formatDate(from)} - {formatDate(to)}
          </strong>
          <button type="button" onClick={() => setFilterOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-[#5470e8] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <Filter className="h-5 w-5" />
            Показать фильтр
          </button>
        </div>
      </header>

      <section className="overflow-x-auto border-b border-slate-300 bg-white px-5 py-4 sm:px-10">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setSelectedAgent(null)}
            className={`flex w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-md border py-3 ${selectedAgent === null ? "border-[#5470e8] bg-[#eef1fd]" : "border-slate-200"}`}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-300 text-white">
              <Star className="h-5 w-5" />
            </span>
            <span className="font-semibold text-slate-700">Все</span>
            <span className="text-slate-500">0</span>
          </button>
          {agents.map((agent) => (
            <button
              key={agent}
              type="button"
              onClick={() => setSelectedAgent(agent)}
              className={`w-40 shrink-0 rounded-md border px-3 py-3 text-left ${selectedAgent === agent ? "border-[#5470e8] bg-[#eef1fd]" : "border-slate-200"}`}
            >
              <p className="mb-2 truncate font-semibold text-slate-800">{agent}</p>
              <div className="flex h-7 items-center justify-center rounded bg-[#5470e8] font-semibold text-white">0</div>
              <p className="mt-1 text-center text-slate-500">0 SUM</p>
            </button>
          ))}
        </div>
      </section>

      <section className="flex min-h-[420px] flex-col items-center justify-center gap-4 py-12">
        <Image src="/robot-empty.png" alt="Робот-помощник" width={150} height={150} priority className="h-36 w-36 object-contain" />
        <p className="text-lg text-slate-400">По вашему запросу ничего не найдено...</p>
      </section>

      {filterOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" onMouseDown={() => setFilterOpen(false)}>
          <section onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" className="w-full max-w-sm rounded bg-white p-7 shadow-2xl">
            <header className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Фильтр</h2>
              <button type="button" onClick={() => setFilterOpen(false)} aria-label="Закрыть" className="rounded-full border border-slate-300 p-1 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="space-y-6">
              <label className="block">
                <span className="mb-2 block font-semibold text-slate-800">Дата</span>
                <div className="flex items-center gap-2 border-b border-slate-300 pb-2">
                  <input type="date" value={draftFrom} max={draftTo} onChange={(event) => setDraftFrom(event.target.value)} className="w-full bg-transparent text-sm outline-none" />
                  <span className="text-slate-400">-</span>
                  <input type="date" value={draftTo} min={draftFrom} onChange={(event) => setDraftTo(event.target.value)} className="w-full bg-transparent text-sm outline-none" />
                </div>
              </label>
              <label className="relative block border-b border-slate-300 pb-2">
                <span className="mb-2 block font-semibold text-slate-800">Тип клиента</span>
                <select value={clientType} onChange={(event) => setClientType(event.target.value)} className="block w-full appearance-none bg-transparent text-sm outline-none">
                  {clientTypes.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="relative block border-b border-slate-300 pb-2">
                <span className="mb-2 block font-semibold text-slate-800">Магазин с оборудованием</span>
                <select value={equipmentStore} onChange={(event) => setEquipmentStore(event.target.value)} className="block w-full appearance-none bg-transparent text-sm outline-none">
                  {equipmentStores.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={applyFilters} className="rounded bg-[#5d6474] px-6 py-3 font-semibold uppercase text-white hover:brightness-95">
                Применить
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
