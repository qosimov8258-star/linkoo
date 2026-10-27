"use client"

import Image from "next/image"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useMemo, useState } from "react"
import { useLanguage } from "@/lib/i18n/language-context"

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
  const { t } = useLanguage()
  const [shifts] = useState(seed)
  const [query, setQuery] = useState("")

  const rows = useMemo(
    () => shifts.filter((shift) => shift.name.toLowerCase().includes(query.toLowerCase()) || shift.user.toLowerCase().includes(query.toLowerCase())),
    [shifts, query],
  )

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="flex h-[60px] flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
            <span className="mx-[11px] inline-block h-[21px] w-[2px] bg-[#5d6474]" /> {t("Смена")}
          </h1>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-3 pr-10 outline-none focus:border-[#4f71dc]" />
            <Search className="absolute right-2 top-3 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {rows.length ? 1 : 0} - {rows.length} {t("из")} {rows.length}
          </span>
          <ChevronLeft className="h-5 w-5 text-slate-300" />
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-4 text-[13px]">{t("Смена")}</th>
              <th className="px-5 py-4 text-[13px]">{t("Пользователь")}</th>
              <th className="px-5 py-4 text-[13px]">{t("Дата создания")}</th>
              <th className="px-5 py-4 text-[13px]">{t("В начале")}</th>
              <th className="px-5 py-4 text-[13px]">{t("Пришло")}</th>
              <th className="px-5 py-4 text-[13px]">{t("Расход")}</th>
              <th className="px-5 py-4 text-[13px]">{t("Ожидается")}</th>
              <th className="px-5 py-4 text-[13px]">{t("Фактически")}</th>
              <th className="px-5 py-4 text-[13px]">{t("Разнится")}</th>
              <th className="px-5 py-4 text-[13px]">{t("Дата закрытия")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((shift) => (
              <tr key={shift.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{shift.name}</td>
                <td className="px-5 py-4">{shift.user}</td>
                <td className="px-5 py-4">{shift.createdAt}</td>
                <td className="px-5 py-4">{formatSum(shift.opening)}</td>
                <td className="px-5 py-4">{formatSum(shift.income)}</td>
                <td className="px-5 py-4">{formatSum(shift.expense)}</td>
                <td className="px-5 py-4">{formatSum(shift.expected)}</td>
                <td className="px-5 py-4">{formatSum(shift.actual)}</td>
                <td className={`px-5 py-4 ${shift.difference < 0 ? "text-red-500" : shift.difference > 0 ? "text-[#71ce87]" : ""}`}>{formatSum(shift.difference)}</td>
                <td className="px-5 py-4">{shift.closedAt || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="flex min-h-[340px] flex-col items-center justify-center gap-4 py-10">
            <Image src="/robot-empty.png" alt={t("Робот-помощник")} width={150} height={150} priority className="h-36 w-36 object-contain" />
            <p className="text-lg text-slate-400">{t("По вашему запросу ничего не найдено")}</p>
          </div>
        )}
      </section>
    </main>
  )
}
