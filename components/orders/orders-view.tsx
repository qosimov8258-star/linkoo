"use client"

import { X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { RefAppliedFilter, RefNothingFound } from "@/components/ref/list-kit"

import { csvCell } from "@/lib/csv"
import { readExcelRows } from "@/lib/excel-import"
import { useCanManage } from "@/components/analytics/cash-management-shared"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { inAppCurrency, useAppCurrencyInfo } from "@/lib/app-currency-context"
import { useLanguage } from "@/lib/i18n/language-context"
import { AmountSum, roundAmount } from "@/lib/amount-precision"
import { compareBandCurrencies, formatMoney, normCurrency, roundMoney } from "@/lib/finance/currency"
import { parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import type { OrderFilterData } from "@/lib/order-filter-data"

import { AddOrderDialog } from "./add-order-dialog"
import { OrderDetailCard } from "./order-detail"
import { OrderDeliveryDialog, type DeliveryDates } from "./order-delivery-dialog"
import { OrderGroupPayment } from "./order-group-payment"
import { ORDER_ICON, OrderIcon, OrderStatusIcon } from "./order-status-icons"
import { EdoMenu, InvoiceNumberDialog, useUrlParams } from "./orders-extra-dialogs"
import { OrderSeriesAutoDialog, OrderSeriesEditLink, useOrderSeriesAutoRequest } from "./order-series"
import { BulkEditDialog, NoSelectionPopover, PAY_PERMISSIONS, RowCheckbox, SelectedTotalsDialog, type BulkEditValues } from "./orders-selection"
import { EMPTY_ORDER_FILTERS, ORDER_FILTER_KEYS, OrderFilterPanel, countOrderFilters, matchesOrderFilters, needsFilterData, orderRest, statusCodeOf, type OrderFilters } from "./order-filter-panel"
import { ORDER_STATUS_REF_LABEL, orderApiErrorText, orderOrganization, type AgentLimitExceeded, type Order, type ProductRestrictionRefusal } from "./orders-data"

export function OrdersView({ initialOrderId }: { initialOrderId?: number } = {}) {
  const router = useRouter()
  const { t } = useLanguage()
  const app = useAppCurrencyInfo()
  const [orders, setOrders] = useState<ListedOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  // Linko keeps pageSize=25 in the URL once it is there; its «clear filter» goes to the bare #/order.
  const [pageSizeInUrl, setPageSizeInUrl] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [query, setQuery] = useState("")
  // Linko's column sort: its `ordering` key (market__name, -total_price …), kept in the URL.
  const [ordering, setOrdering] = useState("")
  const [filterData, setFilterData] = useState<OrderFilterData | null>(null)
  const [selected, setSelected] = useState<Order | null>(null)
  const [checkedIds, setCheckedIds] = useState<number[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  // Linko's «Применить» writes openFilterDialog=false&page=1&pageSize=… (kept until the ⊗ clears the filter).
  const [filterApplied, setFilterApplied] = useState(false)
  const [filters, setFilters] = useState<OrderFilters>(EMPTY_ORDER_FILTERS)
  const [notice, setNotice] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [initialShopId, setInitialShopId] = useState<number | undefined>()
  const [bulkPayOpen, setBulkPayOpen] = useState(false)
  const [noSelection, setNoSelection] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [totalsOpen, setTotalsOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [onlyIds, setOnlyIds] = useState<number[] | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  // null: never opened; false: closed with ✕ (Linko then keeps openExpirationDateDialog=false in the address).
  const [seriesOpen, setSeriesOpen] = useState<boolean | null>(null)
  // The card's av_timer, as Linko: the order becomes the ticked one (?select=<id>) and the auto distribution opens.
  useOrderSeriesAutoRequest(
    useCallback((ids: number[]) => {
      setCheckedIds(ids)
      setSeriesOpen(true)
    }, []),
  )
  const [invoiceNumOpen, setInvoiceNumOpen] = useState(false)
  const [edoOpen, setEdoOpen] = useState(false)
  // Linko's «ВЫПОЛНИТЬ» confirmation of «Передать» / «Доставлен» (openDelivery=true in its address).
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const [deliverySaving, setDeliverySaving] = useState(false)
  const detailRowRef = useRef<HTMLDivElement>(null)
  const today = useMemo(() => todayIso(), [])
  const activeFilterCount = countOrderFilters(filters) + (onlyIds ? 1 : 0)
  // The status codes of the URL (status=0-1-5); no status key = Linko's bare #/order, which shows the «Все» tab.
  const statusKey = filters.status ?? ""
  const statusCodes = useMemo(() => statusKey.split("-").filter(Boolean), [statusKey])
  const tab = TAB_LABELS.find((label) => sameSet(TAB_STATUSES[label], statusCodes)) ?? null
  const badgeStatus = statusCodes.length === 1 && tab === null ? statusCodes[0] : null

  // Linko's filter data (option lists, what each order's lines and shop hold) is loaded once the panel opens or an
  // applied filter needs it.
  const wantsFilterData = filterOpen || needsFilterData(filters)
  useEffect(() => {
    if (!wantsFilterData || filterData) return
    let cancelled = false
    fetch("/api/orders/filter-data")
      .then((response) => (response.ok ? (response.json() as Promise<OrderFilterData>) : null))
      .then((data) => {
        if (!cancelled && data) setFilterData(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [wantsFilterData, filterData])

  const filtered = useMemo(() => {
    // Linko's search (Django SearchFilter): every word must be part of the order № or the shop's name.
    const terms = query.toLowerCase().split(/[\s,]+/).filter(Boolean)
    return orders
      .filter((row) => terms.every((term) => String(row.id).includes(term) || (row.marketName || row.client).toLowerCase().includes(term)))
      .filter((row) => matchesOrderFilters(row, filters, app.code, { data: filterData, today }))
      .filter((row) => !onlyIds || onlyIds.includes(row.id))
  }, [orders, query, filters, onlyIds, app.code, filterData, today])
  const sortedRows = useMemo(() => {
    const field = ordering.replace(/^-/, "")
    const sortKey = SORT_KEYS[field]
    if (!sortKey) return filtered
    const desc = ordering.startsWith("-")
    // Linko sorts on its server (PostgreSQL, en_US collation: Latin before Cyrillic, punctuation ignored; empty values
    // last going up and first going down); rows with the same value keep the list's order.
    return [...filtered].sort((a, b) => {
      const x = sortKey(a)
      const y = sortKey(b)
      if (x === null || y === null) return x === y ? 0 : (x === null ? 1 : -1) * (desc ? -1 : 1)
      const result = typeof x === "number" && typeof y === "number" ? x - y : SORT_COLLATOR.compare(String(x), String(y))
      return desc ? -result : result
    })
  }, [filtered, ordering])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageStart = (Math.min(page, pageCount) - 1) * pageSize
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize)
  const selectedRows = useMemo(() => orders.filter((row) => checkedIds.includes(row.id)), [orders, checkedIds])
  const selecting = selectedRows.length > 0
  // "Групповая оплата" posts into cashboxes (POST /api/cash/orders/[id]/pay): only for users who may.
  const canPay = useCanManage(PAY_PERMISSIONS)
  // The group payment offers each ticked order's payable rest (OrderGroupPayment reads it as
  // orderBalance). A cancelled or fully paid order takes no payment, so it is left out and named
  // in a note instead of failing half-way through the save.
  const groupPay = useMemo(() => {
    const rows: Order[] = []
    const skipped: number[] = []
    for (const row of selectedRows) {
      const rest = payableRestOf(row)
      if (rest > 0.005) rows.push({ ...row, orderBalance: rest })
      else skipped.push(row.id)
    }
    return { rows, skipped }
  }, [selectedRows])
  const totals = useMemo(() => {
    // Like the reference's band (sales/order/total, exclude_cancelled): every listed order but the cancelled ones
    // (they count with «Показать отмененные заказы», Linko's exclude=true), unconfirmed ones included; per currency of
    // the orders (also when it adds up to 0: «Возвраты: 0 SUM , 0 USD») the exact sum of their lines, what was returned
    // of them (pending returns too) and the difference.
    const counted = (selecting ? selectedRows : filtered).filter((row) => filters.exclude || row.status !== "Отменен")
    const orderTotals = new Map<string, number>()
    const returnTotals = new Map<string, number>()
    // With an app currency (Настройки → Валюта приложения) every amount is added up in it.
    const add = (totals: Map<string, number>, currency: string, value: number) =>
      app.code ? addTotal(totals, app.code, inAppCurrency(app, value, currency) ?? 0) : addTotal(totals, bandCurrency(currency), value)
    // «Факт» adds up each order's own fact (its lines less its returns), as Linko's total_fact_price does, not the
    // two totals above: those are rounded to a number already and lose the fifth decimal of a band of billions.
    const fact = new Map<string, number>()
    for (const row of counted) {
      const amount = parseAmount(row.amount)
      if (!amount) continue
      add(orderTotals, amount.currency, row.linesTotal ?? amount.number)
      add(returnTotals, amount.currency, row.returnPrice ?? 0)
      add(fact, amount.currency, row.linesTotal ?? amount.number)
      add(fact, amount.currency, -(row.returnPrice ?? 0))
    }
    // Linko's band of ticked orders prints the amounts without the « , » between currencies; an empty list prints none.
    if (!counted.length && !selecting) return { orders: null, returns: null, fact: null }
    return { orders: renderTotals(orderTotals, selecting), returns: renderTotals(returnTotals, selecting), fact: renderTotals(fact, selecting) }
  }, [filtered, selectedRows, selecting, app, filters.exclude])
  const unconfirmedCount = orders.filter((row) => row.status === "Не подтвержден").length
  const requestedCount = orders.filter((row) => row.status === "В процессе").length
  const readyCount = orders.filter((row) => row.status === "Есть на складе").length

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/orders")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить заказы")
        return (await response.json()) as ListedOrder[]
      })
      .then((data) => {
        if (cancelled) return
        setOrders(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Не удалось загрузить заказы с сервера"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // The expanded order lives in the URL like the reference's #/order/<id>: /analytics/sales/<id> (the old ?order=<id> still works).
  const orderIdFromUrl = () => {
    const path = /\/analytics\/sales\/(\d+)/.exec(window.location.pathname)
    const id = Number(path?.[1] ?? new URLSearchParams(window.location.search).get("order") ?? initialOrderId)
    return Number.isFinite(id) && id > 0 ? id : 0
  }

  useEffect(() => {
    if (loading || selected) return
    const id = orderIdFromUrl()
    if (!id) return
    const match = orders.find((row) => row.id === id)
    if (match) {
      setSelected(match)
      // the card sits inside the list, so jump to the page holding the order unless the URL already names one
      const index = sortedRows.findIndex((row) => row.id === id)
      if (index >= 0 && !new URLSearchParams(window.location.search).get("page")) setPage(Math.floor(index / pageSize) + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, orders])

  // Opening an order pushes its URL and keeps the list's query (Linko's #/order/1592?pageSize=25&status=0-1-5), so the
  // browser's Back button returns to the same list.
  useEffect(() => {
    if (!selected) return
    const target = `/analytics/sales/${selected.id}`
    if (window.location.pathname !== target) window.history.pushState(null, "", target + window.location.search)
  }, [selected?.id])

  useEffect(() => {
    const onPop = () => {
      const id = orderIdFromUrl()
      setSelected((current) => (id ? (orders.find((row) => row.id === id) ?? current) : null))
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders])

  // Esc does not collapse the expanded order (Linko keeps #/order/<id> open); Back or the row closes it.

  // Deep link from the client card: /analytics/sales?openOrderDialog=true&openShop=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ids = (params.get("select") ?? "").split("-").map(Number).filter((id) => Number.isFinite(id) && id > 0)
    const flag = (name: string) => params.get(name) === "true"
    const urlPage = Number(params.get("page"))
    if (Number.isFinite(urlPage) && urlPage > 1) setPage(urlPage)
    const urlPageSize = Number(params.get("pageSize"))
    if (PAGE_SIZES.includes(urlPageSize)) setPageSize(urlPageSize)
    if (params.has("pageSize")) setPageSizeInUrl(true)
    // Linko's list state lives in the URL: the status codes (the menu opens ?status=0-1-5 = Активные, 2 = Доставляется,
    // 3 = Доставленные, empty = Все; the header badges 5 / 0 / 1), every filter key, the search and the sort.
    const fromUrl: OrderFilters = {}
    for (const key of ORDER_FILTER_KEYS) {
      const value = params.get(key)
      // An empty value (?status= of the «Все» tab, ?select=) is dropped on load, as Linko rewrites #/order?status= to #/order.
      if (value) fromUrl[key] = value
    }
    if (Object.keys(fromUrl).length) setFilters(fromUrl)
    if (params.get("search")) setQuery(params.get("search") ?? "")
    const urlOrdering = params.get("ordering") ?? ""
    if (SORT_KEYS[urlOrdering.replace(/^-/, "")]) setOrdering(urlOrdering)
    // Ticked orders alone (select=) show «Выбрано: N» without the check boxes, as Linko.
    if (flag("showCheckboxes")) setSelectMode(true)
    if (ids.length) setCheckedIds(ids)
    if (flag("openFilterDialog")) setFilterOpen(true)
    if (params.get("openFilterDialog") === "false") setFilterApplied(true)
    if (flag("openGroupPaymentDialog")) setBulkPayOpen(true)
    if (flag("openOrderSummaryDialog")) setTotalsOpen(true)
    // The bulk actions need ticked orders; without any the reference shows its "pick at least one order" popover.
    const bulk = (name: string, key: string, open: () => void) => {
      if (!flag(name)) return
      if (ids.length) open()
      else setNoSelection(key)
    }
    bulk("openMultiEdit", "edit", () => setBulkEditOpen(true))
    // The auto distribution opens without ticked orders too («Выберите заказ из списка»), as Linko.
    if (flag("openExpirationDateDialog")) setSeriesOpen(true)
    bulk("openInvoiceNumberDialog", "invoice", () => setInvoiceNumOpen(true))
    bulk("openDelivery", "bulk", () => setDeliveryOpen(true))
    if (flag("openOrderDialog") || flag("openCreateDialog")) {
      const shop = Number(params.get("openShop"))
      setInitialShopId(Number.isFinite(shop) && shop > 0 ? shop : undefined)
      setAddOpen(true)
    }
  }, [])

  useUrlParams(
    {
      ...Object.fromEntries(ORDER_FILTER_KEYS.map((key) => [key, filters[key] ?? null])),
      search: query || null,
      ordering: ordering || null,
      showCheckboxes: selectMode ? "true" : null,
      select: checkedIds.length ? checkedIds.join("-") : null,
      openFilterDialog: filterOpen ? "true" : filterApplied ? "false" : null,
      openGroupPaymentDialog: bulkPayOpen ? "true" : null,
      openOrderSummaryDialog: totalsOpen ? "true" : null,
      openMultiEdit: bulkEditOpen || noSelection === "edit" ? "true" : null,
      openExpirationDateDialog: seriesOpen === null ? null : String(seriesOpen),
      openInvoiceNumberDialog: invoiceNumOpen || noSelection === "invoice" ? "true" : null,
      openDelivery: deliveryOpen ? "true" : null,
      openCreateDialog: addOpen ? "true" : null,
      page: page > 1 || filterApplied ? String(page) : null,
      pageSize: pageSizeInUrl || pageSize !== 25 ? String(pageSize) : null,
    },
    addOpen ? [] : ["openOrderDialog", "openShop"],
  )

  function closeAddDialog() {
    setAddOpen(false)
    setInitialShopId(undefined)
  }

  async function reloadOrders() {
    try {
      const response = await fetch("/api/orders")
      if (!response.ok) throw new Error("reload failed")
      setOrders((await response.json()) as ListedOrder[])
      flash(t("Данные обновлены"))
    } catch {
      flash(t("Не удалось загрузить заказы с сервера"))
    }
  }

  function exportCsv() {
    const rows = orders.filter((row) => checkedIds.includes(row.id))
    const csv = [HEADS.map((head) => csvCell(t(head))).join(";")]
      .concat(rows.map((row) => [row.id, row.client, row.type, t(createdText(row)), delivererOf(row), t(displayDay(row.delivery)), row.agent, row.amount, row.balance, t(row.status)].map(csvCell).join(";")))
      .join("\n")
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "orders.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  /** Runs a toolbar action that needs ticked orders, or shows the "pick at least one order" popover. */
  function requireSelection(key: string, run: () => void) {
    if (!selecting) {
      setNoSelection(key)
      return
    }
    run()
  }

  async function applyBulkEdit(values: BulkEditValues, showAfter: boolean) {
    const ids = [...checkedIds]
    const patchFor = (row: Order): OrderPatch => {
      const patch: OrderPatch = {}
      if (values.created) {
        patch.created = formatCreated(values.created, row.created)
        // The server reads createdAt as local (Tashkent) time and stores UTC: keep the order's local time of day.
        patch.createdAt = `${values.created} ${(parseAnyDate(row.createdAt, true) ?? "").slice(11, 19) || "00:00:00"}`
      }
      if (values.delivery) patch.delivery = values.delivery
      if (values.paid) {
        patch.paymentDate = values.paid
        patch.dueDate = values.paid
      }
      // «Дата передачи» is Linko's accepted_time, the order's realization day.
      if (values.transfer) patch.acceptedDate = values.transfer
      if (values.realization) {
        const delivery = values.delivery ? values.delivery : parseAnyDay(row.delivery)
        if (delivery) patch.acceptedDate = delivery
      }
      if (values.deliverer) patch.deliveryMan = values.deliverer
      if (values.expeditor) patch.expeditor = values.expeditor
      if (values.picker) patch.collector = values.picker
      if (values.agent) patch.agent = values.agent
      // The order's warehouse reference (resolved and stock-checked by the server), not a free-text name.
      if (values.warehouse) patch.warehouse = values.warehouse
      if (values.transport) patch.transportNumber = values.transport
      if (values.dealType) patch.dealType = values.dealType === "Консигнация" ? "consignment" : "standard"
      // Paid / unpaid is no order field: payments go through the cash ledger (see below).
      if (values.status) {
        const label = values.status === "Не подтвержденный" ? "Не подтвержден" : values.status
        patch.status = Object.entries(ORDER_STATUS_REF_LABEL).find(([, refLabel]) => refLabel === label)?.[0] ?? row.status
      }
      return patch
    }
    setBulkEditOpen(false)
    const results = await Promise.all(
      ids.map((id) => {
        const row = orders.find((item) => item.id === id)
        const patch = row ? patchFor(row) : {}
        return Object.keys(patch).length ? updateOrder(id, patch) : Promise.resolve(null)
      }),
    )
    if (showAfter) setOnlyIds(ids)
    const changed = results.filter((result) => result === true).length
    const failed = results.some((result) => result === false)
    // A refused order already showed the server's message (updateOrder); keep it on screen.
    if (!failed && results.some((result) => result !== null)) flash(`${changed} ${t("заказ(ов) изменено")}`)
    // Paid / unpaid follows real payments: "Принять оплату по выбранным заказам" opens the group
    // payment of the ticked orders (cash ledger); a payment is cancelled in the cash section.
    if (values.pay) setBulkPayOpen(true)
  }

  function flash(text: string) {
    setNotice(text)
    window.setTimeout(() => setNotice(""), 2200)
  }

  function toggleChecked(id: number) {
    setCheckedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  /** «ДА» of the «ВЫПОЛНИТЬ» dialog: the ticked orders of this tab move on, with the transfer / delivery day if set. */
  async function confirmDelivery(dates: DeliveryDates) {
    const status = tab === "Доставляется" ? "Доставлено" : "В пути"
    setDeliverySaving(true)
    await moveChecked(status, status === "В пути" ? "заказ(ов) передано в доставку" : "заказ(ов) отмечено доставленными", deliveryIds, dates)
    setDeliverySaving(false)
    setDeliveryOpen(false)
  }

  /** Moves the orders `ids` to `status` (with the transfer / delivery day when given): `done` is the Russian key of the
   * count message. */
  async function moveChecked(status: string, done: string, ids: number[], dates: DeliveryDates = {}) {
    setCheckedIds([])
    // The server checks each transition and the stock; only what it accepted changes here.
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const response = await fetch(`/api/orders/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, ...(dates.transferDate ? { acceptedDate: dates.transferDate } : {}), ...(dates.deliveryDate ? { delivery: dates.deliveryDate } : {}) }),
          })
          const body = (await response.json().catch(() => null)) as (Order & { error?: string; agentLimit?: AgentLimitExceeded; productRestriction?: ProductRestrictionRefusal }) | null
          return response.ok && body ? { id, order: body } : { id, error: orderApiErrorText(body, t, "Не удалось сохранить изменения на сервере") }
        } catch {
          return { id, error: t("Не удалось сохранить изменения на сервере") }
        }
      }),
    )
    const updated = results.flatMap((result) => ("order" in result && result.order ? [result.order] : []))
    setOrders((current) => current.map((row) => updated.find((order) => order.id === row.id) ?? row))
    const failed = results.filter((result) => "error" in result && result.error)
    flash(
      failed.length
        ? `${updated.length} ${t(done)}. №${failed[0].id}: ${String((failed[0] as { error: string }).error)}`
        : `${updated.length} ${t(done)}`,
    )
  }

  async function updateOrder(id: number, patch: OrderPatch): Promise<boolean> {
    try {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const body = (await response.json().catch(() => null)) as (Order & { error?: string; agentLimit?: AgentLimitExceeded; productRestriction?: ProductRestrictionRefusal }) | null
      if (!response.ok || !body) {
        flash(orderApiErrorText(body, t, "Не удалось сохранить изменения на сервере"))
        return false
      }
      setOrders((current) => current.map((row) => (row.id === id ? body : row)))
      setSelected((current) => (current && current.id === id ? body : current))
      return true
    } catch {
      flash(t("Не удалось сохранить изменения на сервере"))
      return false
    }
  }

  async function refreshOrder(id: number) {
    try {
      const response = await fetch(`/api/orders/${id}`)
      if (!response.ok) return
      const updated = (await response.json()) as Order
      setOrders((current) => current.map((row) => (row.id === id ? updated : row)))
      setSelected((current) => (current && current.id === id ? updated : current))
    } catch {
      // best-effort refresh; the items tab already reflects the latest state
    }
  }

  function orderCreated(created: Order) {
    setOrders((current) => [created, ...current])
    closeAddDialog()
    flash(t("Заказ добавлен"))
  }

  function importFromExcel(file: File) {
    void (async () => {
      const rows = await readExcelRows(file)
      // Imported rows (client, amount) become unconfirmed orders without lines;
      // the server validates the client and the amount of each.
      const parsed = rows
        .filter(([client]) => client && !/^(клиент|client)$/i.test(client))
        .map(([client, amount]) => ({ client, amount: amount || "0", status: "Не подтвержден" }))
      if (!parsed.length) return
      const created: Order[] = []
      const errors: string[] = []
      for (const row of parsed) {
        try {
          const response = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(row),
          })
          const body = (await response.json().catch(() => null)) as (Order & { error?: string }) | null
          if (response.ok && body) created.push(body)
          else errors.push(`${row.client}: ${t(body?.error ?? "Не удалось импортировать заказы")}`)
        } catch {
          errors.push(`${row.client}: ${t("Не удалось импортировать заказы")}`)
        }
      }
      // Newest first, as the list is ordered (Linko's id desc).
      setOrders((current) => [...[...created].sort((x, y) => y.id - x.id), ...current])
      flash(errors.length ? `${t("Импортировано заказов:")} ${created.length}. ${t("Ошибки")}: ${errors.slice(0, 3).join("; ")}` : `${t("Импортировано заказов:")} ${created.length}`)
    })()
  }

  /** A tab or a header badge: Linko replaces the status codes and drops the ticked orders (select=). */
  const setStatusFilter = (codes: string[]) => {
    setFilters((current) => ({ ...current, status: codes.join("-") }))
    setCheckedIds([])
    setPage(1)
  }

  /** A column header: Linko's ordering goes up, down, then off. */
  const toggleOrdering = (head: string) => {
    const field = HEAD_ORDERING[head]
    if (!field) return
    setOrdering((current) => (current === field ? `-${field}` : current === `-${field}` ? "" : field))
    setPage(1)
  }

  // The ticked orders the «ВЫПОЛНИТЬ» dialog names: those of the list shown (Linko leaves out a ticked order of another
  // tab), in the order they were ticked.
  const deliveryIds = checkedIds.filter((id) => filtered.some((row) => row.id === id))
  const openDelivery = () => setDeliveryOpen(true)
  const bulkAction =
    tab === "Активные"
      ? { label: t("Передать"), path: ICON.truck, onClick: openDelivery }
      : tab === "Доставляется"
        ? { label: t("Доставлен"), path: ICON.clipboard, onClick: openDelivery }
        : null

  const actionDefs = {
    select: { key: "select", path: selectMode ? ICON.visibilityOff : ICON.checklist, title: selectMode ? t("Спрятать флажки") : t("Выбрать из списка"), color: "#5d6474", onClick: () => setSelectMode((value) => !value) },
    sync: { key: "sync", path: ICON.sync, title: t("Обновить список"), color: "#5d6474", onClick: reloadOrders },
    print: { key: "print", raw: true, path: ICON.print, title: t("Распечатать выбранное"), color: "#666", onClick: () => requireSelection("print", () => window.print()) },
    // Linko's «Скачать» needs ticked orders too («Выберите хотя бы один заказ !» without any).
    download: { key: "download", path: ICON.download, title: t("Скачать"), color: "#666", onClick: () => requireSelection("download", exportCsv) },
    edit: { key: "edit", path: ICON.edit, title: t("Изменить выбранные заказы"), color: "#666", onClick: () => requireSelection("edit", () => setBulkEditOpen(true)) },
    series: { key: "series", raw: true, path: ICON.history, title: t("Авто распределение по сериям"), color: "#666", onClick: () => setSeriesOpen(true) },
    invoice: { key: "invoice", raw: true, path: ICON.textA, title: t("Нумерация счет фактуры"), color: "#666", onClick: () => requireSelection("invoice", () => setInvoiceNumOpen(true)) },
    edo: { key: "edo", raw: true, path: ICON.send, title: t("Отправить EDO"), color: "#666", onClick: () => requireSelection("edo", () => setEdoOpen((value) => !value)) },
    more: { key: "more", path: ICON.more, title: "", color: "#5d6474", onClick: () => setMoreOpen((value) => !value) },
    clear: { key: "clear", path: ICON.minusBox, title: t("Снять выделение"), color: "#333", onClick: () => { setCheckedIds([]); setMoreOpen(false) } },
  }
  // Linko's toolbar: with ticked orders the green «Передать» / «Доставлен» comes before ⋮ and «Снять выделение».
  const toolbarActions = selecting
    ? [actionDefs.sync, actionDefs.print, actionDefs.download, actionDefs.edit, actionDefs.series, actionDefs.invoice, actionDefs.edo]
    : [actionDefs.select, actionDefs.sync, actionDefs.print, actionDefs.download, actionDefs.edit, actionDefs.series, actionDefs.invoice, actionDefs.edo]
  const toolbarTail = selecting ? [actionDefs.more, actionDefs.clear] : []

  return (
    <main className="min-h-screen bg-[#f2f5f8] px-7 pb-7 font-sans text-[13px] text-[#333]">
      <div className="flex h-[60px] items-center justify-between">
        <div className="flex items-center">
          <h1 className="flex items-center text-[18px] font-bold leading-[22.5px] text-[#5d6474]">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#1E4A9A]" />
            <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
            {t("Заказы")}
          </h1>
          <div className="ml-[5px] flex items-center">
            {[
              { path: ICON.warning, count: unconfirmedCount, status: "Не подтвержден", tip: t("Отфильтровать неподтвержденным заказам") },
              { path: ICON.clock, count: requestedCount, status: "В процессе", tip: t("Отфильтровать по запрошенным заказам") },
              { path: ICON.store, count: readyCount, status: "Есть на складе", tip: t("Отфильтровать по доступным заказам") },
            ].map((badge) => {
              // Linko's badges write status=5 / 0 / 1.
              const active = badgeStatus === statusCodeOf(badge.status)
              return (
                <Tip key={badge.status} text={badge.tip} side="right">
                  <button
                    type="button"
                    onClick={() => setStatusFilter([statusCodeOf(badge.status)])}
                    className="relative flex h-12 w-[58px] items-center justify-start pl-[28px]"
                  >
                    <svg viewBox="0 0 24 24" className={`h-6 w-6 ${active ? "fill-[#71ce87]" : "fill-[#5d6474]"}`}><path d={badge.path} /></svg>
                    {active ? (
                      <span className="absolute left-[42px] top-[4px] flex h-[18px] w-[18px] items-center justify-center rounded-full border border-white bg-[#71ce87]">
                        <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-white"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" /></svg>
                      </span>
                    ) : (
                      <span className="absolute left-[42px] top-[4px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-white bg-[#e57373] px-[3px] text-[9px] font-semibold leading-[11.25px] text-white">{badge.count}</span>
                    )}
                  </button>
                </Tip>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-[10px]">
          <TopButton icon={ICON.filter} text={t("Показать на карте")} onClick={() => router.push("/clients/territory?openFilterDialog=true")} />
          {canPay && <TopButton icon={ICON.card} text={t("Групповая оплата")} onClick={() => setBulkPayOpen(true)} />}
          <TopButton icon={ICON.chart} text={t("Импортировать")} onClick={() => setImportOpen(true)} />
          <TopButton
            icon={ICON.add}
            text={t("Добавить")}
            green
            onClick={() => {
              setInitialShopId(undefined)
              setAddOpen(true)
            }}
          />
        </div>
      </div>

      {notice && (
        <div className="mb-3 flex items-center justify-between rounded bg-[#e9f8ed] px-4 py-3 text-sm text-[#278549]">
          {notice}
          <button type="button" onClick={() => setNotice("")} aria-label={t("Закрыть уведомление")}><X size={18} /></button>
        </div>
      )}

      <section className="shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="relative flex h-10 rounded-[2px] bg-white">
          {TAB_LABELS.map((label) => (
            <button key={label} type="button" onClick={() => setStatusFilter(TAB_STATUSES[label])} className="h-10 w-1/4 pt-[2px] text-[13px] font-medium text-black">
              {t(label)}
            </button>
          ))}
          {tab && (
            <span
              className="absolute -bottom-[2px] left-0 h-[3px] w-1/4 bg-[#1E4A9A] shadow-[0_-3px_10px_0_#1E4A9A] transition-transform duration-300"
              style={{ transform: `translateX(${TAB_LABELS.indexOf(tab) * 100}%)` }}
            />
          )}
        </div>
        <div className={`mt-px flex justify-between border-b border-[#efefef] pb-[5px] pl-[5px] pr-[33px] pt-[5px] text-[13px] font-semibold leading-[16.25px] text-white ${selecting ? "bg-[#008000]" : "bg-[#1E4A9A]"}`}>
          {[
            { label: t("Заказы"), value: totals.orders },
            { label: t("Возвраты"), value: totals.returns },
            { label: t("Факт"), value: totals.fact },
          ].map((group, index) => (
            <div key={group.label} className={`flex pt-[4px] ${index === 2 ? "text-right" : ""}`}>
              <span className={selecting ? "mr-[15px]" : "mr-[5px]"}>{group.label}:</span>
              {group.value}
            </div>
          ))}
        </div>

        <div className="relative bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          {filterOpen && (
            <OrderFilterPanel
              orders={orders}
              filters={filters}
              data={filterData}
              today={today}
              onApply={(next) => {
                // Linko's «Применить» replaces the filter keys of the URL, drops the ticked orders and closes the panel.
                setFilters(next)
                setCheckedIds([])
                setPage(1)
                setFilterOpen(false)
                setFilterApplied(true)
                setPageSizeInUrl(true)
              }}
              onClose={() => setFilterOpen(false)}
            />
          )}
          <div className="flex h-[50px] items-center pr-[5px]">
            {selecting ? (
              <div className="w-[347px] shrink-0 pl-[5px] text-[13px] font-bold text-[#333]">{t("Выбрано:")} {selectedRows.length}</div>
            ) : (
              <div className="shrink-0" style={{ width: "calc(326.5px + max(0px, 100vw - 1296px) * 0.25)" }}>
                {activeFilterCount > 0 ? (
                  <RefAppliedFilter
                    // Linko's bar fills its column (a quarter of the row) less the 31 px before the search.
                    width="calc(100% - 31px)"
                    count={activeFilterCount}
                    onEdit={() => setFilterOpen(true)}
                    onClear={() => {
                      // Linko's ⊗ goes to the bare #/order: no filter, search, sort or check boxes.
                      setFilters(EMPTY_ORDER_FILTERS)
                      setOnlyIds(null)
                      setQuery("")
                      setOrdering("")
                      setSelectMode(false)
                      setCheckedIds([])
                      setPageSizeInUrl(false)
                      setFilterApplied(false)
                      setPage(1)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setFilterOpen((value) => !value)}
                    className="ml-[5px] flex h-[30px] items-center rounded-[5px] bg-[#1E4A9A] pl-3 text-[13px] font-semibold text-white"
                  >
                    <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white"><path d={ICON.filter} /></svg>
                    <span className="pl-2 pr-4">{filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")}</span>
                  </button>
                )}
              </div>
            )}
            {!selecting && (
              // Linko's search is 300 px wide at every window width, its magnifier 274 px from the start.
              <div className="relative flex w-[300px] shrink-0 items-center self-start">
                <input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setPage(1) }}
                  placeholder={t("Поиск")}
                  className="h-[40px] w-full border-b border-[#e0e0e0] bg-transparent pt-[8px] text-[13px] outline-none placeholder:text-black/30 focus:border-[#5d6474]"
                />
                <svg viewBox="0 0 24 24" className="absolute right-[2px] top-[12px] h-6 w-6 fill-[#ccc]"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
              </div>
            )}
            <div className="ml-auto flex items-center text-[#5d6474]">
              <div className="relative mr-[11px]">
                <select
                  value={pageSize}
                  onChange={(event) => { setPageSize(Number(event.target.value)); setPageSizeInUrl(true); setPage(1) }}
                  className="h-12 w-[56px] appearance-none bg-transparent text-[13px] text-[#333] outline-none"
                >
                  {PAGE_SIZES.map((size) => <option key={size}>{size}</option>)}
                </select>
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-[16px] top-3 h-6 w-6 fill-[#ddd]"><path d="M7 10l5 5 5-5z" /></svg>
              </div>
              {/* Linko prints «1 - 0 из 0» for an empty list. */}
              <span className="relative top-[1.5px] whitespace-nowrap">{pageStart + 1} - {Math.min(pageStart + pageSize, filtered.length)}  {t("из")}  {filtered.length}</span>
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label={t("Назад")} className="pl-[10px] pr-[5px] disabled:opacity-100">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
              </button>
              <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)} aria-label={t("Вперед")}>
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page >= pageCount ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-12l5 4-5 4V8z" /></svg>
              </button>
              {[...toolbarActions, ...(bulkAction ? [bulkAction] : []), ...toolbarTail].map((action, index) => "onClick" in action && "label" in action ? (
                // Above the sticky table header (z-20). Linko's button keeps its caption («Передать» / «Доставлен») inside from
                // a 1530 px wide window; narrower, the button shrinks and the caption drops onto the header row.
                <span key="bulk" className="relative z-30 flex">
                  <button type="button" onClick={() => requireSelection("bulk", action.onClick)} className="relative flex h-[30px] w-[105.5px] items-center justify-center rounded-[5px] bg-[#71ce87] pl-[12px] hover:brightness-95 min-[1530px]:w-auto min-[1530px]:pl-[12px]">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white min-[1530px]:h-[18px] min-[1530px]:w-[18px]"><path d={action.path} /></svg>
                    <span className="pointer-events-none absolute left-[17px] top-[36px] whitespace-nowrap text-[13px] font-semibold text-white min-[1530px]:static min-[1530px]:pl-[8px] min-[1530px]:pr-[16px]">{action.label}</span>
                  </button>
                  {noSelection === "bulk" && <NoSelectionPopover onClose={() => setNoSelection(null)} />}
                </span>
              ) : (
                <Tip key={action.key} text={action.title} side={action.key === "series" ? "bottom" : "left"} raw={"raw" in action} className={index === 0 ? "ml-5" : ""}>
                  <button type="button" aria-label={action.title} {...("raw" in action ? { "data-no-translate": "" } : {})} onClick={action.onClick} className="flex h-12 w-12 items-center justify-center">
                    <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: action.color }}><path d={action.path} /></svg>
                  </button>
                  {noSelection === action.key && <NoSelectionPopover onClose={() => setNoSelection(null)} />}
                  {action.key === "edo" && edoOpen && (
                    <EdoMenu
                      onClose={() => setEdoOpen(false)}
                      onPick={() => {
                        setEdoOpen(false)
                        flash(t("Интеграция EDO не подключена"))
                      }}
                    />
                  )}
                  {action.key === "more" && moreOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                      <button
                        type="button"
                        onClick={() => { setMoreOpen(false); setTotalsOpen(true) }}
                        className="absolute right-0 top-[0px] z-50 flex h-[56px] w-[224px] items-center rounded-[2px] bg-white pl-[20px] text-left text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
                      >
                        {t("Итоги выбранных заказов")}
                      </button>
                    </>
                  )}
                </Tip>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto min-[1130px]:overflow-visible">
            <div className="min-w-[1100px]">
              <div className="sticky top-[50px] z-20 flex h-[50px] items-center bg-[#5d6474] px-[30px] font-semibold text-white">
                {selectMode && (
                  <div className="relative h-full w-[20px] shrink-0">
                    <button
                      type="button"
                      aria-label={t("Выбрать все")}
                      onClick={() => setCheckedIds(pageRows.every((row) => checkedIds.includes(row.id)) ? checkedIds.filter((id) => !pageRows.some((row) => row.id === id)) : Array.from(new Set([...checkedIds, ...pageRows.map((row) => row.id)])))}
                      className="absolute -left-[10px] top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d={ICON.selectAll} /></svg>
                    </button>
                  </div>
                )}
                {HEADS.map((head, index) => (
                  <div key={head} style={{ width: `${COL_PCT[index]}%` }} className="px-2 leading-[18px]">
                    <button type="button" onClick={() => toggleOrdering(head)} className={`max-h-[36px] overflow-hidden text-left font-semibold hover:opacity-80 ${index === 0 || index === COL_PCT.length - 1 ? "" : "pr-[30px]"}`}>
                      {t(head)}
                      {ordering.replace(/^-/, "") === HEAD_ORDERING[head] ? <span className="ml-1 text-[10px]">{ordering.startsWith("-") ? "▼" : "▲"}</span> : null}
                    </button>
                  </div>
                ))}
              </div>
              {loading ? (
                <div className="px-4 py-16 text-center text-slate-500">{t("Загрузка заказов...")}</div>
              ) : loadError ? (
                <div className="px-4 py-16 text-center text-red-600">{loadError}</div>
              ) : pageRows.length === 0 ? (
                <RefNothingFound />
              ) : (
                pageRows.map((row) =>
                  selected?.id === row.id ? (
                    <div key={row.id} ref={detailRowRef} className="-mx-[15px] my-5">
                      <div className="sticky left-0 w-[calc(100vw-26px)] max-w-full">
                        <OrderDetailCard order={selected} onUpdate={updateOrder} refreshOrder={refreshOrder} onNavigate={(href) => router.push(href)} onNotify={flash} />
                      </div>
                    </div>
                  ) : (
                    <OrderRow
                      key={row.id}
                      row={row}
                      returned={row.returnPrice ?? 0}
                      selectMode={selectMode}
                      checked={checkedIds.includes(row.id)}
                      today={today}
                      onToggle={() => toggleChecked(row.id)}
                      onOpen={() => setSelected(row)}
                    />
                  ),
                )
              )}
            </div>
          </div>
        </div>
      </section>

      {totalsOpen && <SelectedTotalsDialog orders={selectedRows} onClose={() => setTotalsOpen(false)} />}
      <OrderSeriesEditLink onNotify={flash} />
      {seriesOpen && (
        <OrderSeriesAutoDialog
          ids={checkedIds}
          onClose={() => setSeriesOpen(false)}
          onSaved={() => {
            setSeriesOpen(false)
            flash(t("Успешно изменено"))
          }}
        />
      )}
      {invoiceNumOpen && (
        <InvoiceNumberDialog
          onClose={() => setInvoiceNumOpen(false)}
          onSave={async (start) => {
            setInvoiceNumOpen(false)
            const rows = sortedRows.filter((row) => checkedIds.includes(row.id))
            await Promise.all(rows.map((row, index) => updateOrder(row.id, { invoiceNumber: String(start + index) })))
            flash(`${rows.length} ${t("заказ(ов) изменено")}`)
          }}
        />
      )}
      {bulkEditOpen && <BulkEditDialog count={selectedRows.length} onClose={() => setBulkEditOpen(false)} onApply={applyBulkEdit} />}
      {deliveryOpen && <OrderDeliveryDialog ids={deliveryIds} saving={deliverySaving} onClose={() => setDeliveryOpen(false)} onConfirm={(dates) => void confirmDelivery(dates)} />}

      {addOpen && (
        <AddOrderDialog initialShopId={initialShopId} onClose={closeAddDialog} onCreated={orderCreated} />
      )}

      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onSave={(file) => {
            setImportOpen(false)
            importFromExcel(file)
          }}
        />
      )}

      {bulkPayOpen &&
        canPay &&
        (groupPay.rows.length ? (
          <>
            <OrderGroupPayment
              orders={groupPay.rows}
              onClose={() => setBulkPayOpen(false)}
              onSaved={(count) => {
                flash(`${t("Оплата принята по")} ${count}`)
                setBulkPayOpen(false)
                setCheckedIds([])
                void reloadOrders()
              }}
            />
            {groupPay.skipped.length > 0 && (
              <div role="status" className="fixed inset-x-0 bottom-[57px] z-[1201] border-t border-[#ffe0b2] bg-[#fff8e1] px-[30px] py-[8px] text-[13px] text-[#8a5300]">
                {t("Не показаны заказы без остатка к оплате (отменены или оплачены):")} {groupPay.skipped.map((id) => `№ ${id}`).join(", ")}
              </div>
            )}
          </>
        ) : (
          <div data-order-overlay className="fixed inset-0 z-[1200] overflow-y-auto bg-white">
            <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[15px]">
              <h3 className="text-[13px] font-bold uppercase text-[#333]">{t("Групповая оплата")}</h3>
              <button type="button" onClick={() => setBulkPayOpen(false)} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center"><X className="h-6 w-6 text-[#333]" /></button>
            </div>
            <p className="mt-[137px] text-center text-[18px] font-semibold text-[#333]">{t(selecting ? "По выбранным заказам нет остатка к оплате" : "Выберите хотя бы один заказ !")}</p>
          </div>
        ))}
    </main>
  )
}

const IMPORT_FORMATS = ["Korzinka", "Havas Excel", "Havas XML", "Makro", "Baraka market", "Olma market", "С шаблона накладного", "Импорт с excel", "Изменить"]

/** "ИМПОРТ С EXCEL": the reference's format list and drop zone (every format reads the same client / amount columns here). */
function ImportDialog({ onClose, onSave }: { onClose: () => void; onSave: (file: File) => void }) {
  const { t } = useLanguage()
  const [format, setFormat] = useState(IMPORT_FORMATS[0])
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return createPortal(
    <div data-order-overlay className="fixed inset-0 z-[1500] flex items-start justify-center bg-black/[0.54] font-sans text-[13px] text-[#333]">
      <div className="relative mt-[80px] h-[760px] w-[400px] max-w-full bg-white shadow-[0_10px_32px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]">
        <span className="absolute left-[30px] top-[21.4px] text-[13px] font-bold uppercase leading-[16.3px]">{t("Импорт с Excel")}</span>
        <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[15px] top-[5.5px] flex h-12 w-12 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
        </button>
        <span className="absolute inset-x-0 top-[59.3px] h-px bg-[#efefef]" />
        <span className="pointer-events-none absolute left-[30px] top-[90px] h-[567px] w-[348px] border border-[#efefef]" />
        <div className="absolute left-[51px] top-[97px] w-[326px]">
          {IMPORT_FORMATS.map((value) => (
            <label key={value} className="flex h-[34px] cursor-pointer items-center">
              <svg viewBox="0 0 24 24" className="ml-[2px] h-5 w-5 shrink-0" aria-hidden>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" fill="#666" />
                {format === value && <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z" fill="#5d6474" />}
              </svg>
              <input type="radio" name="import-format" checked={format === value} onChange={() => setFormat(value)} className="sr-only" />
              <span className="ml-[18px] text-black">{t(value)}</span>
            </label>
          ))}
        </div>
        <input ref={inputRef} type="file" accept=".csv,.xls,.xlsx" className="hidden" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="absolute left-[51px] top-[432px] flex h-[199px] w-[310px] flex-col items-center justify-center border border-dashed border-[#ccc] text-center text-[13px] text-[#333]"
        >
          <svg viewBox="0 0 24 24" className="mb-[14px] h-6 w-6" fill="#666" aria-hidden><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" /></svg>
          {file ? file.name : t("Добавьте файл Excel или нажмите для выбора")}
        </button>
        <span className="absolute inset-x-0 bottom-[56px] h-px bg-[#efefef]" />
        <button
          type="button"
          onClick={() => file && onSave(file)}
          className="absolute bottom-[10px] right-[10px] h-9 min-w-[110px] rounded-[2px] bg-[#71ce87] px-4 text-[13px] font-semibold uppercase text-white"
        >
          {t("Сохранить")}
        </button>
      </div>
    </div>,
    document.body,
  )
}

const TAB_LABELS = ["Активные", "Доставляется", "Доставленные", "Все"] as const
/** Linko's tab values: the status codes of ?status= (0 В процессе, 1 Есть на складе, 5 Не подтвержден, 2 В пути, 3 Доставлено). */
const TAB_STATUSES: Record<(typeof TAB_LABELS)[number], string[]> = {
  "Активные": ["0", "1", "5"],
  "Доставляется": ["2"],
  "Доставленные": ["3"],
  "Все": [],
}
/** Linko's page sizes. */
const PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000]
const HEADS = ["№", "Клиент", "Тип", "Дата создания", "Доставщик", "Дата доставки", "Агент", "Сумма заказа", "Баланс", "Статус"]
/** Linko's ordering key of each column header. */
const HEAD_ORDERING: Record<string, string> = {
  "№": "id",
  "Клиент": "market__name",
  "Тип": "market__market_type__name",
  "Дата создания": "created_date",
  "Доставщик": "delivery_man__first_name",
  "Дата доставки": "date_delivery",
  "Агент": "user__first_name",
  "Сумма заказа": "total_price",
  "Баланс": "market_internal_balance",
  "Статус": "status",
}
/** The value each ordering sorts by (null = empty, PostgreSQL's NULL). */
const SORT_KEYS: Record<string, (row: Order) => string | number | null> = {
  id: (row) => row.id,
  market__name: (row) => row.marketName || row.client || null,
  market__market_type__name: (row) => row.type || null,
  created_date: (row) => parseAnyDate(row.createdAt, true) ?? parseAnyDay(row.created),
  delivery_man__first_name: (row) => row.deliveryMan || null,
  date_delivery: (row) => parseAnyDay(row.delivery),
  user__first_name: (row) => row.agent || null,
  total_price: (row) => row.totalPrice ?? parseAmount(row.amount)?.number ?? null,
  market_internal_balance: (row) => parseAmount(row.balance ?? "")?.number ?? null,
  status: (row) => Number(statusCodeOf(row.status) || 9),
}
/** PostgreSQL's en_US collation as Linko's server sorts names: Latin before Cyrillic, punctuation and spaces ignored. */
const SORT_COLLATOR = new Intl.Collator("en", { ignorePunctuation: true })
/** Column widths (%) of the reference list: every cell is padded 0.5rem, the last one is centred. */
const COL_PCT = [7, 16, 14, 10, 12, 8, 8, 10, 9, 6]

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((item) => b.includes(item))
}

const ICON = {
  ...ORDER_ICON,
  map: "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z",
  card: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  chart: "M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z",
  add: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
  filter: "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z",
  checklist: "M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z",
  sync: "M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z",
  print: "M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z",
  download: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  history: "M11 17c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1-1 .45-1 1zm0-14v4h2V5.08c3.39.49 6 3.39 6 6.92 0 3.87-3.13 7-7 7s-7-3.13-7-7c0-1.68.59-3.22 1.58-4.42L12 13l1.41-1.41-6.8-6.8v.02C4.42 6.45 3 9.05 3 12c0 4.97 4.02 9 9 9 4.97 0 9-4.03 9-9s-4.03-9-9-9h-1zm7 9c0-.55-.45-1-1-1s-1 .45-1 1 .45 1 1 1 1-.45 1-1zM6 12c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1-1 .45-1 1z",
  textA: "M5 17v2h14v-2H5zm4.5-4.2h5l.9 2.2h2.1L12.75 4h-1.5L6.5 15h2.1l.9-2.2zM12 5.98L13.87 11h-3.74L12 5.98z",
  send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  visibilityOff: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
  selectAll: "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  minusBox: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z",
  clear: "M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
  checkCircle: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
}

function TopButton({ icon, text, onClick, green }: { icon: string; text: string; onClick: () => void; green?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex h-[30px] items-center rounded-[5px] pl-3 text-[13px] font-semibold text-white hover:brightness-95 ${green ? "bg-[#71ce87]" : "bg-[#1E4A9A]"}`}>
      <svg viewBox="0 0 24 24" className="mb-[1px] h-[18px] w-[18px] fill-white"><path d={icon} /></svg>
      <span className="pl-2 pr-4 leading-[18px]">{text}</span>
    </button>
  )
}

/** Re-dates "07 сент. 20:03" / "09 янв. 2025 15:25" keeping the time of day. */
function formatCreated(iso: string, previous: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return previous
  const time = /(\d{1,2}:\d{2})\s*$/.exec(previous)?.[1] ?? "00:00"
  const year = match[1] === String(new Date().getFullYear()) ? "" : `${match[1]} `
  return `${match[3]} ${SHORT_MONTHS[Number(match[2]) - 1]} ${year}${time}`
}

/** Linko's numberFormat: the decimals of Настройки → Округление сумм (three when not set). */
const formatNumber = (value: number) => formatMoney(value)

/** Whole days from `today` to `day` (moment's diff: > 0 ahead, 0 today, < 0 passed; NaN without a day). */
function daysUntil(day: string | undefined, today: string): number {
  if (!day) return Number.NaN
  return Math.trunc((Date.parse(`${day.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/** Linko's payment icon (OrderStatus): coloured by the promised payment date while something is owed (any rest above 0
 * at the money precision) — grey while it is ahead, orange on the day, red once it has passed or when none was
 * promised —, green when paid, grey without a hint when overpaid; its hint names the date and the amount. A cancelled
 * order has none. */
function PaymentIcon({ row, today }: { row: Order; today: string }) {
  const { t } = useLanguage()
  if (row.status === "Отменен") return null
  const rest = roundAmount(orderRest(row))
  const owes = rest > 0
  const days = daysUntil(row.paymentDate, today)
  const currency = row.currency || row.amount.trim().split(/\s+/).pop() || ""
  const amount = `${formatNumber(roundMoney(rest))} ${currency}`
  const date = row.paymentDate ? t(displayDay(row.paymentDate)) : ""
  let color = "#b7bbb7"
  let tip: string[] = []
  if (owes) {
    color = days > 0 ? "#b7bbb7" : days === 0 ? "#f0ad4e" : "#e57373"
    if (days > 0) tip = [`${t("Оплата ожидается")}: ${date}`, `${t("Ожидаемый платеж")}: ${amount}`]
    else if (days === 0) tip = [t("Оплата ожидается сегодня"), `${t("Сумма")}: ${amount}`]
    else if (days < 0) tip = [`${t("Оплата ожидалась")}: ${date}`, `${t("Долг")}: ${amount}`]
  } else if (rest === 0) {
    color = "#81c784"
    tip = [t("Оплачено")]
  }
  return (
    <OrderIcon
      path={row.payMethod === "bank" || (!row.payMethod && row.paymentType === "bank") ? ICON.bank : ICON.cash}
      color={color}
      tip={tip.length ? tip.map((line) => <span key={line} className="block">{line}</span>) : undefined}
    />
  )
}

/** `returned`: the order's accepted client returns (Продажи → Возвраты), in the order currency. */
function OrderRow({ row, returned, selectMode, checked, today, onToggle, onOpen }: { row: Order; returned: number; selectMode: boolean; checked: boolean; today: string; onToggle: () => void; onOpen: () => void }) {
  const { t } = useLanguage()
  // The client balance as the server sends it, one amount per currency (never relabelled into another currency).
  const balanceSign = parseAmount(row.balance ?? "")?.number ?? 0
  const balanceClass = row.negative || balanceSign < 0 ? "font-semibold text-[#e27676]" : balanceSign > 0 ? "font-semibold text-[#48a34b]" : "text-black"
  const acceptedDay = parseAnyDay(row.acceptedDate)
  const accepted = acceptedDay && acceptedDay !== parseAnyDay(row.delivery) ? t(displayDay(acceptedDay)) : ""
  const returnPrice = returned
  const weight = row.weight ?? 0
  const cell = "px-2 leading-[16.25px]"
  return (
    <div className="relative bg-white px-[30px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d5d5d5_2px,transparent_2px)] after:bg-[length:8px_2px]">
      {(row.discountPercent ?? 0) > 0 && (
        <div className="pointer-events-none absolute right-[-23px] top-[-18px] z-[1] mx-[5px] inline-block h-[60px] w-[60px] rotate-[-90deg] scale-[0.4] border-[30px] border-solid border-[#e57373] border-l-transparent border-t-transparent text-white">
          <p className="ml-[10px] mt-[-17px] rotate-90 text-[28px] font-semibold">%</p>
        </div>
      )}
      <div onClick={onOpen} className={`relative -mx-[30px] flex min-h-[50px] cursor-pointer items-center px-[30px] py-[7px] hover:bg-[#f2f5f8] ${checked ? "bg-[#f2f5f8]" : ""}`}>
        {/* Linko's row is a link to #/order/<id> with the list's query: a plain click opens the order in place, a
            middle / ctrl / ⌘ click or «Открыть в новой вкладке» opens it in a new tab. */}
        <a
          href={`/analytics/sales/${row.id}`}
          aria-label={`№ ${row.id}`}
          onClick={(event) => {
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) event.preventDefault()
            else event.stopPropagation()
          }}
          onMouseDown={withListQuery}
          onFocus={withListQuery}
          onContextMenu={withListQuery}
          className="absolute inset-0"
        />
        {selectMode && (
          <div className="relative h-full w-[20px] shrink-0">
            <span className="absolute -left-[10px] top-1/2 -translate-y-1/2"><RowCheckbox checked={checked} onChange={onToggle} label={String(row.id)} /></span>
          </div>
        )}
        <div style={{ width: `${COL_PCT[0]}%` }} className={cell}>{row.id}</div>
        <div style={{ width: `${COL_PCT[1]}%` }} className={cell}>
          {row.marketName || row.client}
          {row.zone && <><br /><span>{t("Зона")}: {row.zone}</span></>}
        </div>
        <div style={{ width: `${COL_PCT[2]}%` }} className={`${cell} min-w-0`}>
          {row.type}
          <br />
          <strong className="block overflow-hidden text-ellipsis whitespace-nowrap font-semibold">{orderOrganization(row)}</strong>
        </div>
        <div style={{ width: `${COL_PCT[3]}%` }} className={cell}><span>{t(createdText(row))}</span></div>
        <div style={{ width: `${COL_PCT[4]}%` }} className={cell}>
          {delivererOf(row) || t("Не указано")}
          <br />
          <span className="text-[#1E4A9A]">{row.expeditor || t("Не указано")}</span>
          {row.transportNumber && <><br /><span className="text-[#1E4A9A]">{row.transportNumber}</span></>}
        </div>
        <div style={{ width: `${COL_PCT[5]}%` }} className={cell}>
          <span>{t(displayDay(row.delivery))}</span>
          {accepted && <><br /><span className="text-[#1E4A9A]">{accepted}</span></>}
        </div>
        <div style={{ width: `${COL_PCT[6]}%` }} className={cell}>
          {row.agent}
          <p className="text-[12px] font-medium leading-[15px] text-[#1E4A9A]"><span>{formatNumber(weight)} {t("кг.")}</span></p>
        </div>
        <div style={{ width: `${COL_PCT[7]}%` }} className={cell}>
          <span className="ml-[3px] inline-block">
            {groupedDigits(row.amount)}
            {returnPrice > 0 && <><br /><span className="text-[#e57373]">-{formatNumber(returnPrice)}</span></>}
          </span>
        </div>
        <div style={{ width: `${COL_PCT[8]}%` }} className={cell}>
          <span className={balanceClass}>{groupedDigits(row.balance) || "—"}</span>
        </div>
        <div style={{ width: `${COL_PCT[9]}%` }} className="relative flex items-center justify-start">
          <OrderStatusIcon status={row.status} />
          <PaymentIcon row={row} today={today} />
          {row.shipmentStatus === "filled" && <OrderIcon path={ICON.checkCircle} color="#2196f3" tip={t("Заполнено")} />}
          <OrderIcon
            path={ICON.receipt}
            color={row.invoiceActive ? "#5868f0" : "transparent"}
            tip={row.invoiceActive ? <><span className="block">{t("Номер счет фактура")}: {row.invoiceNumber || ""}</span><span className="block">{t("Дата счет фактура")}: {row.invoiceDate ? t(displayDay(row.invoiceDate)) : ""}</span></> : undefined}
          />
        </div>
      </div>
    </div>
  )
}

/** The row link keeps the list's current query (Linko's #/order/1592?pageSize=25&status=0-1-5). */
function withListQuery(event: { currentTarget: HTMLAnchorElement }) {
  const link = event.currentTarget
  link.href = link.pathname + window.location.search
}

/** Reference-style dark tooltip (react-tooltip look) shown on hover. */
function Tip({ text, side, raw = false, className = "", children }: { text: string; side: "left" | "right" | "bottom"; /** The reference leaves some hints in Russian in every language. */ raw?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      {text && <span
        role="tooltip"
        {...(raw ? { "data-no-translate": "" } : {})}
        className={`pointer-events-none absolute z-50 hidden whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-normal leading-[17px] text-white opacity-90 group-hover/tip:block ${side === "bottom" ? "left-1/2 top-full mt-[10px] -translate-x-1/2" : `top-1/2 -translate-y-1/2 ${side === "left" ? "right-full mr-[12px]" : "left-full ml-[5px]"}`}`}
      >
        {text}
      </span>}
    </span>
  )
}

function parseAmount(value: string) {
  const match = /^([\d\s\u00a0.,-]+)\s*([A-Za-z]+)/.exec(value.trim())
  if (!match) return null
  const number = Number(match[1].replace(/[\s\u00a0]/g, "").replace(",", "."))
  return Number.isFinite(number) ? { number, currency: match[2] } : null
}

/** "1 234 567 890,5 SUM" with no-break spaces between the digit groups, as Linko's numberFormat prints amounts: a long
 * amount wraps before its currency only. */
const groupedDigits = (value: string | undefined) => (value ?? "").replace(/(\d) (?=\d)/g, "$1\u00a0")

/** Order amounts spell euro "Euro" or "EUR": one key per currency in the band. */
const bandCurrency = (currency: string) => normCurrency(currency)

/** The order's deliverer, else the client's ("Ответственный доставщик"). */
/** What PATCH /api/orders/[id] takes: order fields, and «Сборщик» by name. */
type OrderPatch = Partial<Order> & { collector?: string }

/** An order as /api/orders sends it (payableRest: what the cash desk still accepts, lib/orders-repo.ts withLedgerDues). */
type ListedOrder = Order

/** The group payment's rest of an order: the server's payable rest; without the ledger figures,
 * its listed unpaid rest. A cancelled order takes no payment ("Заказ отменен"). */
function payableRestOf(row: ListedOrder): number {
  if (row.status === "Отменен") return 0
  if (row.payableRest !== undefined) return row.payableRest
  return Math.max(0, row.orderBalance ?? (row.totalPrice ?? 0) - (row.paidAmount ?? 0))
}

function delivererOf(row: Order): string {
  if (row.deliveryMan) return row.deliveryMan
  return row.clientDeliverer && row.clientDeliverer !== "Не указано" ? row.clientDeliverer : ""
}

const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** "20 окт. 15:31": the creation moment (created_at is stored in UTC) in local business time,
 * like the stored `created` text but recomputed, so callers can pass it through t() and the month
 * follows the UI language. Rows without created_at keep their stored text. */
export function createdText(row: Pick<Order, "created" | "createdAt">): string {
  const local = parseAnyDate(row.createdAt, true)
  if (!local || local.length < 16) return row.created
  return `${local.slice(8, 10)} ${SHORT_MONTHS[Number(local.slice(5, 7)) - 1] ?? ""} ${local.slice(11, 16)}`
}

/** "2026-10-21" → "21 окт. 2026"; other texts as they are. */
export function displayDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "")
  return match ? `${match[3]} ${SHORT_MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}` : value
}

/** The exact running sums behind each band map (AmountSum): float additions of a few hundred totals drift a unit in
 * the last decimal the band prints, the reference's server sum does not. */
const bandSums = new WeakMap<Map<string, number>, Map<string, AmountSum>>()

function addTotal(totals: Map<string, number>, currency: string, value: number) {
  if (!currency || !Number.isFinite(value)) return
  let sums = bandSums.get(totals)
  if (!sums) bandSums.set(totals, (sums = new Map()))
  const sum = sums.get(currency) ?? new AmountSum()
  sums.set(currency, sum.add(value))
  totals.set(currency, sum.value())
}

/** "1 234 SUM , 0 USD": one sum per currency of the orders (never added up across currencies, zeros shown as Linko
 * does), "0" when there is no order. */
function renderTotals(totals: Map<string, number>, plain = false) {
  // Linko's band order: SUM, Euro, USD; with ticked orders the amounts stand apart without the « , ».
  const shown = [...totals.entries()].sort(([a], [b]) => compareBandCurrencies(a, b))
  if (!shown.length) return <span>0</span>
  return shown.map(([currency, number], index, all) => (
    <span key={currency} className={index < all.length - 1 ? (plain ? "mr-[15px]" : "mr-[5px]") : ""}>
      {formatNumber(number)} {currency}{index < all.length - 1 && !plain ? " ," : ""}
    </span>
  ))
}
