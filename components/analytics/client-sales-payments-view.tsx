"use client"

import { FormEvent, useMemo, useState } from "react"
import { Download, PlusCircle } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

const sourceRows: { store: string; sale: number; saleCost: number; returned: number; returnCost: number; payment: number; discount: number }[] = []

const filterOptions = {
  responsible: ["Все агенты", "Samandar Abdurahmonov", "Хайрулло Доставщик"],
  organization: ["Все организации", "Linko", "Time3 Distribution"],
  storeType: ["Все типы магазина", "horeca", "market", "market100"],
  zone: ["Все зоны", "Andijon shaharchasi", "Arslan", "chilonzor"],
  branch: ["Все филиалы", "777", "878", "Andijon", "AURUM samarqand"],
  column: ["Все колонки", "Продажа", "Оплата", "Возврат"],
}

type FilterKey = keyof typeof filterOptions

function iso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function ClientSalesPaymentsView() {
  const now = useMemo(() => new Date(), [])
  const [from, setFrom] = useState(() => iso(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(() => iso(now))
  const [filters, setFilters] = useState<Record<FilterKey, string>>(
    Object.fromEntries(Object.entries(filterOptions).map(([key, value]) => [key, value[0]])) as Record<FilterKey, string>,
  )
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")

  const rows = useMemo(
    () => sourceRows.filter((row) => filters.responsible === filterOptions.responsible[0] || row.store === "Doston market"),
    [filters.responsible],
  )
  const totals = rows.reduce(
    (sum, row) => ({
      sale: sum.sale + row.sale,
      saleCost: sum.saleCost + row.saleCost,
      returned: sum.returned + row.returned,
      returnCost: sum.returnCost + row.returnCost,
      payment: sum.payment + row.payment,
      discount: sum.discount + row.discount,
    }),
    { sale: 0, saleCost: 0, returned: 0, returnCost: 0, payment: 0, discount: 0 },
  )

  function setFilter(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
  }
  function apply(event: FormEvent) {
    event.preventDefault()
  }
  function download() {
    downloadExcelTable("client-sales-payments.xls", [
      ["Магазин", "Продажа", "Себестоимость продаж", "Возврат", "Себестоимость возврата", "Факт продаж", "Себестоимость факт", "Оплата", "Сумма скидок"],
      ...rows.map((row) => [row.store, row.sale, row.saleCost, row.returned, row.returnCost, row.sale - row.returned, row.saleCost - row.returnCost, row.payment, row.discount]),
    ])
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b px-5 py-4 text-xl font-bold sm:px-10 sm:text-2xl">
        <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
        <span className="text-slate-500">|</span><h1 className="text-slate-600">Продажа и оплата по магазинам</h1>
        <div className="ml-auto flex gap-4">
          <button type="button" onClick={download} className="rounded bg-[#6ccd8b] px-5 py-2 text-base text-white"><Download className="mr-2 inline h-5 w-5" />Скачать Excel</button>
          <button type="button" onClick={() => setDashboardOpen(true)} className="rounded bg-[#5470e8] px-5 py-2 text-base text-white"><PlusCircle className="mr-2 inline h-5 w-5" />{saved ? "Добавлено в дашборд" : "Добавить в дашборд"}</button>
        </div>
      </header>

      <form onSubmit={apply} className="bg-white px-4 pb-2 sm:px-10">
        <div className="grid gap-x-5 gap-y-12 py-3 md:grid-cols-2 xl:grid-cols-4">
          <DateField label="Дата от" value={from} max={to} onChange={setFrom} />
          <DateField label="Дата до" value={to} min={from} onChange={setTo} />
          {(Object.keys(filterOptions) as FilterKey[]).map((key) => <SelectField key={key} name={key} value={filters[key]} onChange={(value) => setFilter(key, value)} />)}
        </div>
        <button type="submit" className="w-full rounded bg-[#6ccd8b] py-3 font-bold text-white">Применить</button>
      </form>

      <section className="overflow-x-auto bg-white px-4 pt-3 sm:px-10">
        <table className="min-w-[1900px] w-full border-collapse text-sm">
          <thead className="bg-slate-50"><tr>{["Магазин", "Продажа", "Себестоимость продаж", "Возврат", "Себестоимость возврата", "Факт продаж", "Себестоимость факт", "Оплата", "Сумма скидок"].map((title) => <th key={title} className="border px-4 py-4 text-center text-base">{title} <span className="text-slate-300">↕</span></th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => <tr key={row.store} className={index % 2 ? "bg-slate-50" : "bg-white"}><td className="border px-2 py-4">{row.store}</td>{[row.sale, row.saleCost, row.returned, row.returnCost, row.sale-row.returned, row.saleCost-row.returnCost, row.payment, row.discount].map((value, i) => <td key={i} className="border px-2 py-4 text-right">{format(value)}</td>)}</tr>)}
            <tr className="bg-[#555] font-bold text-white"><td className="border px-2 py-4">Итого</td>{[totals.sale, totals.saleCost, totals.returned, totals.returnCost, totals.sale-totals.returned, totals.saleCost-totals.returnCost, totals.payment, totals.discount].map((value, i) => <td key={i} className="border px-2 py-4 text-right">{format(value)}</td>)}</tr>
          </tbody>
        </table>
        <div className="h-1.5 w-full rounded bg-sky-600" />
      </section>

      {dashboardOpen && <button type="button" aria-label="Закрыть" onClick={() => setDashboardOpen(false)} className="fixed inset-0 z-[90] bg-black/55" />}
      {dashboardOpen && (
        <DashboardDialog
          reportSlug="client-sales-payments"
          reportLabel="Оплаты от клиентов"
          visibility={visibility}
          setVisibility={setVisibility}
          dashboard={dashboard}
          setDashboard={setDashboard}
          onClose={() => setDashboardOpen(false)}
          onSave={() => setSaved(true)}
        />
      )}
    </main>
  )
}

const labels: Record<FilterKey, string> = { responsible: "Отв.агент магазина", organization: "Организация", storeType: "Тип магазина", zone: "Зона", branch: "Филиал", column: "Колонка" }
function SelectField({ name, value, onChange }: { name: FilterKey; value: string; onChange: (value: string) => void }) { return <label className="font-semibold">{labels[name]}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 block w-full border-b bg-white py-2 font-normal">{filterOptions[name].map((item) => <option key={item}>{item}</option>)}</select></label> }
function DateField({ label, value, min, max, onChange }: { label: string; value: string; min?: string; max?: string; onChange: (value: string) => void }) { return <label className="text-xs">{label}<input type="date" value={value} min={min} max={max} onChange={(event) => onChange(event.target.value)} className="mt-1 block w-full border-b py-2 text-base" /></label> }
function format(value: number) { return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) }
