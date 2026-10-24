"use client"

import { Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { compareText } from "@/components/ref/list-kit"

import { readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

import { AddOrderDialog } from "./add-order-dialog"
import { OrderDetailCard } from "./order-detail"
import { OrderGroupPayment } from "./order-group-payment"
import { EdoMenu, InvoiceNumberDialog, SERIES_STORAGE_KEY, SeriesDialog, useUrlParams } from "./orders-extra-dialogs"
import { BulkEditDialog, NoSelectionPopover, RowCheckbox, SelectedTotalsDialog, type BulkEditValues } from "./orders-selection"
import { EMPTY_ORDER_FILTERS, OrderFilterPanel, countOrderFilters, matchesOrderFilters, type OrderFilters } from "./order-filter-panel"
import { ORDER_STATUS_REF_LABEL, orderOrganization, type Order } from "./orders-data"

export function OrdersView({ initialOrderId }: { initialOrderId?: number } = {}) {
  const router = useRouter()
  const { t } = useLanguage()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selectMode, setSelectMode] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Order | null>(null)
  const [checkedIds, setCheckedIds] = useState<number[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
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
  const [seriesOpen, setSeriesOpen] = useState(false)
  const [invoiceNumOpen, setInvoiceNumOpen] = useState(false)
  const [edoOpen, setEdoOpen] = useState(false)
  const detailRowRef = useRef<HTMLDivElement>(null)
  const [statusTouched, setStatusTouched] = useState(false)
  const activeFilterCount = countOrderFilters(filters) + (onlyIds ? 1 : 0)
  const statusFilter = filters.select.status ?? []
  const tab = TAB_LABELS.find((label) => sameSet(TAB_STATUSES[label], statusFilter)) ?? null
  const badgeStatus = statusFilter.length === 1 && tab === null ? statusFilter[0] : null

  const filtered = useMemo(
    () =>
      orders
        .filter((row) => `${row.id} ${row.client} ${row.marketName ?? ""} ${row.agent}`.toLowerCase().includes(query.toLowerCase()))
        .filter((row) => matchesOrderFilters(row, filters))
        .filter((row) => !onlyIds || onlyIds.includes(row.id)),
    [orders, query, filters, onlyIds],
  )
  const [sort, setSort] = useState<{ head: string; desc: boolean } | null>(null)
  const sortedRows = useMemo(() => {
    if (!sort) return filtered
    const value = (row: Order): string => {
      switch (sort.head) {
        case "№": return String(row.id)
        case "Клиент": return row.client
        case "Тип": return row.type
        case "Дата создания": return row.created
        case "Дата доставки": return row.delivery
        case "Агент": return row.agent
        case "Сумма заказа": return row.amount
        case "Баланс": return row.balance
        case "Статус": return row.status
        default: return ""
      }
    }
    return [...filtered].sort((a, b) => (sort.desc ? -1 : 1) * compareText(value(a), value(b)))
  }, [filtered, sort])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageStart = (Math.min(page, pageCount) - 1) * pageSize
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize)
  const selectedRows = useMemo(() => orders.filter((row) => checkedIds.includes(row.id)), [orders, checkedIds])
  const selecting = selectedRows.length > 0
  const totals = useMemo(() => {
    const rows = selecting ? selectedRows : filtered
    return {
      // total_price is stored rounded to 2 decimals; fact + return carry the reference's full precision (they add up to its total).
      orders: sumByCurrency(rows, (row) => (row.factPrice !== undefined ? row.factPrice + (row.returnPrice ?? 0) : (row.totalPrice ?? parseAmount(row.amount)?.number ?? 0))),
      returns: sumByCurrency(rows, (row) => row.returnPrice ?? 0),
      fact: sumByCurrency(rows, (row) => row.factPrice ?? parseAmount(row.amount)?.number ?? 0),
    }
  }, [filtered, selectedRows, selecting])
  const unconfirmedCount = orders.filter((row) => row.status === "Не подтвержден").length
  const requestedCount = orders.filter((row) => row.status === "В процессе").length
  const readyCount = orders.filter((row) => row.status === "Есть на складе").length

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/orders")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить заказы")
        return (await response.json()) as Order[]
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

  // Opening an order pushes its URL, so the browser's Back button returns to the list.
  useEffect(() => {
    if (!selected) return
    const target = `/analytics/sales/${selected.id}`
    if (window.location.pathname !== target) window.history.pushState(null, "", target)
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

  // Esc collapses the expanded order unless one of its dialogs is open
  useEffect(() => {
    if (!selected) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("[data-order-overlay]")) return
      setSelected(null)
      window.history.replaceState(null, "", "/analytics/sales")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected])

  // Deep link from the client card: /analytics/sales?openOrderDialog=true&openShop=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ids = (params.get("select") ?? "").split("-").map(Number).filter((id) => Number.isFinite(id) && id > 0)
    const flag = (name: string) => params.get(name) === "true"
    const urlPage = Number(params.get("page"))
    if (Number.isFinite(urlPage) && urlPage > 1) setPage(urlPage)
    const urlPageSize = Number(params.get("pageSize"))
    if ([10, 25, 50, 100].includes(urlPageSize)) setPageSize(urlPageSize)
    // The reference's menu opens the list as ?status=0-1-5 (Активные), 2 (Доставляется), 3 (Доставленные) or empty (Все).
    const statusParam = params.get("status")
    if (statusParam !== null) {
      const byCode: Record<string, string[]> = { "0-1-5": TAB_STATUSES["Активные"], "2": TAB_STATUSES["Доставляется"], "3": TAB_STATUSES["Доставленные"], "": TAB_STATUSES["Все"] }
      const labels = byCode[statusParam] ?? []
      setFilters((current) => ({ ...current, select: { ...current.select, status: labels } }))
      setStatusTouched(true)
    }
    if (flag("showCheckboxes") || ids.length) setSelectMode(true)
    if (ids.length) setCheckedIds(ids)
    if (flag("openFilterDialog")) setFilterOpen(true)
    if (flag("openGroupPaymentDialog")) setBulkPayOpen(true)
    if (flag("openOrderSummaryDialog")) setTotalsOpen(true)
    // The bulk actions need ticked orders; without any the reference shows its "pick at least one order" popover.
    const bulk = (name: string, key: string, open: () => void) => {
      if (!flag(name)) return
      if (ids.length) open()
      else setNoSelection(key)
    }
    bulk("openMultiEdit", "edit", () => setBulkEditOpen(true))
    bulk("openExpirationDateDialog", "series", () => setSeriesOpen(true))
    bulk("openInvoiceNumberDialog", "invoice", () => setInvoiceNumOpen(true))
    if (flag("openOrderDialog") || flag("openCreateDialog")) {
      const shop = Number(params.get("openShop"))
      setInitialShopId(Number.isFinite(shop) && shop > 0 ? shop : undefined)
      setAddOpen(true)
    }
  }, [])

  useUrlParams(
    {
      status: statusTouched && tab ? { Активные: "0-1-5", Доставляется: "2", Доставленные: "3", Все: null }[tab] : null,
      showCheckboxes: selectMode ? "true" : null,
      select: checkedIds.length ? checkedIds.join("-") : null,
      openFilterDialog: filterOpen ? "true" : null,
      openGroupPaymentDialog: bulkPayOpen ? "true" : null,
      openOrderSummaryDialog: totalsOpen ? "true" : null,
      openMultiEdit: bulkEditOpen || noSelection === "edit" ? "true" : null,
      openExpirationDateDialog: seriesOpen || noSelection === "series" ? "true" : null,
      openInvoiceNumberDialog: invoiceNumOpen || noSelection === "invoice" ? "true" : null,
      openCreateDialog: addOpen ? "true" : null,
      page: page > 1 ? String(page) : null,
      pageSize: pageSize !== 25 ? String(pageSize) : null,
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
      setOrders((await response.json()) as Order[])
      flash(t("Данные обновлены"))
    } catch {
      flash(t("Не удалось загрузить заказы с сервера"))
    }
  }

  function exportCsv() {
    const rows = checkedIds.length ? filtered.filter((row) => checkedIds.includes(row.id)) : filtered
    const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
    const csv = [["№", "Клиент", "Тип", "Дата создания", "Дата доставки", "Агент", "Сумма заказа", "Баланс", "Статус"].join(";")]
      .concat(rows.map((row) => [row.id, row.client, row.type, row.created, row.delivery, row.agent, row.amount, row.balance, row.status].map(cell).join(";")))
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
    const patchFor = (row: Order): Partial<Order> => {
      const patch: Partial<Order> = {}
      if (values.created) {
        patch.created = formatCreated(values.created, row.created)
        patch.createdAt = `${values.created} ${(row.createdAt ?? "").slice(11) || "00:00:00"}`
      }
      if (values.delivery) patch.delivery = formatIsoDate(values.delivery)
      if (values.paid) {
        patch.paymentDate = values.paid
        patch.dueDate = values.paid
      }
      if (values.realization) {
        const delivery = values.delivery ? values.delivery : parseRuDate(row.delivery)
        if (delivery) patch.acceptedDate = delivery
      }
      if (values.deliverer) patch.deliveryMan = values.deliverer
      if (values.expeditor) patch.expeditor = values.expeditor
      if (values.agent) patch.agent = values.agent
      if (values.warehouse) patch.stockName = values.warehouse
      if (values.transport) patch.transportNumber = values.transport
      if (values.dealType) patch.dealType = values.dealType === "Консигнация" ? "1" : "0"
      if (values.payStatus) {
        const total = row.totalPrice ?? 0
        patch.paidAmount = values.payStatus === "Оплачен" ? total : 0
        patch.orderBalance = values.payStatus === "Оплачен" ? 0 : total
      }
      if (values.status) {
        const label = values.status === "Не подтвержденный" ? "Не подтвержден" : values.status
        patch.status = Object.entries(ORDER_STATUS_REF_LABEL).find(([, refLabel]) => refLabel === label)?.[0] ?? row.status
      }
      return patch
    }
    setBulkEditOpen(false)
    await Promise.all(
      ids.map((id) => {
        const row = orders.find((item) => item.id === id)
        const patch = row ? patchFor(row) : {}
        return Object.keys(patch).length ? updateOrder(id, patch) : Promise.resolve()
      }),
    )
    if (showAfter) setOnlyIds(ids)
    flash(`${ids.length} ${t("заказ(ов) изменено")}`)
  }

  function flash(text: string) {
    setNotice(text)
    window.setTimeout(() => setNotice(""), 2200)
  }

  function toggleChecked(id: number) {
    setCheckedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function passToDelivery() {
    const ids = [...checkedIds]
    setOrders((current) => current.map((row) => (ids.includes(row.id) ? { ...row, status: "В пути" } : row)))
    setCheckedIds([])
    flash(`${ids.length} ${t("заказ(ов) передано в доставку")}`)
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/orders/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "В пути" }),
          }),
        ),
      )
    } catch {
      flash(t("Не удалось сохранить часть изменений на сервере"))
    }
  }

  async function updateOrder(id: number, patch: Partial<Order>) {
    setOrders((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
    setSelected((current) => (current && current.id === id ? { ...current, ...patch } : current))
    try {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error("update failed")
      const updated = (await response.json()) as Order
      setOrders((current) => current.map((row) => (row.id === id ? updated : row)))
      setSelected((current) => (current && current.id === id ? updated : current))
    } catch {
      flash(t("Не удалось сохранить изменения на сервере"))
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
      const parsed = rows
        .filter(([client]) => client && !/^(клиент|client)$/i.test(client))
        .map(([client, amount]) => ({ client, amount: amount || "0 SUM" }))
      if (!parsed.length) return
      try {
        const created = await Promise.all(
          parsed.map((row) =>
            fetch("/api/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(row),
            }).then((response) => response.json() as Promise<Order>),
          ),
        )
        setOrders((current) => [...created, ...current])
        flash(`${t("Импортировано заказов:")} ${created.length}`)
      } catch {
        flash(t("Не удалось импортировать заказы"))
      }
    })()
  }

  const setStatusFilter = (labels: string[]) => {
    setFilters((current) => ({ ...current, select: { ...current.select, status: labels } }))
    setPage(1)
  }

  async function markDelivered() {
    const ids = [...checkedIds]
    setOrders((current) => current.map((row) => (ids.includes(row.id) ? { ...row, status: "Доставлено" } : row)))
    setCheckedIds([])
    flash(`${ids.length} ${t("заказ(ов) отмечено доставленными")}`)
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/orders/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "Доставлено" }),
          }),
        ),
      )
    } catch {
      flash(t("Не удалось сохранить часть изменений на сервере"))
    }
  }

  const bulkAction =
    tab === "Активные"
      ? { label: t("Передать"), path: ICON.truck, onClick: passToDelivery }
      : tab === "Доставляется"
        ? { label: t("Доставлен"), path: ICON.clipboard, onClick: markDelivered }
        : null

  const actionDefs = {
    select: { key: "select", path: selectMode ? ICON.visibilityOff : ICON.checklist, title: t("Выбрать из списка"), color: "#5d6474", onClick: () => setSelectMode((value) => !value) },
    sync: { key: "sync", path: ICON.sync, title: t("Обновить список"), color: "#5d6474", onClick: reloadOrders },
    print: { key: "print", path: ICON.print, title: t("Распечатать выбранное"), color: "#666", onClick: () => requireSelection("print", () => window.print()) },
    download: { key: "download", path: ICON.download, title: t("Скачать"), color: "#666", onClick: exportCsv },
    edit: { key: "edit", path: ICON.edit, title: t("Изменить выбранные заказы"), color: "#666", onClick: () => requireSelection("edit", () => setBulkEditOpen(true)) },
    series: { key: "series", path: ICON.history, title: t("Авто распределение по сериям"), color: "#666", onClick: () => requireSelection("series", () => setSeriesOpen(true)) },
    invoice: { key: "invoice", path: ICON.textA, title: t("Нумерация счет фактуры"), color: "#666", onClick: () => requireSelection("invoice", () => setInvoiceNumOpen(true)) },
    edo: { key: "edo", path: ICON.send, title: t("Отправить EDO"), color: "#666", onClick: () => requireSelection("edo", () => setEdoOpen((value) => !value)) },
    more: { key: "more", path: ICON.more, title: "", color: "#5d6474", onClick: () => setMoreOpen((value) => !value) },
    clear: { key: "clear", path: ICON.minusBox, title: t("Снять выделение"), color: "#333", onClick: () => { setCheckedIds([]); setMoreOpen(false) } },
  }
  const toolbarActions = selecting
    ? [actionDefs.sync, actionDefs.print, actionDefs.download, actionDefs.edit, actionDefs.series, actionDefs.invoice, actionDefs.edo, actionDefs.more, actionDefs.clear]
    : [actionDefs.select, actionDefs.sync, actionDefs.print, actionDefs.download, actionDefs.edit, actionDefs.series, actionDefs.invoice, actionDefs.edo]

  return (
    <main className="min-h-screen bg-[#f2f5f8] px-7 pb-7 font-sans text-[13px] text-[#333]">
      <div className="flex h-[60px] items-center justify-between">
        <div className="flex items-center">
          <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
            <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
            {t("Заказы")}
          </h1>
          <div className="ml-[5px] flex items-center">
            {[
              { path: ICON.warning, count: unconfirmedCount, status: "Не подтвержден", tip: t("Отфильтровать неподтвержденным заказам") },
              { path: ICON.clock, count: requestedCount, status: "В процессе", tip: t("Отфильтровать по запрошенным заказам") },
              { path: ICON.store, count: readyCount, status: "Есть на складе", tip: t("Отфильтровать по доступным заказам") },
            ].map((badge) => {
              const active = badgeStatus === ORDER_STATUS_REF_LABEL[badge.status]
              return (
                <Tip key={badge.status} text={badge.tip} side="right">
                  <button
                    type="button"
                    onClick={() => setStatusFilter([ORDER_STATUS_REF_LABEL[badge.status]])}
                    className="relative flex h-12 w-[58px] items-center justify-center"
                  >
                    <svg viewBox="0 0 24 24" className={`h-6 w-6 ${active ? "fill-[#71ce87]" : "fill-[#5d6474]"}`}><path d={badge.path} /></svg>
                    {active ? (
                      <span className="absolute left-[42px] top-[4px] flex h-[18px] w-[18px] items-center justify-center rounded-full border border-white bg-[#71ce87]">
                        <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-white"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" /></svg>
                      </span>
                    ) : (
                      <span className="absolute left-[42px] top-[4px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-white bg-[#e57373] px-[3px] text-[9px] font-semibold text-white">{badge.count}</span>
                    )}
                  </button>
                </Tip>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-[10px]">
          <TopButton icon={ICON.map} text={t("Показать на карте")} onClick={() => router.push("/clients/territory?openFilterDialog=true")} />
          <TopButton icon={ICON.card} text={t("Групповая оплата")} onClick={() => setBulkPayOpen(true)} />
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
            <button key={label} type="button" onClick={() => { setStatusFilter(TAB_STATUSES[label]); setStatusTouched(true) }} className="h-10 w-1/4 text-[13px] font-medium text-black">
              {t(label)}
            </button>
          ))}
          {tab && (
            <span
              className="absolute -bottom-[2px] left-0 h-[3px] w-1/4 bg-[#4f71dc] shadow-[0_-3px_10px_0_#5869f0] transition-transform duration-300"
              style={{ transform: `translateX(${TAB_LABELS.indexOf(tab) * 100}%)` }}
            />
          )}
        </div>
        <div className={`mt-px flex justify-between border-b border-[#efefef] pb-[2px] pl-[5px] pr-[33px] pt-[8px] text-[13px] font-semibold leading-[20.3px] text-white ${selecting ? "bg-[#008000]" : "bg-[#5869f0]"}`}>
          {[
            { label: t("Заказы"), value: totals.orders },
            { label: t("Возвраты"), value: totals.returns },
            { label: t("Факт"), value: totals.fact },
          ].map((group) => (
            <div key={group.label}>
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
              onChange={(next) => { setFilters(next); setPage(1) }}
              onApply={() => setFilterOpen(false)}
              onClose={() => setFilterOpen(false)}
            />
          )}
          <div className={`h-[50px] items-center pr-[5px] ${filterOpen ? "hidden" : "flex"}`}>
            {selecting ? (
              <div className="w-[347px] shrink-0 pl-[5px] text-[13px] font-bold text-[#333]">{t("Выбрано:")} {selectedRows.length}</div>
            ) : (
              <div className="w-[347px] shrink-0">
                {activeFilterCount > 0 ? (
                  <div className="relative mt-px flex h-[48.25px] w-[346.5px] items-center bg-[#efefef] pl-[30px] text-[13px] text-[#666]">
                    <span>{t("Фильтр:")} {activeFilterCount} {t("элемента")}</span>
                    <button type="button" onClick={() => setFilterOpen(true)} aria-label={t("Изменить фильтр")} className="relative ml-auto flex h-[48.25px] w-[48px] items-center justify-center rounded-l-[4px] border-l border-[#e6e6e6]">
                      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8f8f8f]"><path d="M17.75 7L14 3.25l-10 10V17h3.75l10-10zm2.96-2.96c.39-.39.39-1.02 0-1.41L18.37.29c-.39-.39-1.02-.39-1.41 0L15 2.25 18.75 6l1.96-1.96z" /></svg>
                      <span className="absolute bottom-[10px] h-[4px] w-[24px] bg-[#c8c8c8]" />
                    </button>
                    <button type="button" onClick={() => { setFilters(EMPTY_ORDER_FILTERS); setOnlyIds(null); setPage(1) }} aria-label={t("Очистить фильтр")} className="flex h-[48.25px] w-[48px] items-center justify-center rounded-l-[4px] border-l border-[#e6e6e6]"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8f8f8f]"><path d={ICON.clear} /></svg></button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setFilterOpen((value) => !value)}
                    className="ml-[5px] flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white"
                  >
                    <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white"><path d={ICON.filter} /></svg>
                    <span className="pl-2 pr-4">{filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")}</span>
                  </button>
                )}
              </div>
            )}
            {!selecting && (
              <div className="relative ml-[30px] flex w-[265px] items-center">
                <input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setPage(1) }}
                  placeholder={t("Поиск")}
                  className="h-12 w-full border-b border-[#e0e0e0] bg-transparent text-[13px] outline-none placeholder:text-black/30 focus:border-[#5d6474]"
                />
                <Search className="absolute -right-[33px] h-6 w-6 text-[#ccc]" />
              </div>
            )}
            <div className="ml-auto flex items-center text-[#5d6474]">
              <div className="relative mr-[27px]">
                <select
                  value={pageSize}
                  onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}
                  className="h-12 w-[56px] appearance-none border-b pl-[16px] border-[#e0e0e0] bg-transparent text-[13px] text-[#333] outline-none"
                >
                  {[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}
                </select>
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-3 h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
              </div>
              <span className="relative top-[1.5px] mr-[5px]">{pageStart + 1 > filtered.length ? 0 : pageStart + 1} - {Math.min(pageStart + pageSize, filtered.length)}  {t("из")}  {filtered.length}</span>
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="prev" className="px-[5px] disabled:opacity-100">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
              </button>
              <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)} aria-label="next">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page >= pageCount ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-12l5 4-5 4V8z" /></svg>
              </button>
              {toolbarActions.map((action, index) => (
                <Tip key={action.key} text={action.title} side="left" className={index === 0 ? "ml-5" : ""}>
                  <button type="button" aria-label={action.title} onClick={action.onClick} className="flex h-12 w-12 items-center justify-center">
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
              {bulkAction && (
                <span className="relative flex">
                  <button type="button" onClick={() => requireSelection("bulk", bulkAction.onClick)} className="relative flex h-[30px] w-[105.5px] items-center justify-center rounded-[5px] bg-[#71ce87] pl-[12px] hover:brightness-95">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d={bulkAction.path} /></svg>
                    <span className="pointer-events-none absolute left-[10px] top-[36px] whitespace-nowrap text-[13px] font-semibold text-white">{bulkAction.label}</span>
                  </button>
                  {noSelection === "bulk" && <NoSelectionPopover onClose={() => setNoSelection(null)} />}
                </span>
              )}
            </div>
          </div>

          <div className="overflow-x-auto min-[1130px]:overflow-visible">
            <div className="min-w-[1100px]">
              <div className={`sticky top-[50px] z-20 h-[50px] items-center bg-[#5d6474] px-[30px] font-semibold text-white ${filterOpen ? "hidden" : "flex"}`}>
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
                    <button type="button" onClick={() => setSort((current) => (current?.head === head ? (current.desc ? null : { head, desc: true }) : { head, desc: false }))} className={`text-left font-semibold hover:opacity-80 ${index === 0 || index === COL_PCT.length - 1 ? "" : "pr-[30px]"}`}>
                      {t(head)}
                      {sort?.head === head ? <span className="ml-1 text-[10px]">{sort.desc ? "▼" : "▲"}</span> : null}
                    </button>
                  </div>
                ))}
              </div>
              {loading ? (
                <div className="px-4 py-16 text-center text-slate-500">{t("Загрузка заказов...")}</div>
              ) : loadError ? (
                <div className="px-4 py-16 text-center text-red-600">{loadError}</div>
              ) : pageRows.length === 0 ? (
                <div className="px-4 py-16 text-center text-slate-500">{t("Ничего не найдено")}</div>
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
                      selectMode={selectMode}
                      checked={checkedIds.includes(row.id)}
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
      {seriesOpen && (
        <SeriesDialog
          onClose={() => setSeriesOpen(false)}
          onSave={(mode) => {
            try {
              window.localStorage.setItem(SERIES_STORAGE_KEY, mode)
            } catch {}
            setSeriesOpen(false)
            flash(t("Сохранено"))
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
        (selecting ? (
          <OrderGroupPayment
            orders={selectedRows}
            onClose={() => setBulkPayOpen(false)}
            onSaved={(count) => {
              flash(`${t("Оплата принята по")} ${count}`)
              setBulkPayOpen(false)
              setCheckedIds([])
              void reloadOrders()
            }}
          />
        ) : (
          <div data-order-overlay className="fixed inset-0 z-[1200] overflow-y-auto bg-white">
            <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[15px]">
              <h3 className="text-[13px] font-bold uppercase text-[#333]">{t("Групповая оплата")}</h3>
              <button type="button" onClick={() => setBulkPayOpen(false)} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center"><X className="h-6 w-6 text-[#333]" /></button>
            </div>
            <p className="mt-[137px] text-center text-[18px] font-semibold text-[#333]">{t("Выберите хотя бы один заказ !")}</p>
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
        <button type="button" aria-label="close" onClick={onClose} className="absolute right-[15px] top-[5.5px] flex h-12 w-12 items-center justify-center">
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
const TAB_STATUSES: Record<(typeof TAB_LABELS)[number], string[]> = {
  "Активные": ["В процессе", "Есть на складе", "Не подтвержден"],
  "Доставляется": ["Передан доставщику"],
  "Доставленные": ["Доставлен"],
  "Все": [],
}
const HEADS = ["№", "Клиент", "Тип", "Дата создания", "Доставщик", "Дата доставки", "Агент", "Сумма заказа", "Баланс", "Статус"]
/** Column widths (%) of the reference list: every cell is padded 0.5rem, the last one is centred. */
const COL_PCT = [7, 16, 14, 10, 12, 8, 8, 10, 9, 6]

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((item) => b.includes(item))
}

const ICON = {
  warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  store: "M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z",
  map: "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z",
  card: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  chart: "M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z",
  add: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
  filter: "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z",
  checklist: "M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z",
  sync: "M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z",
  print: "M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z",
  download: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  history: "M11 17c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1-1 .45-1 1zm0-14v4h2V5.08c3.39.49 6 3.39 6 6.92 0 3.87-3.13 7-7 7s-7-3.13-7-7c0-1.68.59-3.22 1.58-4.42L12 13l1.41-1.41-6.8-6.8v.02C4.42 6.45 3 9.05 3 12c0 4.97 4.02 9 9 9 4.97 0 9-4.03 9-9s-4.03-9-9-9h-1zm7 9c0-.55-.45-1-1-1s-1 .45-1 1 .45 1 1 1 1-.45 1-1zM6 12c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1-1 .45-1 1z",
  textA: "M5 17v2h14v-2H5zm4.5-4.2h5l.9 2.2h2.1L12.75 4h-1.5L6.5 15h2.1l.9-2.2zM12 5.98L13.87 11h-3.74L12 5.98z",
  send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  clipboard: "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z",
  truck: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
  visibilityOff: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
  selectAll: "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  minusBox: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z",
  clear: "M14.59 8L12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
  cash: "M11 17h2v-1h1c.55 0 1-.45 1-1v-3c0-.55-.45-1-1-1h-3v-1h4V8h-2V7h-2v1h-1c-.55 0-1 .45-1 1v3c0 .55.45 1 1 1h3v1H9v2h2v1zm9-13H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4V6h16v12z",
  bank: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z",
  checkCircle: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  receipt: "M18 17H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V7h12v2zM3 22l1.5-1.5L6 22l1.5-1.5L9 22l1.5-1.5L12 22l1.5-1.5L15 22l1.5-1.5L18 22l1.5-1.5L21 22V2l-1.5 1.5L18 2l-1.5 1.5L15 2l-1.5 1.5L12 2l-1.5 1.5L9 2 7.5 3.5 6 2 4.5 3.5 3 2v20z",
  ban: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z",
}

function TopButton({ icon, text, onClick, green }: { icon: string; text: string; onClick: () => void; green?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex h-[30px] items-center rounded-[5px] pl-3 text-[13px] font-semibold text-white hover:brightness-95 ${green ? "bg-[#71ce87]" : "bg-[#4f71dc]"}`}>
      <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white"><path d={icon} /></svg>
      <span className="pl-2 pr-4">{text}</span>
    </button>
  )
}

const STATUS_ICON: Record<string, { path: string; color: string }> = {
  "Доставлено": { path: ICON.clipboard, color: "#81c784" },
  "Есть на складе": { path: ICON.store, color: "#f0ad4e" },
  "В пути": { path: ICON.truck, color: "#f0ad4e" },
  "В процессе": { path: ICON.clock, color: "#f0ad4e" },
  "Отменен": { path: ICON.ban, color: "#e57373" },
  "Не подтвержден": { path: ICON.warning, color: "#999999" },
}

const RU_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** "2026-05-09" -> "09 мая 2026" (the format of the delivery-date column). */
/** "08 сент. 2026" -> "2026-09-08" (empty when the label carries no year). */
function parseRuDate(label: string) {
  const match = label.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})/)
  const month = match ? RU_MONTHS.indexOf(match[2]) : -1
  return match && month >= 0 ? `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}` : ""
}

function formatIsoDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return match ? `${match[3]} ${RU_MONTHS[Number(match[2]) - 1]} ${match[1]}` : ""
}

/** Re-dates "07 сент. 20:03" / "09 янв. 2025 15:25" keeping the time of day. */
function formatCreated(iso: string, previous: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return previous
  const time = /(\d{1,2}:\d{2})\s*$/.exec(previous)?.[1] ?? "00:00"
  const year = match[1] === String(new Date().getFullYear()) ? "" : `${match[1]} `
  return `${match[3]} ${RU_MONTHS[Number(match[2]) - 1]} ${year}${time}`
}

const formatNumber = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })

/** The list always shows the client balance in SUM, whatever the order currency is. */
function balanceInSum(balance: string) {
  const parsed = parseAmount(balance)
  return parsed ? { number: parsed.number, text: `${formatNumber(parsed.number)} SUM` } : { number: 0, text: balance }
}

function IconButton({ path, color }: { path: string; color: string }) {
  return (
    <span className="inline-flex h-[30px] w-[30px] items-center justify-center p-[5px]">
      <svg viewBox="0 0 24 24" className="h-5 w-5" style={{ fill: color }}><path d={path} /></svg>
    </span>
  )
}

function OrderRow({ row, selectMode, checked, onToggle, onOpen }: { row: Order; selectMode: boolean; checked: boolean; onToggle: () => void; onOpen: () => void }) {
  const { t } = useLanguage()
  const status = STATUS_ICON[row.status] ?? { path: ICON.warning, color: "#757575" }
  const balance = balanceInSum(row.balance)
  const accepted = row.acceptedDate && formatIsoDate(row.acceptedDate) !== row.delivery ? formatIsoDate(row.acceptedDate) : ""
  const returnPrice = row.returnPrice ?? 0
  const unpaid = (row.orderBalance ?? 0) > 0
  const payIcon = row.payMethod === "bank" ? ICON.bank : ICON.cash
  const weight = row.weight ?? 0
  const cell = "px-2 leading-[16.25px]"
  return (
    <div className="relative bg-white px-[30px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-dotted after:border-[#d6d6d6]">
      {(row.discountPercent ?? 0) > 0 && (
        <div className="pointer-events-none absolute right-[-23px] top-[-18px] z-[1] mx-[5px] inline-block h-[60px] w-[60px] rotate-[-90deg] scale-[0.4] border-[30px] border-solid border-[#e57373] border-l-transparent border-t-transparent text-white">
          <p className="ml-[10px] mt-[-17px] rotate-90 text-[28px] font-semibold">%</p>
        </div>
      )}
      <div onClick={onOpen} className={`-mx-[30px] flex min-h-[50px] cursor-pointer items-center px-[30px] py-[7px] hover:bg-[#f2f5f8] ${checked ? "bg-[#f2f5f8]" : ""}`}>
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
        <div style={{ width: `${COL_PCT[3]}%` }} className={cell}>{row.created}</div>
        <div style={{ width: `${COL_PCT[4]}%` }} className={cell}>
          {row.deliveryMan || "Admin Ritm"}
          <br />
          <span className="text-[#4f71dc]">{row.expeditor || t("Не указано")}</span>
          {row.transportNumber && <><br /><span className="text-[#4f71dc]">{row.transportNumber}</span></>}
        </div>
        <div style={{ width: `${COL_PCT[5]}%` }} className={cell}>
          <span>{row.delivery}</span>
          {accepted && <><br /><span className="text-[#4f71dc]">{accepted}</span></>}
        </div>
        <div style={{ width: `${COL_PCT[6]}%` }} className={cell}>
          {row.agent}
          <p className="text-[12px] font-medium leading-[15px] text-[#4f71dc]">{formatNumber(weight)} {t("кг.")}</p>
        </div>
        <div style={{ width: `${COL_PCT[7]}%` }} className={cell}>
          <span className="ml-[3px] inline-block">
            {row.amount}
            {returnPrice > 0 && <><br /><span className="text-[#e57373]">-{formatNumber(returnPrice)}</span></>}
          </span>
        </div>
        <div style={{ width: `${COL_PCT[8]}%` }} className={cell}>
          <span className={balance.number > 0 ? "font-semibold text-[#48a34b]" : balance.number < 0 ? "font-semibold text-[#e27676]" : "text-black"}>{balance.text}</span>
        </div>
        <div style={{ width: `${COL_PCT[9]}%` }} className="flex items-center justify-start">
          <IconButton path={status.path} color={status.color} />
          <IconButton path={payIcon} color={unpaid ? "#e57373" : "#81c784"} />
          {row.invoiceActive && <IconButton path={ICON.checkCircle} color="#2196f3" />}
          <IconButton path={ICON.receipt} color={row.invoiceActive ? "#5868f0" : "transparent"} />
        </div>
      </div>
    </div>
  )
}

/** Reference-style dark tooltip (react-tooltip look) shown on hover. */
function Tip({ text, side, className = "", children }: { text: string; side: "left" | "right"; className?: string; children: React.ReactNode }) {
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      {text && <span
        className={`pointer-events-none absolute top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-normal leading-[17px] text-white opacity-90 group-hover/tip:block ${side === "left" ? "right-full mr-[12px]" : "left-full ml-[5px]"}`}
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

const CURRENCY_ORDER = ["SUM", "Euro", "USD"]

function sumByCurrency(rows: Order[], pick: (row: Order) => number) {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const currency = parseAmount(row.amount)?.currency
    if (currency) totals.set(currency, (totals.get(currency) ?? 0) + pick(row))
  }
  const shown = [...totals.entries()].sort(([a], [b]) => CURRENCY_ORDER.indexOf(a) - CURRENCY_ORDER.indexOf(b))
  if (!shown.length) shown.push(["SUM", 0])
  return shown.map(([currency, number], index, all) => (
    <span key={currency} className={index < all.length - 1 ? "mr-[5px]" : ""}>
      {formatNumber(number)} {currency}{index < all.length - 1 ? " ," : ""}
    </span>
  ))
}
