"use client"

import { FormEvent, useMemo, useState } from "react"
import { Download, Settings, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type PeriodData = { stores: number; storePercent: number; sum: number; sumPercent: number; dynamic?: number }
type ClassificationRow = { name: string; periods: [PeriodData, PeriodData, PeriodData] }

const initialRows: ClassificationRow[] = []

const selects = {
  zone: ["Все зоны", "Andijon shaharchasi", "Arslan", "chilonzor"],
  status: ["Все статусы", "Активный", "Неактивный"],
  brand: ["Все бренды", "Alpen Gold", "Apple", "Aqua de lux"],
  productType: ["Все типы товара", "Мыло", "Напитки", "Снеки"],
  agent: ["Все ответственные агенты", "Samandar Abdurahmonov", "Хайрулло Доставщик"],
  branch: ["Все филиалы", "777", "878", "Andijon"],
  clientType: ["Все типы клиента", "horeca", "market", "market100"],
  dateBy: ["Доставки", "Заказы", "Оплаты"],
  closing: ["Незакрыто", "Закрыто", "Все"],
}
type SelectKey = keyof typeof selects

export function ClientDynamicsView() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [periods, setPeriods] = useState(["2026-05-01", "2026-06-01", "2026-07-01"])
  const [filters, setFilters] = useState<Record<SelectKey, string>>(
    Object.fromEntries(Object.entries(selects).map(([key, value]) => [key, value[0]])) as Record<SelectKey, string>,
  )
  const [rows, setRows] = useState(initialRows)
  const periodLabels = useMemo(() => periods.map(periodLabel), [periods])

  function apply(event: FormEvent) {
    event.preventDefault()
    setRows(filters.status === "Неактивный" ? initialRows.filter((row) => row.name === "Нет заказа") : initialRows)
  }
  function download() {
    const header = ["Классификация", ...periodLabels.flatMap((label) => [`${label} магазинов`, "%", "Сумма заказа", "%", "Динамика`"])].join(";")
    const body = rows.map((row) => [row.name, ...row.periods.flatMap((item) => [item.stores, item.storePercent, item.sum, item.sumPercent, item.dynamic ?? ""])].join(";"))
    const url = URL.createObjectURL(new Blob([`\uFEFF${[header, ...body].join("\n")}`], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "client-dynamics.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center gap-3 px-5 py-4 text-xl font-bold sm:px-10 sm:text-2xl">
        <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
        <span className="text-slate-500">|</span><h1 className="text-slate-600">Классификация и динамика клиентов</h1>
        <div className="ml-auto flex gap-3">
          <button type="button" onClick={download} className="rounded bg-[#71ce87] px-5 py-2 text-base text-white"><Download className="mr-2 inline h-5 w-5" />Скачать</button>
          <button type="button" onClick={() => setSettingsOpen(true)} className="rounded bg-[#5470e8] px-5 py-2 text-base text-white"><Settings className="mr-2 inline h-5 w-5" />Настроить классификацию</button>
        </div>
      </header>

      <form onSubmit={apply} className="mx-4 rounded bg-white p-6 shadow sm:mx-9">
        <h2 className="mb-8 text-lg text-slate-500">Фильтр</h2>
        <div className="grid gap-x-3 gap-y-8 md:grid-cols-2 xl:grid-cols-4">
          {(["zone", "status", "brand", "productType", "agent", "branch", "clientType", "dateBy", "closing"] as SelectKey[]).map((key) => <Select key={key} name={key} value={filters[key]} onChange={(value) => setFilters((current) => ({ ...current, [key]: value }))} />)}
          {periods.map((value, index) => <label key={index} className="text-xs">{["Первый период", "Второй период", "Третий период"][index]}<input type="month" value={value.slice(0, 7)} onChange={(event) => setPeriods((current) => current.map((item, i) => i === index ? `${event.target.value}-01` : item))} className="mt-1 block w-full border-b py-2 text-base" /></label>)}
        </div>
        <button type="submit" className="mt-7 rounded bg-slate-600 px-6 py-3 font-bold text-white">ФИЛЬТР</button>
      </form>

      <section className="mx-4 mt-3 overflow-hidden bg-white sm:mx-9">
        <table className="w-full table-fixed border-collapse text-[10px] sm:text-xs xl:text-sm">
          <colgroup>
            <col className="w-[10%]" />
            {Array.from({ length: 14 }).map((_, index) => <col key={index} />)}
          </colgroup>
          <thead><tr><th rowSpan={2} className="border px-1 py-4 text-left sm:px-2">Классификация</th>{periodLabels.map((label, index) => <th key={label} colSpan={index === 0 ? 4 : 5} className={`border px-1 py-4 text-center sm:px-2 ${index ? "border-l-2 border-l-slate-800" : ""}`}>{label}</th>)}</tr><tr>{periodLabels.flatMap((_, period) => ["Кол. магазинов", "%", "Сумма заказа", "%", ...(period ? ["Динамика"] : [])].map((title, index) => <th key={`${period}-${index}`} className={`break-words border px-1 py-4 leading-tight sm:px-2 ${period && index === 0 ? "border-l-2 border-l-slate-800" : ""}`}>{title}</th>))}</tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.name}><td className="break-words border px-1 py-5 sm:px-2">{row.name}</td>{row.periods.flatMap((data, period) => [<td key={`${period}-stores`} className={`border px-1 py-5 text-right text-[#5470e8] sm:px-2 ${period ? "border-l-2 border-l-slate-800" : ""}`}>{format(data.stores)}</td>, <td key={`${period}-sp`} className="border px-1 py-5 text-right sm:px-2">{data.storePercent} %</td>, <td key={`${period}-sum`} className="break-words border px-1 py-5 text-right sm:px-2">{format(data.sum)}</td>, <td key={`${period}-sump`} className="border px-1 py-5 text-right sm:px-2">{data.sumPercent} %</td>, ...(period ? [<td key={`${period}-dynamic`} className="border px-1 py-3 text-center sm:px-2"><Dynamic value={data.dynamic ?? 0} /></td>] : [])])}</tr>)}
            <TotalRow periodLabels={periodLabels} />
          </tbody>
        </table>
      </section>

      {settingsOpen && <ClassificationSettings onClose={() => setSettingsOpen(false)} />}
    </main>
  )
}

function TotalRow({ periodLabels }: { periodLabels: string[] }) {
  const totals = [[0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]
  return <tr className="bg-[#555] font-bold text-white"><td className="border p-2">Итого активные<br />клиенты</td>{periodLabels.flatMap((_, period) => totals[period].map((value, index) => index === 4 ? <td key={`${period}-${index}`} className="border p-2 text-center"><Dynamic value={value} /></td> : <td key={`${period}-${index}`} className={`border p-2 text-right ${period && index === 0 ? "border-l-2 border-l-white" : ""}`}>{index === 1 || index === 3 ? `${value} %` : format(value)}</td>))}</tr>
}
function Dynamic({ value }: { value: number }) { const positive = value > 0; return <span className={`inline-block w-full rounded px-0.5 py-2 font-medium sm:px-1 ${positive ? "bg-emerald-100 text-emerald-500" : "bg-rose-100 text-rose-500"}`}>{positive ? "▲" : "▼"} {format(value)} %</span> }
function ClassificationSettings({ onClose }: { onClose: () => void }) {
  const [limits, setLimits] = useState(["1", "2", "3", "5", "10", "20"])
  return <><button type="button" aria-label="Закрыть" onClick={onClose} className="fixed inset-0 z-[90] bg-black/50" /><section role="dialog" className="fixed left-1/2 top-1/2 z-[100] w-[min(700px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 bg-white shadow-2xl"><header className="flex justify-between border-b p-7 text-lg font-bold">Настроить классификацию<button type="button" onClick={onClose}><X /></button></header><div className="p-8"><p className="mb-5 text-slate-500">Границы суммы заказа, млн SUM</p><div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{limits.map((limit, index) => <input key={index} type="number" min="0" value={limit} onChange={(event) => setLimits((current) => current.map((item, i) => i === index ? event.target.value : item))} className="border-b p-2" />)}</div></div><footer className="flex justify-end border-t p-6"><button type="button" onClick={onClose} className="font-bold uppercase text-sky-500">Сохранить</button></footer></section></>
}
const labels: Record<SelectKey, string> = { zone: "Зона", status: "Статус", brand: "Бренд", productType: "Тип товара", agent: "Ответственный агент магазина", branch: "Филиалы", clientType: "Тип клиента", dateBy: "По дате", closing: "Статус закрытия" }
function Select({ name, value, onChange }: { name: SelectKey; value: string; onChange: (value: string) => void }) { return <label className="font-semibold">{labels[name]}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block w-full border-b bg-white py-2 font-normal">{selects[name].map((option) => <option key={option}>{option}</option>)}</select></label> }
function periodLabel(value: string) { const date = new Date(`${value}T00:00:00`); const end = new Date(date.getFullYear(), date.getMonth() + 1, 0); return `01 ${date.toLocaleString("ru-RU", { month: "long" })} ${date.getFullYear()} - ${end.getDate()} ${end.toLocaleString("ru-RU", { month: "long" })} ${end.getFullYear()}` }
function format(value: number) { return value.toLocaleString("ru-RU") }
