"use client"

import Image from "next/image"
import { CheckSquare, ChevronLeft, ChevronRight, ListChecks, PackagePlus, Search, Trash2, X } from "lucide-react"
import { FormEvent, useEffect, useMemo, useState } from "react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type Restriction = { id: number; employee: string; items: string[] }
type Tab = "products" | "types"

const employees = ["Admin Ritm", "Samandar Abdurahmonov", "Temur Raupov", "Fozil Agent", "Хайрулло Доставщик"]
const products = ["coca-cola", "lipton", "sprayt", "energetik", "Холодильник", "g'ilof", "baby still", "Lalaku"]
const productTypes = ["Напитки", "Снеки", "Бытовая химия", "Молочные продукты", "Кондитерские изделия"]

type ModalMode = "add" | "remove" | "replace" | null

export function ProductRestrictionsView() {
  const [tab, setTab] = useState<Tab>("products")
  const [productRestrictions, setProductRestrictions] = useState<Restriction[]>([])
  const [typeRestrictions, setTypeRestrictions] = useState<Restriction[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [modalEmployee, setModalEmployee] = useState(employees[0])
  const [modalItems, setModalItems] = useState<string[]>([])
  const [applying, setApplying] = useState(false)
  const pageSize = 25

  const restrictions = tab === "products" ? productRestrictions : typeRestrictions
  const setRestrictions = tab === "products" ? setProductRestrictions : setTypeRestrictions
  const itemPool = tab === "products" ? products : productTypes

  useEffect(() => {
    let cancelled = false
    fetch(`/api/product-restrictions?scope=${tab}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить ограничения")
        return (await response.json()) as Restriction[]
      })
      .then((data) => {
        if (!cancelled) setRestrictions(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const filtered = useMemo(() => restrictions.filter((row) => row.employee.toLowerCase().includes(query.toLowerCase())), [restrictions, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openModal(mode: ModalMode) {
    setModalEmployee(employees[0])
    setModalItems([])
    setModalMode(mode)
  }

  function toggleItem(item: string) {
    setModalItems((current) => (current.includes(item) ? current.filter((value) => value !== item) : [...current, item]))
  }

  async function apply(event: FormEvent) {
    event.preventDefault()
    if (!modalItems.length || !modalMode) {
      setModalMode(null)
      return
    }
    setApplying(true)
    try {
      const response = await fetch("/api/product-restrictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: tab, employee: modalEmployee, mode: modalMode, items: modalItems }),
      })
      if (!response.ok) {
        window.alert("Не удалось сохранить ограничения")
        return
      }
      const list = (await response.json()) as Restriction[]
      setRestrictions(list)
      setModalMode(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setApplying(false)
    }
  }

  const modalTitle = modalMode === "add" ? "Добавить продукты" : modalMode === "remove" ? "Убрать продукты" : "Стереть и добавить"

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-slate-600">
          <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
          <span className="mx-2 text-slate-400">|</span> Ограничение продуктов
        </h1>
      </header>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex border-b border-slate-200 text-center">
          <button
            type="button"
            onClick={() => { setTab("products"); setPage(1) }}
            className={`flex-1 border-b-2 py-4 text-[15px] font-medium ${tab === "products" ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-600 hover:text-slate-800"}`}
          >
            По продуктам
          </button>
          <button
            type="button"
            onClick={() => { setTab("types"); setPage(1) }}
            className={`flex-1 border-b-2 py-4 text-[15px] font-medium ${tab === "types" ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-600 hover:text-slate-800"}`}
          >
            По типам продуктов
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
          <ListChecks className="h-5 w-5 text-slate-400" />
          <button type="button" onClick={() => openModal("add")} className="ml-auto inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <PackagePlus className="h-4 w-4" /> Добавить продукты
          </button>
          <button type="button" onClick={() => openModal("remove")} className="inline-flex items-center gap-2 rounded bg-[#ff8967] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <Trash2 className="h-4 w-4" /> Убрать продукты
          </button>
          <button type="button" onClick={() => openModal("replace")} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <CheckSquare className="h-4 w-4" /> Стереть и добавить
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">№</th>
              <th className="px-5 py-5">Сотрудник</th>
              <th className="px-5 py-5">Количество продуктов</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{row.id}</td>
                <td className="px-5 py-4 text-[#4f70e7]">{row.employee}</td>
                <td className="px-5 py-4">{row.items.length}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="flex min-h-[340px] flex-col items-center justify-center gap-4 py-10">
            <Image src="/robot-mascot.png" alt="Робот-помощник" width={150} height={150} priority className="h-36 w-36 object-contain" />
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={apply} className="flex max-h-[85vh] w-full max-w-lg flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{modalTitle}</b>
              <button type="button" onClick={() => setModalMode(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Сотрудник
                <select value={modalEmployee} onChange={(event) => setModalEmployee(event.target.value)} className="mt-2 block w-full bg-white outline-none">
                  {employees.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <div>
                <p className="mb-2 font-medium text-slate-800">{tab === "products" ? "Продукты" : "Типы продуктов"}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {itemPool.map((item) => (
                    <label key={item} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={modalItems.includes(item)} onChange={() => toggleItem(item)} />
                      {item}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={applying} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {applying ? "Применение..." : "Применить"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
