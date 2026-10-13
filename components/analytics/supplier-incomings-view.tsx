"use client"

import {
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  ListPlus,
  Package,
  Pencil,
  Percent,
  Plus,
  Printer,
  Search,
  Upload,
  X,
} from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { OrganizationFormModal } from "./organization-form-modal"
import { SupplierFormModal } from "./supplier-form-modal"
import {
  incomingBranches as branches,
  incomingPaymentTypes as paymentTypes,
  type Incoming,
  type IncomingPaymentType as PaymentType,
  type IncomingStatus as Status,
} from "./supplier-incomings-data"
import { WarehouseFormModal } from "./warehouse-form-modal"

const ITEM_IMPORT_HEADER_ALIASES: Record<string, string> = {
  "товар": "product", "наименование": "product", "название": "product", "product": "product", "name": "product",
  "количество": "qty", "кол во": "qty", "qty": "qty", "quantity": "qty",
  "цена": "cost", "стоимость": "cost", "сумма": "cost", "сумма за единицу": "cost", "цена за единицу": "cost", "cost": "cost", "price": "cost", "unit price": "cost",
}

function formatMoney(value: number) {
  return `${value.toLocaleString("ru-RU")} SUM`
}

const statusStyles: Record<Status, string> = {
  принят: "text-emerald-500",
  ожидает: "text-amber-500",
  отменен: "text-rose-500",
}
const statusDots: Record<Status, string> = {
  принят: "bg-emerald-500",
  ожидает: "bg-amber-500",
  отменен: "bg-rose-500",
}

type DraftItem = { id: number; product: string; qty: number; cost: number }
type Tab = "items" | "cost" | "expenses" | "logs"

const monthNames = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

function emptyDraft(supplierOptions: string[] = [], warehouseOptions: string[] = [], organizationOptions: string[] = []) {
  return {
    supplier: supplierOptions[0] ?? "",
    branch: branches[0],
    warehouse: warehouseOptions[0] ?? "",
    organization: organizationOptions[0] ?? "",
    currency: "SUM",
    paymentType: paymentTypes[0] as string,
    date: formatDate(new Date()),
    expectedFactoryExit: "",
    expectedCustomsArrival: "",
    contractNumber: "",
    invoiceNumber: "",
    invoiceDate: "",
    comment: "",
  }
}

export function SupplierIncomingsView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<Incoming[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all")
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<Tab>("items")
  const [markupTarget, setMarkupTarget] = useState<Incoming | null>(null)
  const [markupPercent, setMarkupPercent] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [supplierOptions, setSupplierOptions] = useState<string[]>([])
  const [warehouseOptions, setWarehouseOptions] = useState<string[]>([])
  const [organizationOptions, setOrganizationOptions] = useState<string[]>([])
  const [productOptions, setProductOptions] = useState<string[]>([])
  const [pickerQuery, setPickerQuery] = useState("")
  const [quickAddSupplierOpen, setQuickAddSupplierOpen] = useState(false)
  const [quickAddWarehouseOpen, setQuickAddWarehouseOpen] = useState(false)
  const [quickAddOrganizationOpen, setQuickAddOrganizationOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/supplier-incomings")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Incoming[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Не удалось загрузить приёмки с сервера"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      const [suppliersRes, warehousesRes, organizationsRes, productsRes] = await Promise.all([
        fetch("/api/suppliers").catch(() => null),
        fetch("/api/warehouses").catch(() => null),
        fetch("/api/organizations").catch(() => null),
        fetch("/api/products").catch(() => null),
      ])
      if (cancelled) return
      if (suppliersRes?.ok) {
        const data = (await suppliersRes.json()) as { name: string }[]
        setSupplierOptions(data.map((item) => item.name))
      }
      if (warehousesRes?.ok) {
        const data = (await warehousesRes.json()) as { name: string }[]
        setWarehouseOptions(data.map((item) => item.name))
      }
      if (organizationsRes?.ok) {
        const data = (await organizationsRes.json()) as { name: string }[]
        setOrganizationOptions(data.map((item) => item.name))
      }
      if (productsRes?.ok) {
        const data = (await productsRes.json()) as { name: string }[]
        setProductOptions(Array.from(new Set(data.map((item) => item.name))).sort((a, b) => a.localeCompare(b, "ru")))
      }
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !row.supplier.toLowerCase().includes(query.toLowerCase()) && !String(row.id).includes(query)) return false
      if (statusFilter !== "all" && row.status !== statusFilter) return false
      if (warehouseFilter !== "all" && row.warehouse !== warehouseFilter) return false
      return true
    })
  }, [rows, query, statusFilter, warehouseFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleExpand(row: Incoming) {
    setExpandedId((current) => (current === row.id ? null : row.id))
    setDetailTab("items")
  }

  function openCreate() {
    setDraft(emptyDraft(supplierOptions, warehouseOptions, organizationOptions))
    setDraftItems([])
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(row: Incoming) {
    setDraft({
      supplier: row.supplier,
      branch: row.branch,
      warehouse: row.warehouse,
      organization: row.organization,
      currency: "SUM",
      paymentType: row.paymentType,
      date: row.date,
      expectedFactoryExit: "",
      expectedCustomsArrival: "",
      contractNumber: row.contractNumber,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: "",
      comment: row.comment,
    })
    setDraftItems(row.items.map((item) => ({ id: item.id, product: item.product, qty: item.qty, cost: item.cost })))
    setEditingId(row.id)
    setModalOpen(true)
  }

  function addBlankItem() {
    setDraftItems((current) => [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product: productOptions[0] ?? "", qty: 1, cost: 0 }])
  }

  function addFromList(product: string) {
    setDraftItems((current) => {
      if (current.some((item) => item.product === product)) return current
      return [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product, qty: 1, cost: 0 }]
    })
  }

  function updateDraftItem(id: number, patch: Partial<DraftItem>) {
    setDraftItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeDraftItem(id: number) {
    setDraftItems((current) => current.filter((item) => item.id !== id))
  }

  function importFromExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    void (async () => {
      const rows = await readExcelRows(file)
      if (!rows.length) return

      const fieldByIndex = mapHeaderColumns(rows[0], ITEM_IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("product")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: DraftItem[] = []
      let nextId = Math.max(0, ...draftItems.map((item) => item.id)) + 1
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.product = row[0] ?? ""
          record.qty = row[1] ?? ""
          record.cost = row[2] ?? ""
        }
        const product = record.product
        if (!product || /^(товар|product|наименование|название)$/i.test(product)) continue
        parsed.push({ id: nextId++, product, qty: Number(record.qty) || 1, cost: Number(record.cost) || 0 })
      }
      if (parsed.length) setDraftItems((current) => [...current, ...parsed])
    })()
  }

  const draftTotalCost = draftItems.reduce((sum, item) => sum + item.qty * item.cost, 0)
  const draftTotalQty = draftItems.reduce((sum, item) => sum + item.qty, 0)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draftItems.length) return
    const items = draftItems.map((item) => ({
      id: item.id,
      product: item.product,
      expiry: "",
      qty: item.qty,
      block: 0,
      kg: 0,
      netWeight: 0,
      cost: item.cost,
      total: item.qty * item.cost,
    }))
    setSaving(true)
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/supplier-incomings/${editingId}` : "/api/supplier-incomings", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier: draft.supplier,
          warehouse: draft.warehouse,
          branch: draft.branch,
          organization: draft.organization,
          paymentType: draft.paymentType,
          date: draft.date,
          contractNumber: draft.contractNumber,
          invoiceNumber: draft.invoiceNumber,
          comment: draft.comment,
          items,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось сохранить приёмку"))
        return
      }
      const saved = (await response.json()) as Incoming
      setRows((current) => (isEdit ? current.map((row) => (row.id === editingId ? saved : row)) : [saved, ...current]))
      setModalOpen(false)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  async function cancelSupply(row: Incoming) {
    if (!window.confirm(`${t("Отменить приёмку поставки №")} ${row.id}?`)) return
    try {
      const response = await fetch(`/api/supplier-incomings/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось отменить приёмку"))
        return
      }
      const saved = (await response.json()) as Incoming
      setRows((current) => current.map((item) => (item.id === row.id ? saved : item)))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadRow(row: Incoming) {
    downloadExcelTable(`postavka-${row.id}`, [
      [t("№"), t("Товар"), t("Количество"), t("Стоимость"), t("Итог")],
      ...row.items.map((item) => [item.id, item.product, `${item.qty} ${t("шт")}`, item.cost, item.total]),
    ])
  }

  function downloadList() {
    downloadExcelTable("prihod-ot-postavshikov", [
      [t("№"), t("Поставщик"), t("Склад"), t("Дата поставки"), t("Тип оплаты"), t("Номер договора"), t("Сумма поставки"), t("Статус"), t("Счет фактура")],
      ...filtered.map((row) => [row.id, row.supplier, row.warehouse, row.date, row.paymentType, row.contractNumber, row.amount, row.status, row.invoiceNumber]),
    ])
  }

  async function applyMarkup(event: FormEvent) {
    event.preventDefault()
    if (!markupTarget) return
    const percent = Number(markupPercent)
    if (!percent) {
      setMarkupTarget(null)
      setMarkupPercent("")
      return
    }
    try {
      const response = await fetch(`/api/supplier-incomings/${markupTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markup", percent }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось применить наценку"))
        return
      }
      const saved = (await response.json()) as Incoming
      setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
    setMarkupTarget(null)
    setMarkupPercent("")
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "items", label: "Список товаров" },
    { id: "cost", label: "Себестоимость" },
    { id: "expenses", label: "Доп. расходы" },
    { id: "logs", label: "Логи" },
  ]

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f71dc]" />
            <span className="mx-2 text-slate-400">|</span> {t("Приход от поставщиков")}
          </h1>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#71ce87] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <Plus className="h-4 w-4" /> {t("Добавить")}
          </button>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">

        {filterOpen && (
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
            <label className="text-sm text-slate-600">
              {t("Статус")}:{" "}
              <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as "all" | Status); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">{t("Все")}</option>
                <option value="принят">{t("принят")}</option>
                <option value="ожидает">{t("ожидает")}</option>
                <option value="отменен">{t("отменен")}</option>
              </select>
            </label>
            <label className="text-sm text-slate-600">
              {t("Склад")}:{" "}
              <select value={warehouseFilter} onChange={(event) => { setWarehouseFilter(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">{t("Все")}</option>
                {warehouseOptions.map((warehouse) => (
                  <option key={warehouse} value={warehouse}>{warehouse}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="flex h-[50px] flex-wrap items-center gap-4 px-[10px]">
          <div className="w-[308px] shrink-0">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f71dc] hover:underline">
            {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
          </button>
          </div>
          <label className="relative w-[248px]">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]" />
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
          <button type="button" onClick={downloadList} aria-label={t("Скачать")} className="text-slate-500 hover:text-[#4f71dc]">
            <Download className="h-5 w-5" />
          </button>
          {embedded && (
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#71ce87] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> {t("Добавить")}
            </button>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-5">{t("№")}</th>
              <th className="px-5 py-5">{t("Поставщик")}</th>
              <th className="px-5 py-5">{t("Склад")}</th>
              <th className="px-5 py-5">{t("Дата поставки")}</th>
              <th className="px-5 py-5">{t("Тип оплаты")}</th>
              <th className="px-5 py-5">{t("Номер договора")}</th>
              <th className="px-5 py-5">{t("Сумма поставки")}</th>
              <th className="px-5 py-5">{t("Статус")}</th>
              <th className="px-5 py-5">{t("Счет фактура")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <Fragment key={row.id}>
                {expandedId !== row.id && (
                  <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                    <td className="px-9 py-4">{row.id}</td>
                    <td className="px-5 py-4 text-[#4f71dc]">{row.supplier}</td>
                    <td className="px-5 py-4">{row.warehouse}</td>
                    <td className="px-5 py-4">{row.date}</td>
                    <td className="px-5 py-4">{row.paymentType}</td>
                    <td className="px-5 py-4">{row.contractNumber}</td>
                    <td className="px-5 py-4">{formatMoney(row.amount)}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${statusDots[row.status]}`} /> {t(row.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4">{row.invoiceNumber}</td>
                  </tr>
                )}

                {expandedId === row.id && (
                  <tr>
                    <td colSpan={9} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-baseline gap-3">
                            <h2 className="text-xl font-bold text-slate-700">{t("Поставка №")} {row.id}</h2>
                            <span className="font-medium text-emerald-500">{row.supplier}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setMarkupTarget(row)} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                              <Percent className="h-4 w-4" /> {t("Наценка")}
                            </button>
                            <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                              <Pencil className="h-4 w-4" /> {t("Изменить")}
                            </button>
                            <button type="button" onClick={() => downloadRow(row)} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                              <Download className="h-4 w-4" /> {t("Скачать")}
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelSupply(row)}
                              disabled={row.status === "отменен"}
                              className="inline-flex items-center gap-2 rounded bg-[#ff8967] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-40"
                            >
                              <Ban className="h-4 w-4" /> {t("Отменить приёмку")}
                            </button>
                            <button type="button" onClick={() => window.print()} aria-label={t("Печать")} className="text-slate-500 hover:text-[#4f71dc]">
                              <Printer className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => toggleExpand(row)} aria-label={t("Свернуть")} className="text-slate-500 hover:text-[#4f71dc]">
                              <X className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        <div className="mb-6 grid gap-6 sm:grid-cols-3">
                          <dl className="space-y-2 text-sm">
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Поставщик")}:</dt><dd className="font-medium">{row.supplier}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Договор №")}</dt><dd className="font-medium">{row.contractNumber || t("Не указан")}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Организация")}:</dt><dd className="font-medium">{row.organization}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Филиал")}:</dt><dd className="font-medium">{row.branch}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Телефон")}:</dt><dd className="font-medium">{row.phone}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">E-mail:</dt><dd className="font-medium">{row.email}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Инициатор")}:</dt><dd className="font-medium">{row.initiator}</dd></div>
                          </dl>

                          <div>
                            <p className="mb-2 font-bold uppercase tracking-wide text-slate-700">{t("Баланс")}</p>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Стоимость поставки")}</dt><dd className="font-medium">{formatMoney(row.amount)}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Тип оплаты")}</dt><dd className="font-medium">{row.paymentType}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Оплачено")}:</dt><dd className="font-medium">{formatMoney(row.paid)}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Остаток")}:</dt><dd className="font-medium text-rose-500">{formatMoney(row.amount - row.paid)}</dd></div>
                            </dl>
                            <p className="mb-2 mt-4 font-bold uppercase tracking-wide text-slate-700">{t("Доп. расходы")}</p>
                            <p className="text-sm text-slate-500">{t("Нет дополнительных расходов")}</p>
                          </div>

                          <div>
                            <p className="mb-2 font-bold uppercase tracking-wide text-slate-700">{t("Исполнение")}</p>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Склад")}:</dt><dd className="font-medium">{row.warehouse}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Статус")}:</dt><dd className={`font-medium ${statusStyles[row.status]}`}>{row.status === "принят" ? t("Завершен") : row.status === "ожидает" ? t("В ожидании") : t("Отменен")}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Принимать на склад")}:</dt><dd className="font-medium text-emerald-500">{row.status === "отменен" ? t("Нельзя") : t("Можно")}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Время приемки")}:</dt><dd className="font-medium">{row.time}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Дата поставки")}:</dt><dd className="font-medium">{row.date}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Комментарии")}:</dt><dd className="font-medium">{row.comment || t("Не указан")}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Счет фактура")}:</dt><dd className="font-medium">{row.invoiceNumber || t("Не указан")}</dd></div>
                            </dl>
                          </div>
                        </div>

                        <div className="mb-3 flex gap-6 border-b border-slate-200">
                          {tabs.map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setDetailTab(tab.id)}
                              className={`border-b-2 pb-2 text-sm font-medium ${detailTab === tab.id ? "border-[#4f71dc] text-[#4f71dc]" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                            >
                              {t(tab.label)}
                            </button>
                          ))}
                        </div>

                        {detailTab === "items" && (
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="text-slate-500">
                                <th className="py-2 pr-4">{t("№")}</th>
                                <th className="py-2 pr-4">{t("Товар")}</th>
                                <th className="py-2 pr-4">{t("Срок годности")}</th>
                                <th className="py-2 pr-4">{t("Количество")}</th>
                                <th className="py-2 pr-4">{t("Блок")}</th>
                                <th className="py-2 pr-4">{t("Кг.")}</th>
                                <th className="py-2 pr-4">{t("Вес нетто.")}</th>
                                <th className="py-2 pr-4">{t("Стоимость")}</th>
                                <th className="py-2 pr-4">{t("Итог")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.items.map((item) => (
                                <tr key={item.id} className="border-t border-slate-100">
                                  <td className="py-2 pr-4">{item.id}</td>
                                  <td className="py-2 pr-4">{item.product}</td>
                                  <td className="py-2 pr-4">{item.expiry || "—"}</td>
                                  <td className="py-2 pr-4">{item.qty} {t("шт")}</td>
                                  <td className="py-2 pr-4">{item.block}</td>
                                  <td className="py-2 pr-4">{item.kg}</td>
                                  <td className="py-2 pr-4">{item.netWeight}</td>
                                  <td className="py-2 pr-4">{item.cost.toLocaleString("ru-RU")}</td>
                                  <td className="py-2 pr-4">{item.total.toLocaleString("ru-RU")}</td>
                                </tr>
                              ))}
                              <tr className="border-t border-slate-300 font-bold">
                                <td className="py-2 pr-4" colSpan={3}>{t("Итого")}:</td>
                                <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.qty, 0)} {t("шт")}</td>
                                <td className="py-2 pr-4">0</td>
                                <td className="py-2 pr-4">0</td>
                                <td className="py-2 pr-4" />
                                <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.cost, 0).toLocaleString("ru-RU")}</td>
                                <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.total, 0).toLocaleString("ru-RU")}</td>
                              </tr>
                            </tbody>
                          </table>
                        )}

                        {detailTab === "cost" && (
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="text-slate-500">
                                <th className="py-2 pr-4">{t("Товар")}</th>
                                <th className="py-2 pr-4">{t("Себестоимость за ед.")}</th>
                                <th className="py-2 pr-4">{t("Итог")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.items.map((item) => (
                                <tr key={item.id} className="border-t border-slate-100">
                                  <td className="py-2 pr-4">{item.product}</td>
                                  <td className="py-2 pr-4">{item.cost.toLocaleString("ru-RU")} SUM</td>
                                  <td className="py-2 pr-4">{item.total.toLocaleString("ru-RU")} SUM</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}

                        {detailTab === "expenses" && <p className="text-sm text-slate-500">{t("Нет дополнительных расходов")}</p>}

                        {detailTab === "logs" && (
                          <ul className="space-y-2 text-sm text-slate-600">
                            <li>{row.time} — {t("Поставка создана инициатором")} {row.initiator}</li>
                            {row.status !== "ожидает" && <li>{row.time} — {t("Статус изменён на")} «{t(row.status)}»</li>}
                          </ul>
                        )}
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
            <Package className="h-14 w-14 text-slate-300" />
            <p className="text-lg text-slate-400">{t("По вашему запросу ничего не найдено")}</p>
          </div>
        )}
      </section>

      {markupTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={applyMarkup} className="w-full max-w-sm rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">{t("Наценка — поставка №")} {markupTarget.id}</b>
              <button type="button" onClick={() => setMarkupTarget(null)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <label className="block text-sm font-medium text-slate-600">
              {t("Процент наценки (%)")}
              <input
                autoFocus
                type="number"
                value={markupPercent}
                onChange={(event) => setMarkupPercent(event.target.value)}
                className="mt-2 block w-full rounded border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setMarkupTarget(null)} className="rounded border px-4 py-2">{t("Отмена")}</button>
              <button type="submit" className="rounded bg-[#4f71dc] px-4 py-2 font-semibold text-white">{t("Применить")}</button>
            </div>
          </form>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? `${t("Изменить поставку №")} ${editingId}` : t("Добавление поставки")}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto p-8">
              <div className="grid gap-6 sm:grid-cols-3">
                <div className="space-y-4">
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Поставщик")} *
                      <select value={draft.supplier} onChange={(event) => setDraft((value) => ({ ...value, supplier: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        {supplierOptions.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddSupplierOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f71dc] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {supplierOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет поставщиков — нажмите «+добавить»")}</p>}
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Филиал")} *
                    <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {branches.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Склад назначения")} *
                      <select value={draft.warehouse} onChange={(event) => setDraft((value) => ({ ...value, warehouse: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        {warehouseOptions.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddWarehouseOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f71dc] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {warehouseOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет складов — нажмите «+добавить»")}</p>}
                  <label className="block font-medium">
                    {t("Оставить комментарий...")}
                    <textarea value={draft.comment} onChange={(event) => setDraft((value) => ({ ...value, comment: event.target.value }))} rows={2} className="mt-2 block w-full resize-none border-b border-slate-200 outline-none" />
                  </label>
                </div>

                <div className="space-y-4">
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Организация")} *
                      <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        {organizationOptions.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddOrganizationOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f71dc] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {organizationOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет организаций — нажмите «+добавить»")}</p>}
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Валюта оплаты")} *
                    <select value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option>SUM</option>
                      <option>USD</option>
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Тип оплаты")} *
                    <select value={draft.paymentType} onChange={(event) => setDraft((value) => ({ ...value, paymentType: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {paymentTypes.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                </div>

                <div className="space-y-4">
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Дата поставки")} *
                    <input value={draft.date} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Ожидаемый выход с завода")}
                    <input value={draft.expectedFactoryExit} onChange={(event) => setDraft((value) => ({ ...value, expectedFactoryExit: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Ожидаемое прибытие в таможню")}
                    <input value={draft.expectedCustomsArrival} onChange={(event) => setDraft((value) => ({ ...value, expectedCustomsArrival: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Номер договора")}
                    <input value={draft.contractNumber} onChange={(event) => setDraft((value) => ({ ...value, contractNumber: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Номер счет фактура")}
                    <input value={draft.invoiceNumber} onChange={(event) => setDraft((value) => ({ ...value, invoiceNumber: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Дата счет фактуры")}
                    <input value={draft.invoiceDate} onChange={(event) => setDraft((value) => ({ ...value, invoiceDate: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                </div>
              </div>

              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium text-slate-800">{t("Список товаров")}</p>
                  <div className="flex items-center gap-4 text-sm">
                    <button type="button" onClick={addBlankItem} className="inline-flex items-center gap-1 text-[#4f71dc] hover:underline">
                      <Plus className="h-4 w-4" /> {t("добавить товар")}
                    </button>
                    <button type="button" onClick={() => { setPickerQuery(""); setPickerOpen(true) }} className="inline-flex items-center gap-1 text-[#4f71dc] hover:underline">
                      <ListPlus className="h-4 w-4" /> {t("добавить из списка")}
                    </button>
                    <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-1 text-[#4f71dc] hover:underline">
                      <Upload className="h-4 w-4" /> {t("импортировать с excel")}
                    </button>
                    <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importFromExcel} className="hidden" />
                  </div>
                </div>

                {draftItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-12 text-slate-400">
                    <FileSpreadsheet className="h-12 w-12" />
                    <p>
                      {t("Вы еще не выбрали ни одного товара.")}{" "}
                      <button type="button" onClick={addBlankItem} className="text-[#4f71dc] hover:underline">
                        {t("Добавить товар?")}
                      </button>
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="py-2 pr-4">{t("Товар")}</th>
                        <th className="py-2 pr-4">{t("Количество")}</th>
                        <th className="py-2 pr-4">{t("Цена")}</th>
                        <th className="py-2 pr-4">{t("Итог")}</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {draftItems.map((item) => (
                        <tr key={item.id} className="border-t border-slate-100">
                          <td className="py-2 pr-4">
                            <select value={item.product} onChange={(event) => updateDraftItem(item.id, { product: event.target.value })} className="bg-white outline-none">
                              {(productOptions.includes(item.product) ? productOptions : [item.product, ...productOptions]).map((product) => (
                                <option key={product}>{product}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-4">
                            <input type="number" min={0} step="any" value={item.qty} onChange={(event) => updateDraftItem(item.id, { qty: Number(event.target.value) })} className="w-20 border-b border-slate-200 outline-none" />
                          </td>
                          <td className="py-2 pr-4">
                            <input type="number" min={0} step="any" value={item.cost} onChange={(event) => updateDraftItem(item.id, { cost: Number(event.target.value) })} className="w-28 border-b border-slate-200 outline-none" />
                          </td>
                          <td className="py-2 pr-4">{(item.qty * item.cost).toLocaleString("ru-RU")}</td>
                          <td className="py-2 pr-4 text-right">
                            <button type="button" onClick={() => removeDraftItem(item.id)} aria-label={t("Удалить")} className="text-slate-400 hover:text-rose-500">
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
                {t("Общая стоимость")}: <b>{formatMoney(draftTotalCost)}</b> &nbsp; {t("Общее кол-во")}: <b>{draftTotalQty} {t("ед")}</b>
              </div>
              <button type="submit" className="font-bold uppercase text-sky-500">
                {t("Сохранить")}
              </button>
            </footer>
          </form>
        </div>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[80vh] w-full max-w-sm flex-col rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">{t("Добавить из списка")}</b>
              <button type="button" onClick={() => setPickerOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <input
              value={pickerQuery}
              onChange={(event) => setPickerQuery(event.target.value)}
              placeholder={t("Поиск товара...")}
              className="mb-3 w-full border-b border-slate-300 py-2 outline-none focus:border-[#4f71dc]"
            />
            <div className="space-y-2 overflow-y-auto">
              {productOptions.length === 0 && <p className="text-sm text-slate-400">{t("Каталог продуктов пуст")}</p>}
              {productOptions
                .filter((product) => !pickerQuery.trim() || product.toLowerCase().includes(pickerQuery.trim().toLowerCase()))
                .slice(0, 200)
                .map((product) => (
                  <label key={product} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draftItems.some((item) => item.product === product)} onChange={() => addFromList(product)} />
                    {product}
                  </label>
                ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded bg-[#4f71dc] px-4 py-2 font-semibold text-white">{t("Готово")}</button>
            </div>
          </div>
        </div>
      )}

      {quickAddSupplierOpen && (
        <SupplierFormModal
          onClose={() => setQuickAddSupplierOpen(false)}
          onSaved={(created) => {
            setSupplierOptions((current) => (current.includes(created.name) ? current : [created.name, ...current]))
            setDraft((value) => ({ ...value, supplier: created.name }))
            setQuickAddSupplierOpen(false)
          }}
        />
      )}

      {quickAddWarehouseOpen && (
        <WarehouseFormModal
          onClose={() => setQuickAddWarehouseOpen(false)}
          onSaved={(created) => {
            setWarehouseOptions((current) => (current.includes(created.name) ? current : [created.name, ...current]))
            setDraft((value) => ({ ...value, warehouse: created.name }))
            setQuickAddWarehouseOpen(false)
          }}
        />
      )}

      {quickAddOrganizationOpen && (
        <OrganizationFormModal
          onClose={() => setQuickAddOrganizationOpen(false)}
          onSaved={(created) => {
            setOrganizationOptions((current) => (current.includes(created.name) ? current : [created.name, ...current]))
            setDraft((value) => ({ ...value, organization: created.name }))
            setQuickAddOrganizationOpen(false)
          }}
        />
      )}
    </main>
  )
}
