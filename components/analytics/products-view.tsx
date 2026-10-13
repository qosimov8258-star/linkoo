"use client"

import { Check, ChevronDown, ChevronLeft, ChevronRight, EyeOff, Search, X } from "lucide-react"
import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { ProductFormDialog, type ProductAttributeDef, type ProductDraft, type ProductTypeNode } from "./product-form-dialog"
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

const defaultPriceListNames = defaultPriceLists().map((entry) => entry.name)

// Maps flexible spreadsheet header text to product fields so imports work
// regardless of column order or which template (ours or the client's own
// export) produced the file. Keys are normalized via normalizeHeader().
const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "наименование обязательно": "name", "name": "name", "товар": "name", "nomi": "name",
  "полное наименование": "fullName", "полное название": "fullName", "full name": "fullName", "fullname": "fullName",
  "штрихкод": "barcode", "штрих код": "barcode", "штрих код товара": "barcode", "barcode": "barcode", "штрихкод товара": "barcode",
  "артикул": "article", "article": "article", "sku": "article", "код товара": "article",
  "код интеграции": "integrationCode", "integration code": "integrationCode",
  "тип": "type", "тип товара": "type", "type": "type", "категория": "type", "turi": "type",
  "организация": "organization", "organization": "organization", "компания": "organization", "tashkilot": "organization",
  "мера": "unit", "мера обязательно": "unit", "единица": "unit", "единица измерения": "unit", "unit": "unit", "o lchov birligi": "unit",
  "доп мера": "subUnit", "доп единица": "subUnit", "sub unit": "subUnit",
  "бренд": "brand", "brand": "brand",
  "поставщик": "supplier", "supplier": "supplier", "yetkazib beruvchi": "supplier",
  "группа": "group", "group": "group",
  "подкатегория": "subcategory", "subcategory": "subcategory",
  "описание": "description", "description": "description", "izoh": "description",
  "икпу": "ikpu", "ikpu": "ikpu",
  "код единицы измерения для накладной": "invoiceUnitCode", "invoice unit code": "invoiceUnitCode",
  "ндс": "vat", "vat": "vat",
  "баллы": "salePoints", "points": "salePoints",
  "мин остаток": "minStock", "минимальный остаток": "minStock", "min stock": "minStock",
  "объем": "volume", "объём": "volume", "volume": "volume", "hajmi": "volume",
  "вес": "weight", "weight": "weight", "og irligi": "weight",
  "чистый вес": "netWeight", "net weight": "netWeight",
  "цвет": "color", "color": "color", "rangi": "color",
  "себестоимость": "cost", "cost": "cost", "tannarx": "cost",
  "порядковый номер": "orderNumber", "order number": "orderNumber",
}

function emptyDraft(): ProductDraft {
  return {
    name: "", fullName: "", barcodes: [""], article: "", integrationCode: "", type: "", organization: "", unit: "",
    orderNumber: "", supplier: "", brand: "", description: "", minStock: "", volume: "", weight: "", netWeight: "", color: "",
    group: "", ikpu: "", invoiceUnitCode: "", vat: "", salePoints: "",
    canSell: true, showInBot: true, markedProduct: false, limitPrice: false,
    onlyMml: false, perfectStore: false, isInventory: false, groupOnly: false, trackExpiry: false,
    priceMin: "", priceMax: "",
    priceEntries: [{ name: "", cash: "", cashCurrency: "", nonCash: "", nonCashCurrency: "" }],
    subcategory: "", attributes: {},
  }
}

type Draft = ProductDraft

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
      currency: entry.cashCurrency || "SUM",
      nonCashCurrency: entry.nonCashCurrency || "SUM",
      min: 0,
      max: 0,
    }))

  return {
    name,
    fullName: draft.fullName.trim() || name,
    barcode,
    article: draft.article,
    type: draft.type || "Не указано",
    organization: draft.organization || organizations[0],
    unit: draft.unit || units[0],
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
    vat: draft.vat || productVatOptions[0],
    salePoints: draft.salePoints || "0",
    subcategory: draft.subcategory || draft.type || base?.subcategory || "Не указано",
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
  const { t } = useLanguage()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState<Tab>("all")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)
  const emptyFilters = { type: "", showOnly: "", unit: "", brand: "", supplier: "", color: "", supply: "", organization: "", onlyMml: false, inventory: false, perfectStore: false }
  const [filters, setFilters] = useState(emptyFilters)
  const [filterDraft, setFilterDraft] = useState(emptyFilters)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<number[]>([])
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
  const [pageSize, setPageSize] = useState(25)
  const [pageSizeOpen, setPageSizeOpen] = useState(false)
  const [typeTree, setTypeTree] = useState<ProductTypeNode[]>([])
  const [attributeDefs, setAttributeDefs] = useState<ProductAttributeDef[]>([])
  const [attributeValues, setAttributeValues] = useState<Record<string, string[]>>({})
  const [supplies, setSupplies] = useState<{ id: number; supplier: string; contractNumber: string; items: { product: string }[] }[]>([])

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
        if (!cancelled) setLoadError(t("Не удалось загрузить продукты с сервера"))
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

  // While searching, ignore the tab scoping (Можно продавать/Инвентари/...)
  // so a match shows up no matter which category the product is actually
  // in — otherwise a query silently returns nothing for products outside
  // the currently selected tab, which looks like search is broken.
  const scoped = useMemo(() => {
    if (query.trim()) return products.filter((product) => !product.deleted)
    switch (tab) {
      case "sellable": return products.filter((product) => product.canSell && !product.deleted)
      case "inventory": return products.filter((product) => product.isInventory && !product.deleted)
      case "delisted": return products.filter((product) => !product.canSell && !product.deleted)
      case "deleted": return products.filter((product) => product.deleted)
      default: return products.filter((product) => !product.deleted)
    }
  }, [products, tab, query])


  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scoped.filter((product) => {
      if (
        needle &&
        !product.name.toLowerCase().includes(needle) &&
        !product.article.toLowerCase().includes(needle) &&
        !product.barcode.toLowerCase().includes(needle) &&
        !product.integrationCode.toLowerCase().includes(needle)
      )
        return false
      if (filters.type && product.type !== filters.type) return false
      if (filters.showOnly === "sell" && !product.canSell) return false
      if (filters.showOnly === "nosell" && product.canSell) return false
      if (filters.unit && product.unit !== filters.unit) return false
      if (filters.brand && product.brand !== filters.brand) return false
      if (filters.supplier && product.supplier !== filters.supplier) return false
      if (filters.color && product.color !== filters.color) return false
      if (filters.organization && product.organization !== filters.organization) return false
      if (filters.supply) {
        const supply = supplies.find((row) => String(row.id) === filters.supply)
        if (supply && !supply.items.some((item) => item.product === product.name)) return false
      }
      if (filters.onlyMml && !product.onlyMml) return false
      if (filters.inventory && !product.isInventory) return false
      if (filters.perfectStore && !product.perfectStore) return false
      return true
    })
  }, [scoped, query, filters, supplies])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function changeTab(next: Tab) {
    setTab(next)
    setQuery("")
    setPage(1)
    setFilters(emptyFilters)
    setFilterDraft(emptyFilters)
    setChecked([])
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
        window.alert(data.error || t("Не удалось сохранить товар"))
        return
      }
      const saved = (await response.json()) as Product
      setProducts((curr) => curr.map((product) => (product.id === id ? saved : product)))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function toggleFlag(product: Product, key: keyof Product) {
    void patchProduct(product.id, { [key]: !product[key] } as Partial<Product>)
  }



  function softDelete(product: Product) {
    if (!window.confirm(`${t("Удалить")} «${product.name}»?`)) return
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
      subcategory: product.subcategory && product.subcategory !== product.type && product.subcategory !== "Не указано" ? product.subcategory : "",
      attributes: {},
    })
    void fetch(`/api/product-attribute-assignments/${product.id}`).then((response) => (response.ok ? response.json() : {})).then((values: Record<string, string>) => setDraft((current) => ({ ...current, attributes: values })))
    setGroupOpen(Boolean(product.group))
    setExtraOpen(Boolean(product.ikpu || product.invoiceUnitCode || (product.vat && product.vat !== "Без НДС")))
    setEditingId(product.id)
    setModalOpen(true)
    setOpenMenuId(null)
  }




  async function saveAttributes(productId: number) {
    const values = Object.fromEntries(Object.entries(draft.attributes).filter(([, value]) => value !== ""))
    if (!Object.keys(values).length && editingId === null) return
    await fetch(`/api/product-attribute-assignments/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    }).catch(() => undefined)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim() || !draft.unit) return
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
          window.alert(data.error || t("Не удалось сохранить товар"))
          return
        }
        const saved = (await response.json()) as Product
        setProducts((curr) => curr.map((product) => (product.id === editingId ? saved : product)))
        await saveAttributes(saved.id)
      } else {
        const input = buildProductInput(draft)
        const response = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || t("Не удалось создать товар"))
          return
        }
        const saved = (await response.json()) as Product
        setProducts((current) => [saved, ...current])
        await saveAttributes(saved.id)
      }
      setModalOpen(false)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  async function readAndImport(file: File): Promise<{ created: number; total: number; failed: number }> {
    const rows = await readExcelRows(file)
    if (!rows.length) return { created: 0, total: 0, failed: 0 }

    // Map columns by header text (works with our own template or the
    // client's own export, whatever order/columns it uses). Falls back
    // to the fixed Наименование/Штрихкод/Артикул column order only if
    // the first row has no recognizable "name" header at all.
    const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
    const hasNameColumn = Array.from(fieldByIndex.values()).includes("name")
    const dataRows = hasNameColumn ? rows.slice(1) : rows

    const parsed: Omit<Product, "id" | "createdDate">[] = []
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
        record.article = row[2] ?? ""
      }
      const name = record.name || ""
      if (!name || /^(наименование|название|name)$/i.test(name)) continue
      parsed.push(
        buildProductInput({
          ...emptyDraft(),
          name,
          fullName: record.fullName || "",
          barcodes: [record.barcode || ""],
          article: record.article || "",
          integrationCode: record.integrationCode || record.article || "",
          type: record.type || "Импорт",
          organization: record.organization || emptyDraft().organization,
          unit: record.unit || emptyDraft().unit,
          brand: record.brand || "",
          supplier: record.supplier || "",
          group: record.group || "",
          description: record.description || "",
          ikpu: record.ikpu || "",
          vat: record.vat || productVatOptions[0],
          minStock: record.minStock || "",
          volume: record.volume || "",
          weight: record.weight || "",
          netWeight: record.netWeight || "",
          color: record.color || "",
          orderNumber: record.orderNumber || "",
        }),
      )
    }
    if (!parsed.length) return { created: 0, total: 0, failed: 0 }

    const created: Product[] = []
    let failed = 0
    for (const item of parsed) {
      try {
        const response = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        })
        if (response.ok) created.push((await response.json()) as Product)
        else failed += 1
      } catch {
        failed += 1
      }
    }
    if (created.length) setProducts((current) => [...created, ...current])
    return { created: created.length, total: parsed.length, failed }
  }

  function parseImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    void readAndImport(file).then(({ created, total, failed }) => {
      if (!total) window.alert(t("Не удалось найти товары для импорта в выбранном файле"))
      else if (failed) window.alert(`${t("Импортировано")} ${created} ${t("из")} ${total}. ${t("Не удалось сохранить")}: ${failed}`)
    })
    event.target.value = ""
  }

  function downloadImportTemplate() {
    downloadExcelTable("shablon_produktov", [[t("Наименование"), t("Штрих-код товара"), t("Артикул")]])
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
    const { created, total, failed } = await readAndImport(importFile)
    setImportSaving(false)
    setImportModalOpen(false)
    setImportFile(null)
    if (!total) window.alert(t("Не удалось найти товары для импорта в выбранном файле"))
    else if (failed) window.alert(`${t("Импортировано")} ${created} ${t("из")} ${total}. ${t("Не удалось сохранить")}: ${failed}`)
  }

  function downloadList() {
    downloadExcelTable("produkty", [
      [t("Наименование"), t("Штрих-код товара"), t("Артикул"), t("Тип товара"), t("Организация"), t("Мера"), t("Дата создания"), t("Порядковый номер")],
      ...filtered.map((product) => [product.name, product.barcode, product.article, product.type, product.organization, product.unit, product.createdDate, product.orderNumber]),
    ])
  }

  useEffect(() => {
    if (!modalOpen) return
    const load = (url: string) => fetch(url).then((response) => (response.ok ? response.json() : []))
    load("/api/product-types").then((rows: ProductTypeNode[]) => setTypeTree(rows))
    load("/api/product-attributes").then((rows: ProductAttributeDef[]) => setAttributeDefs(rows))
    load("/api/product-attribute-values").then((rows: { attribute: string; values: string[] }[]) => setAttributeValues(Object.fromEntries(rows.map((row) => [row.attribute, row.values]))))
  }, [modalOpen])
  useEffect(() => {
    if (!filterOpen) return
    fetch("/api/supplier-incomings").then((response) => (response.ok ? response.json() : [])).then(setSupplies)
  }, [filterOpen])

  const [baseline, setBaseline] = useState("")
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (modalOpen) setBaseline(JSON.stringify(draft))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen])
  const canSubmit = Boolean(draft.name.trim() && draft.unit) && (editingId === null || JSON.stringify(draft) !== baseline)

  const uniq = (pick: (product: Product) => string | undefined) =>
    Array.from(new Set(products.map(pick).filter((value): value is string => Boolean(value) && value !== "Не указано" && value !== "No brand"))).sort()
  const filterOptions = useMemo(
    () => ({
      type: uniq((product) => product.type),
      unit: uniq((product) => product.unit),
      brand: uniq((product) => product.brand),
      supplier: uniq((product) => product.supplier),
      color: uniq((product) => product.color),
      organization: uniq((product) => product.organization),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products],
  )

  const tabs: { id: Tab; label: string }[] = [
    { id: "sellable", label: t("Можно продавать") },
    { id: "inventory", label: t("Инвентари") },
    { id: "delisted", label: t("Сняты с продажи") },
    { id: "all", label: t("Все") },
    { id: "deleted", label: t("Удалённые") },
  ]

  const gridCols = selectMode
    ? "grid-cols-[52px_372px_repeat(7,146.3px)_1fr]"
    : "grid-cols-[409px_repeat(7,148.5px)_1fr]"
  const headCols = [t("Штрих - код товара"), t("Артикул"), t("Тип товара"), t("Организация"), t("Мера"), t("Дата создания"), t("Порядковый номер")]
  const allChecked = visible.length > 0 && visible.every((product) => checked.includes(product.id))
  const headerButton = "flex h-[30px] items-center gap-[8px] rounded-[3px] px-[14px] text-[13px] font-bold text-white hover:brightness-95"

  return (
    <main className={embedded ? "min-w-0 flex-1 text-[13px] text-[#333]" : "min-h-[calc(100vh-50px)] bg-[#f2f5f8] px-[28px] pb-10 pt-[18px] text-[13px] text-[#333]"}>
      {!embedded && (
        <header className="mb-[18px] flex h-[24px] items-center justify-between">
          <h1 className="flex items-center gap-[7px] text-[18px] font-bold text-[#5d6474]">
            <FavoritesButton className="flex items-center gap-[7px] text-[#4a6ee0]" />
            <span className="font-normal">|</span>
            {t("Продукты")}
          </h1>
          <div className="flex items-center gap-[10px]">
            <button type="button" onClick={() => setImportModalOpen(true)} className={`${headerButton} bg-[#4f71dc]`}>
              <BarsIcon /> {t("Импортировать")}
            </button>
            <button type="button" onClick={() => updateInputRef.current?.click()} className={`${headerButton} bg-[#4f71dc]`}>
              <BarsIcon /> {t("Обновить с excel")}
            </button>
            <button type="button" onClick={openCreate} className={`${headerButton} bg-[#71ce87]`}>
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>
              {t("Добавить")}
            </button>
            <input ref={updateInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={parseImport} className="hidden" />
          </div>
        </header>
      )}

      <section className="relative bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
        <div className="grid grid-cols-5">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => changeTab(item.id)}
              className={`relative h-10 text-center text-[13px] text-black ${tab === item.id ? "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-[#4c6dd4] after:shadow-[0_-4px_8px_rgba(76,109,212,0.25)]" : ""}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative flex h-[50px] items-center whitespace-nowrap border-t border-[#eef0f4] pb-[2px] pr-[16px]">
          <button type="button" onClick={() => { setFilterDraft(filters); setFilterOpen(true) }} className="absolute left-[5px] flex items-center gap-[3px] text-[13px] text-[#4f71dc]">
            {t("Показать фильтр")} <ChevronDown className="h-3 w-3" />
          </button>
          <label className="absolute left-[402px] top-[10px] w-[300px]">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="h-[30px] w-full border-b border-[#dfe3ea] bg-transparent pr-8 text-[13px] outline-none placeholder:text-[#b9c0cc] focus:border-[#4c6dd4]" />
            <Search className="absolute right-2 top-1.5 h-[18px] w-[18px] text-[#c4cad4]" />
          </label>

          <div className="relative ml-auto shrink-0">
            <button type="button" onClick={() => setPageSizeOpen((open) => !open)} className="flex items-center gap-1 text-[13px]">
              {pageSize}<ChevronDown className="h-3.5 w-3.5 text-slate-300" />
            </button>
            {pageSizeOpen && (
              <ul className="absolute left-0 top-7 z-20 w-16 bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
                {[25, 50, 100, 250].map((size) => (
                  <li key={size}>
                    <button type="button" onClick={() => { setPageSize(size); setPage(1); setPageSizeOpen(false) }} className={`block w-full px-3 py-1.5 text-left font-semibold ${size === pageSize ? "bg-[#e3effd]" : "text-slate-500 hover:bg-slate-50"}`}>{size}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <span className="ml-[34px] shrink-0 text-[13px]">
            {(safePage - 1) * pageSize + 1} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {filtered.length}
          </span>
          <button type="button" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} aria-label={t("Назад")} className="ml-[12px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-500 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage >= pageCount} aria-label={t("Вперед")} className="ml-[9px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-700 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          <div className="group relative ml-[33px] shrink-0">
            <button type="button" onClick={() => { setSelectMode((current) => !current); setChecked([]) }} aria-label={t("Выбрать из списка")} className="flex h-6 w-6 items-center justify-center text-slate-700">
              {selectMode ? <EyeOff className="h-6 w-6" /> : <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z" /></svg>}
            </button>
            <span className="pointer-events-none absolute right-[calc(100%+26px)] top-[-6px] hidden whitespace-nowrap rounded-[3px] bg-[#3a3f4a] px-5 py-[9px] text-[13px] font-semibold leading-4 text-white group-hover:block">{t("Выбрать из списка")}</span>
          </div>
          <button type="button" onClick={downloadList} aria-label={t("Скачать")} className="ml-[24px] flex h-6 w-6 shrink-0 items-center justify-center text-slate-700">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
          </button>
        </div>

        {filterOpen && (
          <FilterPanel
            draft={filterDraft}
            setDraft={setFilterDraft}
            options={filterOptions}
            supplies={supplies}
            onClose={() => setFilterOpen(false)}
            onApply={() => { setFilters(filterDraft); setPage(1); setFilterOpen(false) }}
          />
        )}

        <div className={`grid h-[50px] items-center bg-[#5d6474] font-bold leading-[18px] text-white ${gridCols}`}>
          {selectMode && (
            <button type="button" onClick={() => setChecked(allChecked ? [] : visible.map((product) => product.id))} aria-label={t("Выбрать все")} className="flex h-full items-center justify-end pr-[10px]">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border-2 border-dotted border-white"><span className="h-[8px] w-[8px] bg-white" /></span>
            </button>
          )}
          <span className={selectMode ? "pl-[9px]" : "pl-[38px]"}>{t("Наименование")}</span>
          {headCols.map((label) => <span key={label} className="pr-[20px]">{label}</span>)}
          <span />
        </div>

        {loading ? (
          <p className="py-16 text-center text-slate-400">{t("Загрузка продуктов...")}</p>
        ) : loadError ? (
          <p className="py-16 text-center text-red-600">{loadError}</p>
        ) : (
          visible.map((product) =>
            expandedId === product.id ? (
              <ProductDetail
                key={product.id}
                product={product}
                onEdit={() => openEdit(product)}
                onDelete={() => softDelete(product)}
                onToggle={(key) => toggleFlag(product, key)}
              />
            ) : (
              <div key={product.id} onClick={() => toggleExpand(product)} className={`relative grid min-h-[50px] cursor-pointer items-center border-b border-dashed border-[#d7dee3] py-[6px] hover:bg-[#f5f6f8] ${gridCols}`}>
                {selectMode && (
                  <label onClick={(event) => event.stopPropagation()} className="flex h-full cursor-pointer items-center justify-end pr-[10px]">
                    <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-[2px] border-2 ${checked.includes(product.id) ? "border-[#5d6474] bg-[#5d6474]" : "border-[#333]"}`}>
                      {checked.includes(product.id) && <Check className="h-3 w-3 stroke-[3] text-white" />}
                      <input type="checkbox" checked={checked.includes(product.id)} onChange={() => setChecked((current) => (current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id]))} className="sr-only" />
                    </span>
                  </label>
                )}
                <span className={`flex items-center gap-[20px] ${selectMode ? "pl-[9px]" : "pl-[43px]"}`}>
                  {product.hasPhoto ? (
                    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center border border-[#c9ced6]"><LandscapeIcon /></span>
                  ) : (
                    <LandscapeIcon />
                  )}
                  <span className="pr-[20px] leading-4">{product.name}</span>
                </span>
                <span className="pr-[12px] leading-4">{product.barcode}</span>
                <span className="pr-[12px] leading-4">{product.article}</span>
                <span className="pr-[12px] leading-4">{product.type}</span>
                <span className="pr-[12px] leading-4">{product.organization}</span>
                <span className="font-bold">{product.unit}</span>
                <span>{product.createdDate}</span>
                <span>{product.orderNumber}</span>
                <span className="relative flex justify-start pl-[21px]">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => (current === product.id ? null : product.id)) }}
                    aria-label={t("Ещё")}
                    className="flex h-6 w-6 items-center justify-center text-[#555]"
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
                  </button>
                  {openMenuId === product.id && (
                    <>
                      <span className="fixed inset-0 z-20" onClick={(event) => { event.stopPropagation(); setOpenMenuId(null) }} />
                      <div onClick={(event) => event.stopPropagation()} className="absolute left-[-111px] top-[-8px] z-30 w-[168px] bg-white py-[2px] text-left shadow-[0_2px_12px_rgba(0,0,0,0.22)]">
                        <button type="button" onClick={() => openEdit(product)} className="flex h-[48px] w-full items-center gap-[20px] pl-[22px] text-[13px] font-semibold text-[#444] hover:bg-slate-50">
                          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#757575]"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
                          {t("Изменить")}
                        </button>
                        <button type="button" onClick={() => softDelete(product)} className="flex h-[48px] w-full items-center gap-[20px] pl-[22px] text-[13px] font-semibold text-[#444] hover:bg-slate-50">
                          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#757575]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                          {t("Удалить")}
                        </button>
                      </div>
                    </>
                  )}
                </span>
              </div>
            ),
          )
        )}

        {!loading && !loadError && visible.length === 0 && (
          <div className="flex h-[276px] flex-col items-center pt-[58px]">
            <img src="/robot-empty.png" alt="" className="h-[162px] w-[162px] object-contain" />
            <p className="mt-[8px] text-[13px] text-[#6b7280]">{t("По вашему запросу ничего не найдено")}</p>
          </div>
        )}
      </section>

      {modalOpen && (
        <ProductFormDialog
          editing={editingId !== null}
          draft={draft}
          setDraft={(update) => setDraft(update)}
          saving={saving}
          canSubmit={canSubmit}
          units={unitOptions}
          types={typeOptions}
          brands={brandOptions}
          organizations={organizations}
          vatOptions={productVatOptions}
          priceListNames={priceListNameOptions}
          currencies={productCurrencies}
          typeTree={typeTree}
          attributeDefs={attributeDefs}
          attributeValues={attributeValues}
          groupOpen={groupOpen}
          setGroupOpen={setGroupOpen}
          extraOpen={extraOpen}
          setExtraOpen={setExtraOpen}
          onAddUnit={(value) => { setUnitOptions((current) => Array.from(new Set([...current, value]))); setDraft((current) => ({ ...current, unit: value })) }}
          onAddType={(value) => { setTypeOptions((current) => Array.from(new Set([...current, value]))); setDraft((current) => ({ ...current, type: value })) }}
          onAddBrand={(value) => { setBrandOptions((current) => Array.from(new Set([...current, value]))); setDraft((current) => ({ ...current, brand: value })) }}
          onAddPriceList={(value) => setPriceListNameOptions((current) => Array.from(new Set([...current, value])))}
          onSubmit={save}
          onClose={() => setModalOpen(false)}
        />
      )}

      {importModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="w-[400px] bg-white shadow-xl">
            <header className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[27px]">
              <h3 className="text-[13px] font-bold uppercase">{t("Импорт с excel")}</h3>
              <button type="button" onClick={() => { setImportModalOpen(false); setImportFile(null) }} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800"><X className="h-6 w-6" /></button>
            </header>
            <div className="p-[30px]">
              <div className="border border-[#e8ebf0] px-[20px] pb-[20px] pt-[18px]">
                <button type="button" onClick={downloadImportTemplate} className="block w-full text-center text-[13px] uppercase hover:text-[#4f71dc]">{t("1. Скачать шаблон")}</button>
                <div
                  onClick={() => modalFileInputRef.current?.click()}
                  onDragOver={(event) => { event.preventDefault(); setImportDragOver(true) }}
                  onDragLeave={() => setImportDragOver(false)}
                  onDrop={handleImportDrop}
                  className={`mt-[10px] flex h-[200px] cursor-pointer flex-col items-center justify-center gap-[10px] border border-dashed text-center ${importDragOver ? "border-[#4f71dc] bg-blue-50" : "border-[#c9ced6]"}`}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-black"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" /></svg>
                  <span className="whitespace-nowrap text-[13px]">{importFile ? importFile.name : t("Добавьте файл Excel или нажмите для выбора")}</span>
                </div>
                <input ref={modalFileInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) setImportFile(file); event.target.value = "" }} className="hidden" />
              </div>
            </div>
            <footer className="flex h-[57px] items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
              <button type="button" onClick={saveImportModal} disabled={!importFile || importSaving} className="h-9 rounded-[3px] bg-[#71ce87] px-[16px] text-[12px] font-bold uppercase text-white hover:brightness-95 disabled:bg-[#ade3b9]">
                {importSaving ? t("Импорт...") : t("Сохранить")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}

function BarsIcon() {
  return <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z" /></svg>
}

function LandscapeIcon() {
  return <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] shrink-0 fill-[#b5bbc6]"><path d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z" /></svg>
}

type FilterState = { type: string; showOnly: string; unit: string; brand: string; supplier: string; color: string; supply: string; organization: string; onlyMml: boolean; inventory: boolean; perfectStore: boolean }

function FilterPanel({
  draft,
  setDraft,
  options,
  supplies,
  onClose,
  onApply,
}: {
  draft: FilterState
  setDraft: (value: FilterState) => void
  options: { type: string[]; unit: string[]; brand: string[]; supplier: string[]; color: string[]; organization: string[] }
  supplies: { id: number; supplier: string; contractNumber: string }[]
  onClose: () => void
  onApply: () => void
}) {
  const { t } = useLanguage()
  const rows: { key: keyof FilterState; label: string; options: { value: string; label: string }[] }[] = [
    { key: "type", label: t("Тип продукта"), options: options.type.map((value) => ({ value, label: value })) },
    { key: "showOnly", label: t("Показать только"), options: [{ value: "sell", label: t("Можно продать") }, { value: "nosell", label: t("Нельзя продать") }] },
    { key: "unit", label: t("Мера"), options: options.unit.map((value) => ({ value, label: value })) },
    { key: "brand", label: t("Бренд"), options: options.brand.map((value) => ({ value, label: value })) },
    { key: "supplier", label: t("Поставщик"), options: options.supplier.map((value) => ({ value, label: value })) },
    { key: "color", label: t("Цвет"), options: options.color.map((value) => ({ value, label: value })) },
    { key: "supply", label: t("Поставка"), options: supplies.map((row) => ({ value: String(row.id), label: `${t("Поставка")} №${row.id}\n${t("Поставщик")}: ${row.supplier}\n${t("Номер договора")}: ${row.contractNumber || "-"}` })) },
    { key: "organization", label: t("Организации"), options: options.organization.map((value) => ({ value, label: value })) },
  ]
  const checks: { key: "onlyMml" | "inventory" | "perfectStore"; label: string }[] = [
    { key: "onlyMml", label: t("Только ММЛ продукты") },
    { key: "inventory", label: t("Инвентари") },
    { key: "perfectStore", label: t("Только Perfect Store продукты") },
  ]
  const [openKey, setOpenKey] = useState<string | null>(null)

  return (
    <div className="absolute left-0 top-[40px] z-40 w-[310px] bg-white pb-[18px] shadow-[0_2px_14px_rgba(0,0,0,0.25)]">
      <div className="flex h-[70px] items-center justify-between px-[20px]">
        <span className="text-[15px] text-[#6b7280]">{t("Фильтр")}</span>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#9aa3b0] hover:text-slate-700"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" /></svg></button>
      </div>
      <div className="px-[20px]">
        {rows.map((row, index) => {
          const selected = row.options.find((option) => option.value === draft[row.key])
          return (
            <div key={row.key} className={`relative ${index === 0 ? "mt-[10px]" : "mt-[22px]"}`}>
              <button type="button" onClick={() => setOpenKey(openKey === row.key ? null : row.key)} className="flex h-[40px] w-full items-end justify-between border-b border-[#d5dae1] pb-[6px] text-left">
                <span className={selected ? "" : "font-bold"}>{selected ? <><span className="mb-[2px] block text-[10px] font-semibold leading-3">{row.label}</span>{selected.label.split("\n")[0]}</> : row.label}</span>
                <span className="flex items-center gap-2 text-[#8a8f98]">
                  {selected && <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); setDraft({ ...draft, [row.key]: "" }) }}><X className="h-3.5 w-3.5" /></span>}
                  <ChevronDown className="h-4 w-4 fill-current" />
                </span>
              </button>
              {openKey === row.key && (
                <ul className="absolute left-0 right-0 z-10 mt-0.5 max-h-60 overflow-y-auto bg-white py-1 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
                  {row.options.length === 0 ? (
                    <li className="px-3 py-2 font-semibold text-slate-400">—</li>
                  ) : (
                    row.options.map((option, index) => (
                      <li key={`${option.value}-${index}`}>
                        <button type="button" onClick={() => { setDraft({ ...draft, [row.key]: option.value }); setOpenKey(null) }} className={`block w-full whitespace-pre-line px-3 py-2 text-left font-semibold ${option.value === draft[row.key] ? "bg-[#e3effd] text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}>{option.label}</button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          )
        })}
        <div className="mt-[12px] space-y-[12px]">
          {checks.map((item) => (
            <label key={item.key} className="flex cursor-pointer items-center gap-[10px] font-semibold">
              <span className={`flex h-[16px] w-[16px] items-center justify-center rounded-[2px] border-2 ${draft[item.key] ? "border-[#5d6474] bg-[#5d6474]" : "border-[#555]"}`}>
                {draft[item.key] && <svg viewBox="0 0 12 12" className="h-3 w-3"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="#fff" strokeWidth="2" /></svg>}
                <input type="checkbox" checked={draft[item.key]} onChange={(event) => setDraft({ ...draft, [item.key]: event.target.checked })} className="sr-only" />
              </span>
              {item.label}
            </label>
          ))}
        </div>
        <button type="button" onClick={onApply} className="mt-[22px] h-[36px] rounded-[3px] bg-[#5d6474] px-[16px] text-[13px] uppercase text-white hover:brightness-110">{t("Применить")}</button>
      </div>
    </div>
  )
}

function ProductDetail({ product, onEdit, onDelete, onToggle }: { product: Product; onEdit: () => void; onDelete: () => void; onToggle: (key: keyof Product) => void }) {
  const { t } = useLanguage()
  const flags: [keyof Product, string][] = [
    ["canSell", t("Можно продавать")],
    ["onlyMml", t("Только ММЛ продукты")],
    ["isInventory", t("Инвентарь")],
    ["perfectStore", "Perfect store"],
    ["groupOnly", t("Продать только в группе")],
    ["trackExpiry", t("Учитывать срок годности")],
    ["manualDiscount", t("Можно дать ручную скидку")],
    ["hideFromAgent", t("Скрыть из списка заказов для агента")],
    ["trackSeries", t("Учитывать серии")],
  ]
  const unset = t("Не указано")
  const info: [string, string][] = [
    [t("Наименование"), product.name],
    [t("Полное наименование"), product.fullName === product.name ? unset : product.fullName || unset],
    [t("Мера"), product.unit],
    [t("Подкатегория"), product.subcategory || unset],
    [t("Брeнд"), product.brand === "No brand" ? unset : product.brand],
    [t("Организация"), product.organization],
    [t("Порядковый номер"), product.orderNumber || unset],
    [t("Минимальный остаток"), product.minStock],
    [t("Описание"), product.description],
    [t("Штрих - коды товара"), product.barcode === "не установлен" ? unset : product.barcode],
    [t("Артикул"), product.article || unset],
    [t("Поставщик"), product.supplier],
    [t("Код для интеграции"), product.integrationCode || unset],
    [t("Объем"), product.volume],
    [t("Вес"), product.weight],
    [t("Вес нетто"), product.netWeight],
    [t("Цвет"), product.color],
  ]
  const money = (value: number, currency?: string) => `${value.toLocaleString("ru-RU")} ${currency || "SUM"}`

  return (
    <div className="mx-[-15px] my-[20px] bg-white shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
      <div className="flex h-[66px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[44px]">
        <h2 className="text-[18px] font-bold">{product.name}</h2>
        <div className="flex items-center gap-[28px]">
          <button type="button" onClick={onEdit} aria-label={t("Изменить")} className="text-[#757575]"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg></button>
          <button type="button" onClick={onDelete} aria-label={t("Удалить")} className="text-[#757575]"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg></button>
        </div>
      </div>
      <div className="grid grid-cols-[322px_465px_1fr]">
        <div className="px-[30px] pb-[24px] pt-[20px]">
          <div className="flex h-[230px] flex-col items-center justify-center border border-dashed border-[#e9ebed] bg-[#f2f5f8] text-center">
            {product.hasPhoto ? <LandscapeIcon /> : <><span className="text-[11px] text-[#9aa3b0]">{t("Фото")}<br />{t("отсутствует")}</span><span className="my-[8px] h-px w-[60px] bg-[#d5dae1]" /></>}
            <button type="button" className="text-[11px] text-[#0a9bd9] hover:underline">{t("добавить фото")}</button>
          </div>
          <ul className="mt-[12px] space-y-[5px]">
            {flags.map(([key, label]) => (
              <li key={key} className="flex h-[20px] items-center gap-[4px]">
                <span>{label}:</span>
                <button type="button" onClick={() => onToggle(key)} aria-label={label} className="flex h-5 w-5 items-center justify-center">
                  {product[key] ? (
                    <svg viewBox="0 0 24 24" className="h-5 w-5"><circle cx="12" cy="12" r="10" fill="#8acb8d" /><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="h-5 w-5"><path d="M5 5l14 14M19 5L5 19" stroke="#e57373" strokeWidth="2" fill="none" /></svg>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-x border-[#e8ebf0] px-[30px] pb-[20px] pt-[20px]">
          <p className="mb-[10px] font-bold">{t("Товар")}:</p>
          <dl className="space-y-[6px] leading-[19px]">
            {info.map(([label, value]) => (
              <div key={label}><dt className="inline">{label}: </dt><dd className="inline font-bold">{value}</dd></div>
            ))}
          </dl>
        </div>
        <div className="px-[30px] pb-[20px] pt-[20px]">
          <div className="grid grid-cols-[190px_121px_121px_121px_1fr] pb-[16px] font-bold"><span>{t("Прайс лист")}</span><span>{t("Нал")}</span><span>{t("Безнал")}</span><span>{t("Мин")}</span><span>{t("Макс")}</span></div>
          {product.priceLists.map((entry) => (
            <div key={entry.name} className="grid h-[40px] grid-cols-[190px_121px_121px_121px_1fr] items-center border-b border-dashed border-[#d7dee3]">
              <span className="pr-2">{entry.name}</span>
              <span>{money(entry.cash, entry.currency)}</span>
              <span>{money(entry.nonCash, entry.nonCashCurrency)}</span>
              <span>{money(entry.min, entry.currency)}</span>
              <span>{money(entry.max, entry.currency)}</span>
            </div>
          ))}
          <p className="mb-[8px] mt-[22px] font-bold">{t("Характеристика")}:</p>
          <p className="leading-[18px]">{t("Балл")}: <b>{product.salePoints && product.salePoints !== "0" ? product.salePoints : t("Неизвестно")}</b></p>
          <p className="leading-[18px]">{t("Лимиты для агентов отсутствуют")}</p>
          <p className="leading-[18px]">{t("Дополнительные параметры")}</p>
          <div className="mt-[14px] grid grid-cols-3 font-bold"><span>{t("Ширина")}</span><span>{t("Высота")}</span><span>{t("Длина")}</span></div>
          <div className="mt-[14px] grid h-[40px] grid-cols-3 items-center border-b border-dashed border-[#d7dee3]"><span>0</span><span>0</span><span>0</span></div>
        </div>
      </div>
    </div>
  )
}
