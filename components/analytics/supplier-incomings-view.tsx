"use client"

import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { RI, RefAppliedFilter, RefButton, RefCard, RefHeader, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit"
import type { LinkoOption } from "@/components/ref/linko-select-fields"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { formatSupplyAmount } from "@/lib/amount-precision"
import { formatStatementDate, parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { unitWeightKg } from "@/lib/internal-transfers-types"
import type { InvoiceSupplyDraft } from "@/lib/invoice-incomings-types"
import { RefTip } from "@/components/ref/ref-tip"
import { SortArrows } from "@/components/ref/sort-arrows"
import { formatUnitTotals } from "./internal-transfers-picker"
import { CashSnackbar, ConfirmDialog, useCanManage, type SnackbarMessage } from "./cash-management-shared"
import { MaterialBody, MaterialDate, MaterialDialog, MaterialFooter } from "./cash-material"
import { OrganizationFormModal } from "./organization-form-modal"
import { SupplierFormModal } from "./supplier-form-modal"
import {
  incomingPaymentTypes as paymentTypes,
  type Incoming,
  type IncomingExpense,
  type IncomingLog,
  type IncomingStatus as Status,
} from "./supplier-incomings-data"
import { currencyChoices, IncomingExpenseDialog, IncomingRepriceDialog, useCurrencyCodes } from "./supplier-incoming-dialogs"
import {
  SupplyDownloadMenu,
  SupplyEditMenu,
  SupplyInvoiceDialog,
  SupplyLogCards,
  SupplyLogPopover,
  SupplyMarksCell,
  SupplyMarksPanel,
  SupplyPrintButton,
  downloadSupplyPrices,
  downloadSupplyProducts,
} from "./supplier-incoming-card-actions"
import { SupplyCostTab, SupplyExpenseSummary, SupplyExpensesTab } from "./supplier-incoming-card-tabs"
import { SupplierIncomingForm, isoToRuDate, ruDateToIso } from "./supplier-incoming-form"
import {
  SupplierIncomingsFilterPanel,
  incomingMatchesFilter,
  incomingMatchesSearch,
  incomingsFilterCount,
  incomingsFilterPatch,
  linkoOrder,
  readIncomingsFilter,
  type IncomingsFilter,
  type IncomingsFilterOptions,
  type IncomingsLookups,
} from "./supplier-incomings-filter"
import { SupplierProductPicker } from "./supplier-product-picker"
import { SupplyPaymentsDialog } from "./supplier-payments-supply-dialog"
import { WarehouseFormModal } from "./warehouse-form-modal"
import { notify } from "@/lib/notify"

const ITEM_IMPORT_HEADER_ALIASES: Record<string, string> = {
  "товар": "product", "наименование": "product", "название": "product", "product": "product", "name": "product",
  "количество": "qty", "кол во": "qty", "qty": "qty", "quantity": "qty",
  "цена": "cost", "стоимость": "cost", "сумма": "cost", "сумма за единицу": "cost", "цена за единицу": "cost", "cost": "cost", "price": "cost", "unit price": "cost",
}

/** Money with 2 decimals (lib/finance/currency.ts) and the document's currency code. */
function formatMoney(value: number, currency = "") {
  // Linko's supplyNumberFormat: the supply decimals of Настройки → Округление сумм, else two.
  return `${formatSupplyAmount(value, 2)} ${currency}`.trim()
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
  отменен: "bg-[#e57373]",
}

/** `source` = the e-invoice line the item was prefilled from ("Создать приход"). */
type DraftItem = { id: number; product: string; qty: number; cost: number; expiry?: string; series?: string; source?: { name: string; ikpu: string; unit: string } }
type Tab = "items" | "cost" | "expenses" | "logs"

/** The card tabs' URL values (Linko's ?tab=). */
const TAB_PARAM: Record<Tab, string> = { items: "productList", cost: "costPriceProductList", expenses: "expenses", logs: "logs" }

const NO_LOOKUPS: IncomingsLookups = { branches: new Map(), suppliers: new Map(), warehouses: new Map(), organizations: new Map(), products: new Map(), warehouseIds: new Map() }
/** Linko's page sizes of the list. */
const PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000]

/** Sets or removes list parameters of the address, keys in order as Linko's query-string writes them; typing in the
 * search box replaces the entry, everything else is a history entry. */
function setListParams(patch: Record<string, string | null>, replace = false) {
  const url = new URL(window.location.href)
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) url.searchParams.delete(name)
    else url.searchParams.set(name, value)
  }
  url.searchParams.sort()
  const next = `${url.pathname}${url.search}`
  if (next === `${window.location.pathname}${window.location.search}`) return
  if (replace) window.history.replaceState(null, "", next)
  else window.history.pushState(null, "", next)
}

/** Sets (or drops) a query parameter of the address, like Linko's hash history (?openUpdateDialog=true …). */
function setUrlParam(name: string, value: string | null, push = false) {
  const url = new URL(window.location.href)
  if (value === null) url.searchParams.delete(name)
  else url.searchParams.set(name, value)
  const next = `${url.pathname}${url.search}`
  if (push) window.history.pushState(null, "", next)
  else window.history.replaceState(null, "", next)
}

/** «Счет фактура» of the list: «№12345678 от 10 дек. 2025». */
function invoiceLabel(row: Incoming, language: string) {
  if (!row.invoiceNumber) return ""
  // Plain spaces: Linko's cell wraps inside the date («№12345678 от 15 / дек. 2025»).
  return row.invoiceDate ? `№${row.invoiceNumber} от ${formatDay(row.invoiceDate, language).replace(/[\u00a0\u202f]/g, " ")}` : `№${row.invoiceNumber}`
}

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

function SupplyAction({ children, icon, onClick, color = "#1E4A9A", disabled, width }: { children: ReactNode; icon: string; onClick: () => void; color?: string; disabled?: boolean; width?: number }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} style={{ backgroundColor: color, width }} className="inline-flex h-[30px] min-w-[88px] items-center justify-center gap-[8px] rounded-[5px] pl-[12px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:hover:brightness-100">
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

/** A header cell of «Список товаров»: Linko's two grey triangles after the name. */
function SortHead({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center pl-[18px]">
      {children}
      <SortArrows color="#888" className="ml-[4px]" />
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


export function SupplierIncomingsView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const [rows, setRows] = useState<Incoming[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
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
  /** «Изменить детали» needs the right to change supplies (Linko's change_supply). */
  const canEdit = useCanManage(["procurement.manage"])
  /** The card whose «Добавить лог» box is open. */
  const [logPopover, setLogPopover] = useState<number | null>(null)
  /** The line whose marking codes are unfolded ("<supply>:<line>"). */
  const [marksOpen, setMarksOpen] = useState<string | null>(null)
  const [snackbar, setSnackbar] = useState<SnackbarMessage | null>(null)
  const closeSnackbar = useCallback(() => setSnackbar(null), [])
  /** Closes the supply form; closing «Изменение поставки» writes openUpdateDialog=false, like Linko's X. */
  const closeForm = useCallback(() => {
    setModalOpen(false)
    if (embedded) return
    if (editingId !== null) setUrlParam("openUpdateDialog", "false")
    else if (new URLSearchParams(window.location.search).get("openCreateDialog") === "true") setUrlParam("openCreateDialog", "false")
  }, [editingId, embedded])
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [supplierOptions, setSupplierOptions] = useState<string[]>([])
  const [warehouseRows, setWarehouseRows] = useState<WarehouseOption[]>([])
  const [organizationOptions, setOrganizationOptions] = useState<string[]>([])
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  /** The list filter's choices (ids as Linko writes them in the address) and the names behind its ids. */
  const [filterOptions, setFilterOptions] = useState<IncomingsFilterOptions | null>(null)
  const [lookups, setLookups] = useState<IncomingsLookups>(NO_LOOKUPS)
  const [productOptions, setProductOptions] = useState<string[]>([])
  const [productUnits, setProductUnits] = useState<Record<string, string>>({})
  const [productExpiry, setProductExpiry] = useState<Record<string, boolean>>({})
  /** Products that keep series (Linko's useSeries) and their code (Linko's product.code, shown under the name). */
  const [productSeries, setProductSeries] = useState<Record<string, boolean>>({})
  const [productCodes, setProductCodes] = useState<Record<string, string>>({})
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
      type Named = { id: number; name: string }
      const read = async <T,>(response: Response | null) => (response?.ok ? ((await response.json().catch(() => [])) as T[]) : [])
      const suppliers = await read<Named>(suppliersRes)
      const warehouses = await read<Named & { branch?: string; active?: boolean }>(warehousesRes)
      const organizations = await read<Named>(organizationsRes)
      const branches = await read<Named>(branchesRes)
      if (suppliersRes?.ok) setSupplierOptions(Array.from(new Set(suppliers.map((item) => item.name))))
      if (warehousesRes?.ok) setWarehouseRows(warehouses.map((item) => ({ name: item.name, branch: item.branch ?? "", active: item.active !== false })))
      if (organizationsRes?.ok) setOrganizationOptions(Array.from(new Set(organizations.map((item) => item.name))))
      if (branchesRes?.ok) setBranchOptions(Array.from(new Set(branches.map((item) => item.name))))
      // The list filter's choices as Linko lists them: suppliers and products newest first, the rest by name.
      const byName = (list: Named[]): LinkoOption[] => [...list].sort((a, b) => linkoOrder(a.name, b.name)).map((item) => ({ value: String(item.id), label: item.name }))
      const newest = (list: Named[]): LinkoOption[] => [...list].sort((a, b) => b.id - a.id).map((item) => ({ value: String(item.id), label: item.name }))
      const names = (list: Named[]) => new Map(list.map((item) => [String(item.id), item.name]))
      const warehouseIds = new Map<string, string[]>()
      for (const item of warehouses) warehouseIds.set(item.name, [...(warehouseIds.get(item.name) ?? []), String(item.id)])
      const filterProducts = productsRes?.ok ? ((await productsRes.clone().json().catch(() => [])) as Array<Named & { deleted?: boolean }>).filter((item) => !item.deleted) : []
      setLookups({ branches: names(branches), suppliers: names(suppliers), warehouses: names(warehouses), organizations: names(organizations), products: names(filterProducts), warehouseIds })
      setFilterOptions({ branches: byName(branches), suppliers: newest(suppliers), warehouses: byName(warehouses), products: newest(filterProducts), organizations: byName(organizations) })
      // Raw materials are received from suppliers too (production stock).
      const catalog: { name: string; unit: string; mass: number; boxUnit?: string; boxAmount?: number; trackExpiry?: boolean; trackSeries?: boolean; code?: string }[] = []
      const massOf = (value: unknown) => Number(String(value ?? "").replace(",", ".")) || 0
      // Soft-deleted products ("Удалённые") are not offered.
      if (productsRes?.ok) {
        const data = (await productsRes.json()) as { name: string; unit: string; weight?: unknown; boxUnit?: string; boxAmount?: number; trackExpiry?: boolean; trackSeries?: boolean; integrationCode?: string; deleted?: boolean }[]
        catalog.push(
          ...data
            .filter((item) => !item.deleted)
            .map((item) => ({ name: item.name, unit: item.unit, mass: massOf(item.weight), boxUnit: item.boxUnit, boxAmount: item.boxAmount, trackExpiry: item.trackExpiry, trackSeries: item.trackSeries, code: item.integrationCode })),
        )
      }
      if (rawMaterialsRes?.ok) {
        const data = (await rawMaterialsRes.json()) as { name: string; unit: string; mass?: unknown }[]
        catalog.push(...data.map((item) => ({ name: item.name, unit: item.unit, mass: massOf(item.mass) })))
      }
      setProductOptions(Array.from(new Set(catalog.map((item) => item.name))).sort((a, b) => a.localeCompare(b, "ru")))
      setProductUnits(Object.fromEntries(catalog.map((item) => [item.name, item.unit])))
      setProductUnitKg(Object.fromEntries(catalog.map((item) => [item.name, unitWeightKg(item.unit, item.mass)])))
      setProductExpiry(Object.fromEntries(catalog.map((item) => [item.name, Boolean(item.trackExpiry)])))
      setProductSeries(Object.fromEntries(catalog.map((item) => [item.name, Boolean(item.trackSeries)])))
      setProductCodes(Object.fromEntries(catalog.filter((item) => item.code?.trim()).map((item) => [item.name, String(item.code).trim()])))
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

  /** Warehouses a supply may go to: every active one, whatever its branch (Linko's «Склад назначения» lists every
   * stock; the server refuses an inactive one). */
  const draftWarehouseOptions = useMemo(() => Array.from(new Set(warehouseRows.filter((item) => item.active).map((item) => item.name))), [warehouseRows])

  // "Создать приход" of an accepted incoming e-invoice: the create dialog prefilled with
  // its supplier, organization, currency, contract / invoice number and date and the lines
  // (matched to our products / raw materials; unmatched lines stay empty to pick a product).
  const invoiceParam = searchParams.get("openCreateDialog") === "true" ? searchParams.get("invoiceId") : null
  // ?openCreateDialog=true (no invoice) opens the empty create dialog, like the reference.
  const plainCreate = searchParams.get("openCreateDialog") === "true" && !searchParams.get("invoiceId")
  // «Добавление поставки» lives in the address like Linko's: «Добавить» writes openCreateDialog=true, closing writes
  // false; Back (or a link without it) closes the empty form.
  useEffect(() => {
    if (!plainCreate) {
      if (invoiceHandled.current === "plain") {
        invoiceHandled.current = null
        setModalOpen(false)
      }
      return
    }
    if (!optionsLoaded || invoiceHandled.current === "plain") return
    invoiceHandled.current = "plain"
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

  // The list's state lives in the address like Linko's #/supply: page, pageSize, search, the filter
  // (supplier-incomings-filter.tsx) and openFilterDialog; Linko's links add &supply=<id> (that supply only).
  const supplyParam = Number(searchParams.get("supply")) || null
  const listFilter = useMemo(() => readIncomingsFilter(new URLSearchParams(searchParams.toString())), [searchParams])
  const appliedCount = useMemo(() => incomingsFilterCount(new URLSearchParams(searchParams.toString())), [searchParams])
  const filterOpen = !embedded && searchParams.get("openFilterDialog") === "true"
  const searchParam = searchParams.get("search") ?? ""
  const [query, setQuery] = useState(searchParam)
  /** The search text this page last wrote: a link or Back that brings another one replaces the box's text. */
  const writtenSearch = useRef(searchParam)
  useEffect(() => {
    if (searchParam === writtenSearch.current) return
    writtenSearch.current = searchParam
    setQuery(searchParam)
  }, [searchParam])
  const acceptedDay = useCallback((row: Incoming) => (row.acceptedAt ? (parseAnyDay(row.acceptedAt) ?? "") : ""), [])
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (supplyParam === null || row.id === supplyParam) &&
          incomingMatchesFilter(row, listFilter, lookups, acceptedDay) &&
          incomingMatchesSearch(row, query, lookups),
      ),
    [rows, supplyParam, listFilter, lookups, acceptedDay, query],
  )

  const sizeParam = Number(searchParams.get("pageSize"))
  const listPageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : 25
  const pageCount = Math.max(1, Math.ceil(filtered.length / listPageSize))
  const listPage = Math.min(Math.max(1, Math.floor(Number(searchParams.get("page"))) || 1), pageCount)
  const pageStart = (listPage - 1) * listPageSize
  const paging = {
    page: listPage,
    pageSize: listPageSize,
    pageCount,
    start: pageStart,
    end: Math.min(pageStart + listPageSize, filtered.length),
    setPage: (page: number) => {
      if (!embedded) setListParams({ page: String(page) })
    },
    setPageSize: (size: number) => {
      if (!embedded) setListParams({ pageSize: String(size), page: "1" })
    },
  }
  function applyFilter(filter: IncomingsFilter) {
    if (!embedded) setListParams(incomingsFilterPatch(filter))
  }
  /** Linko's ⊗ goes to the bare #/supply: no filter, search, page or page size. */
  function clearFilter() {
    if (!embedded) setListParams(Object.fromEntries([...new URLSearchParams(window.location.search).keys()].map((key) => [key, null])))
  }
  function onSearch(value: string) {
    setQuery(value)
    writtenSearch.current = value
    // The search starts again from the first page (Linko keeps the page and shows an empty one).
    if (!embedded) setListParams({ search: value || null, page: listPage > 1 ? "1" : searchParams.get("page") }, true)
  }
  // The card of /analytics/supplier-incomings/<id> (a link from another page) is always shown: the list moves to the
  // page that holds the supply, and a supply the filters leave out (a cancelled one, …) is shown on top of the page.
  const pinned = useMemo(
    () => (expandedId === null || filtered.some((row) => row.id === expandedId) ? null : (rows.find((row) => row.id === expandedId) ?? null)),
    [expandedId, filtered, rows],
  )
  const jumpedTo = useRef<number | null>(null)
  const { pageSize, page: currentPage, setPage } = paging
  useEffect(() => {
    if (expandedId === null) {
      jumpedTo.current = null
      return
    }
    if (jumpedTo.current === expandedId) return
    const index = filtered.findIndex((row) => row.id === expandedId)
    if (index < 0) return
    jumpedTo.current = expandedId
    const page = Math.floor(index / pageSize) + 1
    if (page !== currentPage) setPage(page)
  }, [expandedId, filtered, pageSize, currentPage, setPage])
  const visible = pinned ? [pinned, ...filtered.slice(paging.start, paging.end)] : filtered.slice(paging.start, paging.end)

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
      else closeForm()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [modalOpen, pickerOpen, quickAddSupplierOpen, quickAddWarehouseOpen, quickAddOrganizationOpen, closeForm])

  function toggleExpand(row: Incoming) {
    const next = expandedId === row.id ? null : row.id
    setExpandedId(next)
    setDetailTab("items")
    setLogPopover(null)
    if (embedded) return
    // Linko's row link keeps the list's query (#/supply/350?page=1&pageSize=25&provider=79); the card's own
    // parameters stay with the card.
    const params = new URLSearchParams(window.location.search)
    for (const name of ["tab", "openUpdateDialog", "openInvoiceDialog"]) params.delete(name)
    const search = params.toString()
    window.history.pushState(null, "", `${next === null ? "/analytics/supplier-incomings" : `/analytics/supplier-incomings/${next}`}${search ? `?${search}` : ""}`)
  }

  // /analytics/supplier-incomings/<id> opens the supply card (back / forward and direct links included).
  useEffect(() => {
    if (embedded) return
    const match = pathname.match(/\/supplier-incomings\/(\d+)/)
    setExpandedId(match ? Number(match[1]) : null)
  }, [pathname, embedded])

  // The card's state in the address, like Linko: ?tab=… (the open tab), ?openUpdateDialog=true (the «Изменение
  // поставки» form) and ?openInvoiceDialog=true (the invoice dialog); a direct link opens them, closing writes false.
  const tabParam = searchParams.get("tab")
  useEffect(() => {
    const found = (Object.keys(TAB_PARAM) as Tab[]).find((key) => TAB_PARAM[key] === tabParam)
    if (found) setDetailTab(found)
  }, [tabParam])
  function chooseTab(tab: Tab) {
    setDetailTab(tab)
    if (!embedded) setUrlParam("tab", TAB_PARAM[tab], true)
  }
  const invoiceRow = searchParams.get("openInvoiceDialog") === "true" && expandedId !== null ? rows.find((item) => item.id === expandedId) : undefined

  function openCreate() {
    if (!embedded) {
      setListParams({ openCreateDialog: "true" })
      return
    }
    setDraft(emptyDraft(currencies.base))
    setDraftItems([])
    setEditingId(null)
    setFromInvoice(null)
    setModalOpen(true)
  }

  /** «Изменение поставки»: the supply's values; the invoice number and day stay empty (Linko does not load them: they
   * change through «Изменить детали счет фактуры»). */
  function openEdit(row: Incoming) {
    setDraft({
      supplier: row.supplier,
      branch: row.branch,
      warehouse: row.warehouse,
      organization: row.organization,
      currency: row.currency || currencies.base,
      paymentType: row.paymentType,
      date: isoToRuDate(isoDay(row.date) || todayIso()),
      expectedFactoryExit: isoToRuDate(isoDay(row.expectedFactoryExit)),
      expectedCustomsArrival: isoToRuDate(isoDay(row.expectedCustomsArrival)),
      contractNumber: row.contractNumber,
      invoiceNumber: "",
      invoiceDate: "",
      comment: row.comment,
    })
    setDraftItems(row.items.map((item) => ({ id: item.id, product: item.product, qty: item.qty, cost: item.cost, expiry: item.expiry || "", series: item.series || "" })))
    setEditingId(row.id)
    setFromInvoice(null)
    setModalOpen(true)
  }

  const updateParam = searchParams.get("openUpdateDialog") === "true"
  const editHandled = useRef<number | null>(null)
  useEffect(() => {
    if (!updateParam) {
      editHandled.current = null
      // Back (or a link) without ?openUpdateDialog=true closes «Изменение поставки», like Linko.
      if (modalOpen && editingId !== null && !embedded) setModalOpen(false)
      return
    }
    const row = expandedId === null ? undefined : rows.find((item) => item.id === expandedId)
    if (!row || !optionsLoaded || editHandled.current === row.id) return
    editHandled.current = row.id
    // A cancelled supply and an inventory surplus have no «Изменить детали».
    if (row.status === "отменен" || row.isInventory) setUrlParam("openUpdateDialog", "false")
    else openEdit(row)
    // openEdit reads the current options; it runs once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateParam, expandedId, rows, optionsLoaded, modalOpen, editingId, embedded])
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
      expiry: item.expiry ? toIsoDay(item.expiry) || item.expiry : "",
      series: item.series ?? "",
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
          expectedFactoryExit: toIsoDay(draft.expectedFactoryExit),
          expectedCustomsArrival: toIsoDay(draft.expectedCustomsArrival),
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
      closeForm()
      setFromInvoice(null)
      if (isEdit) setSnackbar({ text: "Успешно сохранено", tone: "success" })
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  /** Linko's «Поставки.xlsx»: every row of the filtered list, the day as the list prints it, «Не указано» for no
   * contract, the invoice as «N от YYYY-MM-DD» and the currency; columns as wide as 1.5 × their longest text
   * (the last one left at Excel's default). */
  function downloadList() {
    const table: Array<Array<string | number>> = [
      [t("№"), t("Поставщик"), t("Склад"), t("Дата поставки"), t("Тип оплаты"), t("Номер договора"), t("Сумма поставки"), t("Статус"), t("Счет фактура"), t("Валюта")],
      ...filtered.map((row) => [
        row.id,
        row.supplier,
        row.warehouse,
        formatDay(row.date, language),
        t(row.paymentType),
        row.contractNumber || t("Не указано"),
        row.amount,
        t(row.status),
        row.invoiceNumber ? (row.invoiceDate ? `${row.invoiceNumber} ${t("от")} ${isoDay(row.invoiceDate)}` : row.invoiceNumber) : "",
        row.currency,
      ]),
    ]
    // Excel's width of N characters is N + 5/6 of the `wch` SheetJS writes.
    const widths = table[0].slice(0, -1).map((_, column) => Math.max(...table.map((line) => String(line[column] ?? "").length)) * 1.5 - 5 / 6)
    downloadExcelTable(t("Поставки"), table, { sheetName: t("Поставки"), widths })
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "items", label: "Список товаров" },
    { id: "cost", label: "Себестоимость" },
    { id: "expenses", label: "Доп. расходы" },
    { id: "logs", label: "Логи" },
  ]

  const filterPanel = filterOpen ? (
    <SupplierIncomingsFilterPanel
      key={searchParams.toString()}
      initial={listFilter}
      options={filterOptions}
      onApply={applyFilter}
      onClose={() => setListParams({ openFilterDialog: "false" })}
    />
  ) : null

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
          fluid
          thinChevron
          pageSizeMenu
          filterOpen={filterOpen}
          onToggleFilter={() => setListParams({ openFilterDialog: filterOpen ? "false" : "true" })}
          filterPanel={filterPanel}
          leftSlot={
            appliedCount > 0 && !filterOpen ? (
              // Linko's afterFilter bar: its column less 8 px, 30 px left of the card's edge.
              <RefAppliedFilter width="calc(100% - 8px)" shift={30} count={appliedCount} onEdit={() => setListParams({ openFilterDialog: "true" })} onClear={clearFilter} />
            ) : undefined
          }
          query={query}
          onQuery={onSearch}
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
            // Linko marks a supply with a comment by «(ком.)» under its number; the comment is its hint.
            row.comment.trim() ? (
              <span key="id" className="block leading-[16px]">
                {row.id}
                <RefTip side="right" raw text={row.comment} className="!flex">
                  <span>({t("ком.")})</span>
                </RefTip>
              </span>
            ) : (
              row.id
            ),
            row.supplier,
            row.warehouse,
            formatDay(row.date, language),
            t(row.paymentType),
            row.contractNumber,
            formatMoney(row.amount, row.currency),
            <span key="status">
              <i className={`mr-[6px] inline-block h-[7px] w-[7px] rounded-full ${statusDots[row.status]}`} /> {t(row.status)}
            </span>,
            row.invoiceNumber ? (
              // Right-aligned in its cell up to the row's padding, as Linko's (its last cell has no right padding).
              <span key="invoice" className="-mr-[8px] block text-right">
                <RefTip side="left" text={`${t("Номер счет фактуры")}: ${row.invoiceNumber}\n${t("Комментарий")}: ${row.invoiceComment}`}>
                  <span data-no-translate>{invoiceLabel(row, language)}</span>
                </RefTip>
              </span>
            ) : (
              ""
            ),
          ]}
          expanded={(row) =>
            expandedId === row.id ? (
              <div className="-mx-[15px] mb-[14px] mt-[20px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                      <div className="px-[30px] pb-[20px] text-[13px]">
                        <div className="relative -mx-[30px] flex h-[65px] items-center justify-between border-b border-[#e0e0e0] pl-[30px] pr-[43px]">
                          <h2 className="text-[18px] font-normal leading-[24px] text-[#333]">
                            {t("Поставка №")} {row.id}
                            {row.isInventory && <span className="ml-[95px] font-semibold text-[#81c784]">{t("Инвентаризация")}</span>}
                          </h2>
                          <div className="flex items-center gap-[10px]">
                            {!row.isInventory && (
                              <SupplyAction disabled={row.status === "отменен"} onClick={() => setExpenseTarget(row)} icon="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z">
                                {t("Добавить расход")}
                              </SupplyAction>
                            )}
                            {canReprice && (
                              <SupplyAction onClick={() => setMarkupTarget(row)} icon="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z">
                                <span>{t("Наценка")}</span>
                              </SupplyAction>
                            )}
                            <SupplyEditMenu
                              row={row}
                              canEdit={canEdit}
                              onEditDetails={() => setUrlParam("openUpdateDialog", "true", true)}
                              onEditInvoice={() => setUrlParam("openInvoiceDialog", "true", true)}
                              onAddLog={() => setLogPopover((current) => (current === row.id ? null : row.id))}
                            />
                            <SupplyDownloadMenu
                              onProducts={() => downloadSupplyProducts(row, productUnits, t)}
                              onPrices={() => void downloadSupplyPrices(row, t).then((ok) => ok || notify(t("Не удалось скачать файл")))}
                            />
                            {row.status === "ожидает" && (
                              <SupplyAction disabled={busy} color="#71ce87" onClick={() => changeStatus(row, "accept")} icon="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z">
                                {t("Принять на склад")}
                              </SupplyAction>
                            )}
                            {row.status === "принят" && (
                              <SupplyAction width={173} disabled={busy} color="#fa8072" onClick={() => changeStatus(row, "unaccept")} icon="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z">
                                <span className="whitespace-nowrap">{t("Отменит приёмку")}</span>
                              </SupplyAction>
                            )}
                            <SupplyPrintButton id={row.id} />
                            {!row.isInventory && (
                              <button
                                type="button"
                                disabled={row.status === "отменен"}
                                onClick={() => changeStatus(row, row.status === "ожидает" ? "cancel" : "unaccept")}
                                aria-label={t("Отменить")}
                                className="ml-[13px] flex h-6 w-6 items-center justify-center disabled:cursor-default"
                              >
                                <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: row.status === "отменен" ? "rgba(0,0,0,0.3)" : "#5d6474" }}><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                              </button>
                            )}
                          </div>
                          {logPopover === row.id && (
                            <SupplyLogPopover
                              row={row}
                              onClose={() => setLogPopover(null)}
                              onSaved={(saved) => {
                                setLogPopover(null)
                                replaceRow(saved)
                                setSnackbar({ text: "Успешно сохранено", tone: "success" })
                              }}
                            />
                          )}
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
                            <p className="font-semibold uppercase leading-[25px]">{t("Баланс")}</p>
                            <dl className="mt-[5px]">
                              <InfoRow label={t("Стоимость поставки")} value={formatMoney(row.amount, row.currency)} />
                              <InfoRow label={t("Тип оплаты")} value={t(row.paymentType)} />
                              {/* "Оплачено" (Σ supplier payments linked to the supply) opens "Список оплат по поставке №N" when > 0; "Остаток" is red while > 0. */}
                              <InfoRow
                                label={`${t("Оплачено")}:`}
                                value={
                                  row.paid > 0 ? (
                                    <button type="button" onClick={() => setPaymentsTarget(row.id)} className="border-b border-dashed border-[#1E4A9A] font-semibold text-[#1E4A9A]">
                                      {formatMoney(row.paid, row.currency)}
                                    </button>
                                  ) : (
                                    formatMoney(row.paid, row.currency)
                                  )
                                }
                              />
                              <InfoRow label={`${t("Остаток")}:`} value={formatMoney(row.amount - row.paid, row.currency)} valueClass={row.amount - row.paid > 0 ? "text-[#e57373]" : "text-[#81c784]"} />
                            </dl>
                            <p className="mt-[6px] font-semibold uppercase leading-[25px]">{t("Доп. расходы")}</p>
                            <SupplyExpenseSummary expenses={detailExpenses} />
                          </div>

                          <div className="pb-[20px] pl-[16px] pr-[30px] pt-[11px]">
                            <p className="font-semibold uppercase leading-[25px]">{t("Исполнение")}</p>
                            <dl className="mt-[5px]">
                              <InfoRow label={`${t("Склад")}:`} value={row.warehouse} />
                              <InfoRow label={`${t("Статус")}:`} value={row.status === "принят" ? t("Завершен") : row.status === "ожидает" ? t("Ожидает") : t("Отменен")} valueClass={row.status === "принят" ? "text-[#81c784]" : row.status === "ожидает" ? "text-[#f5a623]" : "text-[#e57373]"} />
                              {/* Linko: is_confirmed (a supply not confirmed yet is not planned for receiving), whatever the status. */}
                              <InfoRow label={t("Принимать на склад")} value={row.isConfirmed ? t("Можно") : t("Нельзя")} valueClass={row.isConfirmed ? "text-[#81c784]" : "text-[#e57373]"} />
                              <InfoRow label={`${t("Время приемки")}:`} value={row.acceptedAt ? <span data-no-translate>{formatTimestamp(row.acceptedAt, language)}</span> : t("Не начался")} />
                              <InfoRow label={`${t("Дата поставки")}:`} value={formatDay(row.date, language)} />
                              <InfoRow label={`${t("Комментарии")}:`} value={row.comment || t("Не указан")} />
                              <InfoRow label={`${t("Счет фактура")}:`} value={row.invoiceNumber ? <span data-no-translate>{row.invoiceNumber}</span> : t("Не указан")} />
                            </dl>
                          </div>
                        </div>

                        <div className="-mx-[30px] flex px-[30px]">
                          {tabs.map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => chooseTab(tab.id)}
                              className={`h-[51px] flex-1 border-b-2 text-center text-[13px] font-medium ${detailTab === tab.id ? "border-[#1E4A9A] text-black" : "border-transparent text-black"}`}
                            >
                              {t(tab.label)}
                            </button>
                          ))}
                        </div>

                        {detailTab === "items" && (() => {
                          // Linko adds the marking column only when a product of the supply needs marking codes.
                          const marks = row.items.some((item) => item.useMark)
                          const cols = marks
                            ? "grid-cols-[minmax(0,49fr)_minmax(0,140fr)_minmax(0,303fr)_minmax(0,150fr)_minmax(0,133fr)_minmax(0,159fr)_minmax(0,73fr)_minmax(0,122fr)_minmax(0,202fr)_minmax(0,183fr)]"
                            : "grid-cols-[minmax(0,52fr)_minmax(0,348fr)_minmax(0,150fr)_minmax(0,132fr)_minmax(0,187fr)_minmax(0,73fr)_minmax(0,122fr)_minmax(0,231fr)_minmax(0,219fr)]"
                          return (
                          <div className="-mt-px text-[13px] text-[#333]">
                            {/* Linko's table: a 600-weight header, rows as tall as their text (7.8 px padding, 20 px lines). */}
                            <div className={`grid min-h-[36px] ${cols} items-center bg-[#f0f4f9] font-semibold text-[#374557]`}>
                              <div className="pl-[19px]">{t("№")}</div>
                              {marks && <div />}
                              <SortHead>{t("Товар")}</SortHead>
                              <SortHead>{t("Срок годности")}</SortHead>
                              <SortHead>{t("Количество")}</SortHead>
                              <SortHead>{t("Блок")}</SortHead>
                              <SortHead>{t("Кг.")}</SortHead>
                              <SortHead>{t("Вес нетто.")}</SortHead>
                              <SortHead>{t("Стоимость")}</SortHead>
                              <SortHead>{t("Итог")}</SortHead>
                            </div>
                            <div className="border-b border-l border-[#e0e0e0]">
                              {row.items.map((item, index) => (
                                <div key={item.id} className={index ? "border-t border-[#e0e0e0]" : ""}>
                                <div className={`grid min-h-[36px] ${cols} items-center leading-[20px] [&>*]:self-stretch [&>*]:border-r [&>*]:border-[#e0e0e0] [&>*]:py-[7.8px]`}>
                                  <div className="flex items-center pl-[19px]">{index + 1}</div>
                                  {marks && (
                                    <div className="flex items-center">
                                      {item.useMark && <SupplyMarksCell stat={item.markStat} open={marksOpen === `${row.id}:${item.id}`} onToggle={() => setMarksOpen((current) => (current === `${row.id}:${item.id}` ? null : `${row.id}:${item.id}`))} />}
                                    </div>
                                  )}
                                  <div className="flex flex-col justify-center pl-[18px] pr-[8px]">
                                    <span>{item.product}</span>
                                    {productCodes[item.product] && <span data-no-translate className="text-[#1E4A9A]">{productCodes[item.product]}</span>}
                                  </div>
                                  <div className="flex items-center pl-[18px]">{item.expiry ? <span data-no-translate>{formatDay(item.expiry, language)}</span> : ""}</div>
                                  <div className="flex items-center px-[18px]">{item.qty.toLocaleString("ru-RU")} {productUnits[item.product] ? t(productUnits[item.product]) : ""}</div>
                                  <div className="flex items-center px-[18px]">{blockLabel(item.qty, productBoxes[item.product], productUnits[item.product] ? t(productUnits[item.product]) : "")}</div>
                                  <div className="flex items-center pl-[18px]">{lineKg(item).toLocaleString("ru-RU")}</div>
                                  <div className="flex items-center pl-[18px]">{item.netWeight}</div>
                                  <div className="flex items-center justify-end pr-[18px]">{formatMoney(item.cost, row.currency)}</div>
                                  <div className="flex items-center justify-end pr-[18px]">{formatMoney(item.total, row.currency)}</div>
                                </div>
                                {item.useMark && marksOpen === `${row.id}:${item.id}` && <SupplyMarksPanel />}
                                </div>
                              ))}
                              <div className={`grid min-h-[39px] ${cols} items-center border-t border-[#e0e0e0] text-[15px] font-semibold leading-[23.5px] [&>*]:self-stretch [&>*]:border-r [&>*]:border-[#e0e0e0] [&>*]:py-[7.8px]`}>
                                <div className={`${marks ? "col-span-4" : "col-span-3"} flex items-center pl-[19px]`}>{t("Итого")}:</div>
                                <div className="flex items-center px-[18px]">{formatUnitTotals(row.items.map((item) => ({ qty: item.qty, unit: productUnits[item.product] ?? "" })), t)}</div>
                                <div className="flex items-center pl-[17px]" />
                                <div className="flex items-center pl-[18px]">{(Math.round(row.items.reduce((sum, item) => sum + lineKg(item), 0) * 1000) / 1000).toLocaleString("ru-RU")}</div>
                                <div className="flex items-center pl-[18px]">{row.items.reduce((sum, item) => sum + item.netWeight, 0)}</div>
                                <div className="flex items-center justify-end pr-[18px]">{formatMoney(row.items.reduce((sum, item) => sum + item.cost, 0), row.currency)}</div>
                                <div className="flex items-center justify-end pr-[18px]">{formatMoney(row.items.reduce((sum, item) => sum + item.total, 0), row.currency)}</div>
                              </div>
                            </div>
                          </div>
                          )
                        })()}

                        {detailTab === "cost" && <SupplyCostTab row={row} baseCurrency={currencies.base} version={detailVersion} />}

                        {detailTab === "expenses" && <SupplyExpensesTab expenses={detailExpenses} busy={busy} onDelete={(expense) => removeExpense(row, expense)} />}

                        {detailTab === "logs" && <SupplyLogCards logs={detailLogs} details={logDetails} />}
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
            <MaterialDate label={t("Дата")} value={acceptDate} min={parseAnyDay(statusAsk.row.date) ?? undefined} max={todayIso()} onChange={(value) => { setAcceptDate(value); setActionError("") }} display={formatDay(acceptDate, language)} />
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
          title={editingId !== null ? t("Изменение поставки") : t("Добавление поставки")}
          update={editingId !== null}
          acceptedByStock={editingId !== null && rows.find((item) => item.id === editingId)?.status === "принят"}
          editOnlyPrice={editingId !== null && rows.find((item) => item.id === editingId)?.status === "принят"}
          productSeries={productSeries}
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
          setDraft={(update) => setDraft((current) => update(current))}
          supplierOptions={supplierOptions}
          branchOptions={branchOptions}
          warehouseOptions={draftWarehouseOptions}
          organizationOptions={organizationOptions}
          currencyOptions={currencyChoices(currencies.codes, currencies.base, draft.currency)}
          paymentTypeOptions={paymentTypes.map((item) => ({ value: item, label: t(item) }))}
          items={draftItems}
          productOptions={productOptions}
          currency={draft.currency || currencies.base}
          productUnits={productUnits}
          productBoxes={productBoxes}
          productInfo={productInfo}
          productExpiry={productExpiry}
          onClose={closeForm}
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
          organization={draft.organization}
          stock={productInfo}
          initial={draftItems.map((item) => ({ product: item.product, qty: item.qty, cost: item.cost }))}
          onClose={() => setPickerOpen(false)}
          onSave={(picked) =>
            setDraftItems((current) => {
              // A changed row becomes the product's one line (in place of its first line, keeping that line's id,
              // series and expiry); products the user did not touch keep their lines; new products are added.
              let nextId = Math.max(0, ...current.map((item) => item.id)) + 1
              const byName = new Map(picked.map((item) => [item.product, item]))
              const placed = new Set<string>()
              const next: DraftItem[] = []
              for (const item of current) {
                const pick = byName.get(item.product)
                if (!pick) next.push(item)
                else if (!placed.has(item.product)) {
                  placed.add(item.product)
                  next.push({ ...item, qty: pick.qty, cost: pick.cost })
                }
              }
              for (const pick of picked) if (!placed.has(pick.product)) next.push({ id: nextId++, product: pick.product, qty: pick.qty, cost: pick.cost })
              return next
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

      {invoiceRow && (
        <SupplyInvoiceDialog
          key={invoiceRow.id}
          row={invoiceRow}
          onClose={() => setUrlParam("openInvoiceDialog", "false")}
          onSaved={(saved) => {
            replaceRow(saved)
            setUrlParam("openInvoiceDialog", "false")
            setSnackbar({ text: "Успешно изменено", tone: "success" })
          }}
        />
      )}
      <CashSnackbar message={snackbar} onClose={closeSnackbar} />

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
