"use client"

import { Filter, Plus, Search, X } from "lucide-react"
import { useMemo, useState } from "react"

type ReturnRow = { id: number; client: string; zone: string; warehouse: string; product: string; supplier: string; date: string; accepted?: boolean; amount: string; agent: string }
const initial: ReturnRow[] = [
 {id:222,client:"ЧЛ Ибраева Мадина Амангельдыева",zone:"",warehouse:"Andijon skladi",product:"NEW ORG",supplier:"Admin Ritm",date:"17 июля 2026, 08:24",amount:"10 000 SUM",agent:"Хайрулло Доставщик"},
 {id:221,client:"ЧЛ Ибраева Мадина Амангельдыева",zone:"",warehouse:"Andijon skladi",product:"NEW ORG",supplier:"Admin Ritm",date:"17 июля 2026, 08:24",amount:"10 000 SUM",agent:"Хайрулло Доставщик"},
 {id:220,client:"klient 1",zone:"chilonozor",warehouse:"Andijon skladi",product:"NEW ORG",supplier:"Quvonchbek Admin",date:"16 мая 2026, 09:47",amount:"11 000 SUM",agent:"Samandar Abdurahmonov",accepted:true},
 {id:219,client:"Бахт маркет",zone:"",warehouse:"05,08,2025(1)",product:"Lalaku",supplier:"Admin Ritm",date:"11 мая 2026, 09:44",amount:"66 SUM",agent:"MrJakhon Ziyayev",accepted:true},
 {id:218,client:"loe messi",zone:"spark",warehouse:"Andijon skladi",product:"energetik",supplier:"N/A",date:"07 мая 2026, 13:09",amount:"1,6 USD",agent:"Admin Ritm"},
 {id:217,client:"new klient707",zone:"",warehouse:"toshkent",product:"energetik",supplier:"Temur Raupov",date:"28 мар. 2026, 17:28",amount:"86 910 120 SUM",agent:"Temur Raupov"},
 {id:216,client:"marketsavdo1",zone:"spark",warehouse:"Suhrob sklad",product:"Lalaku",supplier:"MrJakhon Ziyayev",date:"04 мар. 2026, 19:08",amount:"360 000 SUM",agent:"MrJakhon Ziyayev"},
 {id:215,client:"marketsavdo1",zone:"spark",warehouse:"Suhrob sklad",product:"Lalaku",supplier:"MrJakhon Ziyayev",date:"04 мар. 2026, 19:08",amount:"360 000 SUM",agent:"MrJakhon Ziyayev",accepted:true},
 ...Array.from({length:15},(_,i)=>({id:213-i,client:i%2?"Asu market":"Klient_Karim175",zone:i%2?"spark":"",warehouse:i%3?"123 test":"toshkent",product:i%3?"energetik":"ddr",supplier:"Admin Ritm",date:`08 янв. 2026, 10:${40-i}`,amount:i%3?"35 820 SUM":"3,98 USD",agent:"Admin Ritm",accepted:i%2===0}))]

const warehouses = ["05,08,2025(1)", "Andijon skladi", "Suhrob sklad", "toshkent", "123 test"]

export function ReturnsView() {
  const [rows, setRows] = useState(initial)
  const [tab, setTab] = useState("Все")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<ReturnRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [warehouseFilter, setWarehouseFilter] = useState("Все склады")

  const visible = useMemo(
    () =>
      rows
        .filter((row) => tab === "Все" || (tab === "Принятые" ? row.accepted : !row.accepted))
        .filter((row) => warehouseFilter === "Все склады" || row.warehouse === warehouseFilter)
        .filter((row) => `${row.id} ${row.client}`.toLowerCase().includes(query.toLowerCase())),
    [rows, tab, query, warehouseFilter],
  )

  function addReturn(client: string) {
    const id = Math.max(0, ...rows.map((row) => row.id)) + 1
    const row: ReturnRow = { id, client: client || "Новый клиент", zone: "", warehouse: warehouses[0], product: "—", supplier: "Admin Ritm", date: "06 авг. 2026, 12:00", amount: "0 SUM", agent: "Admin Ritm" }
    setRows((current) => [row, ...current])
    setAddOpen(false)
  }

  function updateClient(id: number, client: string) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, client } : row)))
    setSelected((current) => (current && current.id === id ? { ...current, client } : current))
  }

  function cancelReturn(id: number) {
    setRows((current) => current.filter((row) => row.id !== id))
    setSelected(null)
  }

  return (
    <main className="min-h-screen bg-slate-100 pb-8 text-slate-800">
      <div className="flex items-center justify-between bg-slate-50 px-10 py-4">
        <h1 className="text-[27px] font-bold text-slate-600"><span className="text-[#5271df]">★ Избранные</span> <span className="font-normal">|</span> Возвраты</h1>
        <button type="button" onClick={() => setAddOpen(true)} className="rounded-md bg-[#70cf84] px-5 py-2.5 font-semibold text-white"><Plus className="mr-2 inline h-5" />Добавить</button>
      </div>
      <section className="mx-9 mt-1 bg-white shadow">
        <div className="grid grid-cols-3">{["Надо принять", "Принятые", "Все"].map((label) => <button key={label} onClick={() => setTab(label)} className={`py-4 text-center ${tab === label ? "border-b-4 border-[#586ce8]" : ""}`}>{label}</button>)}</div>
        <div className="bg-[#586ce8] px-2 py-2 font-semibold text-white">Возвраты: 1 653 922 387,883 SUM , 90 501,91 Euro , 1 526 156,979 USD</div>
        <div className="relative flex items-center gap-5 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="rounded bg-[#5271df] px-4 py-2 text-white"><Filter className="mr-2 inline h-4" />Показать фильтр</button>
          {filterOpen && (
            <div className="absolute left-5 top-full z-20 mt-2 w-64 border border-slate-200 bg-white p-4 shadow-xl">
              <label className="block text-xs font-medium text-slate-500">
                Склад
                <select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} className="mt-1 block w-full border-b border-slate-300 bg-white py-2 text-sm outline-none">
                  <option>Все склады</option>
                  {warehouses.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => setFilterOpen(false)} className="mt-4 w-full rounded bg-[#5271df] py-2 text-sm font-semibold text-white">Применить</button>
            </div>
          )}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск" className="ml-20 w-80 border-b border-slate-300 px-2 py-2 outline-none" />
          <Search className="-ml-12 text-slate-400" />
          <span className="ml-auto">25　 1 - {visible.length} из 179　 ◀ ▶　⌄　↓</span>
          <button onClick={() => setRows((rows) => rows.map((row) => (selected && row.id === selected.id ? { ...row, accepted: true } : row)))} className="rounded bg-[#70cf84] px-4 py-2 font-semibold text-white">Принять на склад</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1450px] text-left">
            <thead className="bg-[#626b7e] text-white"><tr>{["№", "От кого", "Склад", "Доставщик", "Дата возврата", "Создал", "Ответственный агент", "Сумма возврата"].map((h) => <th key={h} className="px-5 py-4">{h}</th>)}</tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer border-b-2 border-dotted border-slate-200 hover:bg-blue-50">
                  <td className="px-5 py-3">{row.id}</td>
                  <td className="px-5">{row.client}<br /><span className="text-[#5271df]">{row.zone}</span></td>
                  <td className="px-5">{row.warehouse}<br /><span className="text-[#5271df]">{row.product}</span></td>
                  <td className="px-5">{row.supplier}</td>
                  <td className="px-5">{row.date}<br /><span className="text-[#5271df]">{row.accepted ? "08 янв. 2026, 10:38" : ""}</span></td>
                  <td className="px-5">Admin Ritm</td>
                  <td className="px-5">{row.agent}</td>
                  <td className="px-5">{row.amount}<br /><span className={row.accepted ? "text-green-500" : "text-orange-400"}>{row.accepted ? "Принят" : "Ожидает"}</span>　<span className="rounded border border-[#5271df] px-1 text-[#5271df]">$</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selected && <Detail row={selected} close={() => setSelected(null)} onEdit={updateClient} onCancelRequest={cancelReturn} />}
      {addOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={(event) => { event.preventDefault(); addReturn((new FormData(event.currentTarget).get("client") as string)?.trim()) }} className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">Добавить возврат</h3>
              <button type="button" onClick={() => setAddOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              Клиент
              <input autoFocus name="client" className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
            </label>
            <button type="submit" className="w-full rounded-md bg-[#70cf84] py-3 font-semibold text-white">Создать</button>
          </form>
        </div>
      )}
    </main>
  )
}

function Detail({ row, close, onEdit, onCancelRequest }: { row: ReturnRow; close: () => void; onEdit: (id: number, client: string) => void; onCancelRequest: (id: number) => void }) {
  const [editOpen, setEditOpen] = useState(false)
  const [editClient, setEditClient] = useState(row.client)

  return (
    <section className="mx-4 mt-6 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b p-5">
        <h2 className="text-2xl">Возврат №{row.id}</h2>
        <div className="flex gap-3">
          <button type="button" onClick={() => setEditOpen(true)} className="rounded bg-[#5271df] px-5 py-2 font-semibold text-white">✎　Изменить</button>
          <button type="button" onClick={() => onCancelRequest(row.id)} className="rounded bg-[#f4827a] px-5 py-2 font-semibold text-white">⊖　Отменить запрос</button>
          <button onClick={close} aria-label="Закрыть"><X /></button>
        </div>
      </div>
      <div className="grid grid-cols-[435px_1fr]">
        <aside className="border-r p-9 leading-8">
          Заказ №1423<br />
          Добавил: <b className="float-right">Admin Ritm</b><br />
          Клиент: <b className="float-right text-[#5271df]">{row.client}</b><br />
          Зона: <b className="float-right">{row.zone || "Не указано"}</b><br />
          Дата возврата: <b className="float-right">08 янв. 2026, 10:38</b><br />
          Доставщик: <b className="float-right">Admin Ritm</b><br />
          Ответственный агент: <b className="float-right">Admin Ritm</b>
          <hr className="my-5" />
          <b>СКЛАД</b><br />
          Склад: <b className="float-right">Карим 2</b><br />
          Статус: <b className="float-right text-green-500">Принят</b>
        </aside>
        <div className="p-9">
          <div className="mb-5 flex justify-around border-b pb-4">
            <span className="border-b-2 border-[#5271df] pb-4">Список товаров</span>
            <span>Серии</span>
            <span>Логи</span>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-dotted"><th className="p-3 text-left">Заказ</th><th>№</th><th className="text-left">Товар</th><th>Количество</th><th>Блок</th><th>Цена (SUM)</th><th>Сумма (SUM)</th></tr></thead>
            <tbody>
              <tr><td className="p-4 text-[#5271df]">1423</td><td>1</td><td>Cola 0.35<br />Заказ: 1423 от 08 янв.</td><td>10 шт</td><td>1 блок</td><td>4 477,5</td><td>44 775</td></tr>
              <tr className="border-t"><td className="p-4 font-bold">Итого:</td><td /><td /><td className="font-bold">10шт</td><td /><td /><td className="font-bold">44 775</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onEdit(row.id, editClient.trim() || row.client)
              setEditOpen(false)
            }}
            className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">Изменить возврат</h3>
              <button type="button" onClick={() => setEditOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              Клиент
              <input autoFocus value={editClient} onChange={(event) => setEditClient(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
            </label>
            <button type="submit" className="w-full rounded-md bg-[#5271df] py-3 font-semibold text-white">Сохранить</button>
          </form>
        </div>
      )}
    </section>
  )
}
