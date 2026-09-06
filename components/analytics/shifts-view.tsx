"use client"

import Image from "next/image"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useMemo, useState } from "react"

type Shift = {
  id: number
  name: string
  user: string
  createdAt: string
  opening: number
  income: number
  expense: number
  expected: number
  actual: number
  difference: number
  closedAt: string
}

const seed: Shift[] = []

function formatSum(value: number) {
  return `${new Intl.NumberFormat("ru-RU").format(value)} SUM`
}

export function ShiftsView({ embedded = false }: { embedded?: boolean }) {
  const [shifts] = useState(seed)
  const [query, setQuery] = useState("")

  const rows = useMemo(
    () => shifts.filter((shift) => shift.name.toLowerCase().includes(query.toLowerCase()) || shift.user.toLowerCase().includes(query.toLowerCase())),
    [shifts, query],
  )

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
            <span className="mx-2 text-slate-400">|</span> Смена
          </h1>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-3 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-3 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            1 - {rows.length} из {rows.length}
          </span>
          <ChevronLeft className="h-5 w-5 text-slate-300" />
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">Смена</th>
              <th className="px-5 py-5">Пользователь</th>
              <th className="px-5 py-5">Дата создания</th>
              <th className="px-5 py-5">В начале</th>
              <th className="px-5 py-5">Пришло</th>
              <th className="px-5 py-5">Расход</th>
              <th className="px-5 py-5">Ожидается</th>
              <th className="px-5 py-5">Фактически</th>
              <th className="px-5 py-5">Разнится</th>
              <th className="px-5 py-5">Дата закрытия</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((shift) => (
              <tr key={shift.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4 text-[#4f70e7]">{shift.name}</td>
                <td className="px-5 py-4">{shift.user}</td>
                <td className="px-5 py-4">{shift.createdAt}</td>
                <td className="px-5 py-4">{formatSum(shift.opening)}</td>
                <td className="px-5 py-4">{formatSum(shift.income)}</td>
                <td className="px-5 py-4">{formatSum(shift.expense)}</td>
                <td className="px-5 py-4">{formatSum(shift.expected)}</td>
                <td className="px-5 py-4">{formatSum(shift.actual)}</td>
                <td className={`px-5 py-4 ${shift.difference < 0 ? "text-red-500" : shift.difference > 0 ? "text-[#6ccd8b]" : ""}`}>{formatSum(shift.difference)}</td>
                <td className="px-5 py-4">{shift.closedAt || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="flex min-h-[340px] flex-col items-center justify-center gap-4 py-10">
            <Image src="/robot-mascot.png" alt="Робот-помощник" width={150} height={150} priority className="h-36 w-36 object-contain" />
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>
    </main>
  )
}
