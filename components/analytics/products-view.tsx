"use client"

import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  ListChecks,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { defaultPriceLists, productOrganizations as organizations, productUnits as units, type Product } from "./products-data"

type Tab = "sellable" | "inventory" | "delisted" | "all" | "deleted"

function emptyDraft() {
  return {
    name: "", fullName: "", barcode: "", article: "", type: "", organization: organizations[0], unit: units[0], supplier: "", description: "",
    minStock: "", volume: "", weight: "", netWeight: "", color: "",
  }
}

function toProductInput(product: Product): Omit<Product, "id" | "createdDate"> {
  const { id: _id, createdDate: _createdDate, ...rest } = product
  return rest
}

function emptyNewProduct(draft: ReturnType<typeof emptyDraft>): Omit<Product, "id" | "createdDate"> {
  return {
    name: draft.name.trim(), fullName: draft.fullName.trim() || draft.name.trim(), barcode: draft.barcode || "не установлен", article: draft.article,
    type: draft.type || "Не указано", organization: draft.organization, unit: draft.unit, subUnit: "", orderNumber: "",
    hasPhoto: false, canSell: true, isInventory: false, deleted: false,
    onlyMml: false, perfectStore: false, groupOnly: false, trackExpiry: false, manualDiscount: false, hideFromAgent: false, trackSeries: false,
    subcategory: draft.type || "Не указано", brand: "No brand", minStock: draft.minStock || "0 шт.", description: draft.description || "Не указано",
    supplier: draft.supplier || "Не указано", integrationCode: draft.article, volume: draft.volume || "Не указано м³.", weight: draft.weight || "0 кг.",
    netWeight: draft.netWeight || "0", color: draft.color || "Не указано", priceLists: defaultPriceLists(),
    cost: 0, priceMin: 0, priceMax: 0, priceUpdatedDate: "Не установлена",
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
  const [draft, setDraft] = useState(emptyDraft)
  const importInputRef = useRef<HTMLInputElement>(null)
  const updateInputRef = useRef<HTMLInputElement>(null)
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
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(product: Product) {
    setDraft({
      name: product.name, fullName: product.fullName, barcode: product.barcode, article: product.article, type: product.type,
      organization: product.organization, unit: product.unit, supplier: product.supplier, description: product.description,
      minStock: product.minStock, volume: product.volume, weight: product.weight, netWeight: product.netWeight, color: product.color,
    })
    setEditingId(product.id)
    setModalOpen(true)
    setOpenMenuId(null)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    if (editingId !== null) {
      await patchProduct(editingId, {
        name: draft.name.trim(), fullName: draft.fullName.trim() || draft.name.trim(), barcode: draft.barcode || "не установлен", article: draft.article,
        type: draft.type, organization: draft.organization, unit: draft.unit, supplier: draft.supplier, description: draft.description || "Не указано",
        minStock: draft.minStock || "0 шт.", volume: draft.volume || "Не указано м³.", weight: draft.weight || "0 кг.", netWeight: draft.netWeight || "0", color: draft.color || "Не указано",
      })
    } else {
      try {
        const response = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(emptyNewProduct(draft)),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось создать товар")
          return
        }
        const saved = (await response.json()) as Product
        setProducts((current) => [saved, ...current])
      } catch {
        window.alert("Сервер недоступен, попробуйте ещё раз")
        return
      }
    }
    setModalOpen(false)
  }

  function parseImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const text = String(reader.result ?? "")
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      const parsed: Omit<Product, "id" | "createdDate">[] = []
      for (const line of lines) {
        const cells = line.split(/\t|,|;/).map((cell) => cell.replace(/<[^>]+>/g, "").trim())
        const [name, barcode, article] = cells
        if (!name || /^(наименование|название|name)$/i.test(name)) continue
        parsed.push({
          name, fullName: name, barcode: barcode || "не установлен", article: article || "", type: "Импорт", organization: organizations[0],
          unit: units[0], subUnit: "", orderNumber: "", hasPhoto: false, canSell: true, isInventory: false, deleted: false,
          onlyMml: false, perfectStore: false, groupOnly: false, trackExpiry: false, manualDiscount: false, hideFromAgent: false, trackSeries: false,
          subcategory: "Импорт", brand: "No brand", minStock: "0 шт.", description: "Не указано", supplier: "Не указано",
          integrationCode: article || "", volume: "Не указано м³.", weight: "0 кг.", netWeight: "0", color: "Не указано", priceLists: defaultPriceLists(),
          cost: 0, priceMin: 0, priceMax: 0, priceUpdatedDate: "Не установлена",
        })
      }
      if (!parsed.length) return
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
    }
    reader.readAsText(file)
    event.target.value = ""
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
            <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> Импортировать
            </button>
            <button type="button" onClick={() => updateInputRef.current?.click()} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
              <BarChart3 className="h-4 w-4" /> Обновить с excel
            </button>
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> Добавить
            </button>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={parseImport} className="hidden" />
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
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Объем:</dt><dd className="font-medium">{expanded.volume}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Вес:</dt><dd className="font-medium">{expanded.weight}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Вес нетто:</dt><dd className="font-medium">{expanded.netWeight}</dd></div>
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
                                    <td className="py-2 pr-4">{entry.cash.toLocaleString("ru-RU")} SUM</td>
                                    <td className="py-2 pr-4">{entry.nonCash.toLocaleString("ru-RU")} SUM</td>
                                    <td className="py-2 pr-4">{entry.min} SUM</td>
                                    <td className="py-2 pr-4">{entry.max} SUM</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p className="mb-2 mt-5 font-medium text-slate-800">Характеристика:</p>
                            <p className="text-sm text-slate-600"><b>Балл:</b> Неизвестно</p>
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
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? "Изменить товар" : "Добавление товара"}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto p-8">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Наименование <span className="text-red-500">*</span>
                  <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Полное наименование
                  <input value={draft.fullName} onChange={(event) => setDraft((value) => ({ ...value, fullName: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Штрих-код товара
                  <input value={draft.barcode} onChange={(event) => setDraft((value) => ({ ...value, barcode: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Артикул
                  <input value={draft.article} onChange={(event) => setDraft((value) => ({ ...value, article: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Тип товара
                  <input value={draft.type} onChange={(event) => setDraft((value) => ({ ...value, type: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Организация
                  <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                    {organizations.map((org) => <option key={org}>{org}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Мера
                  <select value={draft.unit} onChange={(event) => setDraft((value) => ({ ...value, unit: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                    {units.map((unit) => <option key={unit}>{unit}</option>)}
                  </select>
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Поставщик
                  <input value={draft.supplier} onChange={(event) => setDraft((value) => ({ ...value, supplier: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Минимальный остаток
                  <input value={draft.minStock} onChange={(event) => setDraft((value) => ({ ...value, minStock: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Объем
                  <input value={draft.volume} onChange={(event) => setDraft((value) => ({ ...value, volume: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Вес
                  <input value={draft.weight} onChange={(event) => setDraft((value) => ({ ...value, weight: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Цвет
                  <input value={draft.color} onChange={(event) => setDraft((value) => ({ ...value, color: event.target.value }))} className="mt-2 block w-full outline-none" />
                </label>
              </div>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Описание
                <textarea value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} rows={2} className="mt-2 block w-full resize-none outline-none" />
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
