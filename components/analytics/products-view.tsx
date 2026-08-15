"use client"

import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Info,
  ListChecks,
  MoreVertical,
  Pencil,
  Plus,
  PlusCircle,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { ChangeEvent, DragEvent, Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import {
  defaultPriceLists,
  productCurrencies,
  productOrganizations as organizations,
  productUnits as units,
  productVatOptions,
  type PriceListEntry,
  type Product,
} from "./products-data"

type Tab = "sellable" | "inventory" | "delisted" | "all" | "deleted"
type ToggleKey = "onlyMml" | "perfectStore" | "isInventory" | "groupOnly" | "showInBot" | "trackExpiry" | "markedProduct"

const defaultPriceListNames = defaultPriceLists().map((entry) => entry.name)

function emptyDraft() {
  return {
    name: "", fullName: "", barcodes: [""], article: "", integrationCode: "", type: "", organization: organizations[0], unit: units[0],
    orderNumber: "", supplier: "", brand: "", description: "", minStock: "", volume: "", weight: "", netWeight: "", color: "",
    group: "", ikpu: "", invoiceUnitCode: "", vat: productVatOptions[0], salePoints: "0",
    canSell: true, showInBot: true, markedProduct: false, limitPrice: false,
    onlyMml: false, perfectStore: false, isInventory: false, groupOnly: false, trackExpiry: false,
    priceMin: "", priceMax: "",
    priceEntries: [{ name: defaultPriceListNames[0], cash: "", cashCurrency: "SUM", nonCash: "", nonCashCurrency: "SUM" }],
  }
}

type Draft = ReturnType<typeof emptyDraft>
type DraftPriceEntry = Draft["priceEntries"][number]

function toProductInput(product: Product): Omit<Product, "id" | "createdDate"> {
  const { id: _id, createdDate: _createdDate, ...rest } = product
  return rest
}

function buildProductInput(draft: Draft, base?: Product): Omit<Product, "id" | "createdDate"> {
  const name = draft.name.trim()
  const barcode = draft.barcodes.map((code) => code.trim()).filter(Boolean).join(", ") || "не установлен"
  const priceLists: PriceListEntry[] = draft.priceEntries
    .filter((entry) => entry.name && (entry.cash || entry.nonCash))
    .map((entry) => ({
      name: entry.name,
      cash: Number(entry.cash) || 0,
      nonCash: Number(entry.nonCash) || 0,
      currency: entry.cashCurrency,
      nonCashCurrency: entry.nonCashCurrency,
      min: 0,
      max: 0,
    }))

  return {
    name,
    fullName: draft.fullName.trim() || name,
    barcode,
    article: draft.article,
    type: draft.type || "Не указано",
    organization: draft.organization,
    unit: draft.unit,
    subUnit: base?.subUnit ?? "",
    orderNumber: draft.orderNumber,
    hasPhoto: base?.hasPhoto ?? false,
    canSell: draft.canSell,
    isInventory: draft.isInventory,
    deleted: base?.deleted ?? false,
    onlyMml: draft.onlyMml,
    perfectStore: draft.perfectStore,
    groupOnly: draft.groupOnly,
    trackExpiry: draft.trackExpiry,
    manualDiscount: base?.manualDiscount ?? false,
    hideFromAgent: base?.hideFromAgent ?? false,
    trackSeries: base?.trackSeries ?? false,
    showInBot: draft.showInBot,
    markedProduct: draft.markedProduct,
    limitPrice: draft.limitPrice,
    group: draft.group,
    ikpu: draft.ikpu,
    invoiceUnitCode: draft.invoiceUnitCode,
    vat: draft.vat,
    salePoints: draft.salePoints || "0",
    subcategory: draft.type || base?.subcategory || "Не указано",
    brand: draft.brand || "No brand",
    minStock: draft.minStock || "0 шт.",
    description: draft.description || "Не указано",
    supplier: draft.supplier || "Не указано",
    integrationCode: draft.integrationCode || draft.article,
    volume: draft.volume || "Не указано м³.",
    weight: draft.weight || "0 кг.",
    netWeight: draft.netWeight || "0",
    color: draft.color || "Не указано",
    priceLists: priceLists.length ? priceLists : base?.priceLists ?? [],
    cost: base?.cost ?? 0,
    priceMin: Number(draft.priceMin) || 0,
    priceMax: Number(draft.priceMax) || 0,
    priceUpdatedDate: base?.priceUpdatedDate ?? "Не установлена",
  }
}

export function ProductsView({ embedded = false }: { embedded?: boolean }) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState<Tab>("sellable")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [favorite, setFavorite] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState("all")
  const [organizationFilter, setOrganizationFilter] = useState("all")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [groupOpen, setGroupOpen] = useState(false)
  const [extraOpen, setExtraOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [unitOptions, setUnitOptions] = useState<string[]>(units)
  const [typeOptions, setTypeOptions] = useState<string[]>([])
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const [priceListNameOptions, setPriceListNameOptions] = useState<string[]>(defaultPriceListNames)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importDragOver, setImportDragOver] = useState(false)
  const [importSaving, setImportSaving] = useState(false)
  const updateInputRef = useRef<HTMLInputElement>(null)
  const modalFileInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/products")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить продукты")
        return (await response.json()) as Product[]
      })
      .then((data) => {
        if (cancelled) return
        setProducts(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить продукты с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setUnitOptions((current) => Array.from(new Set([...current, ...products.map((product) => product.unit).filter(Boolean)])))
    setTypeOptions((current) => Array.from(new Set([...current, ...products.map((product) => product.type).filter(Boolean)])))
    setBrandOptions((current) =>
      Array.from(new Set([...current, ...products.map((product) => product.brand).filter((brand) => brand && brand !== "No brand")])),
    )
  }, [products])

  const scoped = useMemo(() => {
    switch (tab) {
      case "sellable": return products.filter((product) => product.canSell && !product.deleted)
      case "inventory": return products.filter((product) => product.isInventory && !product.deleted)
      case "delisted": return products.filter((product) => !product.canSell && !product.deleted)
      case "deleted": return products.filter((product) => product.deleted)
      default: return products.filter((product) => !product.deleted)
    }
  }, [products, tab])

  const availableTypes = useMemo(() => Array.from(new Set(scoped.map((product) => product.type))).slice(0, 40), [scoped])

  const filtered = useMemo(() => {
    return scoped.filter((product) => {
      if (query && !product.name.toLowerCase().includes(query.toLowerCase()) && !product.article.toLowerCase().includes(query.toLowerCase())) return false
      if (typeFilter !== "all" && product.type !== typeFilter) return false
      if (organizationFilter !== "all" && product.organization !== organizationFilter) return false
      return true
    })
  }, [scoped, query, typeFilter, organizationFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const expanded = products.find((product) => product.id === expandedId) ?? null

  function changeTab(next: Tab) {
    setTab(next)
    setQuery("")
    setPage(1)
    setTypeFilter("all")
    setOrganizationFilter("all")
    setExpandedId(null)
    setOpenMenuId(null)
  }

  function toggleExpand(product: Product) {
    setExpandedId((current) => (current === product.id ? null : product.id))
    setOpenMenuId(null)
  }

  async function patchProduct(id: number, patch: Partial<Product>) {
    const current = products.find((product) => product.id === id)
    if (!current) return
    const merged: Product = { ...current, ...patch }
    try {
      const response = await fetch(`/api/products/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toProductInput(merged)),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось сохранить товар")
        return
      }
      const saved = (await response.json()) as Product
      setProducts((curr) => curr.map((product) => (product.id === id ? saved : product)))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function toggleFlag(product: Product, key: keyof Product) {
    void patchProduct(product.id, { [key]: !product[key] } as Partial<Product>)
  }

  function delist(product: Product) {
    void patchProduct(product.id, { canSell: false })
    setOpenMenuId(null)
  }

  function restore(product: Product) {
    void patchProduct(product.id, { canSell: true, deleted: false })
    setOpenMenuId(null)
    setExpandedId(null)
  }

  function softDelete(product: Product) {
    if (!window.confirm(`Удалить «${product.name}»?`)) return
    void patchProduct(product.id, { deleted: true })
    setOpenMenuId(null)
    setExpandedId(null)
  }

  function openCreate() {
    setDraft(emptyDraft())
    setGroupOpen(false)
    setExtraOpen(false)
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(product: Product) {
    const rawBarcodes = product.barcode === "не установлен" ? [] : product.barcode.split(",").map((code) => code.trim()).filter(Boolean)
    setDraft({
      name: product.name, fullName: product.fullName, barcodes: rawBarcodes.length ? rawBarcodes : [""], article: product.article,
      integrationCode: product.integrationCode || product.article, type: product.type, organization: product.organization, unit: product.unit,
      orderNumber: product.orderNumber, supplier: product.supplier === "Не указано" ? "" : product.supplier,
      brand: product.brand === "No brand" ? "" : product.brand, description: product.description === "Не указано" ? "" : product.description,
      minStock: product.minStock, volume: product.volume, weight: product.weight, netWeight: product.netWeight,
      color: product.color === "Не указано" ? "" : product.color,
      group: product.group, ikpu: product.ikpu, invoiceUnitCode: product.invoiceUnitCode, vat: product.vat || productVatOptions[0],
      salePoints: product.salePoints || "0",
      canSell: product.canSell, showInBot: product.showInBot, markedProduct: product.markedProduct, limitPrice: product.limitPrice,
      onlyMml: product.onlyMml, perfectStore: product.perfectStore, isInventory: product.isInventory, groupOnly: product.groupOnly,
      trackExpiry: product.trackExpiry,
      priceMin: product.priceMin ? String(product.priceMin) : "", priceMax: product.priceMax ? String(product.priceMax) : "",
      priceEntries: product.priceLists.length
        ? product.priceLists.map((entry) => ({
            name: entry.name, cash: entry.cash ? String(entry.cash) : "", cashCurrency: entry.currency || "SUM",
            nonCash: entry.nonCash ? String(entry.nonCash) : "", nonCashCurrency: entry.nonCashCurrency || "SUM",
          }))
        : [{ name: priceListNameOptions[0], cash: "", cashCurrency: "SUM", nonCash: "", nonCashCurrency: "SUM" }],
    })
    setGroupOpen(Boolean(product.group))
    setExtraOpen(Boolean(product.ikpu || product.invoiceUnitCode || (product.vat && product.vat !== "Без НДС")))
    setEditingId(product.id)
    setModalOpen(true)
    setOpenMenuId(null)
  }

  function addPriceEntry() {
    setDraft((value) => {
      const unused = priceListNameOptions.find((name) => !value.priceEntries.some((entry) => entry.name === name))
      return {
        ...value,
        priceEntries: [...value.priceEntries, { name: unused || priceListNameOptions[0], cash: "", cashCurrency: "SUM", nonCash: "", nonCashCurrency: "SUM" }],
      }
    })
  }

  function removePriceEntry(index: number) {
    setDraft((value) => ({ ...value, priceEntries: value.priceEntries.filter((_, i) => i !== index) }))
  }

  function updatePriceEntry(index: number, patch: Partial<DraftPriceEntry>) {
    setDraft((value) => ({ ...value, priceEntries: value.priceEntries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)) }))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    setSaving(true)
    try {
      if (editingId !== null) {
        const base = products.find((product) => product.id === editingId)
        const input = buildProductInput(draft, base)
        const response = await fetch(`/api/products/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось сохранить товар")
          return
        }
        const saved = (await response.json()) as Product
        setProducts((curr) => curr.map((product) => (product.id === editingId ? saved : product)))
      } else {
        const input = buildProductInput(draft)
        const response = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось создать товар")
          return
        }
        const saved = (await response.json()) as Product
        setProducts((current) => [saved, ...current])
      }
      setModalOpen(false)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function readAndImport(file: File): Promise<number> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const text = String(reader.result ?? "")
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        const parsed: Omit<Product, "id" | "createdDate">[] = []
        for (const line of lines) {
          const cells = line.split(/\t|,|;/).map((cell) => cell.replace(/<[^>]+>/g, "").trim())
          const [name, barcode, article] = cells
          if (!name || /^(наименование|название|name)$/i.test(name)) continue
          parsed.push(
            buildProductInput({
              ...emptyDraft(),
              name,
              barcodes: [barcode || ""],
              article: article || "",
              integrationCode: article || "",
              type: "Импорт",
            }),
          )
        }
        if (!parsed.length) {
          resolve(0)
          return
        }
        const created: Product[] = []
        for (const item of parsed) {
          try {
            const response = await fetch("/api/products", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(item),
            })
            if (response.ok) created.push((await response.json()) as Product)
          } catch {
            // ignore individual row failures during bulk import
          }
        }
        if (created.length) setProducts((current) => [...created, ...current])
        resolve(created.length)
      }
      reader.readAsText(file)
    })
  }

  function parseImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    void readAndImport(file)
    event.target.value = ""
  }

  function downloadImportTemplate() {
    downloadExcelTable("shablon_produktov", [["Наименование", "Штрих-код товара", "Артикул"]])
  }

  function handleImportDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setImportDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) setImportFile(file)
  }

  async function saveImportModal() {
    if (!importFile) return
    setImportSaving(true)
    const count = await readAndImport(importFile)
    setImportSaving(false)
    setImportModalOpen(false)
    setImportFile(null)
    if (!count) window.alert("Не удалось найти товары для импорта в выбранном файле")
  }

  function downloadList() {
    downloadExcelTable("produkty", [
      ["Наименование", "Штрих-код товара", "Артикул", "Тип товара", "Организация", "Мера", "Дата создания", "Порядковый номер"],
      ...filtered.map((product) => [product.name, product.barcode, product.article, product.type, product.organization, product.unit, product.createdDate, product.orderNumber]),
    ])
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "sellable", label: "Можно продавать" },
    { id: "inventory", label: "Инвентари" },
    { id: "delisted", label: "Сняты с продажи" },
    { id: "all", label: "Все" },
    { id: "deleted", label: "Удалённые" },
  ]

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <button type="button" onClick={() => setFavorite((value) => !value)} className="inline-flex items-center gap-2 text-[#4f70e7]">
              <Star className={`h-5 w-5 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} /> Избранные
            </button>
            <span className="mx-2 text-slate-400">|</span> Продукты
          </h1>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setImportModalOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> Импортировать
            </button>
            <button type="button" onClick={() => updateInputRef.current?.click()} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> Обновить с excel
            </button>
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> Добавить
            </button>
            <input ref={updateInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={parseImport} className="hidden" />
          </div>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex overflow-x-auto text-center">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => changeTab(item.id)}
              className={`flex-1 whitespace-nowrap border-b-2 px-4 py-4 text-[15px] font-medium ${tab === item.id ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-600 hover:text-slate-800"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
            Показать фильтр <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
            <label className="text-sm text-slate-600">
              Тип товара:{" "}
              <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">Все</option>
                {availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Организация:{" "}
              <select value={organizationFilter} onChange={(event) => { setOrganizationFilter(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">Все</option>
                {organizations.map((org) => <option key={org} value={org}>{org}</option>)}
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
          <ListChecks className="h-5 w-5 text-slate-400" />
          <button type="button" onClick={downloadList} aria-label="Скачать" className="text-slate-500 hover:text-[#4f70e7]">
            <Upload className="h-5 w-5 rotate-180" />
          </button>
          {embedded && (
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> Добавить
            </button>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">Наименование</th>
              <th className="px-5 py-5">Штрих - код товара</th>
              <th className="px-5 py-5">Артикул</th>
              <th className="px-5 py-5">Тип товара</th>
              <th className="px-5 py-5">Организация</th>
              <th className="px-5 py-5">Мера</th>
              <th className="px-5 py-5">Дата создания</th>
              <th className="px-5 py-5">Порядковый номер</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-9 py-10 text-center text-slate-400">Загрузка продуктов...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={9} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((product) => (
              <Fragment key={product.id}>
                <tr onClick={() => toggleExpand(product)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">
                    <span className="flex items-center gap-3">
                      <ImageIcon className="h-5 w-5 shrink-0 text-slate-300" />
                      <span className={product.canSell ? "text-[#4f70e7]" : ""}>{product.name}</span>
                    </span>
                  </td>
                  <td className="px-5 py-4">{product.barcode}</td>
                  <td className="px-5 py-4">{product.article}</td>
                  <td className="px-5 py-4">{product.type}</td>
                  <td className="px-5 py-4">{product.organization}</td>
                  <td className="px-5 py-4">
                    {product.unit}
                    {product.subUnit && <span className="block text-[#4f70e7]">{product.subUnit}</span>}
                  </td>
                  <td className="px-5 py-4">{product.createdDate}</td>
                  <td className="px-5 py-4">{product.orderNumber}</td>
                  <td className="relative px-3 py-4 text-right">
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => (current === product.id ? null : product.id)) }}
                      aria-label="Ещё"
                      className="text-slate-500 hover:text-slate-800"
                    >
                      <MoreVertical className="h-5 w-5" />
                    </button>
                    {openMenuId === product.id && (
                      <div onClick={(event) => event.stopPropagation()} className="absolute right-3 top-12 z-30 w-52 rounded border border-slate-200 bg-white py-1 text-left shadow-xl">
                        <button type="button" onClick={() => openEdit(product)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                          <Pencil className="h-4 w-4" /> Изменить
                        </button>
                        {product.deleted ? (
                          <button type="button" onClick={() => restore(product)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                            <Check className="h-4 w-4" /> Восстановить
                          </button>
                        ) : product.canSell ? (
                          <button type="button" onClick={() => delist(product)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                            <X className="h-4 w-4" /> Снять с продажи
                          </button>
                        ) : (
                          <button type="button" onClick={() => restore(product)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                            <Check className="h-4 w-4" /> Восстановить
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>

                {expandedId === product.id && expanded && (
                  <tr>
                    <td colSpan={9} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-6 flex items-center justify-between">
                          <h2 className="text-xl font-bold text-slate-700">{expanded.name}</h2>
                          <div className="flex items-center gap-4 text-slate-500">
                            <button type="button" onClick={() => openEdit(expanded)} aria-label="Изменить" className="hover:text-[#4f70e7]">
                              <Pencil className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => softDelete(expanded)} aria-label="Удалить" className="hover:text-rose-500">
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-8 lg:grid-cols-[220px_1.4fr_1.4fr]">
                          <div>
                            <div className="mb-4 flex h-40 flex-col items-center justify-center gap-1 rounded border border-dashed border-slate-300 text-center text-sm text-slate-400">
                              {expanded.hasPhoto ? <ImageIcon className="h-10 w-10" /> : <span>Фото отсутствует</span>}
                              <button type="button" className="text-[#4f70e7] hover:underline">добавить фото</button>
                            </div>
                            <ul className="space-y-2 text-sm">
                              {(
                                [
                                  ["canSell", "Можно продавать"],
                                  ["onlyMml", "Только ММЛ продукты"],
                                  ["isInventory", "Инвентарь"],
                                  ["perfectStore", "Perfect store"],
                                  ["groupOnly", "Продать только в группе"],
                                  ["trackExpiry", "Учитывать срок годности"],
                                  ["manualDiscount", "Можно дать ручную скидку"],
                                  ["hideFromAgent", "Скрыть из списка заказов для агента"],
                                  ["trackSeries", "Учитывать серии"],
                                  ["showInBot", "Показывать в боте"],
                                  ["markedProduct", "Маркировочный товар"],
                                ] as [keyof Product, string][]
                              ).map(([key, label]) => (
                                <li key={key} className="flex items-center justify-between gap-2">
                                  <span className="text-slate-600">{label}:</span>
                                  <button type="button" onClick={() => toggleFlag(expanded, key)} aria-label={label}>
                                    {expanded[key] ? <Check className="h-5 w-5 text-emerald-500" /> : <X className="h-5 w-5 text-rose-500" />}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div>
                            <p className="mb-3 font-medium text-slate-800">Товар:</p>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Наименование:</dt><dd className="text-right font-medium">{expanded.name}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="shrink-0 text-slate-500">Полное наименование:</dt><dd className="text-right font-medium">{expanded.fullName}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Мера:</dt><dd className="font-medium">{expanded.unit}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Группа:</dt><dd className="font-medium">{expanded.group || "Не указано"}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Подкатегория:</dt><dd className="font-medium">{expanded.subcategory}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Бренд:</dt><dd className="font-medium">{expanded.brand}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Организация:</dt><dd className="font-medium">{expanded.organization}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Порядковый номер:</dt><dd className="font-medium">{expanded.orderNumber || "Не указано"}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Минимальный остаток:</dt><dd className="font-medium">{expanded.minStock}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Описание:</dt><dd className="font-medium">{expanded.description}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Штрих-коды товара:</dt><dd className="font-medium">{expanded.barcode === "не установлен" ? "Не указано" : expanded.barcode}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Артикул:</dt><dd className="font-medium">{expanded.article || "Не указано"}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Поставщик:</dt><dd className="font-medium">{expanded.supplier}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Код для интеграции:</dt><dd className="font-medium">{expanded.integrationCode || "Не указано"}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Икпу:</dt><dd className="font-medium">{expanded.ikpu || "Не указано"}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="shrink-0 text-slate-500">Код ед.изм. в фактуре:</dt><dd className="font-medium">{expanded.invoiceUnitCode || "Не указано"}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">НДС:</dt><dd className="font-medium">{expanded.vat || "Без НДС"}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Масса - кг:</dt><dd className="font-medium">{expanded.weight}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Вес нетто:</dt><dd className="font-medium">{expanded.netWeight}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Объем:</dt><dd className="font-medium">{expanded.volume}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Цвет:</dt><dd className="font-medium">{expanded.color}</dd></div>
                            </dl>
                          </div>

                          <div>
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-2 pr-4">Прайс лист</th>
                                  <th className="py-2 pr-4">Нал</th>
                                  <th className="py-2 pr-4">Безнал</th>
                                  <th className="py-2 pr-4">Мин</th>
                                  <th className="py-2 pr-4">Макс</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expanded.priceLists.map((entry) => (
                                  <tr key={entry.name} className="border-t border-slate-100 align-top">
                                    <td className="max-w-[220px] break-words py-2 pr-4">{entry.name}</td>
                                    <td className="py-2 pr-4">{entry.cash.toLocaleString("ru-RU")} {entry.currency || "SUM"}</td>
                                    <td className="py-2 pr-4">{entry.nonCash.toLocaleString("ru-RU")} {entry.nonCashCurrency || "SUM"}</td>
                                    <td className="py-2 pr-4">{entry.min} SUM</td>
                                    <td className="py-2 pr-4">{entry.max} SUM</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {expanded.limitPrice && (
                              <p className="mt-3 text-sm text-slate-600">
                                <b>Мин/Макс цена продажи:</b> {expanded.priceMin.toLocaleString("ru-RU")} — {expanded.priceMax.toLocaleString("ru-RU")} SUM
                              </p>
                            )}
                            <p className="mb-2 mt-5 font-medium text-slate-800">Характеристика:</p>
                            <p className="text-sm text-slate-600"><b>Балл:</b> {expanded.salePoints && expanded.salePoints !== "0" ? expanded.salePoints : "Неизвестно"}</p>
                            <p className="text-sm text-slate-500">Лимиты для агентов отсутствуют</p>
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

        {!loading && !loadError && visible.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-10">
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-6xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? "Изменить продукт" : "Добавить продукт"}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid gap-8 lg:grid-cols-3">
                {/* Left column */}
                <div className="space-y-4">
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Наименование <span className="text-red-500">*</span>
                    <input autoFocus required value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>

                  <div className="flex items-end gap-2 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      Мера <span className="text-red-500">*</span>
                      <select value={draft.unit} onChange={(event) => setDraft((value) => ({ ...value, unit: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        {unitOptions.map((unit) => <option key={unit}>{unit}</option>)}
                      </select>
                    </label>
                    <button
                      type="button"
                      title="Добавить меру"
                      onClick={() => {
                        const value = window.prompt("Новая мера")
                        if (value?.trim()) {
                          setUnitOptions((current) => Array.from(new Set([...current, value.trim()])))
                          setDraft((current) => ({ ...current, unit: value.trim() }))
                        }
                      }}
                      className="mb-1 text-[#5fb583] hover:text-[#4a9d6d]"
                    >
                      <PlusCircle className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="space-y-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={groupOpen} onChange={(event) => setGroupOpen(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                      Указать группу
                    </label>
                    {groupOpen && (
                      <input
                        value={draft.group}
                        onChange={(event) => setDraft((value) => ({ ...value, group: event.target.value }))}
                        placeholder="Группа"
                        className="block w-full border-b border-slate-200 pb-2 outline-none"
                      />
                    )}
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={extraOpen} onChange={(event) => setExtraOpen(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                      Доп. параметры
                    </label>
                  </div>

                  <div className="flex items-end gap-2 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      Тип продукта
                      <select value={draft.type} onChange={(event) => setDraft((value) => ({ ...value, type: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        <option value="">Не указано</option>
                        {typeOptions.map((type) => <option key={type}>{type}</option>)}
                      </select>
                    </label>
                    <button
                      type="button"
                      title="Добавить тип продукта"
                      onClick={() => {
                        const value = window.prompt("Новый тип продукта")
                        if (value?.trim()) {
                          setTypeOptions((current) => Array.from(new Set([...current, value.trim()])))
                          setDraft((current) => ({ ...current, type: value.trim() }))
                        }
                      }}
                      className="mb-1 text-[#5fb583] hover:text-[#4a9d6d]"
                    >
                      <PlusCircle className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="flex gap-3">
                    <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                      Поставщик
                      <input value={draft.supplier} onChange={(event) => setDraft((value) => ({ ...value, supplier: event.target.value }))} className="mt-2 block w-full outline-none" />
                    </label>
                    <div className="flex flex-1 items-end gap-2">
                      <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                        Бренд
                        <select value={draft.brand} onChange={(event) => setDraft((value) => ({ ...value, brand: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                          <option value="">No brand</option>
                          {brandOptions.map((brand) => <option key={brand}>{brand}</option>)}
                        </select>
                      </label>
                      <button
                        type="button"
                        title="Добавить бренд"
                        onClick={() => {
                          const value = window.prompt("Новый бренд")
                          if (value?.trim()) {
                            setBrandOptions((current) => Array.from(new Set([...current, value.trim()])))
                            setDraft((current) => ({ ...current, brand: value.trim() }))
                          }
                        }}
                        className="mb-1 text-[#5fb583] hover:text-[#4a9d6d]"
                      >
                        <PlusCircle className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Организация
                    <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {organizations.map((org) => <option key={org}>{org}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Порядковый номер
                      <span title="Определяет позицию товара в списках"><Info className="h-3.5 w-3.5 text-slate-400" /></span>
                    </span>
                    <input value={draft.orderNumber} onChange={(event) => setDraft((value) => ({ ...value, orderNumber: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Минимальный остаток
                      <span title="Порог для уведомления о нехватке товара"><Info className="h-3.5 w-3.5 text-slate-400" /></span>
                    </span>
                    <input value={draft.minStock} onChange={(event) => setDraft((value) => ({ ...value, minStock: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Цвет
                    <input value={draft.color} onChange={(event) => setDraft((value) => ({ ...value, color: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                </div>

                {/* Middle column */}
                <div className="space-y-4">
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Полное наименование
                    <input value={draft.fullName} onChange={(event) => setDraft((value) => ({ ...value, fullName: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>

                  <div className="border-b border-slate-200 pb-2">
                    <span className="font-medium">Штрих-код</span>
                    <div className="mt-2 space-y-2">
                      {draft.barcodes.map((code, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <input
                            value={code}
                            onChange={(event) => setDraft((value) => ({ ...value, barcodes: value.barcodes.map((c, i) => (i === index ? event.target.value : c)) }))}
                            className="block w-full outline-none"
                          />
                          {index === draft.barcodes.length - 1 ? (
                            <button
                              type="button"
                              title="Добавить штрих-код"
                              onClick={() => setDraft((value) => ({ ...value, barcodes: [...value.barcodes, ""] }))}
                              className="shrink-0 text-[#5fb583] hover:text-[#4a9d6d]"
                            >
                              <PlusCircle className="h-5 w-5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              title="Удалить штрих-код"
                              onClick={() => setDraft((value) => ({ ...value, barcodes: value.barcodes.filter((_, i) => i !== index) }))}
                              className="shrink-0 text-rose-400 hover:text-rose-600"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDraft((value) => ({ ...value, barcodes: [String(Date.now()).slice(-13), ...value.barcodes.slice(1)] }))}
                      className="mt-2 text-sm text-[#4f70e7] hover:underline"
                    >
                      Сгенерировать
                    </button>
                  </div>

                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Артикул
                    <input value={draft.article} onChange={(event) => setDraft((value) => ({ ...value, article: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Код для интеграции
                    <input value={draft.integrationCode} onChange={(event) => setDraft((value) => ({ ...value, integrationCode: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Масса - кг
                    <input value={draft.weight} onChange={(event) => setDraft((value) => ({ ...value, weight: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Вес нетто
                    <input value={draft.netWeight} onChange={(event) => setDraft((value) => ({ ...value, netWeight: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    Объем
                    <input value={draft.volume} onChange={(event) => setDraft((value) => ({ ...value, volume: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>

                  {extraOpen && (
                    <>
                      <label className="block border-b border-slate-200 pb-2 font-medium">
                        Икпу
                        <input value={draft.ikpu} onChange={(event) => setDraft((value) => ({ ...value, ikpu: event.target.value }))} className="mt-2 block w-full outline-none" />
                      </label>
                      <label className="block border-b border-slate-200 pb-2 font-medium">
                        Код ед.изм. в фактуре
                        <input value={draft.invoiceUnitCode} onChange={(event) => setDraft((value) => ({ ...value, invoiceUnitCode: event.target.value }))} className="mt-2 block w-full outline-none" />
                      </label>
                      <label className="block border-b border-slate-200 pb-2 font-medium">
                        НДС
                        <select value={draft.vat} onChange={(event) => setDraft((value) => ({ ...value, vat: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                          {productVatOptions.map((option) => <option key={option}>{option}</option>)}
                        </select>
                      </label>
                    </>
                  )}

                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    {(
                      [
                        ["onlyMml", "ММЛ продукт"],
                        ["perfectStore", "Perfect Store продукт"],
                        ["isInventory", "Показывать этот товар в качестве тип инвентаря"],
                        ["groupOnly", "Продать только в группе"],
                        ["showInBot", "Показывать в боте"],
                        ["trackExpiry", "Учитывать срок годности"],
                        ["markedProduct", "Маркировочный товар"],
                      ] as [ToggleKey, string][]
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-700">{label}</span>
                        <button
                          type="button"
                          onClick={() => setDraft((value) => ({ ...value, [key]: !value[key] }))}
                          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${draft[key] ? "bg-[#4f70e7]" : "bg-slate-300"}`}
                        >
                          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${draft[key] ? "translate-x-5" : "translate-x-0.5"}`} />
                        </button>
                      </label>
                    ))}
                  </div>

                  <label className="block border-b border-slate-200 pb-2 pt-2 font-medium">
                    Описание
                    <textarea value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} rows={2} className="mt-2 block w-full resize-none outline-none" />
                  </label>
                </div>

                {/* Right column */}
                <div className="space-y-4">
                  <label className="flex items-center justify-between gap-3 rounded bg-slate-50 p-3">
                    <span>
                      <span className="block font-medium text-slate-800">Можно продавать</span>
                      <span className="block text-xs text-slate-500">Агенты могут продать этот товар</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setDraft((value) => ({ ...value, canSell: !value.canSell }))}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${draft.canSell ? "bg-[#4f70e7]" : "bg-slate-300"}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${draft.canSell ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </label>

                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">Продажная цена</span>
                    <button type="button" onClick={addPriceEntry} className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-[#4f70e7] px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95">
                      <Plus className="h-3.5 w-3.5" /> Добавить новую цену
                    </button>
                  </div>

                  <div className="space-y-4">
                    {draft.priceEntries.map((entry, index) => (
                      <div key={index} className="space-y-3 rounded border border-slate-200 p-3">
                        {draft.priceEntries.length > 1 && (
                          <div className="flex justify-end">
                            <button type="button" title="Удалить цену" onClick={() => removePriceEntry(index)} className="text-rose-400 hover:text-rose-600">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                        <div className="flex items-end gap-2">
                          <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                            Прайс лист
                            <select value={entry.name} onChange={(event) => updatePriceEntry(index, { name: event.target.value })} className="mt-2 block w-full bg-white outline-none">
                              {priceListNameOptions.map((name) => <option key={name}>{name}</option>)}
                            </select>
                          </label>
                          <button
                            type="button"
                            title="Добавить прайс лист"
                            onClick={() => {
                              const value = window.prompt("Название прайс листа")
                              if (value?.trim()) {
                                setPriceListNameOptions((current) => Array.from(new Set([...current, value.trim()])))
                                updatePriceEntry(index, { name: value.trim() })
                              }
                            }}
                            className="mb-1 shrink-0 text-[#5fb583] hover:text-[#4a9d6d]"
                          >
                            <PlusCircle className="h-5 w-5" />
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                            Цена наличные
                            <input type="number" value={entry.cash} onChange={(event) => updatePriceEntry(index, { cash: event.target.value })} className="mt-2 block w-full outline-none" />
                          </label>
                          <label className="block w-24 border-b border-slate-200 pb-2 font-medium">
                            Валюта
                            <select value={entry.cashCurrency} onChange={(event) => updatePriceEntry(index, { cashCurrency: event.target.value })} className="mt-2 block w-full bg-white outline-none">
                              {productCurrencies.map((code) => <option key={code}>{code}</option>)}
                            </select>
                          </label>
                        </div>
                        <div className="flex gap-2">
                          <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                            Цена безналичные
                            <input type="number" value={entry.nonCash} onChange={(event) => updatePriceEntry(index, { nonCash: event.target.value })} className="mt-2 block w-full outline-none" />
                          </label>
                          <label className="block w-24 border-b border-slate-200 pb-2 font-medium">
                            Валюта
                            <select value={entry.nonCashCurrency} onChange={(event) => updatePriceEntry(index, { nonCashCurrency: event.target.value })} className="mt-2 block w-full bg-white outline-none">
                              {productCurrencies.map((code) => <option key={code}>{code}</option>)}
                            </select>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-700">Установить минимальную и максимальную цену для продажи</span>
                    <button
                      type="button"
                      onClick={() => setDraft((value) => ({ ...value, limitPrice: !value.limitPrice }))}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${draft.limitPrice ? "bg-[#4f70e7]" : "bg-slate-300"}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${draft.limitPrice ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </label>
                  {draft.limitPrice && (
                    <div className="flex gap-2">
                      <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                        Мин
                        <input type="number" value={draft.priceMin} onChange={(event) => setDraft((value) => ({ ...value, priceMin: event.target.value }))} className="mt-2 block w-full outline-none" />
                      </label>
                      <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                        Макс
                        <input type="number" value={draft.priceMax} onChange={(event) => setDraft((value) => ({ ...value, priceMax: event.target.value }))} className="mt-2 block w-full outline-none" />
                      </label>
                    </div>
                  )}

                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      Можно продать за кол-во балов
                      <span title="Количество бонусных баллов, за которые можно продать товар"><Info className="h-3.5 w-3.5 text-slate-400" /></span>
                    </span>
                    <input value={draft.salePoints} onChange={(event) => setDraft((value) => ({ ...value, salePoints: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                </div>
              </div>
            </div>

            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? "Сохранение..." : "Сохранить изменение"}
              </button>
            </footer>
          </form>
        </div>
      )}

      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Импорт с excel</b>
              <button type="button" onClick={() => { setImportModalOpen(false); setImportFile(null) }} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="p-6">
              <button type="button" onClick={downloadImportTemplate} className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700 hover:text-[#4f70e7]">
                1. Скачать шаблон
              </button>
              <div
                onClick={() => modalFileInputRef.current?.click()}
                onDragOver={(event) => { event.preventDefault(); setImportDragOver(true) }}
                onDragLeave={() => setImportDragOver(false)}
                onDrop={handleImportDrop}
                className={`flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed text-center text-sm transition-colors ${importDragOver ? "border-[#4f70e7] bg-blue-50" : "border-slate-300"}`}
              >
                <FileText className="h-8 w-8 text-slate-400" />
                {importFile ? (
                  <span className="px-4 font-medium text-slate-700">{importFile.name}</span>
                ) : (
                  <span className="px-4 text-slate-500">Добавьте файл Excel или нажмите для выбора</span>
                )}
              </div>
              <input
                ref={modalFileInputRef}
                type="file"
                accept=".csv,.xls,.xlsx,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) setImportFile(file)
                  event.target.value = ""
                }}
                className="hidden"
              />
            </div>
            <footer className="flex justify-end border-t p-5">
              <button
                type="button"
                onClick={saveImportModal}
                disabled={!importFile || importSaving}
                className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-50"
              >
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
