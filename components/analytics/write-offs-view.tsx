"use client"

import { Ban, Download, Minus, Plus, Printer, Search, Star, X, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react"
import { Fragment, FormEvent, useMemo, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"

type WriteOffItem = { id: number; product: string; code: string; series: string; block: number; qty: number; cost: number; sum: number }
type WriteOff = { id: number; creator: string; warehouse: string; date: string; status: "закрыт" | "открыт"; comment: string; reason: string; items: WriteOffItem[] }

const warehouses = ["05,08,2025(1)", "Andijon skladi", "toshkent", "Suhrob sklad", "основной"]
const reasons = ["Порча", "Истек срок годности", "Недостача", "Брак", "Прочее"]
const products = ["Muzlatkich 2", "sndwch", "g'ilof", "robot moshina", "energetik 1 l", "coca-cola"]

const monthNames = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
function fmt(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

const knownRows: Omit<WriteOff, "items" | "comment" | "reason">[] = [
  { id: 69, creator: "Admin Ritm", warehouse: "05,08,2025(1)", date: "24 июня 2026", status: "закрыт" },
  { id: 68, creator: "Admin Ritm", warehouse: "05,08,2025(1)", date: "11 апр. 2026", status: "закрыт" },
  { id: 67, creator: "Admin Ritm", warehouse: "05,08,2025(1)", date: "16 мар. 2026", status: "закрыт" },
  { id: 66, creator: "Admin Ritm", warehouse: "Andijon skladi", date: "06 февр. 2026", status: "закрыт" },
  { id: 65, creator: "Admin Ritm", warehouse: "05,08,2025(1)", date: "05 февр. 2026", status: "закрыт" },
]

function buildRows(): WriteOff[] {
  const rows: WriteOff[] = knownRows.map((row) => ({
    ...row,
    comment: "",
    reason: reasons[row.id % reasons.length],
    items:
      row.id === 67
        ? [{ id: 1, product: "Muzlatkich 2", code: "-", series: "-", block: 0, qty: 10, cost: 51176.499, sum: 511764.994 }]
        : [{ id: 1, product: products[row.id % products.length], code: "-", series: "-", block: 0, qty: 1 + (row.id % 15), cost: 1000 + (row.id * 373) % 90000, sum: 0 }],
  }))
  rows.forEach((row) => {
    if (row.id !== 67) row.items[0].sum = row.items[0].qty * row.items[0].cost
  })

  const baseline = new Date(2026, 1, 5)
  for (let id = 64; id >= 5; id -= 1) {
    const offsetDays = (65 - id) * 6
    const date = new Date(baseline)
    date.setDate(date.getDate() - offsetDays)
    const qty = 1 + (id % 15)
    const cost = 1000 + (id * 373) % 90000
    rows.push({
      id,
      creator: "Admin Ritm",
      warehouse: warehouses[id % warehouses.length],
      date: fmt(date),
      status: "закрыт",
      comment: "",
      reason: reasons[id % reasons.length],
      items: [{ id: 1, product: products[id % products.length], code: "-", series: "-", block: 0, qty, cost, sum: qty * cost }],
    })
  }

  return rows
}

function money(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
}

type DraftItem = { id: number; product: string; qty: number; cost: number }

export function WriteOffsView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<WriteOff[]>(buildRows)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [favorite, setFavorite] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [draftWarehouse, setDraftWarehouse] = useState(warehouses[0])
  const [draftReason, setDraftReason] = useState(reasons[0])
  const [draftComment, setDraftComment] = useState("")
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const pageSize = 25

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !String(row.id).includes(query) && !row.warehouse.toLowerCase().includes(query.toLowerCase())) return false
      if (warehouseFilter !== "all" && row.warehouse !== warehouseFilter) return false
      return true
    })
  }, [rows, query, warehouseFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleExpand(row: WriteOff) {
    setExpandedId((current) => (current === row.id ? null : row.id))
  }

  function cancelWriteOff(row: WriteOff) {
    if (!window.confirm(`Отменить списание № ${row.id}? Товар будет возвращён на склад.`)) return
    setRows((current) => current.filter((item) => item.id !== row.id))
    if (expandedId === row.id) setExpandedId(null)
  }

  function openCreate() {
    setDraftWarehouse(warehouses[0])
    setDraftReason(reasons[0])
    setDraftComment("")
    setDraftItems([])
    setModalOpen(true)
  }

  function addBlankItem() {
    setDraftItems((current) => [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product: products[0], qty: 1, cost: 0 }])
  }

  function updateDraftItem(id: number, patch: Partial<DraftItem>) {
    setDraftItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeDraftItem(id: number) {
    setDraftItems((current) => current.filter((item) => item.id !== id))
  }

  const draftTotal = draftItems.reduce((sum, item) => sum + item.qty * item.cost, 0)

  function save(event: FormEvent) {
    event.preventDefault()
    if (!draftItems.length) return
    const id = Math.max(0, ...rows.map((row) => row.id)) + 1
    const newRow: WriteOff = {
      id,
      creator: "Admin Ritm",
      warehouse: draftWarehouse,
      date: fmt(new Date()),
      status: "закрыт",
      comment: draftComment || "",
      reason: draftReason,
      items: draftItems.map((item) => ({ id: item.id, product: item.product, code: "-", series: "-", block: 0, qty: item.qty, cost: item.cost, sum: item.qty * item.cost })),
    }
    setRows((current) => [newRow, ...current])
    setModalOpen(false)
  }

  function downloadList() {
    downloadExcelTable("spisanie", [
      ["№", "Создал", "Склад", "Дата создания", "Статус"],
      ...filtered.map((row) => [row.id, row.creator, row.warehouse, row.date, row.status]),
    ])
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <button type="button" onClick={() => setFavorite((value) => !value)} className="inline-flex items-center gap-2 text-[#4f70e7]">
              <Star className={`h-5 w-5 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} /> Избранные
            </button>
            <span className="mx-2 text-slate-400">|</span> Списание
          </h1>
          <button type="button" onClick={openCreate} className="text-[15px] font-medium text-[#ff7a59] hover:underline">
            Списание товара
          </button>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
            Показать фильтр <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
            <label className="text-sm text-slate-600">
              Склад:{" "}
              <select value={warehouseFilter} onChange={(event) => { setWarehouseFilter(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">Все</option>
                {warehouses.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}
              </select>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
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
          <button type="button" onClick={downloadList} aria-label="Скачать" className="text-slate-500 hover:text-[#4f70e7]">
            <Download className="h-5 w-5" />
          </button>
          {embedded && (
            <button type="button" onClick={openCreate} className="text-sm font-medium text-[#ff7a59] hover:underline">
              Списание товара
            </button>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">№</th>
              <th className="px-5 py-5">Создал</th>
              <th className="px-5 py-5">Склад</th>
              <th className="px-5 py-5">Дата создания</th>
              <th className="px-5 py-5">Статус</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{row.id}</td>
                  <td className="px-5 py-4 text-[#4f70e7]">{row.creator}</td>
                  <td className="px-5 py-4">{row.warehouse}</td>
                  <td className="px-5 py-4">{row.date}</td>
                  <td className="px-5 py-4 text-emerald-500">{row.status}</td>
                </tr>

                {expandedId === row.id && (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex items-center justify-between">
                          <h2 className="text-xl font-bold text-slate-700">Списание № {row.id}</h2>
                          <div className="flex items-center gap-3 text-slate-500">
                            <button type="button" onClick={() => cancelWriteOff(row)} aria-label="Отменить списание" className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-400 text-white hover:bg-rose-500">
                              <Minus className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => window.print()} aria-label="Печать" className="hover:text-[#4f70e7]">
                              <Printer className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
                          <div>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Создал</dt><dd className="font-medium">{row.creator}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Склад</dt><dd className="font-medium">{row.warehouse}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Дата создания</dt><dd className="font-medium">{row.date}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Статус</dt><dd className="font-medium text-emerald-500">{row.status}</dd></div>
                            </dl>
                            <p className="mb-1 mt-5 font-medium text-slate-800">Комментарий:</p>
                            <p className="text-sm text-slate-500">{row.comment || "Комментарий отсутствует"}</p>
                          </div>

                          <div>
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-2 pr-4">Товар</th>
                                  <th className="py-2 pr-4">Код товара</th>
                                  <th className="py-2 pr-4">Серия</th>
                                  <th className="py-2 pr-4">Блок</th>
                                  <th className="py-2 pr-4">Кол-во</th>
                                  <th className="py-2 pr-4">Себестоимость</th>
                                  <th className="py-2 pr-4">Сумма</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.items.map((item) => (
                                  <tr key={item.id} className="border-t border-slate-100">
                                    <td className="py-2 pr-4">{item.product}</td>
                                    <td className="py-2 pr-4">{item.code}</td>
                                    <td className="py-2 pr-4">{item.series}</td>
                                    <td className="py-2 pr-4">{item.block}</td>
                                    <td className="py-2 pr-4">{item.qty}</td>
                                    <td className="py-2 pr-4">{money(item.cost)}</td>
                                    <td className="py-2 pr-4">{money(item.sum)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-10">
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Списание товара</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Склад <span className="text-red-500">*</span>
                <select value={draftWarehouse} onChange={(event) => setDraftWarehouse(event.target.value)} className="mt-2 block w-full bg-white outline-none">
                  {warehouses.map((warehouse) => <option key={warehouse}>{warehouse}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Причина списания <span className="text-red-500">*</span>
                <select value={draftReason} onChange={(event) => setDraftReason(event.target.value)} className="mt-2 block w-full bg-white outline-none">
                  {reasons.map((reason) => <option key={reason}>{reason}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Комментарий
                <textarea value={draftComment} onChange={(event) => setDraftComment(event.target.value)} rows={2} className="mt-2 block w-full resize-none outline-none" />
              </label>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-medium text-slate-800">Товары</p>
                  <button type="button" onClick={addBlankItem} className="inline-flex items-center gap-1 text-sm text-[#4f70e7] hover:underline">
                    <Plus className="h-4 w-4" /> добавить товар
                  </button>
                </div>

                {draftItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-10 text-slate-400">
                    <Ban className="h-10 w-10" />
                    <p>
                      Товары не добавлены.{" "}
                      <button type="button" onClick={addBlankItem} className="text-[#4f70e7] hover:underline">
                        Добавить товар?
                      </button>
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="py-2 pr-4">Товар</th>
                        <th className="py-2 pr-4">Кол-во</th>
                        <th className="py-2 pr-4">Себестоимость</th>
                        <th className="py-2 pr-4">Сумма</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {draftItems.map((item) => (
                        <tr key={item.id} className="border-t border-slate-100">
                          <td className="py-2 pr-4">
                            <select value={item.product} onChange={(event) => updateDraftItem(item.id, { product: event.target.value })} className="bg-white outline-none">
                              {products.map((product) => <option key={product}>{product}</option>)}
                            </select>
                          </td>
                          <td className="py-2 pr-4">
                            <input type="number" min={0} value={item.qty} onChange={(event) => updateDraftItem(item.id, { qty: Number(event.target.value) })} className="w-20 border-b border-slate-200 outline-none" />
                          </td>
                          <td className="py-2 pr-4">
                            <input type="number" min={0} value={item.cost} onChange={(event) => updateDraftItem(item.id, { cost: Number(event.target.value) })} className="w-28 border-b border-slate-200 outline-none" />
                          </td>
                          <td className="py-2 pr-4">{money(item.qty * item.cost)}</td>
                          <td className="py-2 pr-4 text-right">
                            <button type="button" onClick={() => removeDraftItem(item.id)} aria-label="Удалить" className="text-slate-400 hover:text-rose-500">
                              <X className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <footer className="flex items-center justify-between border-t p-5">
              <div className="text-sm text-slate-600">
                Общая сумма: <b>{money(draftTotal)}</b>
              </div>
              <button type="submit" disabled={!draftItems.length} className="rounded bg-[#ff7a59] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                Списать
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
