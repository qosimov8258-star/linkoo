"use client"

import { ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

type Warehouse = {
  id: number
  name: string
  address: string
  branch: string
  manager: string
  createdDate: string
  online: boolean
  active: boolean
}

const managers = ["Admin Ritm", "Админ 1", "A Rustam", "Asad Asadov", "Samandar Abdurahmonov", "Temur Raupov"]
const branchPool = ["Buxoro", "samarqand", "mozdini", "Ташкент", "Bobomotors", "korea kosmetika", "toshkent", "Surxandaryo", "Andijon skladi", "Farg'ona"]
const addressPool = ["Adana", "Toshkent", "Тест Магазин 01", "Tashkent", "RITM", "Andijon skladi", "Surxandaryo", "Namangan", "Buxoro shahri"]

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function fmt(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

const knownActive: Omit<Warehouse, "active">[] = [
  { id: 59, name: "05,08,2025(1)", address: "Adana", branch: "Buxoro", manager: "Admin Ritm", createdDate: "05 авг. 2025", online: false },
  { id: 60, name: "05,08,2025(2)", address: "Adana", branch: "samarqand", manager: "Admin Ritm", createdDate: "05 авг. 2025", online: false },
  { id: 7, name: "11111", address: "11222", branch: "Mirzo Ulugbek1", manager: "Admin Ritm", createdDate: "23 сент. 2024", online: true },
  { id: 64, name: "123 test", address: "Toshkent", branch: "mozdini", manager: "Asad Asadov", createdDate: "13 сент. 2025", online: false },
  { id: 72, name: "250607250607", address: "Тест Магазин 01", branch: "Buxoro", manager: "Admin Ritm", createdDate: "30 сент. 2025", online: false },
  { id: 22, name: "878", address: "Tashkent", branch: "Ташкент", manager: "Админ 1", createdDate: "12 июня 2025", online: true },
  { id: 99, name: "All", address: "RITM", branch: "Bobomotors", manager: "Admin Ritm", createdDate: "30 янв. 2026", online: false },
  { id: 13, name: "Andijon skladi", address: "Andijon skladi", branch: "korea kosmetika", manager: "A Rustam", createdDate: "28 дек. 2024", online: true },
  { id: 8, name: "ANGOR", address: "Surxandaryo", branch: "toshkent", manager: "Admin Ritm", createdDate: "04 окт. 2024", online: false },
  { id: 24, name: "anjan marajni", address: "Tashkent", branch: "Ташкент", manager: "Админ 1", createdDate: "12 июня 2025", online: true },
]

const ACTIVE_TOTAL = 105

function buildWarehouses(): Warehouse[] {
  const rows: Warehouse[] = knownActive.map((row) => ({ ...row, active: true }))
  const knownIds = new Set(knownActive.map((row) => row.id))
  const baseline = new Date(2025, 7, 5)
  const namePool = ["baby still (сирия)", "sklad 11", "Яндекс Лавка", "ПРОФРЕШ", "Suhrob sklad", "основной", "Asosiy ombor", "Xomashyo", "Tayyor mahsulotlar", "Zaxira sklad"]

  let id = 1
  while (rows.length < ACTIVE_TOTAL) {
    if (!knownIds.has(id)) {
      const date = new Date(baseline)
      date.setDate(date.getDate() - id * 3)
      rows.push({
        id,
        name: `${namePool[id % namePool.length]}${id % 4 === 0 ? ` ${id}` : ""}`,
        address: addressPool[id % addressPool.length],
        branch: branchPool[id % branchPool.length],
        manager: managers[id % managers.length],
        createdDate: fmt(date),
        online: id % 3 === 0,
        active: true,
      })
    }
    id += 1
  }

  const inactiveNames = ["Закрытый склад Юг", "Старый филиал", "Тест удалён", "Демо склад", "Резерв 2024", "Списан 2023", "Временный склад", "Архив Ташкент", "Архив Бухара", "Неактуальный", "Пробный склад", "Старая точка"]
  for (let index = 0; index < inactiveNames.length; index += 1) {
    const date = new Date(2024, index % 12, 10 + index)
    rows.push({
      id: 200 + index,
      name: inactiveNames[index],
      address: addressPool[index % addressPool.length],
      branch: branchPool[index % branchPool.length],
      manager: managers[index % managers.length],
      createdDate: fmt(date),
      online: false,
      active: false,
    })
  }

  return rows
}

function emptyDraft() {
  return { name: "", address: "", branch: branchPool[0], manager: managers[0], online: true }
}

export function WarehousesView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<Warehouse[]>(buildWarehouses)
  const [tab, setTab] = useState<"active" | "inactive">("active")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Warehouse | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const pageSize = 25

  const scoped = useMemo(() => rows.filter((row) => row.active === (tab === "active")), [rows, tab])
  const filtered = useMemo(
    () => scoped.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()) || row.branch.toLowerCase().includes(query.toLowerCase())),
    [scoped, query],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function changeTab(next: "active" | "inactive") {
    setTab(next)
    setQuery("")
    setPage(1)
  }

  function openCreate() {
    setDraft(emptyDraft())
    setEditing("new")
  }

  function openEdit(row: Warehouse) {
    setDraft({ name: row.name, address: row.address, branch: row.branch, manager: row.manager, online: row.online })
    setEditing(row)
  }

  function remove(id: number) {
    if (!window.confirm("Удалить склад?")) return
    setRows((current) => current.filter((row) => row.id !== id))
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim() || !draft.address.trim()) return
    if (editing !== "new" && editing) {
      setRows((current) => current.map((row) => (row.id === editing.id ? { ...row, ...draft, name: draft.name.trim(), address: draft.address.trim() } : row)))
    } else {
      const id = Math.max(0, ...rows.map((row) => row.id)) + 1
      setRows((current) => [{ id, name: draft.name.trim(), address: draft.address.trim(), branch: draft.branch, manager: draft.manager, createdDate: fmt(new Date()), online: draft.online, active: true }, ...current])
    }
    setEditing(null)
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-white"}>
      <div className="flex border-b border-slate-200 text-center">
        <button
          type="button"
          onClick={() => changeTab("active")}
          className={`flex-1 border-b-2 py-4 text-[15px] font-medium ${tab === "active" ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-600 hover:text-slate-800"}`}
        >
          Активные
        </button>
        <button
          type="button"
          onClick={() => changeTab("inactive")}
          className={`flex-1 border-b-2 py-4 text-[15px] font-medium ${tab === "inactive" ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-600 hover:text-slate-800"}`}
        >
          Не активные
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <button type="button" onClick={openCreate} className="text-[15px] text-[#4f70e7] hover:underline">
          + добавить склад
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
            <th className="px-9 py-5">Id</th>
            <th className="px-5 py-5">Наименование</th>
            <th className="px-5 py-5">Адрес</th>
            <th className="px-5 py-5">Филиал</th>
            <th className="px-5 py-5">Зав. склад</th>
            <th className="px-5 py-5">Дата создания</th>
            <th className="px-5 py-5">Вэнсел</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
              <td className="px-9 py-4">{row.id}</td>
              <td className="px-5 py-4 text-[#4f70e7]">{row.name}</td>
              <td className="px-5 py-4">{row.address}</td>
              <td className="px-5 py-4">{row.branch}</td>
              <td className="px-5 py-4">{row.manager}</td>
              <td className="px-5 py-4">{row.createdDate}</td>
              <td className="px-5 py-4">
                <span className={`inline-block h-3 w-3 rounded-full ${row.online ? "bg-emerald-500" : "bg-rose-500"}`} />
              </td>
              <td className="px-5 py-4">
                <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                  <button type="button" onClick={() => openEdit(row)} aria-label="Изменить">
                    <Pencil className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => remove(row.id)} aria-label="Удалить">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={8} className="px-9 py-10 text-center text-slate-400">
                Ничего не найдено
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Добавить склад" : "Изменить склад"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Адрес <span className="text-red-500">*</span>
                <input value={draft.address} onChange={(event) => setDraft((value) => ({ ...value, address: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Филиал
                <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  {branchPool.map((branch) => <option key={branch}>{branch}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Зав. склад
                <select value={draft.manager} onChange={(event) => setDraft((value) => ({ ...value, manager: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  {managers.map((manager) => <option key={manager}>{manager}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={draft.online} onChange={(event) => setDraft((value) => ({ ...value, online: event.target.checked }))} className="h-5 w-5" />
                Вэнсел подключен
              </label>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95">
                Сохранить
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
