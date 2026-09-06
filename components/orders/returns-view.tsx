"use client"

import { Filter, Plus, Search, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useMemo, useState } from "react"
import { useLanguage } from "@/lib/i18n/language-context"

type ReturnRow = { id: number; client: string; zone: string; warehouse: string; product: string; supplier: string; date: string; accepted?: boolean; amount: string; agent: string }
const initial: ReturnRow[] = []

const warehouses = ["05,08,2025(1)", "Andijon skladi", "Suhrob sklad", "toshkent", "123 test"]

export function ReturnsView() {
  const { t } = useLanguage()
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
        <h1 className="text-[27px] font-bold text-slate-600"><FavoritesButton className="text-[#5271df]" /> <span className="font-normal">|</span> {t("Возвраты")}</h1>
        <button type="button" onClick={() => setAddOpen(true)} className="rounded-md bg-[#70cf84] px-5 py-2.5 font-semibold text-white"><Plus className="mr-2 inline h-5" />{t("Добавить")}</button>
      </div>
      <section className="mx-9 mt-1 bg-white shadow">
        <div className="grid grid-cols-3">{["Надо принять", "Принятые", "Все"].map((label) => <button key={label} onClick={() => setTab(label)} className={`py-4 text-center ${tab === label ? "border-b-4 border-[#586ce8]" : ""}`}>{t(label)}</button>)}</div>
        <div className="bg-[#586ce8] px-2 py-2 font-semibold text-white">{t("Возвраты: 0 SUM , 0 Euro , 0 USD")}</div>
        <div className="relative flex items-center gap-5 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="rounded bg-[#5271df] px-4 py-2 text-white"><Filter className="mr-2 inline h-4" />{t("Показать фильтр")}</button>
          {filterOpen && (
            <div className="absolute left-5 top-full z-20 mt-2 w-64 border border-slate-200 bg-white p-4 shadow-xl">
              <label className="block text-xs font-medium text-slate-500">
                {t("Склад")}
                <select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} className="mt-1 block w-full border-b border-slate-300 bg-white py-2 text-sm outline-none">
                  <option value="Все склады">{t("Все склады")}</option>
                  {warehouses.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => setFilterOpen(false)} className="mt-4 w-full rounded bg-[#5271df] py-2 text-sm font-semibold text-white">{t("Применить")}</button>
            </div>
          )}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Поиск")} className="ml-20 w-80 border-b border-slate-300 px-2 py-2 outline-none" />
          <Search className="-ml-12 text-slate-400" />
          <span className="ml-auto">25　 1 - {visible.length} {t("из")} {visible.length}　 ◀ ▶　⌄　↓</span>
          <button onClick={() => setRows((rows) => rows.map((row) => (selected && row.id === selected.id ? { ...row, accepted: true } : row)))} className="rounded bg-[#70cf84] px-4 py-2 font-semibold text-white">{t("Принять на склад")}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1450px] text-left">
            <thead className="bg-[#626b7e] text-white"><tr>{["№", "От кого", "Склад", "Доставщик", "Дата возврата", "Создал", "Ответственный агент", "Сумма возврата"].map((h) => <th key={h} className="px-5 py-4">{t(h)}</th>)}</tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer border-b-2 border-dotted border-slate-200 hover:bg-blue-50">
                  <td className="px-5 py-3">{row.id}</td>
                  <td className="px-5">{t(row.client)}<br /><span className="text-[#5271df]">{row.zone}</span></td>
                  <td className="px-5">{row.warehouse}<br /><span className="text-[#5271df]">{row.product}</span></td>
                  <td className="px-5">{row.supplier}</td>
                  <td className="px-5">{t(row.date)}<br /><span className="text-[#5271df]">{row.accepted ? t("08 янв. 2026, 10:38") : ""}</span></td>
                  <td className="px-5">Admin Ritm</td>
                  <td className="px-5">{row.agent}</td>
                  <td className="px-5">{row.amount}<br /><span className={row.accepted ? "text-green-500" : "text-orange-400"}>{t(row.accepted ? "Принят" : "Ожидает")}</span>　<span className="rounded border border-[#5271df] px-1 text-[#5271df]">$</span></td>
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
              <h3 className="text-lg font-bold">{t("Добавить возврат")}</h3>
              <button type="button" onClick={() => setAddOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              {t("Клиент")}
              <input autoFocus name="client" className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
            </label>
            <button type="submit" className="w-full rounded-md bg-[#70cf84] py-3 font-semibold text-white">{t("Создать")}</button>
          </form>
        </div>
      )}
    </main>
  )
}

function Detail({ row, close, onEdit, onCancelRequest }: { row: ReturnRow; close: () => void; onEdit: (id: number, client: string) => void; onCancelRequest: (id: number) => void }) {
  const { t } = useLanguage()
  const [editOpen, setEditOpen] = useState(false)
  const [editClient, setEditClient] = useState(row.client)

  return (
    <section className="mx-4 mt-6 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b p-5">
        <h2 className="text-2xl">{t("Возврат №")}{row.id}</h2>
        <div className="flex gap-3">
          <button type="button" onClick={() => setEditOpen(true)} className="rounded bg-[#5271df] px-5 py-2 font-semibold text-white">✎　{t("Изменить")}</button>
          <button type="button" onClick={() => onCancelRequest(row.id)} className="rounded bg-[#f4827a] px-5 py-2 font-semibold text-white">⊖　{t("Отменить запрос")}</button>
          <button onClick={close} aria-label={t("Закрыть")}><X /></button>
        </div>
      </div>
      <div className="grid grid-cols-[435px_1fr]">
        <aside className="border-r p-9 leading-8">
          {t("Заказ №1423")}<br />
          {t("Добавил")}: <b className="float-right">Admin Ritm</b><br />
          {t("Клиент")}: <b className="float-right text-[#5271df]">{t(row.client)}</b><br />
          {t("Зона")}: <b className="float-right">{row.zone || t("Не указано")}</b><br />
          {t("Дата возврата")}: <b className="float-right">{t("08 янв. 2026, 10:38")}</b><br />
          {t("Доставщик")}: <b className="float-right">Admin Ritm</b><br />
          {t("Ответственный агент")}: <b className="float-right">Admin Ritm</b>
          <hr className="my-5" />
          <b>{t("СКЛАД")}</b><br />
          {t("Склад")}: <b className="float-right">Карим 2</b><br />
          {t("Статус")}: <b className="float-right text-green-500">{t("Принят")}</b>
        </aside>
        <div className="p-9">
          <div className="mb-5 flex justify-around border-b pb-4">
            <span className="border-b-2 border-[#5271df] pb-4">{t("Список товаров")}</span>
            <span>{t("Серии")}</span>
            <span>{t("Логи")}</span>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-dotted"><th className="p-3 text-left">{t("Заказ")}</th><th>{t("№")}</th><th className="text-left">{t("Товар")}</th><th>{t("Количество")}</th><th>{t("Блок")}</th><th>{t("Цена (SUM)")}</th><th>{t("Сумма (SUM)")}</th></tr></thead>
            <tbody>
              <tr><td className="p-4 text-[#5271df]">1423</td><td>1</td><td>Cola 0.35<br />{t("Заказ: 1423 от 08 янв.")}</td><td>{t("10 шт")}</td><td>{t("1 блок")}</td><td>4 477,5</td><td>44 775</td></tr>
              <tr className="border-t"><td className="p-4 font-bold">{t("Итого:")}</td><td /><td /><td className="font-bold">{t("10шт")}</td><td /><td /><td className="font-bold">44 775</td></tr>
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
              <h3 className="text-lg font-bold">{t("Изменить возврат")}</h3>
              <button type="button" onClick={() => setEditOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              {t("Клиент")}
              <input autoFocus value={editClient} onChange={(event) => setEditClient(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
            </label>
            <button type="submit" className="w-full rounded-md bg-[#5271df] py-3 font-semibold text-white">{t("Сохранить")}</button>
          </form>
        </div>
      )}
    </section>
  )
}
