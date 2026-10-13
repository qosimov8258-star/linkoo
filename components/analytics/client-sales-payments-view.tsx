"use client"

import { FormEvent, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { RI, RefButton, RefEmpty, RefFilterDate, RefFilterSelect, RefHeader, RefPage } from "@/components/ref/list-kit"

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

  const heads = ["Магазин", "Продажа", "Себестоимость продаж", "Возврат", "Себестоимость возврата", "Факт продаж", "Себестоимость факт", "Оплата", "Сумма скидок"]
  return (
    <RefPage>
      <RefHeader title="Продажа и оплата по магазинам">
        <RefButton icon={RI.download} green label="Скачать Excel" onClick={download} />
        <RefButton icon={RI.add} label={saved ? "Добавлено в дашборд" : "Добавить в дашборд"} onClick={() => setDashboardOpen(true)} />
      </RefHeader>

      <form onSubmit={apply} className="bg-white px-[10px] pb-[10px] pt-[8px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="grid gap-x-5 gap-y-6 py-3 md:grid-cols-2 xl:grid-cols-4">
          <RefFilterDate label="Дата от" value={from} max={to} onChange={setFrom} />
          <RefFilterDate label="Дата до" value={to} min={from} onChange={setTo} />
          {(Object.keys(filterOptions) as FilterKey[]).map((key) => (
            <RefFilterSelect key={key} label={labels[key]} value={filters[key]} onChange={(value) => setFilter(key, value)} options={filterOptions[key]} />
          ))}
        </div>
        <button type="submit" className="h-[30px] w-full rounded-[5px] bg-[#71ce87] text-[13px] font-semibold text-white">Применить</button>
      </form>

      {rows.length === 0 ? (
        <RefEmpty text="По вашему запросу ничего не найдено..." />
      ) : (
        <section className="mt-5 overflow-x-auto bg-white">
          <table className="w-full min-w-[1500px] border-collapse">
            <thead className="bg-[#5d6474] text-white">
              <tr>{heads.map((title) => <th key={title} className="text-left">{title}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.store}>
                  <td>{row.store}</td>
                  {[row.sale, row.saleCost, row.returned, row.returnCost, row.sale - row.returned, row.saleCost - row.returnCost, row.payment, row.discount].map((value, index) => <td key={index}>{format(value)}</td>)}
                </tr>
              ))}
              <tr className="font-bold">
                <td>Итого</td>
                {[totals.sale, totals.saleCost, totals.returned, totals.returnCost, totals.sale - totals.returned, totals.saleCost - totals.returnCost, totals.payment, totals.discount].map((value, index) => <td key={index}>{format(value)}</td>)}
              </tr>
            </tbody>
          </table>
        </section>
      )}

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
    </RefPage>
  )
}

const labels: Record<FilterKey, string> = { responsible: "Отв.агент магазина", organization: "Организация", storeType: "Тип магазина", zone: "Зона", branch: "Филиал", column: "Колонка" }
function format(value: number) { return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) }
