"use client"

import { Trash2 } from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { FilterCheck, FilterDate, FilterSelect, FilterTextMui, RI, RefButton, RefCard, RefFilterPanel, RefHeader, RefPage, RefTable, RefToolbar, usePaging } from "@/components/ref/list-kit"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { formatStatementDate, parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { unitWeightKg } from "@/lib/internal-transfers-types"
import type { InvoiceSupplyDraft } from "@/lib/invoice-incomings-types"
import { RefTip } from "@/components/ref/ref-tip"
import { formatUnitTotals } from "./internal-transfers-picker"
import { ConfirmDialog, useCanManage } from "./cash-management-shared"
import { MaterialBody, MaterialDate, MaterialDialog, MaterialFooter } from "./cash-material"
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
import { currencyChoices, IncomingExpenseDialog, IncomingRepriceDialog, LOG_LABELS, useCurrencyCodes } from "./supplier-incoming-dialogs"
import { SupplierIncomingForm, isoToRuDate, ruDateToIso } from "./supplier-incoming-form"
import { SupplierProductPicker } from "./supplier-product-picker"
import { SupplyPaymentsDialog } from "./supplier-payments-supply-dialog"
import { WarehouseFormModal } from "./warehouse-form-modal"
import { notify } from "@/lib/notify"

const ITEM_IMPORT_HEADER_ALIASES: Record<string, string> = {
  "товар": "product", "наименование": "product", "название": "product", "product": "product", "name": "product",
  "количество": "qty", "кол во": "qty", "qty": "qty", "quantity": "qty",
  "цена": "cost", "стоимость": "cost", "сумма": "cost", "сумма за единицу": "cost", "цена за единицу": "cost", "cost": "cost", "price": "cost", "unit price": "cost",
}

function formatMoney(value: number, currency = "SUM") {
  return `${(Math.round(value * 1000) / 1000).toLocaleString("ru-RU")} ${currency}`
}

/** A stored timestamp (UTC ISO, local text, …) in the page language, Asia/Tashkent time. */
function formatTimestamp(value: string, language: string) {
  if (!value) return ""
  const local = parseAnyDate(value)
  return local ? formatStatementDate(local.slice(0, 16), language).replace(/\s*г\.,/, ",") : value
}

/** A stored day (YYYY-MM-DD, legacy "19 октября 2026") in the page language. */
function formatDay(value: string, language: string) {
  const day = parseAnyDay(value)
  return day ? formatStatementDate(day, language, false).replace(/\s*г\.$/, "") : value
}

const statusDots: Record<Status, string> = {
  принят: "bg-[#81c784]",
  ожидает: "bg-[#f0ad4e]",
  отменен: "bg-rose-500",
}

/** `source` = the e-invoice line the item was prefilled from ("Создать приход"). */
type DraftItem = { id: number; product: string; qty: number; cost: number; expiry?: string; source?: { name: string; ikpu: string; unit: string } }
type Tab = "items" | "cost" | "expenses" | "logs"

/** Older expense logs stored the amount unformatted ("Доставка: 250000 SUM"). */
function logDetails(log: IncomingLog): string {
  if (log.action !== "expense_added" && log.action !== "expense_deleted") return log.details
  const match = /^(.*): (-?\d+(?:\.\d+)?) (\S+)$/.exec(log.details)
  return match ? `${match[1]}: ${formatMoney(Number(match[2]), match[3])}` : log.details
}

/** A stored day as the value of an <input type="date"> ("" when it does not parse). */
const isoDay = (value: string) => parseAnyDay(value) ?? ""
/** A date of the form (Russian text "23 октября 2026" or ISO) as the ISO day the API stores. */
const toIsoDay = (value: string) => ruDateToIso(value) || isoDay(value)

/** A new supply starts with nothing picked: the storekeeper must choose the supplier,
 * branch, warehouse and organization (the lists are newest-first, so a preselected
 * first option would be whatever was created last). Dates are ISO (date pickers).
 * The currency defaults to the base currency (Валюты). */
function emptyDraft(currency = "SUM") {
  return {
    supplier: "",
    branch: "",
    warehouse: "",
    organization: "",
    currency,
    paymentType: paymentTypes[0] as string,
    date: isoToRuDate(todayIso()),
    expectedFactoryExit: "",
    expectedCustomsArrival: "",
    contractNumber: "",
    invoiceNumber: "",
    invoiceDate: "",
    comment: "",
  }
}

function TipIconButton({ path, label, onClick }: { path: string; label: string; onClick: () => void }) {
  const [tip, setTip] = useState(false)
  return (
    <span className="relative" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
      <button type="button" aria-label={label} onClick={onClick} className="flex h-12 w-12 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
          <path d={path} />
        </svg>
      </button>
      {tip && (
        <span className="pointer-events-none absolute right-full top-1/2 z-50 mr-[14px] -translate-y-1/2 whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-bold leading-[17px] text-white opacity-90">{label}</span>
      )}
    </span>
  )
}

function SupplyAction({ children, icon, onClick, color = "#4f71dc", disabled, width }: { children: ReactNode; icon: string; onClick: () => void; color?: string; disabled?: boolean; width?: number }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} style={{ backgroundColor: color, width }} className="inline-flex h-[30px] min-w-[88px] items-center justify-center gap-[8px] rounded-[5px] pl-[12px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden>
        <path d={icon} />
      </svg>
      {children}
    </button>
  )
}

function InfoRow({ label, value, valueClass = "" }: { label: string; value: ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="font-normal">{label}</dt>
      <dd className={`font-semibold ${valueClass}`}>{value}</dd>
    </div>
  )
}

function SortHead({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center pl-[18px]">
      {children}
      <svg viewBox="0 0 24 24" className="ml-[8px] h-4 w-4 fill-[#9e9e9e]" aria-hidden>
        <path d="M12 5.83L15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z" />
      </svg>
    </div>
  )
}

/** "0 новый шт (+11 новый шт)": whole boxes, then the loose units. */
function blockLabel(qty: number, box: { unit: string; amount: number } | undefined, unit: string) {
  if (!box || box.amount <= 0) return "0"
  const boxes = Math.floor(qty / box.amount)
  const rest = Math.round((qty - boxes * box.amount) * 1000) / 1000
  return `${boxes} ${box.unit}${rest > 0 ? ` (+${rest} ${unit})` : ""}`
}

type WarehouseOption = { name: string; branch: string; active: boolean }

const sameName = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase()

export function SupplierIncomingsView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const [rows, setRows] = useState<Incoming[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [branchFilter, setBranchFilter] = useState("")
  const [supplierFilter, setSupplierFilter] = useState("")
  const [productFilter, setProductFilter] = useState("")
  const [organizationFilter, setOrganizationFilter] = useState("")
  const [paymentFilter, setPaymentFilter] = useState("")
  const [contractFilter, setContractFilter] = useState("")
  const [invoiceFilter, setInvoiceFilter] = useState("")
  const [supplyDateFilter, setSupplyDateFilter] = useState({ begin: "", end: "" })
  const [invoiceDateFilter, setInvoiceDateFilter] = useState({ begin: "", end: "" })
  const [acceptedFilter, setAcceptedFilter] = useState({ begin: "", end: "" })
  const [createdFilter, setCreatedFilter] = useState({ begin: "", end: "" })
  const [excludeCancelled, setExcludeCancelled] = useState(true)
  const [excludeInventory, setExcludeInventory] = useState(false)
  const pathname = usePathname()
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<Tab>("items")
  const [markupTarget, setMarkupTarget] = useState<Incoming | null>(null)
  // The reference confirms every status change in its own dialog (accept asks for the day, cancel asks to confirm).
  const [statusAsk, setStatusAsk] = useState<{ row: Incoming; action: "accept" | "unaccept" | "cancel" } | null>(null)
  const [acceptDate, setAcceptDate] = useState("")
  const [expenseDelete, setExpenseDelete] = useState<{ row: Incoming; expense: IncomingExpense } | null>(null)
  const [expenseTarget, setExpenseTarget] = useState<Incoming | null>(null)
  const [paymentsTarget, setPaymentsTarget] = useState<number | null>(null)
  const [detailExpenses, setDetailExpenses] = useState<IncomingExpense[]>([])
  const [detailLogs, setDetailLogs] = useState<IncomingLog[]>([])
  const [detailVersion, setDetailVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  /** Why the last status change / expense delete was refused: shown in its dialog, which stays open. */
  const [actionError, setActionError] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(() => emptyDraft())
  const currencies = useCurrencyCodes()
  /** "Наценка" writes a price list: procurement.manage (this page) and catalog.manage (repricing). */
  const canReprice = useCanManage(["procurement.manage", "catalog.manage"])
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [supplierOptions, setSupplierOptions] = useState<string[]>([])
  const [warehouseRows, setWarehouseRows] = useState<WarehouseOption[]>([])
  const [organizationOptions, setOrganizationOptions] = useState<string[]>([])
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  const [productOptions, setProductOptions] = useState<string[]>([])
  const [productUnits, setProductUnits] = useState<Record<string, string>>({})
  const [productExpiry, setProductExpiry] = useState<Record<string, boolean>>({})
  const [productInfo, setProductInfo] = useState<Record<string, { stock: number; barcode: string }>>({})
  const [productBoxes, setProductBoxes] = useState<Record<string, { unit: string; amount: number }>>({})
  /** Weight of one unit, kg (the item's mass, else what a weight unit implies), by item name. */
  const [productUnitKg, setProductUnitKg] = useState<Record<string, number>>({})
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
  // "excel'dan import qilish": 1. sample, 2. the filled file (staged here), 3. confirm adds the staged rows.
  const [importStaged, setImportStaged] = useState<DraftItem[]>([])
  /** "Кг." of a supply line: the weight typed on the line, else quantity × weight of one unit. */
  const lineKg = (item: { product: string; qty: number; kg?: number }) =>
    Number(item.kg) > 0 ? Number(item.kg) : Math.round(item.qty * (productUnitKg[item.product] ?? 0) * 1000) / 1000

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
        setSupplierOptions(Array.from(new Set(data.map((item) => item.name))))
      }
      if (warehousesRes?.ok) {
        const data = (await warehousesRes.json()) as Array<{ name: string; branch?: string; active?: boolean }>
        setWarehouseRows(data.map((item) => ({ name: item.name, branch: item.branch ?? "", active: item.active !== false })))
      }
      if (organizationsRes?.ok) {
        const data = (await organizationsRes.json()) as { name: string }[]
        setOrganizationOptions(Array.from(new Set(data.map((item) => item.name))))
      }
      if (branchesRes?.ok) {
        const data = (await branchesRes.json()) as { name: string }[]
        setBranchOptions(Array.from(new Set(data.map((item) => item.name))))
      }
      // Raw materials are received from suppliers too (production stock).
      const catalog: { name: string; unit: string; mass: number; boxUnit?: string; boxAmount?: number; trackExpiry?: boolean }[] = []
      const massOf = (value: unknown) => Number(String(value ?? "").replace(",", ".")) || 0
      // Soft-deleted products ("Удалённые") are not offered.
      if (productsRes?.ok) {
        const data = (await productsRes.json()) as { name: string; unit: string; weight?: unknown; boxUnit?: string; boxAmount?: number; trackExpiry?: boolean; deleted?: boolean }[]
        catalog.push(...data.filter((item) => !item.deleted).map((item) => ({ name: item.name, unit: item.unit, mass: massOf(item.weight), boxUnit: item.boxUnit, boxAmount: item.boxAmount, trackExpiry: item.trackExpiry })))
      }
      if (rawMaterialsRes?.ok) {
        const data = (await rawMaterialsRes.json()) as { name: string; unit: string; mass?: unknown }[]
        catalog.push(...data.map((item) => ({ name: item.name, unit: item.unit, mass: massOf(item.mass) })))
      }
      setProductOptions(Array.from(new Set(catalog.map((item) => item.name))).sort((a, b) => a.localeCompare(b, "ru")))
      setProductUnits(Object.fromEntries(catalog.map((item) => [item.name, item.unit])))
      setProductUnitKg(Object.fromEntries(catalog.map((item) => [item.name, unitWeightKg(item.unit, item.mass)])))
      setProductExpiry(Object.fromEntries(catalog.map((item) => [item.name, Boolean(item.trackExpiry)])))
      setProductBoxes(Object.fromEntries(catalog.filter((item) => item.boxUnit && (item.boxAmount ?? 0) > 0).map((item) => [item.name, { unit: item.boxUnit as string, amount: item.boxAmount as number }])))
      setOptionsLoaded(true)
      // "В наличии" and the barcode shown in the product search of the reference's form.
      const balancesRes = await fetch("/api/stock/balances?pageSize=0").catch(() => null)
      if (!cancelled && balancesRes?.ok) {
        const data = (await balancesRes.json()) as { rows?: { name: string; total: number; barcode?: string }[] }
        const info: Record<string, { stock: number; barcode: string }> = {}
        for (const row of data.rows ?? []) {
          const current = info[row.name]
          info[row.name] = { stock: (current?.stock ?? 0) + (row.total ?? 0), barcode: current?.barcode || row.barcode || "" }
        }
        setProductInfo(info)
      }
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  /** Every warehouse (filters, legacy rows). */
  const warehouseOptions = useMemo(() => warehouseRows.map((item) => item.name), [warehouseRows])
  /** Warehouses a new supply may go to: active ones of the chosen branch (all branches when none is chosen). */
  const draftWarehouseOptions = useMemo(
    () => warehouseRows.filter((item) => item.active && (!draft.branch || !item.branch || sameName(item.branch, draft.branch))).map((item) => item.name),
    [warehouseRows, draft.branch],
  )

  // "Создать приход" of an accepted incoming e-invoice: the create dialog prefilled with
  // its supplier, organization, currency, contract / invoice number and date and the lines
  // (matched to our products / raw materials; unmatched lines stay empty to pick a product).
  const invoiceParam = searchParams.get("openCreateDialog") === "true" ? searchParams.get("invoiceId") : null
  // ?openCreateDialog=true (no invoice) opens the empty create dialog, like the reference.
  const plainCreate = searchParams.get("openCreateDialog") === "true" && !searchParams.get("invoiceId")
  useEffect(() => {
    if (!plainCreate || !optionsLoaded || invoiceHandled.current === "plain") return
    invoiceHandled.current = "plain"
    const url = new URL(window.location.href)
    url.searchParams.delete("openCreateDialog")
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`)
    setDraft(emptyDraft(currencies.base))
    setDraftItems([])
    setEditingId(null)
    setFromInvoice(null)
    setModalOpen(true)
  }, [plainCreate, optionsLoaded, currencies.base])
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
        const base = emptyDraft(currencies.base)
        setDraft({
          ...base,
          supplier: invoice.supplier,
          organization: invoice.organizationMatched ? invoice.organization : base.organization,
          currency: invoice.currency,
          contractNumber: invoice.contractNumber,
          invoiceNumber: invoice.number,
          invoiceDate: invoice.date ? isoToRuDate(isoDay(invoice.date)) : "",
        })
        setDraftItems(invoice.lines.map((line, index) => ({ id: index + 1, product: line.product, qty: line.quantity, cost: line.cost, source: { name: line.name, ikpu: line.ikpu, unit: line.unit } })))
        setEditingId(null)
        setFromInvoice(invoice)
        setModalOpen(true)
      })
      .catch((reason: unknown) => notify(t(reason instanceof Error ? reason.message : String(reason))))
  }, [invoiceParam, optionsLoaded, t, currencies.base])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !row.supplier.toLowerCase().includes(query.toLowerCase()) && !String(row.id).includes(query)) return false
      if (statusFilter !== "all" && row.status !== statusFilter.toLowerCase()) return false
      if (warehouseFilter !== "all" && row.warehouse !== warehouseFilter) return false
      if (branchFilter && row.branch !== branchFilter) return false
      if (supplierFilter && row.supplier !== supplierFilter) return false
      if (productFilter && !row.items.some((item) => item.product === productFilter)) return false
      if (organizationFilter && row.organization !== organizationFilter) return false
      if (paymentFilter && row.paymentType !== paymentFilter) return false
      if (contractFilter && !row.contractNumber.toLowerCase().includes(contractFilter.toLowerCase())) return false
      if (invoiceFilter && !row.invoiceNumber.toLowerCase().includes(invoiceFilter.toLowerCase())) return false
      if (excludeCancelled && row.status === "отменен") return false
      if (excludeInventory && /инвент?[ao]ризаци/i.test(row.supplier)) return false
      for (const [range, value] of [[invoiceDateFilter, row.invoiceDate], [acceptedFilter, row.acceptedAt], [createdFilter, row.date]] as const) {
        if (!range.begin && !range.end) continue
        const iso = /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : isoDay(value)
        if (!iso || (range.begin && iso < range.begin) || (range.end && iso > range.end)) return false
      }
      if (supplyDateFilter.begin || supplyDateFilter.end) {
        const iso = isoDay(row.date)
        if (!iso || (supplyDateFilter.begin && iso < supplyDateFilter.begin) || (supplyDateFilter.end && iso > supplyDateFilter.end)) return false
      }
      return true
    })
  }, [supplyDateFilter, invoiceDateFilter, acceptedFilter, createdFilter, excludeCancelled, excludeInventory, rows, query, statusFilter, warehouseFilter, branchFilter, supplierFilter, productFilter, organizationFilter, paymentFilter, contractFilter, invoiceFilter])

  const paging = usePaging(filtered.length)
  const visible = filtered.slice(paging.start, paging.end)

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

  /** PATCH status actions and the expense delete share this error handling: "" = done,
   * else the (translated) reason, shown in the confirm dialog. */
  async function mutate(url: string, init: RequestInit, failure: string): Promise<string> {
    setBusy(true)
    try {
      const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) return data.error ? t(data.error) : t(failure)
      replaceRow(data as Incoming)
      return ""
    } catch {
      return t("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setBusy(false)
    }
  }

  function changeStatus(row: Incoming, action: "accept" | "unaccept" | "cancel") {
    setAcceptDate(todayIso())
    setActionError("")
    setStatusAsk({ row, action })
  }

  /** The dialog stays open (busy) until the server answers, and shows its refusal. */
  async function confirmStatus() {
    if (!statusAsk || busy) return
    const { row, action } = statusAsk
    const error = await mutate(`/api/supplier-incomings/${row.id}`, { method: "PATCH", body: JSON.stringify(action === "accept" ? { action, date: acceptDate } : { action }) }, "Не удалось изменить статус поставки")
    if (error) setActionError(error)
    else setStatusAsk(null)
  }

  function removeExpense(row: Incoming, expense: IncomingExpense) {
    setActionError("")
    setExpenseDelete({ row, expense })
  }

  async function confirmRemoveExpense() {
    if (!expenseDelete || busy) return
    const { row, expense } = expenseDelete
    const error = await mutate(`/api/supplier-incomings/${row.id}/expenses/${expense.id}`, { method: "DELETE" }, "Не удалось удалить расход")
    if (error) setActionError(error)
    else setExpenseDelete(null)
  }

  // Escape closes the top layer of the supply dialog (the product list, else the
  // dialog itself), like the other dialogs; a quick-add form on top keeps it.
  useEffect(() => {
    if (!modalOpen && !pickerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || quickAddSupplierOpen || quickAddWarehouseOpen || quickAddOrganizationOpen) return
      if (pickerOpen) setPickerOpen(false)
      else setModalOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [modalOpen, pickerOpen, quickAddSupplierOpen, quickAddWarehouseOpen, quickAddOrganizationOpen])

  function toggleExpand(row: Incoming) {
    const next = expandedId === row.id ? null : row.id
    setExpandedId(next)
    setDetailTab("items")
    if (!embedded) window.history.pushState(null, "", next === null ? "/analytics/supplier-incomings" : `/analytics/supplier-incomings/${next}`)
  }

  // /analytics/supplier-incomings/<id> opens the supply card (back / forward and direct links included).
  useEffect(() => {
    if (embedded) return
    const match = pathname.match(/\/supplier-incomings\/(\d+)/)
    setExpandedId(match ? Number(match[1]) : null)
  }, [pathname, embedded])

  function openCreate() {
    setDraft(emptyDraft(currencies.base))
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
      currency: row.currency || currencies.base,
      paymentType: row.paymentType,
      date: isoToRuDate(isoDay(row.date) || todayIso()),
      expectedFactoryExit: "",
      expectedCustomsArrival: "",
      contractNumber: row.contractNumber,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: isoToRuDate(isoDay(row.invoiceDate)),
      comment: row.comment,
    })
    setDraftItems(row.items.map((item) => ({ id: item.id, product: item.product, qty: item.qty, cost: item.cost })))
    setEditingId(row.id)
    setFromInvoice(null)
    setModalOpen(true)
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
      if (parsed.length) setImportStaged(parsed)
    })()
  }

  function confirmImport() {
    if (!importStaged.length) return
    setDraftItems((current) => [...current, ...importStaged])
    setImportStaged([])
  }

  function downloadImportTemplate() {
    downloadExcelTable("namuna", [[t("Наименование"), t("Количество"), t("Цена")], [productOptions[0] ?? "", 1, 1000]])
  }

  const draftTotalCost = draftItems.reduce((sum, item) => sum + item.qty * item.cost, 0)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving || !draftItems.length) return
    if (!draft.supplier || !draft.warehouse || !draft.organization) {
      notify(t("Заполните обязательные поля"))
      return
    }
    if (draftItems.some((item) => !item.product.trim())) {
      notify(t("Выберите товар"))
      return
    }
    if (draftItems.some((item) => !(item.qty > 0))) {
      notify(t("Количество должно быть больше 0"))
      return
    }
    if (draftItems.some((item) => !(item.cost >= 0))) {
      notify(t("Цена не может быть отрицательной"))
      return
    }
    if (fromInvoice && editingId === null) {
      if (!supplierOptions.includes(draft.supplier)) {
        notify(t("Выберите поставщика из справочника"))
        return
      }
      if (draftItems.some((item) => !item.product.trim())) {
        notify(t("Выберите товар для каждой строки счет-фактуры или удалите строку"))
        return
      }
    }
    const items = draftItems.map((item) => ({
      id: item.id,
      product: item.product,
      expiry: item.expiry ?? "",
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
          date: toIsoDay(draft.date),
          contractNumber: draft.contractNumber,
          invoiceNumber: draft.invoiceNumber,
          invoiceDate: toIsoDay(draft.invoiceDate),
          comment: draft.comment,
          items,
          ...(fromInvoice && !isEdit ? { invoiceId: fromInvoice.invoiceId } : {}),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        notify(data.error ? t(data.error) : t("Не удалось сохранить приёмку"))
        return
      }
      const saved = (await response.json()) as Incoming
      setRows((current) => (isEdit ? current.map((row) => (row.id === editingId ? saved : row)) : [saved, ...current]))
      setDetailVersion((value) => value + 1)
      setModalOpen(false)
      setFromInvoice(null)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
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

  const filterPanel = (
    <RefFilterPanel narrow applyClassName="mt-[25px]" onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)} className="!w-[310px]">
      <FilterSelect className="-mt-[1px]" label={t("Филиалы")} value={branchFilter} onChange={(value) => { setBranchFilter(value); paging.setPage(1) }} options={branchOptions} />
      <FilterSelect label={t("Поставщик")} value={supplierFilter} onChange={(value) => { setSupplierFilter(value); paging.setPage(1) }} options={supplierOptions} />
      <FilterSelect label={t("Склад")} value={warehouseFilter === "all" ? "" : warehouseFilter} onChange={(value) => { setWarehouseFilter(value || "all"); paging.setPage(1) }} options={warehouseOptions} />
      <FilterSelect label={t("Товар")} value={productFilter} onChange={(value) => { setProductFilter(value); paging.setPage(1) }} options={productOptions} />
      <FilterSelect label={t("Организация")} value={organizationFilter} onChange={(value) => { setOrganizationFilter(value); paging.setPage(1) }} options={organizationOptions} />
      <FilterSelect label={t("Тип оплаты")} value={paymentFilter} onChange={(value) => { setPaymentFilter(value); paging.setPage(1) }} options={[...paymentTypes]} />
      <FilterSelect label={t("Тип")} value={statusFilter === "all" ? "" : statusFilter} onChange={(value) => { setStatusFilter(value || "all"); paging.setPage(1) }} options={["Ожидает", "В процессе", "Принят", "Отменен"]} />
      <FilterTextMui className="mt-[1px]" label={t("Номер договора")} value={contractFilter} onChange={(value) => { setContractFilter(value); paging.setPage(1) }} />
      <FilterTextMui label="Номер счет фактуры" value={invoiceFilter} onChange={(value) => { setInvoiceFilter(value); paging.setPage(1) }} />
      <FilterDate mui label={t("Дата счет фактуры")} begin={invoiceDateFilter.begin} end={invoiceDateFilter.end} onChange={(begin, end) => { setInvoiceDateFilter({ begin, end }); paging.setPage(1) }} />
      <FilterDate mui label={t("Дата поставки")} begin={supplyDateFilter.begin} end={supplyDateFilter.end} onChange={(begin, end) => { setSupplyDateFilter({ begin, end }); paging.setPage(1) }} />
      <FilterDate mui tall label={t("Период передачи со склада")} begin={acceptedFilter.begin} end={acceptedFilter.end} onChange={(begin, end) => { setAcceptedFilter({ begin, end }); paging.setPage(1) }} />
      <FilterDate mui label={t("Дата создания")} begin={createdFilter.begin} end={createdFilter.end} onChange={(begin, end) => { setCreatedFilter({ begin, end }); paging.setPage(1) }} />
      <FilterCheck compact label={t("Исключить отмененные поставки")} checked={excludeCancelled} onChange={(value) => { setExcludeCancelled(value); paging.setPage(1) }} className="mt-[10px] w-[235.5px]" />
      <FilterCheck compact label="Исключить инвентаризации" checked={excludeInventory} onChange={(value) => { setExcludeInventory(value); paging.setPage(1) }} className="mt-[10px]" />
    </RefFilterPanel>
  )

  const heads = [<span key="n" className="-ml-2 block">{t("№")}</span>, t("Поставщик"), t("Склад"), t("Дата поставки"), t("Тип оплаты"), t("Номер договора"), t("Сумма поставки"), t("Статус"), t("Счет фактура")]

  const content = (
    <>
      {!embedded && (
        <RefHeader title={t("Приход от поставщиков")}>
          <RefButton green icon={RI.add} label={t("Добавить")} onClick={openCreate} />
        </RefHeader>
      )}
      <RefCard>
        <RefToolbar
          linkFilter="flush"
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={filterPanel}
          query={query}
          onQuery={(value) => {
            setQuery(value)
            paging.setPage(1)
          }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={filtered.length ? paging.start + 1 : 0}
          to={paging.end}
          total={filtered.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
          icons={<TipIconButton path={RI.download} label={t("Скачать Excel")} onClick={downloadList} />}
          extra={embedded ? <RefButton green icon={RI.add} label={t("Добавить")} onClick={openCreate} /> : undefined}
        />
        <RefTable
          cols="minmax(0,1fr) minmax(0,2fr) minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,2fr) minmax(0,1fr) minmax(0,1fr)"
          heads={heads}
          headPad={36}
          rows={visible}
          rowKey={(row) => row.id}
          onRowClick={toggleExpand}
          rowClass={(row) => (expandedId === row.id ? "hidden" : "")}
          empty={loading ? t("Загрузка...") : loadError || t("По вашему запросу ничего не найдено")}
          render={(row) => [
            row.id,
            row.supplier,
            row.warehouse,
            formatDay(row.date, language),
            t(row.paymentType),
            row.contractNumber,
            formatMoney(row.amount, row.currency),
            <span key="status">
              <i className={`mr-[6px] inline-block h-[7px] w-[7px] rounded-full ${statusDots[row.status]}`} /> {t(row.status)}
            </span>,
            row.invoiceNumber,
          ]}
          expanded={(row) =>
            expandedId === row.id ? (
              <div className="-mx-[15px] mb-[14px] mt-[20px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                      <div className="px-[30px] pb-[20px] text-[13px]">
                        <div className="-mx-[30px] flex h-[65px] items-center justify-between border-b border-[#e0e0e0] pl-[30px] pr-[43px]">
                          <h2 className="text-[18px] font-normal leading-[24px] text-[#333]">{t("Поставка №")} {row.id}</h2>
                          <div className="flex items-center gap-[10px]">
                            {row.status !== "отменен" && !/^инвент/i.test(row.supplier) && (
                              <SupplyAction onClick={() => setExpenseTarget(row)} icon="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z">
                                {t("Добавить расход")}
                              </SupplyAction>
                            )}
                            {row.status !== "отменен" && canReprice && (
                              <SupplyAction onClick={() => setMarkupTarget(row)} icon="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z">
                                <span data-no-translate>Наценка</span>
                              </SupplyAction>
                            )}
                            {row.status === "ожидает" && (
                              <SupplyAction onClick={() => openEdit(row)} icon="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z">
                                {t("Изменить")}
                              </SupplyAction>
                            )}
                            <SupplyAction onClick={() => downloadRow(row)} icon="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z">
                              {t("Скачать")}
                            </SupplyAction>
                            {row.status === "ожидает" && (
                              <SupplyAction disabled={busy} color="#71ce87" onClick={() => changeStatus(row, "accept")} icon="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z">
                                {t("Принять на склад")}
                              </SupplyAction>
                            )}
                            {row.status === "принят" && (
                              <SupplyAction width={173} disabled={busy} color="#fa8072" onClick={() => changeStatus(row, "unaccept")} icon="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z">
                                <span data-no-translate className="whitespace-nowrap">Отменит приёмку</span>
                              </SupplyAction>
                            )}
                            <RefTip text={t("Распечатать")} side="left" gap={24} className="ml-[10px]">
                              <button type="button" onClick={() => window.print()} aria-label={t("Распечатать")} title="" className="flex h-6 w-6 items-center justify-center">
                                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" /></svg>
                              </button>
                            </RefTip>
                            <button
                              type="button"
                              onClick={() => (row.status === "отменен" ? undefined : changeStatus(row, row.status === "ожидает" ? "cancel" : "unaccept"))}
                              aria-label={t("Отменить")}
                              className="ml-[13px] flex h-6 w-6 items-center justify-center"
                            >
                              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                            </button>
                          </div>
                        </div>

                        <div className="-mx-[30px] grid grid-cols-[496fr_481fr_497fr] border-b border-[#e0e0e0] text-[13px] leading-[25px] text-[#333]">
                          <dl className="border-r border-[#e0e0e0] pb-[20px] pl-[30px] pr-[16px] pt-[15px]">
                            <InfoRow label={`${t("Поставщик")}:`} value={row.supplier} />
                            <InfoRow label={t("Договор №") + ":"} value={row.contractNumber || t("Не указан")} />
                            <InfoRow label={`${t("Организация")}:`} value={row.organization || t("Не указано")} />
                            <InfoRow label={`${t("Филиал")}:`} value={row.branch || t("Не указано")} />
                            <InfoRow label={`${t("Телефон")}:`} value={row.phone} />
                            <InfoRow label="E-mail:" value={row.email} />
                            <InfoRow label={`${t("Инициатор")}:`} value={row.initiator} />
                          </dl>

                          <div className="border-r border-[#e0e0e0] pb-[20px] pl-[15px] pr-[16px] pt-[11px]">
                            <p className="uppercase leading-[25px]">{t("Баланс")}</p>
                            <dl className="mt-[5px]">
                              <InfoRow label={t("Стоимость поставки")} value={formatMoney(row.amount, row.currency)} />
                              <InfoRow label={t("Тип оплаты")} value={t(row.paymentType)} />
                              {/* "Оплачено" (Σ supplier payments linked to the supply) opens "Список оплат по поставке №N" when > 0; "Остаток" is red while > 0. */}
                              <InfoRow
                                label={`${t("Оплачено")}:`}
                                value={
                                  row.paid > 0 ? (
                                    <button type="button" onClick={() => setPaymentsTarget(row.id)} className="border-b border-dashed border-[#4f70e7] font-semibold text-[#4f70e7]">
                                      {formatMoney(row.paid, row.currency)}
                                    </button>
                                  ) : (
                                    formatMoney(row.paid, row.currency)
                                  )
                                }
                              />
                              <InfoRow label={`${t("Остаток")}:`} value={formatMoney(row.amount - row.paid, row.currency)} valueClass={row.amount - row.paid > 0 ? "text-[#e57373]" : "text-[#81c784]"} />
                            </dl>
                            <p className="mt-[6px] uppercase leading-[25px]">{t("Доп. расходы")}</p>
                            {detailExpenses.length ? (
                              <dl className="mt-[2px]">
                                {Object.entries(detailExpenses.reduce<Record<string, number>>((totals, expense) => ({ ...totals, [expense.currency]: (totals[expense.currency] ?? 0) + expense.amount }), {})).map(([currency, total]) => (
                                  <InfoRow key={currency} label={`${t("Итого")}:`} value={formatMoney(total, currency)} />
                                ))}
                              </dl>
                            ) : (
                              <p className="mt-[2px] leading-[25px]">{t("Нет дополнительных расходов")}</p>
                            )}
                          </div>

                          <div className="pb-[20px] pl-[16px] pr-[30px] pt-[11px]">
                            <p className="uppercase leading-[25px]">{t("Исполнение")}</p>
                            <dl className="mt-[5px]">
                              <InfoRow label={`${t("Склад")}:`} value={row.warehouse} />
                              <InfoRow label={`${t("Статус")}:`} value={row.status === "принят" ? t("Завершен") : row.status === "ожидает" ? t("Ожидает") : t("Отменен")} valueClass={row.status === "принят" ? "text-[#81c784]" : row.status === "ожидает" ? "text-[#f5a623]" : "text-[#e57373]"} />
                              <InfoRow label={`${t("Принимать на склад")}:`} value={row.status === "отменен" ? t("Нельзя") : t("Можно")} valueClass={row.status === "отменен" ? "text-[#999]" : "text-[#81c784]"} />
                              <InfoRow label={`${t("Время приемки")}:`} value={row.acceptedAt ? <span data-no-translate>{formatTimestamp(row.acceptedAt, language)}{row.acceptedBy ? ` (${row.acceptedBy})` : ""}</span> : t("Не начался")} />
                              <InfoRow label={`${t("Дата поставки")}:`} value={formatDay(row.date, language)} />
                              <InfoRow label={`${t("Комментарии")}:`} value={row.comment || t("Не указан")} />
                              <InfoRow label={`${t("Счет фактура")}:`} value={row.invoiceNumber || t("Не указан")} />
                            </dl>
                          </div>
                        </div>

                        <div className="-mx-[30px] flex px-[30px]">
                          {tabs.map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setDetailTab(tab.id)}
                              className={`h-[51px] flex-1 border-b text-center text-[13px] ${detailTab === tab.id ? "border-[#5d6474] text-black" : "border-transparent text-black"}`}
                            >
                              {t(tab.label)}
                            </button>
                          ))}
                        </div>

                        {detailTab === "items" && (
                          <div className="-mt-px text-[13px] text-[#333]">
                            <div className="grid min-h-[36px] grid-cols-[minmax(0,147fr)_minmax(0,231fr)_minmax(0,150fr)_minmax(0,86fr)_minmax(0,123fr)_minmax(0,73fr)_minmax(0,122fr)_minmax(0,139fr)_minmax(0,138fr)] items-center bg-[#f0f4f7]">
                              <div className="pl-[19px]">{t("№")}</div>
                              <SortHead>{t("Товар")}</SortHead>
                              <SortHead><span data-no-translate>Срок годности</span></SortHead>
                              <SortHead>{t("Количество")}</SortHead>
                              <SortHead>{t("Блок")}</SortHead>
                              <SortHead><span data-no-translate>Кг.</span></SortHead>
                              <SortHead><span data-no-translate>Вес нетто.</span></SortHead>
                              <SortHead>{t("Стоимость")}</SortHead>
                              <SortHead>{t("Итог")}</SortHead>
                            </div>
                            <div className="border-b border-l border-[#e0e0e0]">
                              {row.items.map((item) => (
                                <div key={item.id} className="grid min-h-[55px] grid-cols-[minmax(0,147fr)_minmax(0,231fr)_minmax(0,150fr)_minmax(0,86fr)_minmax(0,123fr)_minmax(0,73fr)_minmax(0,122fr)_minmax(0,139fr)_minmax(0,138fr)] items-center border-t border-[#e0e0e0] first:border-t-0 [&>*]:self-stretch [&>*]:border-r [&>*]:border-[#e0e0e0]">
                                  <div className="relative flex items-center pl-[19px]">
                                    <span>{item.id}</span>
                                    <svg viewBox="0 0 24 24" className="absolute left-[58px] top-1/2 h-5 w-5 -translate-y-1/2 fill-[#333]"><path d="M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm13-2h-2v3h-3v2h3v3h2v-3h3v-2h-3v-3z" /></svg>
                                    <span className="absolute right-[10px] top-1/2 -translate-y-1/2 text-[10px] text-[#4f71dc]">0 / 0</span>
                                  </div>
                                  <div className="flex flex-col justify-center pl-[18px] pr-[8px] leading-[19px]">
                                    <span>{item.product}</span>
                                    {productInfo[item.product]?.barcode && productInfo[item.product].barcode !== "не установлен" && <span className="text-[#4f71dc]">{productInfo[item.product].barcode}</span>}
                                  </div>
                                  <div className="flex items-center pl-[18px]">{item.expiry}</div>
                                  <div className="flex items-center px-[18px] py-[8px]">{item.qty.toLocaleString("ru-RU")} {productUnits[item.product] ? t(productUnits[item.product]) : ""}</div>
                                  <div className="flex items-center px-[18px] py-[8px] leading-[19px]">{blockLabel(item.qty, productBoxes[item.product], productUnits[item.product] ? t(productUnits[item.product]) : "")}</div>
                                  <div className="flex items-center pl-[18px]">{lineKg(item).toLocaleString("ru-RU")}</div>
                                  <div className="flex items-center pl-[18px]">{item.netWeight}</div>
                                  <div className="flex items-center justify-end pr-[18px]">{formatMoney(item.cost, row.currency)}</div>
                                  <div className="flex items-center justify-end pr-[18px]">{formatMoney(item.total, row.currency)}</div>
                                </div>
                              ))}
                              <div className="grid min-h-[62px] grid-cols-[minmax(0,147fr)_minmax(0,231fr)_minmax(0,150fr)_minmax(0,86fr)_minmax(0,123fr)_minmax(0,73fr)_minmax(0,122fr)_minmax(0,139fr)_minmax(0,138fr)] items-center border-t border-[#e0e0e0] text-[16px] font-bold [&>*]:self-stretch [&>*]:border-r [&>*]:border-[#e0e0e0]">
                                <div className="col-span-3 flex items-center pl-[19px]">{t("Итого")}:</div>
                                <div className="flex items-center px-[18px] py-[6px] leading-[24px]">{formatUnitTotals(row.items.map((item) => ({ qty: item.qty, unit: productUnits[item.product] ?? "" })), t)}</div>
                                <div className="flex items-center pl-[17px]" />
                                <div className="flex items-center pl-[18px]">{(Math.round(row.items.reduce((sum, item) => sum + lineKg(item), 0) * 1000) / 1000).toLocaleString("ru-RU")}</div>
                                <div className="flex items-center pl-[18px]">{row.items.reduce((sum, item) => sum + item.netWeight, 0)}</div>
                                <div className="flex items-center justify-end pr-[18px]">{formatMoney(row.items.reduce((sum, item) => sum + item.cost, 0), row.currency)}</div>
                                <div className="flex items-center justify-end pr-[18px]">{formatMoney(row.items.reduce((sum, item) => sum + item.total, 0), row.currency)}</div>
                              </div>
                            </div>
                          </div>
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
                                  <td className="py-2 pr-4">{line.qty.toLocaleString("ru-RU")} {productUnits[line.product] ? t(productUnits[line.product]) : ""}</td>
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
                                    <td className="py-2 pr-4">{formatDay(expense.date, language)}</td>
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
                                <span className="text-slate-400">{formatTimestamp(log.createdAt, language)}</span>
                                <span className="font-medium text-slate-700">{t(LOG_LABELS[log.action] ?? log.action)}</span>
                                {log.details && <span>— {logDetails(log)}</span>}
                                <span className="text-slate-400">({log.userName})</span>
                              </li>
                            ))}
                            {!detailLogs.length && <li className="text-slate-400">{t("Записей нет")}</li>}
                          </ul>
                        )}
                      </div>
              </div>
            ) : null
          }
        />
      </RefCard>

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

      {expenseDelete && (
        <ConfirmDialog title={expenseDelete.expense.description || t("Расход")} busy={busy} error={actionError} onConfirm={() => void confirmRemoveExpense()} onClose={() => setExpenseDelete(null)} />
      )}
      {statusAsk?.action === "accept" && (
        <MaterialDialog title={`${t("Приемка товара")} (${t("поставка")} №${statusAsk.row.id})`} onClose={() => setStatusAsk(null)} zIndex={300}>
          <MaterialBody minHeight={110} className="pt-[39px]">
            <MaterialDate label={t("Дата")} value={acceptDate} max={todayIso()} onChange={(value) => { setAcceptDate(value); setActionError("") }} display={formatDay(acceptDate, language)} />
            {actionError && <p className="mt-[12px] text-[13px] text-[#e57373]">{actionError}</p>}
          </MaterialBody>
          <MaterialFooter type="button" label={t("Принять товар")} busy={busy} disabled={!acceptDate} onClick={() => void confirmStatus()} />
        </MaterialDialog>
      )}
      {statusAsk?.action === "cancel" && (
        <ConfirmDialog title={t("Подтверждение отмены")} kind="cancel" item={`${t("Поставка")}№ ${statusAsk.row.id}`} confirmLabel="Да" busy={busy} error={actionError} onConfirm={() => void confirmStatus()} onClose={() => setStatusAsk(null)} />
      )}
      {statusAsk?.action === "unaccept" && (
        <ConfirmDialog title={t("Подтверждение отмены")} kind="cancel" warning={t("Склад уже принял данную поставку. Отмена приведет к списанию товаров из склада. ОТМЕНА НЕ РЕКОМЕНДУЕТСЯ!")} confirmLabel="Да" busy={busy} error={actionError} onConfirm={() => void confirmStatus()} onClose={() => setStatusAsk(null)} />
      )}

      {modalOpen && (
        <SupplierIncomingForm
          title={editingId !== null ? `${t("Изменить поставку №")} ${editingId}` : t("Добавление поставки")}
          banner={
            fromInvoice && editingId === null ? (
              <div className="space-y-1 border-b border-sky-200 bg-sky-50 px-[30px] py-3 text-sm text-sky-800">
                <p>
                  {t("Приход создается из счет-фактуры")} № <b>{fromInvoice.number}</b> {t("от")} {formatDay(draft.invoiceDate, language)} — {formatMoney(fromInvoice.total, fromInvoice.currency)}
                </p>
                {!supplierOptions.includes(draft.supplier) && <p className="text-amber-700">{t("Поставщик не найден в справочнике — выберите поставщика или добавьте его.")}</p>}
                {draftItems.some((item) => !item.product) && <p className="text-amber-700">{t("Строки без товара в каталоге выделены — выберите товар или удалите строку.")}</p>}
              </div>
            ) : null
          }
          draft={draft}
          setDraft={(update) =>
            setDraft((current) => {
              const next = update(current)
              // A warehouse of another branch is no longer offered: pick again.
              if (next.branch !== current.branch && next.warehouse && next.warehouse === current.warehouse) {
                const known = warehouseRows.find((item) => item.name === next.warehouse)
                if (next.branch && known?.branch && !sameName(known.branch, next.branch)) return { ...next, warehouse: "" }
              }
              return next
            })
          }
          supplierOptions={supplierOptions}
          branchOptions={branchOptions}
          warehouseOptions={draftWarehouseOptions}
          organizationOptions={organizationOptions}
          currencyOptions={currencyChoices(currencies.codes, currencies.base, draft.currency)}
          paymentTypeOptions={paymentTypes.map((item) => ({ value: item, label: t(item) }))}
          items={draftItems}
          productOptions={productOptions}
          totalCost={formatMoney(draftTotalCost, draft.currency || currencies.base)}
          currency={draft.currency || currencies.base}
          productUnits={productUnits}
          productBoxes={productBoxes}
          productInfo={productInfo}
          productExpiry={productExpiry}
          onClose={() => setModalOpen(false)}
          onSubmit={save}
          onQuickAddSupplier={() => setQuickAddSupplierOpen(true)}
          onQuickAddOrganization={() => setQuickAddOrganizationOpen(true)}
          onAddItem={(item) => setDraftItems((current) => [...current, { id: Math.max(0, ...current.map((entry) => entry.id)) + 1, ...item }])}
          onUpdateItem={updateDraftItem}
          onRemoveItem={removeDraftItem}
          onOpenPicker={() => { setPickerQuery(""); setPickerOpen(true) }}
          onImportClick={() => importInputRef.current?.click()}
          onImportTemplate={downloadImportTemplate}
          onImportConfirm={confirmImport}
          importStaged={importStaged.length}
          importInput={<input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importFromExcel} className="hidden" />}
        />
      )}

      {pickerOpen && (
        <SupplierProductPicker
          currency={draft.currency || currencies.base}
          stock={productInfo}
          initial={draftItems.map((item) => ({ product: item.product, qty: item.qty, cost: item.cost }))}
          onClose={() => setPickerOpen(false)}
          onSave={(picked) =>
            setDraftItems((current) => {
              const names = new Set(picked.map((item) => item.product))
              const kept = current.filter((item) => !names.has(item.product))
              let nextId = Math.max(0, ...current.map((item) => item.id)) + 1
              return [...kept, ...picked.map((item) => ({ id: nextId++, product: item.product, qty: item.qty, cost: item.cost }))]
            })
          }
        />
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
            setWarehouseRows((current) => (current.some((item) => item.name === created.name) ? current : [{ name: created.name, branch: created.branch ?? "", active: created.active !== false }, ...current]))
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
    </>
  )

  return embedded ? <main className="min-w-0 flex-1">{content}</main> : <RefPage>{content}</RefPage>
}
