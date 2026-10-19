"use client"

import {
  Ban,
  CheckCircle2,
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
  Receipt,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import type { InvoiceSupplyDraft } from "@/lib/invoice-incomings-types"
import { OrganizationFormModal } from "./organization-form-modal"
import { SupplierFormModal } from "./supplier-form-modal"
import {
  incomingPaymentTypes as paymentTypes,
  supplyCostLines,
  type Incoming,
  type IncomingExpense,
  type IncomingLog,
  type IncomingStatus as Status,
} from "./supplier-incomings-data"
import { IncomingExpenseDialog, IncomingRepriceDialog, LOG_LABELS } from "./supplier-incoming-dialogs"
import { SupplyPaymentsDialog } from "./supplier-payments-supply-dialog"
import { WarehouseFormModal } from "./warehouse-form-modal"

const ITEM_IMPORT_HEADER_ALIASES: Record<string, string> = {
  "товар": "product", "наименование": "product", "название": "product", "product": "product", "name": "product",
  "количество": "qty", "кол во": "qty", "qty": "qty", "quantity": "qty",
  "цена": "cost", "стоимость": "cost", "сумма": "cost", "сумма за единицу": "cost", "цена за единицу": "cost", "cost": "cost", "price": "cost", "unit price": "cost",
}

function formatMoney(value: number, currency = "SUM") {
  return `${(Math.round(value * 1000) / 1000).toLocaleString("ru-RU")} ${currency}`
}

function formatTimestamp(value: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${formatDate(date)}, ${date.toTimeString().slice(0, 5)}`
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

/** `source` = the e-invoice line the item was prefilled from ("Создать приход"). */
type DraftItem = { id: number; product: string; qty: number; cost: number; source?: { name: string; ikpu: string; unit: string } }
type Tab = "items" | "cost" | "expenses" | "logs"

const monthNames = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
function formatDate(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

function emptyDraft(supplierOptions: string[] = [], warehouseOptions: string[] = [], organizationOptions: string[] = [], branchOptions: string[] = []) {
  return {
    supplier: supplierOptions[0] ?? "",
    branch: branchOptions[0] ?? "",
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
  const [expenseTarget, setExpenseTarget] = useState<Incoming | null>(null)
  const [paymentsTarget, setPaymentsTarget] = useState<number | null>(null)
  const [detailExpenses, setDetailExpenses] = useState<IncomingExpense[]>([])
  const [detailLogs, setDetailLogs] = useState<IncomingLog[]>([])
  const [detailVersion, setDetailVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [supplierOptions, setSupplierOptions] = useState<string[]>([])
  const [warehouseOptions, setWarehouseOptions] = useState<string[]>([])
  const [organizationOptions, setOrganizationOptions] = useState<string[]>([])
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  const [productOptions, setProductOptions] = useState<string[]>([])
  const [productUnits, setProductUnits] = useState<Record<string, string>>({})
  const [pickerQuery, setPickerQuery] = useState("")
  const [quickAddSupplierOpen, setQuickAddSupplierOpen] = useState(false)
  const [quickAddWarehouseOpen, setQuickAddWarehouseOpen] = useState(false)
  const [quickAddOrganizationOpen, setQuickAddOrganizationOpen] = useState(false)
  // Create dialog opened from "Входящие счет фактуры" (?openCreateDialog=true&invoiceId=N).
  const searchParams = useSearchParams()
  const [optionsLoaded, setOptionsLoaded] = useState(false)
  const [fromInvoice, setFromInvoice] = useState<InvoiceSupplyDraft | null>(null)
  const invoiceHandled = useRef<string | null>(null)
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
      const [suppliersRes, warehousesRes, organizationsRes, productsRes, rawMaterialsRes, branchesRes] = await Promise.all([
        fetch("/api/suppliers").catch(() => null),
        fetch("/api/warehouses").catch(() => null),
        fetch("/api/organizations").catch(() => null),
        fetch("/api/products").catch(() => null),
        fetch("/api/raw-materials").catch(() => null),
        fetch("/api/branches").catch(() => null),
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
      if (branchesRes?.ok) {
        const data = (await branchesRes.json()) as { name: string }[]
        setBranchOptions(data.map((item) => item.name))
      }
      // Raw materials are received from suppliers too (production stock).
      const catalog: { name: string; unit: string }[] = []
      // Soft-deleted products ("Удалённые") are not offered.
      if (productsRes?.ok) catalog.push(...((await productsRes.json()) as { name: string; unit: string; deleted?: boolean }[]).filter((item) => !item.deleted))
      if (rawMaterialsRes?.ok) catalog.push(...((await rawMaterialsRes.json()) as { name: string; unit: string }[]))
      setProductOptions(Array.from(new Set(catalog.map((item) => item.name))).sort((a, b) => a.localeCompare(b, "ru")))
      setProductUnits(Object.fromEntries(catalog.map((item) => [item.name, item.unit])))
      setOptionsLoaded(true)
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  // "Создать приход" of an accepted incoming e-invoice: the create dialog prefilled with
  // its supplier, organization, currency, contract / invoice number and date and the lines
  // (matched to our products / raw materials; unmatched lines stay empty to pick a product).
  const invoiceParam = searchParams.get("openCreateDialog") === "true" ? searchParams.get("invoiceId") : null
  useEffect(() => {
    if (!invoiceParam || !optionsLoaded || invoiceHandled.current === invoiceParam) return
    invoiceHandled.current = invoiceParam
    const url = new URL(window.location.href)
    url.searchParams.delete("openCreateDialog")
    url.searchParams.delete("invoiceId")
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`)
    fetch(`/api/invoice-incomings/${encodeURIComponent(invoiceParam)}/supply-draft`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить счет-фактуру")
        return data as InvoiceSupplyDraft
      })
      .then((invoice) => {
        const base = emptyDraft(supplierOptions, warehouseOptions, organizationOptions, branchOptions)
        setDraft({
          ...base,
          supplier: invoice.supplier,
          organization: invoice.organizationMatched ? invoice.organization : base.organization,
          currency: invoice.currency,
          contractNumber: invoice.contractNumber,
          invoiceNumber: invoice.number,
          invoiceDate: invoice.date ? formatDate(new Date(`${invoice.date}T00:00:00`)) : "",
        })
        setDraftItems(invoice.lines.map((line, index) => ({ id: index + 1, product: line.product, qty: line.quantity, cost: line.cost, source: { name: line.name, ikpu: line.ikpu, unit: line.unit } })))
        setEditingId(null)
        setFromInvoice(invoice)
        setModalOpen(true)
      })
      .catch((reason: unknown) => window.alert(t(reason instanceof Error ? reason.message : String(reason))))
  }, [invoiceParam, optionsLoaded, supplierOptions, warehouseOptions, organizationOptions, branchOptions, t])

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

  useEffect(() => {
    if (expandedId === null) return
    let cancelled = false
    Promise.all([
      fetch(`/api/supplier-incomings/${expandedId}/expenses`).then((response) => (response.ok ? response.json() : [])),
      fetch(`/api/supplier-incomings/${expandedId}/logs`).then((response) => (response.ok ? response.json() : [])),
    ])
      .then(([expenses, logs]) => {
        if (cancelled) return
        setDetailExpenses(expenses as IncomingExpense[])
        setDetailLogs(logs as IncomingLog[])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [expandedId, detailVersion])

  function replaceRow(saved: Incoming) {
    setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)))
    setDetailVersion((value) => value + 1)
  }

  /** PATCH status actions and the expense delete share this error handling. */
  async function mutate(url: string, init: RequestInit, failure: string) {
    setBusy(true)
    try {
      const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        window.alert(data.error ? t(data.error) : t(failure))
        return
      }
      replaceRow(data as Incoming)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setBusy(false)
    }
  }

  function changeStatus(row: Incoming, action: "accept" | "unaccept" | "cancel") {
    const question =
      action === "accept" ? `${t("Принять на склад поставку №")} ${row.id}?` : action === "unaccept" ? `${t("Отменить приёмку поставки №")} ${row.id}?` : `${t("Отменить поставку №")} ${row.id}?`
    if (!window.confirm(question)) return
    void mutate(`/api/supplier-incomings/${row.id}`, { method: "PATCH", body: JSON.stringify({ action }) }, "Не удалось изменить статус поставки")
  }

  function removeExpense(row: Incoming, expense: IncomingExpense) {
    if (!window.confirm(`${t("Удалить расход")} «${expense.description}»?`)) return
    void mutate(`/api/supplier-incomings/${row.id}/expenses/${expense.id}`, { method: "DELETE" }, "Не удалось удалить расход")
  }

  function toggleExpand(row: Incoming) {
    setExpandedId((current) => (current === row.id ? null : row.id))
    setDetailTab("items")
  }

  function openCreate() {
    setDraft(emptyDraft(supplierOptions, warehouseOptions, organizationOptions, branchOptions))
    setDraftItems([])
    setEditingId(null)
    setFromInvoice(null)
    setModalOpen(true)
  }

  function openEdit(row: Incoming) {
    setDraft({
      supplier: row.supplier,
      branch: row.branch,
      warehouse: row.warehouse,
      organization: row.organization,
      currency: row.currency || "SUM",
      paymentType: row.paymentType,
      date: row.date,
      expectedFactoryExit: "",
      expectedCustomsArrival: "",
      contractNumber: row.contractNumber,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      comment: row.comment,
    })
    setDraftItems(row.items.map((item) => ({ id: item.id, product: item.product, qty: item.qty, cost: item.cost })))
    setEditingId(row.id)
    setFromInvoice(null)
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
    if (fromInvoice && editingId === null) {
      if (!supplierOptions.includes(draft.supplier)) {
        window.alert(t("Выберите поставщика из справочника"))
        return
      }
      if (draftItems.some((item) => !item.product.trim())) {
        window.alert(t("Выберите товар для каждой строки счет-фактуры или удалите строку"))
        return
      }
    }
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
          currency: draft.currency,
          date: draft.date,
          contractNumber: draft.contractNumber,
          invoiceNumber: draft.invoiceNumber,
          invoiceDate: draft.invoiceDate,
          comment: draft.comment,
          items,
          ...(fromInvoice && !isEdit ? { invoiceId: fromInvoice.invoiceId } : {}),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error ? t(data.error) : t("Не удалось сохранить приёмку"))
        return
      }
      const saved = (await response.json()) as Incoming
      setRows((current) => (isEdit ? current.map((row) => (row.id === editingId ? saved : row)) : [saved, ...current]))
      setDetailVersion((value) => value + 1)
      setModalOpen(false)
      setFromInvoice(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  function downloadRow(row: Incoming) {
    downloadExcelTable(`postavka-${row.id}`, [
      [t("№"), t("Товар"), t("Количество"), t("Стоимость"), t("Итог")],
      ...row.items.map((item) => [item.id, item.product, `${item.qty} ${productUnits[item.product] ?? ""}`.trim(), item.cost, item.total]),
    ])
  }

  function downloadList() {
    downloadExcelTable("prihod-ot-postavshikov", [
      [t("№"), t("Поставщик"), t("Склад"), t("Дата поставки"), t("Тип оплаты"), t("Номер договора"), t("Сумма поставки"), t("Статус"), t("Счет фактура")],
      ...filtered.map((row) => [row.id, row.supplier, row.warehouse, row.date, t(row.paymentType), row.contractNumber, row.amount, t(row.status), row.invoiceNumber]),
    ])
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "items", label: "Список товаров" },
    { id: "cost", label: "Себестоимость" },
    { id: "expenses", label: "Доп. расходы" },
    { id: "logs", label: "Логи" },
  ]

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
            <span className="mx-2 text-slate-400">|</span> {t("Приход от поставщиков")}
          </h1>
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <Plus className="h-4 w-4" /> {t("Добавить")}
          </button>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
            {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
          </button>
        </div>

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
          <button type="button" onClick={downloadList} aria-label={t("Скачать")} className="text-slate-500 hover:text-[#4f70e7]">
            <Download className="h-5 w-5" />
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
                    <td className="px-5 py-4 text-[#4f70e7]">{row.supplier}</td>
                    <td className="px-5 py-4">{row.warehouse}</td>
                    <td className="px-5 py-4">{row.date}</td>
                    <td className="px-5 py-4">{t(row.paymentType)}</td>
                    <td className="px-5 py-4">{row.contractNumber}</td>
                    <td className="px-5 py-4">{formatMoney(row.amount, row.currency)}</td>
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
                          <div className="flex flex-wrap items-center gap-2">
                            {row.status !== "отменен" && (
                              <button type="button" onClick={() => setExpenseTarget(row)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                                <Receipt className="h-4 w-4" /> {t("Добавить расход")}
                              </button>
                            )}
                            {row.status !== "отменен" && (
                              <button type="button" onClick={() => setMarkupTarget(row)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                                <Percent className="h-4 w-4" /> {t("Наценка")}
                              </button>
                            )}
                            {row.status === "ожидает" && (
                              <button type="button" onClick={() => openEdit(row)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                                <Pencil className="h-4 w-4" /> {t("Изменить")}
                              </button>
                            )}
                            <button type="button" onClick={() => downloadRow(row)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                              <Download className="h-4 w-4" /> {t("Скачать")}
                            </button>
                            {row.status === "ожидает" && (
                              <button type="button" disabled={busy} onClick={() => changeStatus(row, "accept")} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">
                                <CheckCircle2 className="h-4 w-4" /> {t("Принять на склад")}
                              </button>
                            )}
                            {row.status === "ожидает" && (
                              <button type="button" disabled={busy} onClick={() => changeStatus(row, "cancel")} className="inline-flex items-center gap-2 rounded bg-[#ff8967] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">
                                <Ban className="h-4 w-4" /> {t("Отменить")}
                              </button>
                            )}
                            {row.status === "принят" && (
                              <button type="button" disabled={busy} onClick={() => changeStatus(row, "unaccept")} className="inline-flex items-center gap-2 rounded bg-[#ff8967] px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50">
                                <RotateCcw className="h-4 w-4" /> {t("Отменить приёмку")}
                              </button>
                            )}
                            <button type="button" onClick={() => window.print()} aria-label={t("Печать")} className="text-slate-500 hover:text-[#4f70e7]">
                              <Printer className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => toggleExpand(row)} aria-label={t("Свернуть")} className="text-slate-500 hover:text-[#4f70e7]">
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
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Стоимость поставки")}</dt><dd className="font-medium">{formatMoney(row.amount, row.currency)}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Тип оплаты")}</dt><dd className="font-medium">{t(row.paymentType)}</dd></div>
                              {/* Demo: "Оплачено" (Σ supplier payments linked to the supply) opens "Список оплат по поставке №N" when > 0; "Остаток" red while > 0. */}
                              <div className="flex justify-between gap-4">
                                <dt className="text-slate-500">{t("Оплачено")}:</dt>
                                <dd className="font-medium">
                                  {row.paid > 0 ? (
                                    <button type="button" onClick={() => setPaymentsTarget(row.id)} className="border-b border-dashed border-[#4f70e7] font-semibold text-[#4f70e7]">
                                      {formatMoney(row.paid, row.currency)}
                                    </button>
                                  ) : (
                                    formatMoney(row.paid, row.currency)
                                  )}
                                </dd>
                              </div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Остаток")}:</dt><dd className={`font-medium ${row.amount - row.paid > 0 ? "text-[#e57373]" : "text-[#81c784]"}`}>{formatMoney(row.amount - row.paid, row.currency)}</dd></div>
                            </dl>
                            <p className="mb-2 mt-4 font-bold uppercase tracking-wide text-slate-700">{t("Доп. расходы")}</p>
                            {detailExpenses.length ? (
                              <dl className="space-y-1 text-sm">
                                {Object.entries(detailExpenses.reduce<Record<string, number>>((totals, expense) => ({ ...totals, [expense.currency]: (totals[expense.currency] ?? 0) + expense.amount }), {})).map(([currency, total]) => (
                                  <div key={currency} className="flex justify-between gap-4"><dt className="text-slate-500">{t("Итого")}:</dt><dd className="font-medium">{formatMoney(total, currency)}</dd></div>
                                ))}
                              </dl>
                            ) : (
                              <p className="text-sm text-slate-500">{t("Нет дополнительных расходов")}</p>
                            )}
                          </div>

                          <div>
                            <p className="mb-2 font-bold uppercase tracking-wide text-slate-700">{t("Исполнение")}</p>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Склад")}:</dt><dd className="font-medium">{row.warehouse}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Статус")}:</dt><dd className={`font-medium ${statusStyles[row.status]}`}>{row.status === "принят" ? t("Принят") : row.status === "ожидает" ? t("В ожидании") : t("Отменен")}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Принимать на склад")}:</dt><dd className={`font-medium ${row.status === "ожидает" ? "text-emerald-500" : "text-slate-500"}`}>{row.status === "ожидает" ? t("Можно") : row.status === "принят" ? t("Принято") : t("Нельзя")}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">{t("Время приемки")}:</dt><dd className="font-medium">{row.acceptedAt ? `${formatTimestamp(row.acceptedAt)}${row.acceptedBy ? ` (${row.acceptedBy})` : ""}` : t("Не начался")}</dd></div>
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
                              className={`border-b-2 pb-2 text-sm font-medium ${detailTab === tab.id ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-500 hover:text-slate-700"}`}
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
                                  <td className="py-2 pr-4">{item.qty.toLocaleString("ru-RU")} {productUnits[item.product] ?? ""}</td>
                                  <td className="py-2 pr-4">{item.block}</td>
                                  <td className="py-2 pr-4">{item.kg}</td>
                                  <td className="py-2 pr-4">{item.netWeight}</td>
                                  <td className="py-2 pr-4">{item.cost.toLocaleString("ru-RU")}</td>
                                  <td className="py-2 pr-4">{item.total.toLocaleString("ru-RU")}</td>
                                </tr>
                              ))}
                              <tr className="border-t border-slate-300 font-bold">
                                <td className="py-2 pr-4" colSpan={3}>{t("Итого")}:</td>
                                <td className="py-2 pr-4">{row.items.reduce((sum, item) => sum + item.qty, 0).toLocaleString("ru-RU")}</td>
                                <td className="py-2 pr-4">0</td>
                                <td className="py-2 pr-4">0</td>
                                <td className="py-2 pr-4" />
                                <td className="py-2 pr-4" />
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
                                <th className="py-2 pr-4">{t("Количество")}</th>
                                <th className="py-2 pr-4">{t("Закупочная цена")}</th>
                                <th className="py-2 pr-4">{t("Доп. расход на ед.")}</th>
                                <th className="py-2 pr-4">{t("Себестоимость за ед.")}</th>
                                <th className="py-2 pr-4">{t("Итог")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {supplyCostLines(row).map((line, index) => (
                                <tr key={`${line.product}-${index}`} className="border-t border-slate-100">
                                  <td className="py-2 pr-4">{line.product}</td>
                                  <td className="py-2 pr-4">{line.qty.toLocaleString("ru-RU")} {productUnits[line.product] ?? ""}</td>
                                  <td className="py-2 pr-4">{formatMoney(line.purchasePrice, row.currency)}</td>
                                  <td className="py-2 pr-4">{formatMoney(line.expensePerUnit, row.currency)}</td>
                                  <td className="py-2 pr-4 font-medium">{formatMoney(line.unitCost, row.currency)}</td>
                                  <td className="py-2 pr-4">{formatMoney(line.total, row.currency)}</td>
                                </tr>
                              ))}
                              <tr className="border-t border-slate-300 font-bold">
                                <td className="py-2 pr-4" colSpan={5}>{t("Итого")}:</td>
                                <td className="py-2 pr-4">{formatMoney(row.amount + row.expensesTotal, row.currency)}</td>
                              </tr>
                            </tbody>
                          </table>
                        )}

                        {detailTab === "expenses" && (
                          detailExpenses.length ? (
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-2 pr-4">{t("Дата")}</th>
                                  <th className="py-2 pr-4">{t("Описание расхода")}</th>
                                  <th className="py-2 pr-4">{t("Тип оплаты")}</th>
                                  <th className="py-2 pr-4">{t("Сумма")}</th>
                                  <th className="py-2 pr-4">{t("Добавил")}</th>
                                  <th className="w-10" />
                                </tr>
                              </thead>
                              <tbody>
                                {detailExpenses.map((expense) => (
                                  <tr key={expense.id} className="border-t border-slate-100">
                                    <td className="py-2 pr-4">{expense.date}</td>
                                    <td className="py-2 pr-4">{expense.description}</td>
                                    <td className="py-2 pr-4">{t(expense.paymentType)}</td>
                                    <td className="py-2 pr-4">{formatMoney(expense.amount, expense.currency)}</td>
                                    <td className="py-2 pr-4">{expense.createdBy}</td>
                                    <td className="py-2 pr-4 text-right">
                                      <button type="button" disabled={busy} onClick={() => removeExpense(row, expense)} aria-label={t("Удалить")} className="text-slate-400 hover:text-rose-500">
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-sm text-slate-500">{t("Нет дополнительных расходов")}</p>
                          )
                        )}

                        {detailTab === "logs" && (
                          <ul className="space-y-2 text-sm text-slate-600">
                            {detailLogs.map((log) => (
                              <li key={log.id} className="flex flex-wrap gap-x-2 border-b border-dashed border-slate-200 pb-2">
                                <span className="text-slate-400">{formatTimestamp(log.createdAt)}</span>
                                <span className="font-medium text-slate-700">{t(LOG_LABELS[log.action] ?? log.action)}</span>
                                {log.details && <span>— {log.details}</span>}
                                <span className="text-slate-400">({log.userName})</span>
                              </li>
                            ))}
                            {!detailLogs.length && <li className="text-slate-400">{t("Записей нет")}</li>}
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
        <IncomingRepriceDialog
          incoming={markupTarget}
          units={productUnits}
          onClose={() => setMarkupTarget(null)}
          onSaved={() => {
            setMarkupTarget(null)
            setDetailVersion((value) => value + 1)
          }}
        />
      )}

      {paymentsTarget !== null && <SupplyPaymentsDialog supplyId={paymentsTarget} onClose={() => setPaymentsTarget(null)} />}

      {expenseTarget && (
        <IncomingExpenseDialog
          incoming={expenseTarget}
          onClose={() => setExpenseTarget(null)}
          onSaved={(saved) => {
            setExpenseTarget(null)
            replaceRow(saved)
          }}
        />
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? `${t("Изменить поставку №")} ${editingId}` : t("Добавление поставки")}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto p-8">
              {fromInvoice && editingId === null && (
                <div className="space-y-1 rounded border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  <p>
                    {t("Приход создается из счет-фактуры")} № <b>{fromInvoice.number}</b> {t("от")} {draft.invoiceDate} — {formatMoney(fromInvoice.total, fromInvoice.currency)}
                  </p>
                  {!supplierOptions.includes(draft.supplier) && <p className="text-amber-700">{t("Поставщик не найден в справочнике — выберите поставщика или добавьте его.")}</p>}
                  {draftItems.some((item) => !item.product) && <p className="text-amber-700">{t("Строки без товара в каталоге выделены — выберите товар или удалите строку.")}</p>}
                </div>
              )}
              <div className="grid gap-6 sm:grid-cols-3">
                <div className="space-y-4">
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Поставщик")} *
                      <select value={draft.supplier} onChange={(event) => setDraft((value) => ({ ...value, supplier: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        {draft.supplier && !supplierOptions.includes(draft.supplier) && <option>{draft.supplier}</option>}
                        {supplierOptions.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddSupplierOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f70e7] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {supplierOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет поставщиков — нажмите «+добавить»")}</p>}
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Филиал")} *
                    <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">{t("Не указано")}</option>
                      {draft.branch && !branchOptions.includes(draft.branch) && <option>{draft.branch}</option>}
                      {branchOptions.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Склад назначения")} *
                      <select value={draft.warehouse} onChange={(event) => setDraft((value) => ({ ...value, warehouse: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        {warehouseOptions.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddWarehouseOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f70e7] hover:underline">
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
                    <button type="button" onClick={() => setQuickAddOrganizationOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f70e7] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {organizationOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет организаций — нажмите «+добавить»")}</p>}
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Валюта оплаты")} *
                    <select value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option>SUM</option>
                      <option>USD</option>
                      {!["SUM", "USD"].includes(draft.currency) && <option>{draft.currency}</option>}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Тип оплаты")} *
                    <select value={draft.paymentType} onChange={(event) => setDraft((value) => ({ ...value, paymentType: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {paymentTypes.map((item) => <option key={item} value={item}>{t(item)}</option>)}
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
                    <button type="button" onClick={addBlankItem} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                      <Plus className="h-4 w-4" /> {t("добавить товар")}
                    </button>
                    <button type="button" onClick={() => { setPickerQuery(""); setPickerOpen(true) }} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                      <ListPlus className="h-4 w-4" /> {t("добавить из списка")}
                    </button>
                    <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
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
                      <button type="button" onClick={addBlankItem} className="text-[#4f70e7] hover:underline">
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
                            <select value={item.product} onChange={(event) => updateDraftItem(item.id, { product: event.target.value })} className={`bg-white outline-none ${item.source && !item.product ? "rounded border border-rose-400" : ""}`}>
                              {(productOptions.includes(item.product) ? productOptions : [item.product, ...productOptions]).map((product) => (
                                <option key={product}>{product}</option>
                              ))}
                            </select>
                            {item.source && (
                              <span className={`block text-xs ${item.product ? "text-slate-400" : "text-rose-500"}`}>
                                {t("По счет-фактуре")}: {item.source.name}
                                {item.source.ikpu ? ` · ${t("ИКПУ")} ${item.source.ikpu}` : ""}
                                {item.source.unit ? ` · ${item.source.unit}` : ""}
                              </span>
                            )}
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
              className="mb-3 w-full border-b border-slate-300 py-2 outline-none focus:border-[#4f70e7]"
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
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded bg-[#4f70e7] px-4 py-2 font-semibold text-white">{t("Готово")}</button>
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
