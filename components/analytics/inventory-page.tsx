"use client"

import { Fragment, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Download, MinusCircle, Pencil, Plus, Search, Trash2, X } from "lucide-react"

type Status = "Подтвержденный" | "В ожидании" | "Отменен"
type Inventory = { id: number; warehouse: string; author: string; date: string; comment: string; status: Status; amount: string }

const warehouses = ["05,08,2025(1)", "Andijon skladi", "ПРОФРЕШ", "123 test", "878", "Herat", "Chinobod sklad"]
const dates = ["14 мая 2026", "22 апр. 2026", "11 апр. 2026", "06 апр. 2026", "16 мар. 2026", "26 февр. 2026", "24 янв. 2026"]
const amounts = ["205,22", "10 000", "-18 499,424", "171 868,51", "-511 764,994", "24 465,453", "1 023 529,988"]

function makeRows(): Inventory[] {
  return Array.from({ length: 104 }, (_, index) => {
    const id = 132 - index
    const status: Status = index % 7 === 6 ? "Отменен" : index % 3 === 1 ? "В ожидании" : "Подтвержденный"
    return {
      id,
      warehouse: warehouses[index % warehouses.length],
      author: "Admin Ritm",
      date: dates[index % dates.length],
      comment: index === 22 ? "3000 ta tovar qani ?" : "Комментариев нет",
      status,
      amount: index % 11 === 9 ? "-205 105 738,756" : amounts[index % amounts.length],
    }
  })
}

const statusColor: Record<Status, string> = {
  "Подтвержденный": "bg-[#77c98b]",
  "В ожидании": "bg-[#f1aa42]",
  "Отменен": "bg-[#e96c70]",
}

export function InventoryPage() {
  const [rows, setRows] = useState<Inventory[]>(makeRows)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<number | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [warehouse, setWarehouse] = useState("Все склады")
  const [status, setStatus] = useState<Status | "Все статусы">("Все статусы")

  const filtered = useMemo(() => rows.filter((row) => {
    const matchesQuery = `${row.id} ${row.warehouse} ${row.author} ${row.comment} ${row.status}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (warehouse === "Все склады" || row.warehouse === warehouse) && (status === "Все статусы" || row.status === status)
  }), [rows, query, warehouse, status])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  function downloadExcel() {
    const body = filtered.map((r) => `<tr><td>${r.id}</td><td>${r.warehouse}</td><td>${r.author}</td><td>${r.date}</td><td>${r.comment}</td><td>${r.status}</td><td>${r.amount}</td></tr>`).join("")
    const html = `<html><meta charset="utf-8"><table><tr><th>№</th><th>Склад</th><th>Создал</th><th>Дата создания</th><th>Комментарий</th><th>Статус</th><th>Сумма</th></tr>${body}</table></html>`
    const url = URL.createObjectURL(new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" }))
    const link = document.createElement("a"); link.href = url; link.download = "inventory.xls"; link.click(); URL.revokeObjectURL(url)
  }

  function addInventory() {
    setRows((current) => [{ id: Math.max(...current.map((r) => r.id)) + 1, warehouse: warehouse === "Все склады" ? warehouses[0] : warehouse, author: "Admin Ritm", date: "01 авг. 2026", comment: "Комментариев нет", status: "В ожидании", amount: "0" }, ...current])
    setAddOpen(false); setPage(1)
  }

  return <div className="min-h-[calc(100vh-64px)] bg-[#f1f4f8] text-[#17233d]">
    <div className="flex items-center justify-between border-b border-slate-200 px-9 py-4">
      <h1 className="text-[26px] font-semibold text-[#586174]"><span className="mr-2 text-[#596275]">★</span><span className="text-[#4e70e7]">Избранные</span><span className="mx-3 text-[#596275]">|</span>Инвентаризация</h1>
      <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-md bg-[#6dce8b] px-5 py-2.5 font-semibold text-white shadow"><Plus size={20}/>Добавить</button>
    </div>

    <div className="m-9 mt-0 overflow-hidden rounded-sm bg-white shadow">
      <div className="flex items-center gap-6 px-2 py-3">
        <button onClick={() => setFilterOpen(!filterOpen)} className="text-[#4f70e7]">Показать фильтр⌄</button>
        <label className="relative ml-auto mr-auto w-96"><input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 px-1 py-2 outline-none"/><Search className="absolute right-1 top-2 text-slate-300"/></label>
        <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="bg-transparent outline-none"><option>25</option><option>50</option><option>100</option></select>
        <span className="text-slate-500">{filtered.length ? (page - 1) * pageSize + 1 : 0} - {Math.min(page * pageSize, filtered.length)} из {filtered.length}</span>
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="text-slate-400"/></button>
        <button disabled={page === pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="text-slate-500"/></button>
        <button onClick={downloadExcel} title="Скачать Excel"><Download className="text-slate-600"/></button>
      </div>

      {filterOpen && <div className="absolute z-30 ml-2 w-[390px] rounded bg-white p-6 shadow-2xl">
        <div className="mb-7 flex justify-between text-xl text-slate-500">Фильтр<button onClick={() => setFilterOpen(false)}><X/></button></div>
        <label className="mb-5 block font-medium">Склад<select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="mt-2 w-full border-b py-2 font-normal"><option>Все склады</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select></label>
        <label className="mb-7 block font-medium">Статус<select value={status} onChange={(e) => setStatus(e.target.value as Status | "Все статусы")} className="mt-2 w-full border-b py-2 font-normal"><option>Все статусы</option><option>Подтвержденный</option><option>В ожидании</option><option>Отменен</option></select></label>
        <button onClick={() => { setFilterOpen(false); setPage(1) }} className="rounded bg-[#626d82] px-6 py-3 text-white shadow">ПРИМЕНИТЬ</button>
      </div>}

      <div className="overflow-x-auto"><table className="w-full min-w-[1250px] border-collapse text-left">
        <thead className="bg-[#626b7e] text-white"><tr>{["№", "Склад", "Создал", "Дата создания", "Комментарий", "Статус", "Сумма"].map((h) => <th key={h} className="px-9 py-5 font-semibold">{h}</th>)}</tr></thead>
        <tbody>{visible.map((row) => <Fragment key={row.id}>
          <tr onClick={() => setSelected(selected === row.id ? null : row.id)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-blue-50">
            <td className="px-9 py-5">{row.id}</td><td className="px-9 py-5">{row.warehouse}</td><td className="px-9 py-5">{row.author}</td><td className="px-9 py-5">{row.date}</td><td className="px-9 py-5">{row.comment}</td>
            <td className="px-9 py-5"><span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${statusColor[row.status]}`}/>{row.status}</td><td className="px-9 py-5">{row.amount}</td>
          </tr>
          {selected === row.id && <tr><td colSpan={7} className="bg-[#f2f5f8] p-4"><div className="rounded bg-white shadow-lg">
            <div className="flex items-center border-b px-9 py-5"><strong className="text-xl">{row.author}</strong><div className="ml-auto flex gap-5"><button><Pencil className="text-slate-400"/></button><button onClick={downloadExcel} className="flex items-center gap-2 rounded bg-[#67cc87] px-5 py-2 text-white"><Download size={18}/>Скачать Excel</button><button className="flex items-center gap-2 rounded bg-[#fa8077] px-5 py-2 text-white"><MinusCircle size={18}/>Отменить</button><button onClick={() => { setRows((r) => r.filter((x) => x.id !== row.id)); setSelected(null) }}><Trash2 className="text-slate-500"/></button></div></div>
            <div className="grid grid-cols-[420px_1fr]">
              <dl className="grid grid-cols-2 gap-y-3 border-r p-9 text-slate-600"><dt>Тип:</dt><dd className="text-right font-semibold">По факту проведения</dd><dt>Склад:</dt><dd className="text-right font-semibold">{row.warehouse}</dd><dt>Статус:</dt><dd className="text-right font-semibold">{row.status}</dd><dt>Дата создания:</dt><dd className="text-right font-semibold">{row.date}</dd><dt>Время:</dt><dd className="text-right font-semibold">На начало дня</dd><dt>Комментарий:</dt><dd className="text-right font-semibold">{row.comment}</dd></dl>
              <div className="p-9"><div className="grid grid-cols-6 border-b pb-4 font-semibold"><span>Наименование</span><span>Серия</span><span>Баланс (до)</span><span>Баланс (после)</span><span>Разница</span><span>Сумма SUM</span></div><div className="grid grid-cols-6 border-b py-5"><span>sndwch</span><span>-</span><span>4 sht</span><span>1 sht</span><span>-3 sht</span><span>{row.amount}</span></div><div className="mt-5 text-right font-semibold">Итого: <span className="ml-16">{row.amount}</span></div></div>
            </div>
          </div></td></tr>}
        </Fragment>)}</tbody>
      </table></div>
    </div>

    {addOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"><div className="w-[620px] rounded bg-white p-8 shadow-2xl"><div className="mb-8 flex justify-between text-xl font-semibold">ДОБАВИТЬ ИНВЕНТАРИЗАЦИЮ<button onClick={() => setAddOpen(false)}><X/></button></div><label className="block">Склад<select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="mt-2 w-full border-b py-3"><option>Все склады</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select></label><label className="mt-6 block">Комментарий<input className="mt-2 w-full border-b py-3" placeholder="Комментарий"/></label><div className="mt-10 text-right"><button onClick={addInventory} className="rounded bg-[#67cc87] px-7 py-3 font-semibold text-white">СОХРАНИТЬ</button></div></div></div>}
  </div>
}
