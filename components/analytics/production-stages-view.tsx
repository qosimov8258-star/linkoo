"use client"

import Image from "next/image"
import { FormEvent, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Factory,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react"

type Tab = "products" | "operations" | "staff" | "equipment" | "activity"
type Stage = { id: number; name: string }
type Product = { id: number; stageId: number; name: string; type: string; quantity: number }
type Operation = { id: number; stageId: number; name: string; type: string; equipment: string }
type SimpleRow = { id: number; stageId: number; name: string; role: string; value: string }

const initialStages: Stage[] = [
  { id: 1, name: "Konditer maxsulotlari" },
  { id: 2, name: "demotest_proizvotsva_1" },
  { id: 3, name: "Sendvich Bolochka" },
  { id: 4, name: "Klub Sendvich" },
  { id: 5, name: "NEW MANUFACTURING" },
  { id: 6, name: "УПК" },
  { id: 7, name: "Мойка" },
  { id: 8, name: "1 - чистка" },
  { id: 9, name: "Супервайзер | Функции" },
  { id: 10, name: "Агент | Функции0000000" },
  { id: 11, name: "ДСП" },
  { id: 12, name: "buxanka" },
]

const initialProducts: Product[] = initialStages.map((stage, index) => ({
  id: index + 1,
  stageId: stage.id,
  name: index === 0 ? "seriya test" : `${stage.name} product`,
  type: index === 0 ? "Eagle" : index % 2 ? "Готовая продукция" : "Полуфабрикат",
  quantity: index === 0 ? 1 : index + 2,
}))

const initialOperations: Operation[] = [
  { id: 1, stageId: 1, name: "pepsi", type: "Оборудование", equipment: "presa 15 t" },
  { id: 2, stageId: 1, name: "LIST 55", type: "Оборудование", equipment: "presa 15 t" },
  { id: 3, stageId: 1, name: "nuruddin", type: "Трудовые затраты", equipment: "N/A" },
  ...initialStages.slice(1).map((stage, index) => ({
    id: index + 4,
    stageId: stage.id,
    name: `${stage.name} операция`,
    type: index % 2 ? "Трудовые затраты" : "Оборудование",
    equipment: index % 2 ? "N/A" : "Производственная линия",
  })),
]

const initialDetails: Record<Exclude<Tab, "products" | "operations">, SimpleRow[]> = {
  staff: initialStages.map((stage, index) => ({
    id: index + 1,
    stageId: stage.id,
    name: index ? `Сотрудник ${index + 1}` : "Admin Ritm",
    role: index % 2 ? "Оператор" : "Ответственный",
    value: "Активен",
  })),
  equipment: initialStages.map((stage, index) => ({
    id: index + 1,
    stageId: stage.id,
    name: index ? `Оборудование ${index + 1}` : "presa 15 t",
    role: "Производственное оборудование",
    value: `${index + 1} шт.`,
  })),
  activity: initialStages.map((stage, index) => ({
    id: index + 1,
    stageId: stage.id,
    name: index ? `Активность ${index + 1}` : "Запуск производства",
    role: "28 июля 2026, 10:00",
    value: "Выполнено",
  })),
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "products", label: "Продукция" },
  { id: "operations", label: "Операции" },
  { id: "staff", label: "Персонал" },
  { id: "equipment", label: "Оборудование" },
  { id: "activity", label: "Активность" },
]

export function ProductionStagesView() {
  const [favorite, setFavorite] = useState(false)
  const [stages] = useState(initialStages)
  const [selectedStage, setSelectedStage] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>("products")
  const [products, setProducts] = useState(initialProducts)
  const [operations, setOperations] = useState(initialOperations)
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState("Все типы")
  const [modal, setModal] = useState<"product" | "operation" | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formName, setFormName] = useState("")
  const [formType, setFormType] = useState("")
  const [formValue, setFormValue] = useState("")

  const selectedName = stages.find((stage) => stage.id === selectedStage)?.name

  const rows = useMemo(() => {
    if (!selectedStage) return []
    const normalized = query.trim().toLocaleLowerCase("ru")
    if (tab === "products") {
      return products.filter((row) =>
        row.stageId === selectedStage &&
        (typeFilter === "Все типы" || row.type === typeFilter) &&
        (!normalized || `${row.name} ${row.type}`.toLocaleLowerCase("ru").includes(normalized)),
      )
    }
    if (tab === "operations") {
      return operations.filter((row) =>
        row.stageId === selectedStage &&
        (typeFilter === "Все типы" || row.type === typeFilter) &&
        (!normalized || `${row.name} ${row.type} ${row.equipment}`.toLocaleLowerCase("ru").includes(normalized)),
      )
    }
    return initialDetails[tab].filter((row) =>
      row.stageId === selectedStage &&
      (!normalized || `${row.name} ${row.role} ${row.value}`.toLocaleLowerCase("ru").includes(normalized)),
    )
  }, [operations, products, query, selectedStage, tab, typeFilter])

  function chooseStage(id: number) {
    setSelectedStage(id)
    setQuery("")
    setTypeFilter("Все типы")
  }

  function openCreate() {
    setEditingId(null)
    setFormName("")
    setFormType(tab === "operations" ? "Оборудование" : "Готовая продукция")
    setFormValue(tab === "operations" ? "N/A" : "1")
    setModal(tab === "operations" ? "operation" : "product")
  }

  function openEdit(id: number) {
    if (tab === "products") {
      const row = products.find((item) => item.id === id)
      if (!row) return
      setFormName(row.name)
      setFormType(row.type)
      setFormValue(String(row.quantity))
      setModal("product")
    } else if (tab === "operations") {
      const row = operations.find((item) => item.id === id)
      if (!row) return
      setFormName(row.name)
      setFormType(row.type)
      setFormValue(row.equipment)
      setModal("operation")
    }
    setEditingId(id)
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!selectedStage || !modal || !formName.trim()) return
    if (modal === "product") {
      if (editingId) {
        setProducts((current) => current.map((row) => row.id === editingId
          ? { ...row, name: formName.trim(), type: formType, quantity: Math.max(1, Number(formValue) || 1) }
          : row))
      } else {
        setProducts((current) => [...current, {
          id: Math.max(0, ...current.map((row) => row.id)) + 1,
          stageId: selectedStage,
          name: formName.trim(),
          type: formType,
          quantity: Math.max(1, Number(formValue) || 1),
        }])
      }
    } else {
      if (editingId) {
        setOperations((current) => current.map((row) => row.id === editingId
          ? { ...row, name: formName.trim(), type: formType, equipment: formValue.trim() || "N/A" }
          : row))
      } else {
        setOperations((current) => [...current, {
          id: Math.max(0, ...current.map((row) => row.id)) + 1,
          stageId: selectedStage,
          name: formName.trim(),
          type: formType,
          equipment: formValue.trim() || "N/A",
        }])
      }
    }
    setModal(null)
  }

  function remove(id: number) {
    if (tab === "products") setProducts((current) => current.filter((row) => row.id !== id))
    if (tab === "operations") setOperations((current) => current.filter((row) => row.id !== id))
  }

  const productOrOperation = tab === "products" || tab === "operations"
  const addLabel = tab === "operations" ? "Добавить операцию" : "Добавить продукцию"
  const types = tab === "operations"
    ? ["Все типы", "Оборудование", "Трудовые затраты"]
    : ["Все типы", "Eagle", "Готовая продукция", "Полуфабрикат"]

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 text-slate-800">
      <header className="px-8 py-4">
        <button
          onClick={() => setFavorite((value) => !value)}
          className="flex items-center gap-3"
          aria-label="Избранные | Этапы производства"
        >
          <Star className={`h-7 w-7 ${favorite ? "fill-amber-400 text-amber-400" : "fill-slate-600 text-slate-600"}`} />
          <span className="text-2xl font-semibold text-blue-600">Избранные</span>
          <span className="text-2xl text-slate-500">|</span>
          <span className="text-2xl font-semibold text-slate-600">Этапы производства</span>
        </button>
      </header>

      <div className="grid min-h-[calc(100vh-8.5rem)] grid-cols-[350px_minmax(0,1fr)]">
        <aside className="border-r border-slate-300 bg-slate-100">
          <h2 className="border-b border-slate-300 px-9 py-6 text-lg font-semibold">Этапы производства</h2>
          <div className="max-h-[calc(100vh-14rem)] overflow-y-auto">
            {stages.map((stage) => (
              <button
                key={stage.id}
                onClick={() => chooseStage(stage.id)}
                className={`flex w-full items-center gap-3 border-b border-slate-200 px-9 py-5 text-left text-lg transition ${
                  selectedStage === stage.id ? "bg-white text-blue-600 shadow-sm" : "hover:bg-white/70"
                }`}
              >
                <Factory className="h-6 w-6 shrink-0 text-slate-600" />
                <span>{stage.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 px-9">
          <nav className="grid grid-cols-5 overflow-hidden rounded-sm bg-white shadow">
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => { setTab(item.id); setQuery(""); setTypeFilter("Все типы") }}
                className={`border-b-2 px-4 py-6 text-lg ${
                  tab === item.id ? "border-blue-600 font-semibold text-blue-600" : "border-transparent text-black"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {!selectedStage ? (
            <div className="mt-6 flex min-h-[370px] flex-col items-center justify-center bg-white shadow">
              <Image src="/robot-mascot.png" alt="Робот-помощник" width={190} height={190} priority />
              <p className="mt-5 text-xl text-slate-500">Выберите производство...</p>
            </div>
          ) : (
            <div className="mt-6">
              <div className="mb-5 flex items-center justify-between">
                <p className="text-lg text-slate-500">Производство: <strong className="text-slate-700">{selectedName}</strong></p>
                {productOrOperation && (
                  <button onClick={openCreate} className="flex items-center gap-1 text-lg text-blue-600">
                    <Plus className="h-5 w-5" /> {addLabel}
                  </button>
                )}
              </div>

              <div className="overflow-hidden bg-white shadow">
                <div className="flex flex-wrap items-center justify-between gap-5 px-2 py-4">
                  <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center text-blue-600">
                    Показать фильтр <ChevronDown className="h-4 w-4" />
                  </button>
                  <label className="relative w-80 max-w-full">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Поиск"
                      className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-blue-600"
                    />
                    <Search className="absolute right-1 top-2 h-6 w-6 text-slate-400" />
                  </label>
                  <div className="flex items-center gap-5 text-slate-600">
                    <span>25</span><ChevronDown className="h-4 w-4 text-slate-300" />
                    <span>{rows.length ? `1 - ${rows.length} из ${rows.length}` : "0 - 0 из 0"}</span>
                    <ChevronLeft className="h-7 w-7 text-slate-300" />
                    <ChevronRight className="h-7 w-7 text-slate-300" />
                  </div>
                </div>

                {filterOpen && (
                  <div className="border-t bg-slate-50 p-4">
                    <label className="block max-w-md">
                      <span className="mb-2 block text-sm font-semibold">Тип</span>
                      <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="w-full border-b bg-white p-2">
                        {types.map((type) => <option key={type}>{type}</option>)}
                      </select>
                    </label>
                  </div>
                )}

                <table className="w-full table-fixed border-collapse">
                  <thead className="bg-[#626b7e] text-left text-white">
                    <tr>
                      <th className="px-9 py-5">Наименование</th>
                      <th className="px-9 py-5">{tab === "products" ? "Тип товара" : tab === "operations" ? "Тип товара" : "Тип / роль"}</th>
                      <th className="px-9 py-5">{tab === "products" ? "Кол-во" : tab === "operations" ? "Оборудование" : "Значение"}</th>
                      {productOrOperation && <th className="w-32 px-5 py-5" />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isProduct = "quantity" in row
                      const isOperation = "equipment" in row
                      return (
                        <tr key={row.id} className="border-b border-dashed border-slate-300 even:bg-slate-50 hover:bg-slate-100">
                          <td className="px-9 py-5">{row.name}</td>
                          <td className="px-9 py-5">{isProduct ? row.type : isOperation ? row.type : row.role}</td>
                          <td className="px-9 py-5">{isProduct ? `${row.quantity} шт` : isOperation ? row.equipment : row.value}</td>
                          {productOrOperation && (
                            <td className="px-5 py-5">
                              <div className="flex gap-4">
                                <button onClick={() => openEdit(row.id)} aria-label={`Редактировать ${row.name}`}><Pencil className="h-5 w-5 text-slate-600" /></button>
                                <button onClick={() => remove(row.id)} aria-label={`Удалить ${row.name}`}><Trash2 className="h-5 w-5 text-slate-600" /></button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                    {!rows.length && (
                      <tr><td colSpan={productOrOperation ? 4 : 3} className="p-16 text-center text-slate-400">По вашему запросу ничего не найдено...</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <form onSubmit={save} className="w-full max-w-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-7 py-5">
              <h2 className="text-xl font-bold">{editingId ? "РЕДАКТИРОВАТЬ" : "ДОБАВИТЬ"} {modal === "product" ? "ПРОДУКЦИЮ" : "ОПЕРАЦИЮ"}</h2>
              <button type="button" onClick={() => setModal(null)} aria-label="Закрыть"><X className="h-6 w-6" /></button>
            </div>
            <div className="grid gap-6 p-7 md:grid-cols-2">
              <label className="md:col-span-2">
                <span className="mb-2 block font-semibold">Наименование</span>
                <input required value={formName} onChange={(event) => setFormName(event.target.value)} className="w-full border-b p-2 outline-none focus:border-blue-600" />
              </label>
              <label>
                <span className="mb-2 block font-semibold">Тип</span>
                <select value={formType} onChange={(event) => setFormType(event.target.value)} className="w-full border-b p-2">
                  {(modal === "product" ? ["Eagle", "Готовая продукция", "Полуфабрикат"] : ["Оборудование", "Трудовые затраты"]).map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-2 block font-semibold">{modal === "product" ? "Количество" : "Оборудование"}</span>
                <input required value={formValue} onChange={(event) => setFormValue(event.target.value)} type={modal === "product" ? "number" : "text"} min={modal === "product" ? 1 : undefined} className="w-full border-b p-2 outline-none focus:border-blue-600" />
              </label>
            </div>
            <div className="flex justify-end border-t p-5">
              <button type="submit" className="rounded-md bg-emerald-400 px-7 py-3 font-semibold text-white">СОХРАНИТЬ</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
