"use client"

import { useMemo, useState } from "react"

const tabs = ["Приемка", "Передача", "Движение товаров", "История Приемки", "История Передачи"] as const

const rows = [
  ["sndwch", "-22 sht", "-", "13 июля 2026, 16:17", "Andijon skladi", "Заказ 1582"],
  ["robot moshina", "213 dona", "-", "10 июля 2026, 09:43", "Andijon skladi", "Поставка 351"],
  ["robot moshina", "1 dona", "-", "10 июля 2026, 09:43", "Andijon skladi", "Поставка 351"],
  ["sndwch", "-1 sht", "-", "24 июня 2026, 16:21", "05,08,2025(1)", "Списание 69"],
  ["Arslan 111111", "1 Dona", "-", "23 июня 2026, 10:00", "Andijon skladi", "Поставка 349"],
  ["g'ilof", "10 шт", "-", "14 мая 2026, 13:20", "05,08,2025(1)", "Поставка 348"],
  ["test inventar", "1 dona", "-", "14 мая 2026, 13:12", "toshkent", "Инвентаризация 27"],
  ["Nataxtari 0.25", "6 Dona", "-", "09 мая 2026, 09:45", "05,08,2025(1)", "Инвентаризация 219"],
  ["spark123", "-1 шт", "-", "08 мая 2026, 16:13", "Andijon skladi", "Заказ 1572"],
]

export function GoodsMovementView() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Движение товаров")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)

  const filtered = useMemo(
    () => rows.filter((row) => row.join(" ").toLowerCase().includes(query.toLowerCase())),
    [query],
  )

  const download = () => {
    const body = [["Товар", "Кол-во", "Серия", "Дата", "Склад", "Тип"], ...filtered]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";"))
      .join("\r\n")
    const blob = new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8" })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = "dvizhenie-tovarov.csv"
    anchor.click()
    URL.revokeObjectURL(href)
  }

  return (
    <section className="min-h-[calc(100vh-64px)] bg-[#f2f5f9] p-4 text-[#18233a] md:p-9">
      <h1 className="mb-5 text-2xl font-semibold text-[#566074]">★ <span className="text-[#4f70e7]">Избранные</span> | План приемок и передач</h1>
      <div className="overflow-hidden rounded-sm bg-white shadow">
        <div className="grid grid-cols-2 md:grid-cols-5">
          {tabs.map((item) => (
            <button key={item} onClick={() => setTab(item)} className={`h-16 border-b-4 px-3 text-base ${tab === item ? "border-[#5574e7]" : "border-transparent"}`}>
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-6 rounded-sm bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-4 p-2">
          <button onClick={() => setFilterOpen((value) => !value)} className="text-[#5574e7]">Показать фильтр⌄</button>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-96 max-w-full border-b px-2 py-3 outline-none" />
          <div className="flex items-center gap-5 text-[#566074]"><span>25</span><span>1 - {filtered.length} из {filtered.length}</span><button onClick={download} aria-label="Скачать" className="text-2xl">⇩</button></div>
        </div>

        {filterOpen && (
          <div className="absolute left-0 top-14 z-20 w-[390px] max-w-[95vw] bg-white p-6 shadow-xl">
            <div className="mb-10 flex justify-between text-xl text-[#566074]"><span>Фильтр</span><button onClick={() => setFilterOpen(false)}>⊗</button></div>
            {["Тип продукта", "Тип", "Товар", "Склад", "Статус"].map((label) => <button key={label} className="flex w-full justify-between border-b py-4 font-medium"><span>{label}</span><span>▾</span></button>)}
            <label className="mt-5 block text-xs">Период</label><input defaultValue="01 июля 2026 - 31 июля 2026" className="w-full border-b py-2" />
            <button onClick={() => setFilterOpen(false)} className="mt-6 rounded bg-[#626c80] px-5 py-3 text-white">ПРИМЕНИТЬ</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] border-collapse text-left">
            <thead><tr className="bg-[#626b7d] text-white">{["Товар", "Кол-во", "Серия", "Дата", "Склад", "Тип"].map((heading) => <th key={heading} className="px-10 py-5">{heading}</th>)}</tr></thead>
            <tbody>{filtered.map((row, index) => <tr key={`${row[0]}-${index}`} className="border-b border-dashed even:bg-[#f3f6f9]">{row.map((cell, cellIndex) => <td key={cellIndex} className={`px-10 py-5 ${cellIndex === 0 ? (String(row[1]).startsWith("-") ? "before:mr-2 before:text-red-400 before:content-['↑']" : "before:mr-2 before:text-green-500 before:content-['↓']") : ""}`}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default GoodsMovementView
