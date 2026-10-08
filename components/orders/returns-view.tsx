"use client"

import { Download, Filter, Plus, Search, SlidersHorizontal, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useMemo, useState } from "react"
import { useLanguage } from "@/lib/i18n/language-context"

type ReturnRow = {
  id: number
  client: string
  zone: string
  warehouse: string
  organization: string
  deliverer: string
  date: string
  acceptedDate?: string
  creator: string
  accepted?: boolean
  amount: string
  agent: string
}

const warehouses = ["05,08,2025(1)", "Andijon skladi", "Suhrob sklad", "toshkent", "123 test"]

const initial: ReturnRow[] = [
  { id: 222, client: "ЧЛ Ибраева Мадина", zone: "", warehouse: "Andijon skladi", organization: "NEW ORG", deliverer: "Admin Ritm", date: "17 июля 2026, 08:24", creator: "Admin Ritm", agent: "Хайрулло Доставщик", amount: "10 000 SUM" },
  { id: 220, client: "klient 1", zone: "chilonzor", warehouse: "Andijon skladi", organization: "NEW ORG", deliverer: "Quvonchbek Admin", date: "16 мая 2026, 09:47", acceptedDate: "06 июня 2026, 11:20", creator: "Admin Ritm", agent: "Samandar Abdurahmonov", amount: "11 000 SUM", accepted: true },
  { id: 219, client: "Бахт маркет", zone: "", warehouse: "05,08,2025(1)", organization: "Lalaku", deliverer: "Admin Ritm", date: "11 мая 2026, 09:44", acceptedDate: "09 мая 2026, 09:45", creator: "Admin Ritm", agent: "MrJakhon Ziyayev", amount: "66 SUM", accepted: true },
  { id: 218, client: "loe messi", zone: "spark", warehouse: "Andijon skladi", organization: "energetik", deliverer: "N/A", date: "07 мая 2026, 13:09", creator: "Admin Ritm", agent: "Admin Ritm", amount: "1,6 USD" },
  { id: 217, client: "new klient707", zone: "", warehouse: "toshkent", organization: "energetik", deliverer: "Temur Raupov", date: "28 мар. 2026, 17:28", creator: "Admin Ritm", agent: "Temur Raupov", amount: "86 910 120 SUM" },
  { id: 216, client: "marketsavdo1", zone: "spark", warehouse: "Suhrob sklad", organization: "Lalaku", deliverer: "MrJakhon Ziyayev", date: "04 мар. 2026, 19:08", creator: "Admin Ritm", agent: "MrJakhon Ziyayev", amount: "360 000 SUM" },
  { id: 210, client: "Asu market", zone: "", warehouse: "Suhrob sklad", organization: "Lalaku", deliverer: "Admin Ritm", date: "20 янв. 2026, 17:22", acceptedDate: "23 янв. 2026, 16:08", creator: "Admin Ritm", agent: "Temur Raupov", amount: "6 000 SUM", accepted: true },
  { id: 205, client: "mustafo", zone: "spark", warehouse: "toshkent", organization: "energetik", deliverer: "Admin Ritm", date: "11 янв. 2026, 19:47", acceptedDate: "11 янв. 2026, 19:48", creator: "Admin Ritm", agent: "Admin Ritm", amount: "646 750 SUM", accepted: true },
]

function parseAmount(amount: string): { value: number; currency: string } {
  const match = amount.trim().match(/^([\d\s.,]+)\s*(SUM|USD|Euro|EUR)$/i)
  if (!match) return { value: 0, currency: "SUM" }
  const value = Number(match[1].replace(/\s/g, "").replace(",", ".")) || 0
  const currency = match[2].toUpperCase() === "EUR" ? "Euro" : match[2].toUpperCase() === "USD" ? "USD" : "SUM"
  return { value, currency }
}

function formatTotal(value: number): string {
  const [whole, fraction] = value.toFixed(3).replace(/\.?0+$/, "").split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return fraction ? `${grouped},${fraction}` : grouped
}

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

  const totals = useMemo(() => {
    const sums: Record<string, number> = { SUM: 0, Euro: 0, USD: 0 }
    for (const row of visible) {
      const { value, currency } = parseAmount(row.amount)
      sums[currency] = (sums[currency] ?? 0) + value
    }
    return sums
  }, [visible])

  function addReturn(client: string) {
    const id = Math.max(0, ...rows.map((row) => row.id)) + 1
    const row: ReturnRow = { id, client: client || "Новый клиент", zone: "", warehouse: warehouses[0], organization: "—", deliverer: "Admin Ritm", date: "06 авг. 2026, 12:00", creator: "Admin Ritm", amount: "0 SUM", agent: "Admin Ritm" }
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
        <div className="bg-[#586ce8] px-2 py-2 font-semibold text-white">
          {t("Возвраты")}: {formatTotal(totals.SUM)} SUM , {formatTotal(totals.Euro)} Euro , {formatTotal(totals.USD)} USD
        </div>
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
          <span className="ml-auto flex items-center gap-3 text-slate-600">
            25　 1 - {visible.length} {t("из")} {visible.length}　 ◀ ▶
            <SlidersHorizontal className="h-4 w-4 cursor-pointer" />
            <Download className="h-4 w-4 cursor-pointer" />
          </span>
          <button onClick={() => setRows((rows) => rows.map((row) => (selected && row.id === selected.id ? { ...row, accepted: true } : row)))} className="rounded bg-[#70cf84] px-4 py-2 font-semibold text-white">{t("Принять на склад")}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-left">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                {["№", "От кого", "Склад", "Доставщик", "Дата возврата", "Создал", "Ответственный агент"].map((h) => <th key={h} className="px-5 py-4">{t(h)}</th>)}
                <th className="px-5 py-4 text-right">{t("Сумма возврата")}</th>
                <th className="w-14" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer border-b-2 border-dotted border-slate-200 hover:bg-blue-50">
                  <td className="px-5 py-3">{row.id}</td>
                  <td className="px-5">{t(row.client)}<br /><span className="text-[#5271df]">{row.zone}</span></td>
                  <td className="px-5">{row.warehouse}<br /><span className="text-[#5271df]">{row.organization}</span></td>
                  <td className="px-5">{row.deliverer}</td>
                  <td className="px-5">{t(row.date)}<br /><span className="text-[#5271df]">{row.acceptedDate ?? ""}</span></td>
                  <td className="px-5">{row.creator}</td>
                  <td className="px-5">{row.agent}</td>
                  <td className="px-5 text-right">{row.amount}<br /><span className={row.accepted ? "text-green-500" : "text-orange-400"}>{t(row.accepted ? "Принят" : "Ожидает")}</span></td>
                  <td className="px-3 text-center"><span className="inline-flex rounded border border-[#5271df] px-1.5 py-0.5 text-[#5271df]">$</span></td>
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
          {t("Возврат №")}{row.id}<br />
          {t("Добавил")}: <b className="float-right">{row.creator}</b><br />
          {t("Клиент")}: <b className="float-right text-[#5271df]">{t(row.client)}</b><br />
          {t("Зона")}: <b className="float-right">{row.zone || t("Не указано")}</b><br />
          {t("Дата возврата")}: <b className="float-right">{row.acceptedDate ?? row.date}</b><br />
          {t("Доставщик")}: <b className="float-right">{row.deliverer}</b><br />
          {t("Ответственный агент")}: <b className="float-right">{row.agent}</b>
          <hr className="my-5" />
          <b>{t("СКЛАД")}</b><br />
          {t("Склад")}: <b className="float-right">{row.warehouse}</b><br />
          {t("Статус")}: <b className={`float-right ${row.accepted ? "text-green-500" : "text-orange-400"}`}>{t(row.accepted ? "Принят" : "Ожидает")}</b>
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
