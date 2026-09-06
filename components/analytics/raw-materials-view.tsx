"use client"

import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  ListChecks,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  rawMaterialOrganizations as organizations,
  rawMaterialPriceListOptions as priceListOptions,
  rawMaterialUnits as units,
  type RawMaterial,
} from "./raw-materials-data"

// Maps flexible spreadsheet header text to raw-material fields so imports
// work regardless of column order or which template produced the file.
const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "наименование обязательно": "name", "name": "name", "товар": "name",
  "полное наименование": "fullName", "полное название": "fullName", "full name": "fullName",
  "штрихкод": "barcode", "штрих код": "barcode", "штрих код товара": "barcode", "barcode": "barcode",
  "артикул": "article", "article": "article", "sku": "article",
  "тип": "type", "тип товара": "type", "type": "type", "категория": "type",
  "организация": "organization", "organization": "organization",
  "мера": "unit", "мера обязательно": "unit", "единица": "unit", "единица измерения": "unit", "unit": "unit",
  "доп мера": "subUnit", "sub unit": "subUnit",
  "бренд": "brand", "brand": "brand",
  "поставщик": "supplier", "supplier": "supplier",
  "мин остаток": "minStock", "минимальный остаток": "minStock", "min stock": "minStock",
  "цвет": "color", "color": "color",
  "вес": "mass", "масса": "mass", "weight": "mass",
  "чистый вес": "netWeight", "net weight": "netWeight",
  "объем": "volume", "объём": "volume", "volume": "volume",
  "описание": "description", "description": "description",
  "порядковый номер": "orderNumber", "order number": "orderNumber",
}

function emptyDraft() {
  return {
    name: "", fullName: "", unit: units[0], type: "", supplier: "", brand: "", organization: organizations[0], orderNumber: "", minStock: "", color: "",
    barcode: "", article: "", integrationCode: "", mass: "", netWeight: "", volume: "", description: "", subUnit: "",
    canSell: true, onlyMml: false, showAsInventory: false, groupOnly: false, showInBot: true, trackExpiry: false, markedProduct: false,
    priceList: priceListOptions[0], cashPrice: "", nonCashPrice: "",
  }
}

type RawMaterialInput = Omit<RawMaterial, "id" | "createdDate">

function draftToInput(draft: ReturnType<typeof emptyDraft>): RawMaterialInput {
  return {
    name: draft.name.trim(), fullName: draft.fullName.trim() || draft.name.trim(), unit: draft.unit, type: draft.type, subUnit: draft.subUnit,
    supplier: draft.supplier || "Не указано", brand: draft.brand || "No brand", organization: draft.organization, orderNumber: draft.orderNumber,
    minStock: draft.minStock || "0", color: draft.color || "Не указано", barcode: draft.barcode || "не установлен", article: draft.article,
    integrationCode: draft.integrationCode, mass: draft.mass || "0", netWeight: draft.netWeight || "0", volume: draft.volume || "Не указано",
    description: draft.description || "Не указано", canSell: draft.canSell, onlyMml: draft.onlyMml, showAsInventory: draft.showAsInventory,
    groupOnly: draft.groupOnly, showInBot: draft.showInBot, trackExpiry: draft.trackExpiry, markedProduct: draft.markedProduct,
    priceList: draft.priceList, cashPrice: draft.cashPrice || "0", nonCashPrice: draft.nonCashPrice || "0",
  }
}

export function RawMaterialsView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<RawMaterial[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState("all")
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [saving, setSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const updateInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/raw-materials")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить сырьё")
        return (await response.json()) as RawMaterial[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Не удалось загрузить сырьё с сервера"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const availableTypes = useMemo(() => Array.from(new Set(rows.map((row) => row.type))), [rows])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !row.name.toLowerCase().includes(query.toLowerCase())) return false
      if (typeFilter !== "all" && row.type !== typeFilter) return false
      return true
    })
  }, [rows, query, typeFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setDraft(emptyDraft())
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(row: RawMaterial) {
    setDraft({
      name: row.name, fullName: row.fullName, unit: row.unit, type: row.type, subUnit: row.subUnit, supplier: row.supplier, brand: row.brand, organization: row.organization,
      orderNumber: row.orderNumber, minStock: row.minStock, color: row.color, barcode: row.barcode === "не установлен" ? "" : row.barcode, article: row.article,
      integrationCode: row.integrationCode, mass: row.mass, netWeight: row.netWeight, volume: row.volume, description: row.description,
      canSell: row.canSell, onlyMml: row.onlyMml, showAsInventory: row.showAsInventory, groupOnly: row.groupOnly, showInBot: row.showInBot,
      trackExpiry: row.trackExpiry, markedProduct: row.markedProduct, priceList: row.priceList, cashPrice: row.cashPrice, nonCashPrice: row.nonCashPrice,
    })
    setEditingId(row.id)
    setModalOpen(true)
    setOpenMenuId(null)
  }

  async function remove(id: number) {
    if (!window.confirm(t("Удалить сырьё?"))) return
    try {
      const response = await fetch(`/api/raw-materials/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось удалить сырьё"))
        return
      }
      setRows((current) => current.filter((row) => row.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
    setOpenMenuId(null)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim() || !draft.unit) return
    setSaving(true)
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/raw-materials/${editingId}` : "/api/raw-materials", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToInput(draft)),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось сохранить сырьё"))
        return
      }
      const saved = (await response.json()) as RawMaterial
      setRows((current) => (isEdit ? current.map((row) => (row.id === editingId ? saved : row)) : [saved, ...current]))
      setModalOpen(false)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  function parseImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ""
    void (async () => {
      const rowsData = await readExcelRows(file)
      if (!rowsData.length) return

      const fieldByIndex = mapHeaderColumns(rowsData[0], IMPORT_HEADER_ALIASES)
      const hasNameColumn = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasNameColumn ? rowsData.slice(1) : rowsData

      const parsed: RawMaterialInput[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasNameColumn) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.barcode = row[1] ?? ""
        }
        const name = record.name || ""
        if (!name || /^(наименование|название|name)$/i.test(name)) continue
        parsed.push(
          draftToInput({
            ...emptyDraft(),
            name,
            fullName: record.fullName || name,
            barcode: record.barcode || "",
            article: record.article || "",
            integrationCode: record.integrationCode || "",
            type: record.type || "Импорт",
            organization: record.organization || organizations[0],
            unit: record.unit || units[0],
            subUnit: record.subUnit || "",
            brand: record.brand || "",
            supplier: record.supplier || "",
            minStock: record.minStock || "",
            color: record.color || "",
            mass: record.mass || "",
            netWeight: record.netWeight || "",
            volume: record.volume || "",
            description: record.description || "",
            orderNumber: record.orderNumber || "",
          }),
        )
      }
      if (!parsed.length) return
      const created: RawMaterial[] = []
      for (const item of parsed) {
        try {
          const response = await fetch("/api/raw-materials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as RawMaterial)
        } catch {
          // ignore individual row failures during bulk import
        }
      }
      if (created.length) setRows((current) => [...created, ...current])
    })()
  }

  function downloadList() {
    downloadExcelTable("syrye", [
      [t("Наименование"), t("Штрих-код товара"), t("Артикул"), t("Тип товара"), t("Организация"), t("Мера"), t("Дата создания"), t("Порядковый номер")],
      ...filtered.map((row) => [row.name, row.barcode, row.article, row.type, row.organization, row.unit, row.createdDate, row.orderNumber]),
    ])
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
            <span className="mx-2 text-slate-400">|</span> {t("Сырье")}
          </h1>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> {t("Импортировать")}
            </button>
            <button type="button" onClick={() => updateInputRef.current?.click()} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> {t("Обновить с excel")}
            </button>
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> {t("Добавить")}
            </button>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={parseImport} className="hidden" />
            <input ref={updateInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={parseImport} className="hidden" />
          </div>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
            {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
            <label className="text-sm text-slate-600">
              {t("Тип товара:")}{" "}
              <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">{t("Все")}</option>
                {availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label={t("Назад")} className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label={t("Вперед")} className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
          <ListChecks className="h-5 w-5 text-slate-400" />
          <button type="button" onClick={downloadList} aria-label={t("Скачать")} className="text-slate-500 hover:text-[#4f70e7]">
            <Upload className="h-5 w-5 rotate-180" />
          </button>
          {embedded && (
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> {t("Добавить")}
            </button>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">{t("Наименование")}</th>
              <th className="px-5 py-5">{t("Штрих - код товара")}</th>
              <th className="px-5 py-5">{t("Артикул")}</th>
              <th className="px-5 py-5">{t("Тип товара")}</th>
              <th className="px-5 py-5">{t("Организация")}</th>
              <th className="px-5 py-5">{t("Мера")}</th>
              <th className="px-5 py-5">{t("Дата создания")}</th>
              <th className="px-5 py-5">{t("Порядковый номер")}</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-9 py-10 text-center text-slate-400">{t("Загрузка сырья...")}</td></tr>
            ) : loadError ? (
              <tr><td colSpan={9} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => openEdit(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">
                    <span className="flex items-center gap-3">
                      <ImageIcon className="h-5 w-5 shrink-0 text-slate-300" />
                      {row.name}
                    </span>
                  </td>
                  <td className="px-5 py-4">{row.barcode}</td>
                  <td className="px-5 py-4">{row.article || "-"}</td>
                  <td className="px-5 py-4">{row.type}</td>
                  <td className="px-5 py-4">{row.organization}</td>
                  <td className="px-5 py-4">
                    {row.unit}
                    {row.subUnit && <span className="block text-[#4f70e7]">{row.subUnit}</span>}
                  </td>
                  <td className="px-5 py-4">{row.createdDate}</td>
                  <td className="px-5 py-4">{row.orderNumber}</td>
                  <td className="relative px-3 py-4 text-right">
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => (current === row.id ? null : row.id)) }}
                      aria-label={t("Ещё")}
                      className="text-slate-500 hover:text-slate-800"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                    {openMenuId === row.id && (
                      <div onClick={(event) => event.stopPropagation()} className="absolute right-3 top-12 z-30 w-44 rounded border border-slate-200 bg-white py-1 text-left shadow-xl">
                        <button type="button" onClick={() => openEdit(row)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                          <Pencil className="h-4 w-4" /> {t("Изменить")}
                        </button>
                        <button type="button" onClick={() => remove(row.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-500 hover:bg-slate-50">
                          <Trash2 className="h-4 w-4" /> {t("Удалить")}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>

        {!loading && !loadError && visible.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-10">
            <p className="text-lg text-slate-400">{t("По вашему запросу ничего не найдено")}</p>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? t("Изменить сырьё") : t("Добавить сырьё")}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid gap-8 md:grid-cols-3">
                <div className="space-y-4">
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Наименование")} <span className="text-red-500">*</span>
                    <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Мера")} <span className="text-red-500">*</span>
                    <select value={draft.unit} onChange={(event) => setDraft((value) => ({ ...value, unit: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {units.map((unit) => <option key={unit}>{unit}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Тип продукта")}
                    <input value={draft.type} onChange={(event) => setDraft((value) => ({ ...value, type: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <div className="flex gap-4">
                    <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                      {t("Поставщик")}
                      <input value={draft.supplier} onChange={(event) => setDraft((value) => ({ ...value, supplier: event.target.value }))} className="mt-2 block w-full outline-none" />
                    </label>
                    <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                      {t("Бренд")}
                      <input value={draft.brand} onChange={(event) => setDraft((value) => ({ ...value, brand: event.target.value }))} className="mt-2 block w-full outline-none" />
                    </label>
                  </div>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Организация")}
                    <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {organizations.map((org) => <option key={org}>{org}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Порядковый номер")}
                    <input value={draft.orderNumber} onChange={(event) => setDraft((value) => ({ ...value, orderNumber: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Минимальный остаток")}
                    <input value={draft.minStock} onChange={(event) => setDraft((value) => ({ ...value, minStock: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Цвет")}
                    <input value={draft.color} onChange={(event) => setDraft((value) => ({ ...value, color: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                </div>

                <div className="space-y-4">
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Полное наименование")}
                    <input value={draft.fullName} onChange={(event) => setDraft((value) => ({ ...value, fullName: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Штрих-код")}
                    <div className="mt-2 flex items-center gap-3">
                      <input value={draft.barcode} onChange={(event) => setDraft((value) => ({ ...value, barcode: event.target.value }))} className="block w-full outline-none" />
                      <button type="button" onClick={() => setDraft((value) => ({ ...value, barcode: String(Date.now()).slice(-13) }))} className="whitespace-nowrap text-sm text-[#4f70e7] hover:underline">
                        {t("Сгенерировать")}
                      </button>
                    </div>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Артикул")}
                    <input value={draft.article} onChange={(event) => setDraft((value) => ({ ...value, article: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Код для интеграции")}
                    <input value={draft.integrationCode} onChange={(event) => setDraft((value) => ({ ...value, integrationCode: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Масса - кг")}
                    <input value={draft.mass} onChange={(event) => setDraft((value) => ({ ...value, mass: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Вес нетто")}
                    <input value={draft.netWeight} onChange={(event) => setDraft((value) => ({ ...value, netWeight: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Объем")}
                    <input value={draft.volume} onChange={(event) => setDraft((value) => ({ ...value, volume: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>

                  <div className="space-y-3 pt-2">
                    {(
                      [
                        ["onlyMml", "ММЛ продукт"],
                        ["showAsInventory", "Показывать этот товар в качестве тип инвентаря"],
                        ["groupOnly", "Продать только в группе"],
                        ["showInBot", "Показывать в боте"],
                        ["trackExpiry", "Учитывать срок годности"],
                        ["markedProduct", "Маркировочный товар"],
                      ] as [keyof typeof draft, string][]
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-700">{t(label)}</span>
                        <button
                          type="button"
                          onClick={() => setDraft((value) => ({ ...value, [key]: !value[key] }))}
                          className={`relative h-6 w-11 rounded-full transition-colors ${draft[key] ? "bg-[#4f70e7]" : "bg-slate-300"}`}
                        >
                          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${draft[key] ? "translate-x-5" : "translate-x-0.5"}`} />
                        </button>
                      </label>
                    ))}
                  </div>

                  <label className="block border-b border-slate-200 pb-2 pt-2 font-medium">
                    {t("Описание")}
                    <textarea value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} rows={2} className="mt-2 block w-full resize-none outline-none" />
                  </label>
                </div>

                <div className="space-y-4">
                  <label className="flex items-center justify-between gap-3 rounded bg-slate-50 p-3">
                    <span>
                      <span className="block font-medium text-slate-800">{t("Можно продавать")}</span>
                      <span className="block text-xs text-slate-500">{t("Агенты могут продать этот товар")}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setDraft((value) => ({ ...value, canSell: !value.canSell }))}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${draft.canSell ? "bg-[#4f70e7]" : "bg-slate-300"}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${draft.canSell ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </label>

                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Прайс лист")}
                    <select value={draft.priceList} onChange={(event) => setDraft((value) => ({ ...value, priceList: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {priceListOptions.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Цена наличные")}
                    <input type="number" value={draft.cashPrice} onChange={(event) => setDraft((value) => ({ ...value, cashPrice: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Цена безналичные")}
                    <input type="number" value={draft.nonCashPrice} onChange={(event) => setDraft((value) => ({ ...value, nonCashPrice: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                </div>
              </div>
            </div>

            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? t("Сохранение...") : t("Сохранить изменение")}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
