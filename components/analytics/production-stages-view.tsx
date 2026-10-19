"use client"

import Image from "next/image"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Factory,
  FileText,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { RefHeader, RefPage } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

const PRODUCT_IMPORT_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "тип товара": "type", "тип": "type", "type": "type",
  "кол-во": "quantity", "количество": "quantity", "quantity": "quantity",
}
const OPERATION_IMPORT_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "тип товара": "type", "тип": "type", "type": "type",
  "оборудование": "equipment", "equipment": "equipment",
}

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
  { id: 5, name: "NEW MANAFACTURING" },
  { id: 6, name: "УПК" },
  { id: 7, name: "Мойка" },
  { id: 8, name: "1-chistka" },
  { id: 9, name: "Supervayzer funksiyalari" },
  { id: 10, name: "Agent funksiyalari" },
  { id: 11, name: "DSP" },
  { id: 12, name: "buxanka" },
  { id: 13, name: "etap 1" },
  { id: 14, name: "Производства1" },
]

const initialProducts: Product[] = initialStages.map((stage, index) => ({
  id: index + 1,
  stageId: stage.id,
  name: index === 0 ? "seriya test" : `${stage.name} product`,
  type: index === 0 ? "Eagle" : index % 2 ? "Готовая продукция" : "Полуфабрикат",
  quantity: index === 0 ? 1 : index + 2,
}))

const initialOperations: Operation[] = []

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
  const { t } = useLanguage()
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
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/production-stage-items")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить данные")
        return (await response.json()) as Array<{
          id: number
          stageId: number
          kind: "product" | "operation"
          name: string
          type: string
          quantity: number | null
          equipment: string | null
        }>
      })
      .then((data) => {
        if (cancelled) return
        setProducts(
          data
            .filter((item) => item.kind === "product")
            .map((item) => ({ id: item.id, stageId: item.stageId, name: item.name, type: item.type, quantity: item.quantity ?? 1 })),
        )
        setOperations(
          data
            .filter((item) => item.kind === "operation")
            .map((item) => ({ id: item.id, stageId: item.stageId, name: item.name, type: item.type, equipment: item.equipment ?? "N/A" })),
        )
      })
      .catch(() => {
        if (!cancelled) window.alert("Не удалось загрузить данные с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])

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

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!selectedStage || !modal || !formName.trim()) return
    const isProduct = modal === "product"
    const body = JSON.stringify({
      stageId: selectedStage,
      kind: modal,
      name: formName.trim(),
      type: formType,
      quantity: isProduct ? Math.max(1, Number(formValue) || 1) : undefined,
      equipment: !isProduct ? (formValue.trim() || "N/A") : undefined,
    })
    try {
      if (editingId) {
        const response = await fetch(`/api/production-stage-items/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось сохранить запись")
          return
        }
        const saved = await response.json()
        if (isProduct) {
          setProducts((current) => current.map((row) => row.id === editingId ? { id: saved.id, stageId: saved.stageId, name: saved.name, type: saved.type, quantity: saved.quantity ?? 1 } : row))
        } else {
          setOperations((current) => current.map((row) => row.id === editingId ? { id: saved.id, stageId: saved.stageId, name: saved.name, type: saved.type, equipment: saved.equipment ?? "N/A" } : row))
        }
      } else {
        const response = await fetch("/api/production-stage-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось создать запись")
          return
        }
        const saved = await response.json()
        if (isProduct) {
          setProducts((current) => [...current, { id: saved.id, stageId: saved.stageId, name: saved.name, type: saved.type, quantity: saved.quantity ?? 1 }])
        } else {
          setOperations((current) => [...current, { id: saved.id, stageId: saved.stageId, name: saved.name, type: saved.type, equipment: saved.equipment ?? "N/A" }])
        }
      }
      setModal(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/production-stage-items/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить запись")
        return
      }
      if (tab === "products") setProducts((current) => current.filter((row) => row.id !== id))
      if (tab === "operations") setOperations((current) => current.filter((row) => row.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function downloadTemplate() {
    if (tab === "operations") {
      downloadExcelTable("operations-template", [["Наименование", "Тип товара", "Оборудование"]])
    } else {
      downloadExcelTable("products-template", [["Наименование", "Тип товара", "Кол-во"]])
    }
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile || !selectedStage) return
    setImportSaving(true)
    try {
      const rows = await readExcelRows(importFile)
      if (!rows.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      const isOperation = tab === "operations"
      const aliases = isOperation ? OPERATION_IMPORT_ALIASES : PRODUCT_IMPORT_ALIASES
      const fieldByIndex = mapHeaderColumns(rows[0], aliases)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: { name: string; type: string; extra: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.type = row[1] ?? ""
          record[isOperation ? "equipment" : "quantity"] = row[2] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name,
          type: record.type || (isOperation ? "Оборудование" : "Готовая продукция"),
          extra: isOperation ? (record.equipment || "N/A") : (record.quantity || "1"),
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const bodies = parsed.map((item) =>
        isOperation
          ? { stageId: selectedStage, kind: "operation", name: item.name, type: item.type, equipment: item.extra }
          : { stageId: selectedStage, kind: "product", name: item.name, type: item.type, quantity: Math.max(1, Number(item.extra) || 1) },
      )

      const createdProducts: Product[] = []
      const createdOperations: Operation[] = []
      let failed = 0
      for (const body of bodies) {
        try {
          const response = await fetch("/api/production-stage-items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
          if (response.ok) {
            const saved = await response.json()
            if (isOperation) createdOperations.push({ id: saved.id, stageId: saved.stageId, name: saved.name, type: saved.type, equipment: saved.equipment ?? "N/A" })
            else createdProducts.push({ id: saved.id, stageId: saved.stageId, name: saved.name, type: saved.type, quantity: saved.quantity ?? 1 })
          } else {
            failed += 1
          }
        } catch {
          failed += 1
        }
      }
      if (createdOperations.length) setOperations((current) => [...current, ...createdOperations])
      if (createdProducts.length) setProducts((current) => [...current, ...createdProducts])
      if (failed) window.alert(`Импортировано ${bodies.length - failed} из ${bodies.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  const productOrOperation = tab === "products" || tab === "operations"
  const addLabel = tab === "operations" ? "Добавить операцию" : "Добавить продукцию"
  const types = tab === "operations"
    ? ["Все типы", "Оборудование", "Трудовые затраты"]
    : ["Все типы", "Eagle", "Готовая продукция", "Полуфабрикат"]

  return (
    <RefPage>
      <RefHeader title="Этапы производства" />
      <div className="-mx-7 grid min-h-[calc(100vh-130px)] grid-cols-[280px_minmax(0,1fr)] gap-[30px]">
        <aside>
          <h2 className="px-[30px] pb-[16px] pt-[14px] text-[13px] font-bold">Этапы производства</h2>
          <div className="bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {stages.map((stage) => (
              <button
                key={stage.id}
                onClick={() => chooseStage(stage.id)}
                className={`flex h-[50px] w-full items-center gap-[10px] border-b border-[#efefef] px-[30px] text-left text-[13px] transition ${
                  selectedStage === stage.id ? "bg-[#f2f5f8] text-[#4f71dc]" : "hover:bg-[#f7f9fb]"
                }`}
              >
                <Factory className="h-5 w-5 shrink-0 text-[#555]" />
                <span>{stage.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 pr-[30px]">
          <nav className="flex h-[54px] overflow-hidden rounded-[2px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {tabs.map((item) => (
              <button
                key={item.id}
                onClick={() => { setTab(item.id); setQuery(""); setTypeFilter("Все типы") }}
                className={`border-b-[3px] px-[22px] text-[13px] font-medium ${
                  tab === item.id ? "border-[#4f71dc] text-[#4f71dc]" : "border-transparent text-black"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {!selectedStage ? (
            <div className="mt-[20px] flex min-h-[294px] flex-col items-center justify-center bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
              <Image src="/robot-empty.png" alt="Робот-помощник" width={190} height={190} priority className="h-[160px] w-[160px] object-contain" />
              <p className="mt-[8px] text-[13px] text-[#666]">Выберите производство...</p>
            </div>
          ) : (
            <div className="mt-6">
              <div className="mb-5 flex items-center justify-between">
                <p className="text-lg text-slate-500">Производство: <strong className="text-slate-700">{selectedName}</strong></p>
                {productOrOperation && (
                  <div className="flex items-center gap-4">
                    <button onClick={openCreate} className="flex items-center gap-1 text-lg text-blue-600">
                      <Plus className="h-5 w-5" /> {addLabel}
                    </button>
                    <button onClick={() => setImportOpen(true)} className="flex items-center gap-1 text-lg text-blue-600">
                      <FileText className="h-5 w-5" /> Импорт с Excel
                    </button>
                  </div>
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
                  <thead className="bg-[#5d6474] text-left text-white">
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

      {importOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-7 py-5">
              <h2 className="text-xl font-bold">ИМПОРТ С EXCEL</h2>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label="Закрыть"><X className="h-6 w-6" /></button>
            </div>
            <div className="p-7">
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-blue-600 hover:underline">
                1. Скачать шаблон
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-blue-600 hover:text-blue-600"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
              </button>
            </div>
            <div className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded-md bg-emerald-400 px-7 py-3 font-semibold text-white disabled:opacity-40">
                {importSaving ? "Импорт..." : "СОХРАНИТЬ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </RefPage>
  )
}
