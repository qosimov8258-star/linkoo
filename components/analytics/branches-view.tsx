"use client"

import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { Fragment, FormEvent, useMemo, useState } from "react"

type Branch = {
  id: number
  name: string
  date: string
  debtTracking: boolean
  isMain: boolean
  priceList: string
  currency: "SUM" | "USD" | "Euro"
}

const priceLists = ["donalik", "11111", "123123123", "asus vivobook", "attack", "Attack250", "Шт14", "savdo", "Bozor narx", "tovar"]
const namePool = [
  "Filial Green", "Filial Blue", "Filial Red", "Karim sklad", "Toshkent markaz", "Samarqand hub", "Namangan filial",
  "Fergana filial", "Xorazm filial", "Navoiy filial", "Jizzax filial", "Termiz filial", "Nukus filial", "Guliston filial",
  "Qarshi filial", "Marketing filial", "Test filial", "Demo filial", "Zaxira sklad", "Yangi filial", "Eski filial",
  "Chilonzor filial", "Yunusobod filial", "Sergeli filial", "Mirzo Ulugbek filial", "Bektemir filial", "Olmazor filial",
  "Shayxontohur filial", "Uchtepa filial", "Yashnobod filial",
]

function generateBranches(): Branch[] {
  const seed: [string, string, boolean, boolean][] = [
    ["777", "23 сент. 2024", true, true],
    ["878", "12 июня 2025", true, true],
    ["agent", "09 нояб. 2024", true, true],
    ["Andijon", "28 дек. 2024", true, false],
    ["AURUM samarqand", "10 апр. 2026", false, false],
    ["baby still", "23 сент. 2025", false, false],
    ["Bobomotors", "04 окт. 2024", false, false],
    ["Borsa_kelmas", "31 янв. 2025", false, false],
    ["buxoro", "05 авг. 2025", false, false],
    ["Buxoro", "23 сент. 2024", true, false],
    ["Buxoro 2", "16 июня 2025", false, true],
    ["candycold", "28 февр. 2025", true, false],
    ["candy cold", "20 февр. 2025", true, true],
    ["Chinobod", "31 июля 2025", true, false],
    ["choshtepa", "22 сент. 2025", true, false],
    ["Corelion", "09 нояб. 2024", false, false],
    ["ddr", "07 янв. 2026", false, true],
    ["ddr1", "07 янв. 2026", false, true],
    ["Dodge LLC", "05 сент. 2025", true, true],
    ["doston2filialcola", "11 июля 2025", false, false],
    ["DostonfoodToshkent", "03 июля 2025", true, true],
    ["dosyaglavniyfil", "04 июля 2025", true, true],
    ["Farg'ona", "07 янв. 2025", true, false],
    ["filial 007", "29 дек. 2025", false, true],
    ["filial_1", "10 дек. 2025", true, false],
  ]

  const rows: Branch[] = seed.map(([name, date, debtTracking, isMain], index) => ({
    id: index + 1,
    name,
    date,
    debtTracking,
    isMain,
    priceList: name === "dosyaglavniyfil" ? "donalik" : priceLists[index % priceLists.length],
    currency: name === "dosyaglavniyfil" ? "SUM" : (["SUM", "SUM", "SUM", "USD", "Euro"] as const)[index % 5],
  }))

  const months = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
  for (let index = rows.length; index < 130; index++) {
    const namedBase = namePool[(index - rows.length) % namePool.length]
    const suffix = Math.floor((index - rows.length) / namePool.length)
    const day = 1 + (index % 28)
    const month = months[index % 12]
    const year = 2024 + (index % 3)
    rows.push({
      id: index + 1,
      name: suffix ? `${namedBase} ${suffix + 1}` : namedBase,
      date: `${String(day).padStart(2, "0")} ${month} ${year}`,
      debtTracking: index % 3 !== 0,
      isMain: index % 5 === 0,
      priceList: priceLists[index % priceLists.length],
      currency: (["SUM", "SUM", "SUM", "USD", "Euro"] as const)[index % 5],
    })
  }
  return rows
}

const seedBranches = generateBranches()

export const branchNames = seedBranches.map((branch) => branch.name)

export function BranchesView({ embedded = false }: { embedded?: boolean }) {
  const [branches, setBranches] = useState(seedBranches)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [draft, setDraft] = useState({ name: "", priceList: priceLists[0], currency: "SUM" as Branch["currency"], debtTracking: true, isMain: false })
  const pageSize = 25

  const filtered = useMemo(() => branches.filter((branch) => branch.name.toLowerCase().includes(query.toLowerCase())), [branches, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const selected = selectedId !== null ? branches.find((branch) => branch.id === selectedId) ?? null : null

  function openCreate() {
    setDraft({ name: "", priceList: priceLists[0], currency: "SUM", debtTracking: true, isMain: false })
    setEditing({ id: 0, name: "", date: "", debtTracking: true, isMain: false, priceList: priceLists[0], currency: "SUM" })
  }

  function openEdit(branch: Branch) {
    setDraft({ name: branch.name, priceList: branch.priceList, currency: branch.currency, debtTracking: branch.debtTracking, isMain: branch.isMain })
    setEditing(branch)
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    if (editing?.id) {
      setBranches((list) => list.map((branch) => (branch.id === editing.id ? { ...branch, ...draft, name: draft.name.trim() } : branch)))
    } else {
      const id = Math.max(0, ...branches.map((branch) => branch.id)) + 1
      const today = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date()).replace(".", "")
      setBranches((list) => [{ id, ...draft, name: draft.name.trim(), date: today }, ...list])
    }
    setEditing(null)
  }

  function remove(id: number) {
    setBranches((list) => list.filter((branch) => branch.id !== id))
    setSelectedId((current) => (current === id ? null : current))
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      <div className={embedded ? "" : "overflow-hidden rounded bg-white shadow"}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={openCreate} className="text-[17px] text-[#4f70e7] hover:underline">
            + Добавить филиал
          </button>
          <label className="relative ml-4 w-72">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">№</th>
              <th className="px-5 py-5">Наименование</th>
              <th className="px-5 py-5">Дата</th>
              <th className="px-5 py-5">Учет долга</th>
              <th className="px-5 py-5">Основной филиал</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((branch) => (
              <Fragment key={branch.id}>
                <tr className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50" onClick={() => setSelectedId((current) => (current === branch.id ? null : branch.id))}>
                  <td className="px-9 py-4">{branch.id}</td>
                  <td className="px-5 py-4 text-[#4f70e7]">{branch.name}</td>
                  <td className="px-5 py-4">{branch.date}</td>
                  <td className={`px-5 py-4 ${branch.debtTracking ? "text-[#6ccd8b]" : "text-red-400"}`}>{branch.debtTracking ? "Включен" : "Отключен"}</td>
                  <td className={`px-5 py-4 ${branch.isMain ? "text-[#6ccd8b]" : "text-red-400"}`}>{branch.isMain ? "Да" : "Нет"}</td>
                </tr>
                {selected?.id === branch.id && (
                  <tr>
                    <td colSpan={5} className="border-b border-slate-200 bg-white p-0">
                      <div className="p-8">
                        <div className="mb-6 flex items-center justify-between">
                          <h2 className="text-2xl font-semibold text-slate-800">{branch.name}</h2>
                          <div className="flex items-center gap-4">
                            <button type="button" className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
                              <Plus className="h-4 w-4" /> Добавить план
                            </button>
                            <button type="button" onClick={() => openEdit(branch)} aria-label="Изменить" className="text-slate-500 hover:text-[#4f70e7]">
                              <Pencil className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => remove(branch.id)} aria-label="Удалить" className="text-slate-500 hover:text-red-500">
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2 text-[15px]">
                          <p>
                            Дата создания: <b className="ml-2">{branch.date}</b>
                          </p>
                          <p>
                            Прайс лист: <b className="ml-2">{branch.priceList}</b>
                          </p>
                          <p>
                            Валюта: <b className="ml-2">{branch.currency === "SUM" ? "SUM" : branch.currency}</b>
                          </p>
                          <p>
                            Основной филиал: <b className={`ml-2 ${branch.isMain ? "text-[#6ccd8b]" : "text-red-400"}`}>{branch.isMain ? "Включено" : "Выключено"}</b>
                          </p>
                          <p>
                            Учет долга: <b className={`ml-2 ${branch.debtTracking ? "text-[#6ccd8b]" : "text-red-400"}`}>{branch.debtTracking ? "Включено" : "Выключено"}</b>
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <form onSubmit={save} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex justify-between">
              <h2 className="text-xl font-bold">{editing.id ? "Изменить филиал" : "Добавить филиал"}</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <label className="mb-2 block font-medium">Наименование</label>
            <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Прайс лист</label>
            <select value={draft.priceList} onChange={(event) => setDraft({ ...draft, priceList: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5">
              {priceLists.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <label className="mb-2 block font-medium">Валюта</label>
            <select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as Branch["currency"] })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5">
              <option value="SUM">SUM</option>
              <option value="USD">USD</option>
              <option value="Euro">Euro</option>
            </select>
            <label className="mb-2 flex items-center gap-2">
              <input type="checkbox" checked={draft.debtTracking} onChange={(event) => setDraft({ ...draft, debtTracking: event.target.checked })} />
              Учет долга
            </label>
            <label className="mb-4 flex items-center gap-2">
              <input type="checkbox" checked={draft.isMain} onChange={(event) => setDraft({ ...draft, isMain: event.target.checked })} />
              Основной филиал
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEditing(null)} className="rounded border px-4 py-2">
                Отмена
              </button>
              <button type="submit" className="inline-flex items-center gap-2 rounded bg-[#5474e6] px-4 py-2 font-semibold text-white">
                <Plus className="h-4 w-4" />
                Сохранить
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
