"use client"

import { Search, X } from "lucide-react"
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { compareText } from "@/components/ref/list-kit"

import { readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

import { AddOrderDialog } from "./add-order-dialog"
import { OrderDetailCard } from "./order-detail"
import { EMPTY_ORDER_FILTERS, OrderFilterPanel, countOrderFilters, matchesOrderFilters, type OrderFilters } from "./order-filter-panel"
import type { Order } from "./orders-data"

export function OrdersView() {
  const router = useRouter()
  const { t } = useLanguage()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState<string>("Активные")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selectMode, setSelectMode] = useState(true)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Order | null>(null)
  const [checkedIds, setCheckedIds] = useState<number[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [chipOn, setChipOn] = useState(true)
  const [filters, setFilters] = useState<OrderFilters>(EMPTY_ORDER_FILTERS)
  const [notice, setNotice] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [initialShopId, setInitialShopId] = useState<number | undefined>()
  const [bulkPayOpen, setBulkPayOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const detailRowRef = useRef<HTMLDivElement>(null)
  const activeFilterCount = countOrderFilters(filters)

  const filtered = useMemo(
    () =>
      orders
        .filter((row) => `${row.id} ${row.client} ${row.agent}`.toLowerCase().includes(query.toLowerCase()))
        .filter((row) => matchesOrderFilters(row, filters))
        .filter((row) =>
          tab === "Активные"
            ? row.status !== "Доставлено" && row.status !== "Отменен" && row.status !== "В пути"
            : tab === "Доставляется"
              ? row.status === "В пути"
              : tab === "Доставленные"
                ? row.status === "Доставлено"
                : true,
        ),
    [orders, query, filters, tab],
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
  const totals = useMemo(
    () => ({
      orders: sumByCurrency(filtered),
      returns: sumByCurrency([]),
      fact: sumByCurrency(filtered),
    }),
    [filtered],
  )
  const alertCount = orders.filter((row) => row.negative).length
  const transitCount = orders.filter((row) => row.status === "В пути").length
  const stockCount = orders.filter((row) => row.status === "Есть на складе").length

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

  // Deep link to an expanded order: /analytics/sales?order=<id>
  useEffect(() => {
    if (loading || selected) return
    const id = Number(new URLSearchParams(window.location.search).get("order"))
    if (!Number.isFinite(id) || id <= 0) return
    const match = orders.find((row) => row.id === id)
    if (match) setSelected(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, orders])

  useEffect(() => {
    if (!selected) return
    const url = new URL(window.location.href)
    url.searchParams.set("order", String(selected.id))
    window.history.replaceState(null, "", url)
    detailRowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [selected?.id])

  // Esc collapses the expanded order unless one of its dialogs is open
  useEffect(() => {
    if (!selected) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("[data-order-overlay]")) return
      setSelected(null)
      const url = new URL(window.location.href)
      url.searchParams.delete("order")
      window.history.replaceState(null, "", url)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected])

  // Deep link from the client card: /analytics/sales?openOrderDialog=true&openShop=<id>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("openOrderDialog") !== "true") return
    const shop = Number(params.get("openShop"))
    setInitialShopId(Number.isFinite(shop) && shop > 0 ? shop : undefined)
    setAddOpen(true)
  }, [])

  function closeAddDialog() {
    setAddOpen(false)
    setInitialShopId(undefined)
    if (window.location.search) router.replace("/analytics/sales")
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

  function editChecked() {
    const target = orders.find((row) => row.id === checkedIds[0])
    if (!target) {
      setSelectMode(true)
      flash(t("Выберите заказ для изменения"))
      return
    }
    setSelected(target)
  }

  function flash(text: string) {
    setNotice(text)
    window.setTimeout(() => setNotice(""), 2200)
  }

  function toggleChecked(id: number) {
    setCheckedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function passToDelivery() {
    if (!checkedIds.length) {
      flash(t("Выберите заказы для передачи"))
      return
    }
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

  function importFromExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
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

  return (
    <main className="min-h-screen bg-[#f2f5f8] px-7 pb-7 font-sans text-[13px] text-[#333]">
      <div className="flex h-[60px] items-center justify-between">
        <div className="flex items-center">
          <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
            <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
            {t("Заказы")}
          </h1>
          <div className="ml-[22px] flex items-center">
            {[
              { path: ICON.warning, count: alertCount },
              { path: ICON.clock, count: transitCount },
              { path: ICON.store, count: stockCount },
            ].map((badge, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setTab(index === 0 ? "Все" : index === 1 ? "Доставляется" : "Активные")}
                className="relative flex h-12 w-12 items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={badge.path} /></svg>
                <span className="absolute left-[26px] top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-white bg-[#e57373] px-[3px] text-[9px] font-semibold text-white">{badge.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-[10px]">
          <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={importFromExcel} className="hidden" />
          <TopButton icon={ICON.map} text={t("Показать на карте")} onClick={() => router.push("/tracking")} />
          <TopButton icon={ICON.card} text={t("Групповая оплата")} onClick={() => setBulkPayOpen(true)} />
          <TopButton icon={ICON.chart} text={t("Импортировать")} onClick={() => importInputRef.current?.click()} />
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
            <button key={label} type="button" onClick={() => { setTab(label); setPage(1) }} className="h-10 w-1/4 text-[13px] font-medium text-black">
              {t(label)}
            </button>
          ))}
          <span
            className="absolute -bottom-[2px] left-0 h-[3px] w-1/4 bg-[#4f71dc] shadow-[0_-3px_10px_0_#5869f0] transition-transform duration-300"
            style={{ transform: `translateX(${TAB_LABELS.indexOf(tab as (typeof TAB_LABELS)[number]) * 100}%)` }}
          />
        </div>
        <div className="flex justify-between border-b border-[#efefef] bg-[#5869f0] p-[5px] text-[13px] font-semibold text-white">
          {[
            { label: t("Заказы"), value: totals.orders },
            { label: t("Возвраты"), value: totals.returns },
            { label: t("Факт"), value: totals.fact },
          ].map((group, index) => (
            <div key={group.label} className={`flex-1 pt-1 ${index === 1 ? "text-center" : index === 2 ? "text-right" : ""}`}>
              <span className="mr-[5px]">{group.label}:</span>
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
          <div className={`h-[50px] items-center px-[5px] ${filterOpen ? "hidden" : "flex"}`}>
            <div className="w-[318px] shrink-0">
            {chipOn && activeFilterCount === 0 ? (
              <div className="relative flex h-[40px] w-[255px] items-center bg-[#f2f5f8] pl-[12px] text-[13px] text-[#5d6474]">
                <span>{t("Фильтр: 1 элемента")}</span>
                <button type="button" onClick={() => setFilterOpen(true)} aria-label={t("Изменить фильтр")} className="ml-auto flex h-[40px] w-[40px] items-center justify-center"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]"><path d={ICON.edit ?? "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"} /></svg></button>
                <button type="button" onClick={() => setChipOn(false)} aria-label={t("Очистить фильтр")} className="flex h-[40px] w-[40px] items-center justify-center text-[#5d6474]">⊗</button>
              </div>
            ) : (
            <button
              type="button"
              onClick={() => setFilterOpen((value) => !value)}
              className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white"
            >
              <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white"><path d={ICON.filter} /></svg>
              <span className="pl-2 pr-4">{filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")}</span>
              {activeFilterCount > 0 && (
                <span className="mr-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] text-[#4f71dc]">{activeFilterCount}</span>
              )}
            </button>
            )}
            </div>
            <div className="relative ml-[18px] flex w-[248px] items-center">
              <input
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(1) }}
                placeholder={t("Поиск")}
                className="h-12 w-full border-b border-[#e0e0e0] bg-transparent text-[13px] outline-none placeholder:text-black/30 focus:border-[#5d6474]"
              />
              <Search className="absolute -right-[38px] h-6 w-6 text-[#ccc]" />
            </div>
            <div className="ml-auto flex items-center text-[#5d6474]">
              <div className="relative mr-[15px]">
                <select
                  value={pageSize}
                  onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}
                  className="h-12 w-[52px] appearance-none border-b border-[#e0e0e0] bg-transparent text-[13px] text-[#333] outline-none"
                >
                  {[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}
                </select>
                <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-3 h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
              </div>
              <span className="mr-2">{pageStart + 1 > filtered.length ? 0 : pageStart + 1} - {Math.min(pageStart + pageSize, filtered.length)}  {t("из")}  {filtered.length}</span>
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} aria-label="prev" className="px-[5px] disabled:opacity-100">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
              </button>
              <button type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)} aria-label="next">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page >= pageCount ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
              </button>
              {[
                { path: ICON.checklist, title: t("Выбрать"), color: "#5d6474", onClick: () => setSelectMode((value) => !value) },
                { path: ICON.sync, title: t("Обновить"), color: "#5d6474", onClick: reloadOrders },
                { path: ICON.print, title: t("Распечатать"), color: "#666", onClick: () => window.print() },
                { path: ICON.download, title: t("Экспортировать"), color: "#666", onClick: exportCsv },
                { path: ICON.edit, title: t("Изменить"), color: "#666", onClick: editChecked },
                { path: ICON.history, title: t("История"), color: "#666", onClick: () => flash(t("Скоро будет доступно")) },
                { path: ICON.textA, title: t("Текст"), color: "#666", onClick: () => flash(t("Скоро будет доступно")) },
                { path: ICON.send, title: t("Передать"), color: "#666", onClick: passToDelivery },
              ].map((action, index) => (
                <button key={index} type="button" title={action.title} aria-label={action.title} onClick={action.onClick} className={`flex h-12 w-12 items-center justify-center ${index === 0 ? "ml-5" : ""}`}>
                  <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ fill: action.color }}><path d={action.path} /></svg>
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[1100px]">
              <div className={`h-[50px] items-center bg-[#5d6474] px-[30px] font-semibold text-white ${filterOpen ? "hidden" : "grid"}`} style={{ gridTemplateColumns: COLS }}>
                {["№", "Клиент", "Тип", "Дата создания", "Доставщик", "Дата доставки", "Агент", "Сумма заказа", "Баланс", "Статус"].map((head) => (
                  <div key={head} className="px-2 leading-[18px]">
                    <button type="button" onClick={() => setSort((current) => (current?.head === head ? (current.desc ? null : { head, desc: true }) : { head, desc: false }))} className="text-left font-semibold hover:opacity-80">
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
                    <div key={row.id} ref={detailRowRef} className="my-3 px-[2px]">
                      <div className="sticky left-0 w-[calc(100vw-56px)] max-w-full">
                        <OrderDetailCard order={selected} onUpdate={updateOrder} refreshOrder={refreshOrder} onNavigate={(href) => router.push(href)} onNotify={flash} />
                      </div>
                    </div>
                  ) : (
                    <div
                      key={row.id}
                      onClick={() => setSelected(row)}
                      className="grid min-h-[50px] cursor-pointer items-center border-b border-dotted border-[#d6d6d6] bg-white px-[30px] py-[7px] hover:bg-[#f2f5f8]"
                      style={{ gridTemplateColumns: COLS }}
                    >
                      <div className="flex items-center gap-2 px-2">
                        {selectMode && (
                          <input type="checkbox" checked={checkedIds.includes(row.id)} onClick={(event) => event.stopPropagation()} onChange={() => toggleChecked(row.id)} />
                        )}
                        {row.id}
                      </div>
                      <div className="px-2 leading-[16.25px]">{row.client}<br /><span>{t("Зона")} : {row.zone || t("Не указано")}</span></div>
                      <div className="px-2 leading-[16.25px]">{row.type}<br /><b className="font-semibold">{row.product}</b></div>
                      <div className="px-2">{row.created}</div>
                      <div className="px-2 leading-[16.25px]">Admin Ritm<br /><span className="text-[#4f71dc]">{t("Не указано")}</span></div>
                      <div className="px-2">{row.delivery}</div>
                      <div className="px-2 leading-[16.25px]">{row.agent}<br /><span className="text-[#4f71dc]">{t("0 кг.")}</span></div>
                      <div className="px-2">{row.amount}</div>
                      <div className={`px-2 font-semibold ${row.negative ? "text-[#e57373]" : "text-[#48a34b]"}`}>{row.balance}</div>
                      <div className="flex items-center gap-[10px] px-2">
                        <StatusIcon status={row.status} />
                        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#e57373]"><path d={ICON.card} /></svg>
                      </div>
                    </div>
                  ),
                )
              )}
            </div>
          </div>
        </div>
      </section>

      {addOpen && (
        <AddOrderDialog initialShopId={initialShopId} onClose={closeAddDialog} onCreated={orderCreated} />
      )}

      {bulkPayOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">{t("Групповая оплата")}</h3>
              <button type="button" onClick={() => setBulkPayOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-5 text-sm text-slate-500">{t("Выбрано заказов:")} {checkedIds.length || t("0 (отметьте заказы в таблице)")}</p>
            <button
              type="button"
              onClick={() => {
                if (checkedIds.length) flash(`${t("Оплата принята по")} ${checkedIds.length} ${t("заказ(ам)")}`)
                setBulkPayOpen(false)
                setCheckedIds([])
              }}
              disabled={!checkedIds.length}
              className="w-full rounded-md bg-[#71ce87] py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("Оплатить")}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

const TAB_LABELS = ["Активные", "Доставляется", "Доставленные", "Все"] as const
const COLS = "minmax(0,87fr) minmax(0,198fr) minmax(0,173fr) minmax(0,124fr) minmax(0,148fr) minmax(0,99fr) minmax(0,99fr) minmax(0,124fr) minmax(0,111fr) minmax(0,74fr)"

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

function StatusIcon({ status }: { status: string }) {
  const map: Record<string, { path: string; color: string }> = {
    "Доставлено": { path: ICON.clipboard, color: "#81c784" },
    "Есть на складе": { path: ICON.store, color: "#f0ad4e" },
    "В пути": { path: ICON.truck, color: "#f0ad4e" },
    "В процессе": { path: ICON.clock, color: "#f0ad4e" },
    "Отменен": { path: ICON.ban, color: "#e57373" },
  }
  const item = map[status] ?? { path: ICON.warning, color: "#757575" }
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5">
      <path d={item.path} fill={item.color} />
    </svg>
  )
}

function parseAmount(value: string) {
  const match = /^([\d\s\u00a0.,-]+)\s*([A-Za-z]+)/.exec(value.trim())
  if (!match) return null
  const number = Number(match[1].replace(/[\s\u00a0]/g, "").replace(",", "."))
  return Number.isFinite(number) ? { number, currency: match[2].toUpperCase() } : null
}

function sumByCurrency(rows: Order[]) {
  const totals = new Map<string, number>([["SUM", 0], ["EUR", 0], ["USD", 0]])
  for (const row of rows) {
    const parsed = parseAmount(row.amount)
    if (parsed) totals.set(parsed.currency, (totals.get(parsed.currency) ?? 0) + parsed.number)
  }
  const label = (currency: string) => (currency === "EUR" ? "Euro" : currency)
  const shown = [...totals.entries()].filter(([currency, number]) => currency !== "EUR" || number !== 0)
  return shown.map(([currency, number], index, all) => (
    <span key={currency} className="mr-[5px]">
      {number.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} {label(currency)}{index < all.length - 1 ? " ," : ""}
    </span>
  ))
}
