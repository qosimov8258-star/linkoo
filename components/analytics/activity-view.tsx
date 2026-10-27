"use client"

import Image from "next/image"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { FilterSelect, RI, RefButton, RefFilterPanel, RefHeader, RefPage } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { ClientDetail } from "@/components/clients/clients-view"
import type { Client } from "@/components/clients/clients-data"
import { ActivityOrderDialog } from "@/components/analytics/activity-order-dialog"
import type { Order } from "@/components/orders/orders-data"
import { refDate, refDateTime } from "@/lib/ref-date"

type AgentCell = { id: number; name: string; done: number; sales: number }
type FeedKind = "order" | "delivery" | "payment" | "report" | "rejection" | "return"
type FeedItem = { kind: FeedKind; id: number; userId: number | null; userName: string; at: string; text: string; marketId: number | null; marketName: string | null; extra: { order_id?: number; comment?: string | null; before?: string[]; after?: string[]; key?: string | null } }
type FeedColumn = { items: FeedItem[]; count: number; page: number }
type Totals = { orders: number; ordersSum: number; rejections: number; reports: number; payments: number; paymentsSum: number; deliveries: number; returns: number; returnsSum: number }

const FEED_PAGE = 25
const COLUMNS: FeedKind[] = ["order", "rejection", "report", "return", "payment", "delivery"]
const emptyColumns = (): Record<FeedKind, FeedColumn> => ({ order: { items: [], count: 0, page: 0 }, rejection: { items: [], count: 0, page: 0 }, report: { items: [], count: 0, page: 0 }, payment: { items: [], count: 0, page: 0 }, return: { items: [], count: 0, page: 0 }, delivery: { items: [], count: 0, page: 0 } })
const emptyTotals: Totals = { orders: 0, ordersSum: 0, rejections: 0, reports: 0, payments: 0, paymentsSum: 0, deliveries: 0, returns: 0, returnsSum: 0 }
const money = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })

const equipmentStores = ["С оборудованием", "Без оборудования"]

const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const monthStart = () => {
  const today = new Date()
  return isoDay(new Date(today.getFullYear(), today.getMonth(), 1))
}
const monthEnd = () => {
  const today = new Date()
  return isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0))
}
// "23 Окт. 2026": the reference capitalises the month of the period caption.
const caption = (value: string) => {
  const text = refDate(value)
  return text.replace(/^(\d+ )(.)/, (_all, day: string, first: string) => `${day}${first.toUpperCase()}`)
}

const HEAD: Record<FeedKind, string> = { order: "Cделки", rejection: "Отказы", report: "Отчеты", payment: "Сбор денег", delivery: "Доставки", return: "Возвраты" }

function FeedColumnView({ kind, column, totals, onOrder, onClient, onMore }: { kind: FeedKind; column: FeedColumn; totals: Totals; onOrder: (id: number) => void; onClient: (id: number) => void; onMore: () => void }) {
  const { t } = useLanguage()
  const head = {
    order: { count: totals.orders, sum: totals.ordersSum, unit: true },
    payment: { count: totals.payments, sum: totals.paymentsSum, unit: true },
    rejection: { count: totals.rejections },
    report: { count: totals.reports },
    delivery: { count: totals.deliveries },
    return: { count: totals.returns, sum: totals.returnsSum, unit: true },
  }[kind] as { count: number; sum?: number; unit?: boolean }
  // The reference offers "Загрузить еще..." while the loaded cards are fewer than the counter above the column (not the list's own count).
  const more = head.count > FEED_PAGE && column.items.length < head.count
  return (
    <div className="w-[330px] shrink-0 pr-[20px]">
      <div className="mr-[10px] flex h-[46.25px] items-center justify-between py-[15px] text-[13px] font-bold text-[#333]">
        <strong className="leading-[16.25px]">{t(HEAD[kind])}: {head.count}{head.unit ? ` ${t("шт.")}` : ""}{kind === "return" && head.sum !== undefined ? ` ${money(head.sum)} SUM` : ""}</strong>
        {kind !== "return" && head.sum !== undefined && <strong className="leading-[16.25px]">{money(head.sum)} SUM</strong>}
      </div>
      <div className="relative h-[693px] overflow-y-auto pr-[10px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {column.items.map((item) => (
          <FeedCard key={`${item.kind}-${item.id}`} item={item} onOrder={onOrder} onClient={onClient} />
        ))}
        {more && (
          <div className="pb-[10px] pt-[2px] text-center">
            <button type="button" onClick={onMore} className="text-[13px] font-semibold text-[#4f71dc]">{t("Загрузить еще...")}</button>
          </div>
        )}
      </div>
    </div>
  )
}

function FeedCard({ item, onOrder, onClient }: { item: FeedItem; onOrder: (id: number) => void; onClient: (id: number) => void }) {
  const { t } = useLanguage()
  const date = item.kind === "delivery" ? refDate(item.at.slice(0, 10)) : refDateTime(item.at.slice(0, 19))
  const link = item.marketName ? (
    <span onClick={(event) => { event.stopPropagation(); if (item.marketId) onClient(item.marketId) }} className="cursor-pointer text-[#4f71dc]">{item.marketName}</span>
  ) : null
  const before = item.extra.before ?? []
  const after = item.extra.after ?? []
  return (
    <div
      onClick={() => item.kind === "order" && item.extra.order_id && onOrder(item.extra.order_id)}
      className={`relative mb-[10px] w-[300px] rounded-[2px] bg-white px-[15px] py-[20px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] hover:shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)] ${item.kind === "order" || item.kind === "report" || item.kind === "return" ? "cursor-pointer" : ""}`}
    >
      <div className="flex justify-between text-[13px] font-semibold leading-[16.25px] text-[#333]">
        <span>{item.userName}</span>
        {item.kind === "order" && <div className="h-[4px] w-[30px] rounded-[2px] bg-[#92ce95]" />}
      </div>
      <div className="text-[10px] leading-[12.5px] text-[#999]">{date}</div>
      {item.kind === "rejection" && <div className="mt-[10px] h-0 flow-root" />}
      {link && <div className={`mt-[10px] text-[13px] leading-[15px] ${item.kind === "rejection" || item.kind === "report" ? "flex" : ""}`}>{link}</div>}
      {item.kind === "report" && (
        <div className="mt-[10px] flex items-center justify-between">
          <div className="flex flex-col gap-[10px]">
            {before.length === 0 ? (
              <div className="flex h-[135px] w-[173.8px] flex-col items-center justify-center border border-[#c7cdd4] bg-[#e9ecef]/[0.38] text-[13px] text-[#84909f]">
                <svg viewBox="0 0 24 24" className="h-8 w-8 fill-[#b2bac4]"><path d="M12 12m-3.2 0a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" /></svg>
                <p className="mt-[3px] text-center">{t("Ожидается синхронизация")}</p>
              </div>
            ) : (
              // The reference's photos never load (zero-size boxes), so the "до" / "после" marks stack 10px apart from the box corner.
              before.map((_src, index) => (
                <div key={index} className="relative">
                  <p className="absolute left-[8px] top-[8px] whitespace-nowrap bg-[#333] px-[8px] py-[2px] text-[11px] font-semibold leading-[13.8px] text-white opacity-80">{t("до")}</p>
                </div>
              ))
            )}
          </div>
          <div className="flex flex-col gap-[10px]">
            {after.map((_src, index) => (
              <div key={index} className="relative">
                <p className="absolute left-[8px] top-[8px] whitespace-nowrap bg-[#333] px-[8px] py-[2px] text-[11px] font-semibold leading-[13.8px] text-white opacity-80">{t("после")}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {(item.kind === "order" || item.kind === "payment" || item.kind === "delivery" || item.kind === "return") && <div className="mt-[10px] text-[13px] leading-[15px] text-[#333]">{item.text}</div>}
      {item.kind === "rejection" && item.text && <div className="mt-[10px] text-[13px] leading-[15px] text-[#333]">{item.text}</div>}
      {item.kind === "report" && item.extra.comment && <div className="mt-[10px] text-[13px] leading-[15px] text-[#333]">{item.extra.comment}</div>}
    </div>
  )
}

function DateField({ label, begin, end, onChange }: { label: string; begin: string; end: string; onChange: (begin: string, end: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative h-[63px]">
      <button type="button" onClick={() => setOpen((c) => !c)} className="absolute inset-x-0 top-0 h-[54px] w-full text-left">
        <span className="absolute left-0 top-[4px] text-[10px] font-bold leading-3 text-black">{label}</span>
        <span className="absolute left-0 top-[34px] text-[13px] font-medium leading-4 text-black">{refDate(begin)} - {refDate(end || begin)}</span>
        <span className="absolute inset-x-0 top-[54px] h-px bg-[#e0e0e0]" />
      </button>
      {open && (
        <DateRangePicker
          begin={begin}
          end={end || begin}
          highlightPreset={false}
          positionClassName="right-0 top-[70px]"
          onClose={() => setOpen(false)}
          onApply={(b, e) => {
            onChange(b, e)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

export function ActivityView() {
  return (
    <Suspense fallback={null}>
      <ActivityInner />
    </Suspense>
  )
}

const DAY_PARAM = /^\d{4}-\d{2}-\d{2}$/

function ActivityInner() {
  const { t } = useLanguage()
  const today = useMemo(() => isoDay(new Date()), [])
  // The reference keeps the page state in the URL: fromDate / toDate / agentId / openShop / orderDetails.
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const fromParam = search.get("fromDate")
  const toParam = search.get("toDate")
  const from = fromParam && DAY_PARAM.test(fromParam) ? fromParam : today
  const to = toParam && DAY_PARAM.test(toParam) ? toParam : today
  const agentParam = Number(search.get("agentId")) || null
  const shopParam = Number(search.get("openShop")) || null
  const orderParam = Number(search.get("orderDetails")) || null
  const go = useCallback(
    (patch: Record<string, string | null>, ordered?: string[]) => {
      const next: Record<string, string> = Object.fromEntries(search.entries())
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete next[key]
        else next[key] = value
      }
      const keys = ordered ?? Object.keys(next).sort()
      const query = keys.filter((key) => key in next).map((key) => `${key}=${encodeURIComponent(next[key])}`).join("&")
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [search, router, pathname],
  )
  const [draftFrom, setDraftFrom] = useState(monthStart)
  const [draftTo, setDraftTo] = useState(monthEnd)
  const [clientType, setClientType] = useState("")
  const [clientTypes, setClientTypes] = useState<string[]>([])
  const [equipmentStore, setEquipmentStore] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const selectedAgent = agentParam
  const [columns, setColumns] = useState<Record<FeedKind, FeedColumn>>(emptyColumns)
  const [totals, setTotals] = useState<Totals>(emptyTotals)
  const [orderDialog, setOrderDialog] = useState<{ order: Order; clientId: number | null } | null>(null)
  const [panelClient, setPanelClient] = useState<Client | null>(null)
  const [cells, setCells] = useState<AgentCell[]>([])
  const stripRef = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ back: false, forward: false })

  // The strip lists the reference's agents (market/agent/done_plan, in its order) with the visited markets and the sales of
  // the chosen period; the tiles with visits come first.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/activity-feed?view=tiles&begin=${from}&end=${to}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((list: Array<{ id: number; name: string; count: number; sales: number }>) => {
        if (cancelled || !Array.isArray(list)) return
        setCells(list.map((row, index) => ({ row, index })).sort((a, b) => b.row.count - a.row.count || a.index - b.index).map(({ row }) => ({ id: row.id, name: row.name, done: row.count, sales: row.sales })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [from, to])

  // The feed: first page of every column plus the counters of the range (and of the chosen agent).
  useEffect(() => {
    let cancelled = false
    const agent = selectedAgent ? `&agent=${selectedAgent}` : ""
    const base = `begin=${from}&end=${to}${agent}`
    fetch(`/api/activity-feed?view=totals&${base}`)
      .then((response) => (response.ok ? response.json() : emptyTotals))
      .then((data: Totals) => !cancelled && setTotals(data))
      .catch(() => {})
    Promise.all(
      COLUMNS.map((kind) =>
        fetch(`/api/activity-feed?kind=${kind}&page=1&${base}`)
          .then((response) => (response.ok ? response.json() : { results: [], count: 0 }))
          .catch(() => ({ results: [], count: 0 })),
      ),
    ).then((lists: Array<{ results: FeedItem[]; count: number }>) => {
      if (cancelled) return
      const next = emptyColumns()
      COLUMNS.forEach((kind, index) => {
        next[kind] = { items: lists[index].results, count: lists[index].count, page: 1 }
      })
      setColumns(next)
    })
    return () => {
      cancelled = true
    }
  }, [from, to, selectedAgent])

  function loadMore(kind: FeedKind) {
    const agent = selectedAgent ? `&agent=${selectedAgent}` : ""
    const page = columns[kind].page + 1
    fetch(`/api/activity-feed?kind=${kind}&page=${page}&begin=${from}&end=${to}${agent}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { results: FeedItem[]; count: number } | null) => {
        if (!data) return
        setColumns((current) => ({ ...current, [kind]: { items: [...current[kind].items, ...data.results], count: data.count, page } }))
      })
      .catch(() => {})
  }
  // Opening a card writes orderDetails / openShop into the URL (as the reference does); the dialogs follow the URL.
  const openOrder = (id: number) => go({ orderDetails: String(id) })
  const openClient = (id: number) => go({ openShop: String(id) })
  useEffect(() => {
    if (!orderParam) return setOrderDialog(null)
    let cancelled = false
    fetch(`/api/orders/${orderParam}`)
      .then((response) => (response.ok ? (response.json() as Promise<Order>) : null))
      .then((order) => {
        if (cancelled || !order) return
        const known = columns.order.items.find((item) => item.extra.order_id === orderParam)
        setOrderDialog({ order, clientId: known?.marketId ?? null })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderParam])
  useEffect(() => {
    if (!shopParam) return setPanelClient(null)
    let cancelled = false
    fetch(`/api/clients/${shopParam}`)
      .then((response) => (response.ok ? (response.json() as Promise<Client>) : null))
      .then((client) => !cancelled && client && setPanelClient(client))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [shopParam])

  useEffect(() => {
    if (!filterOpen || clientTypes.length) return
    fetch("/api/client-types")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Array<{ name?: string }>) => setClientTypes([...new Set(data.map((item) => item.name ?? "").filter(Boolean))]))
      .catch(() => {})
  }, [filterOpen, clientTypes.length])

  function applyFilters() {
    go({ fromDate: draftFrom, toDate: draftTo })
    setFilterOpen(false)
  }

  function measureScroll() {
    const node = stripRef.current
    if (!node) return
    const back = node.scrollLeft > 1
    const forward = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
    setScroll((current) => (current.back === back && current.forward === forward ? current : { back, forward }))
  }
  // The reference scrolls the strip by itself (350 px/s) while the pointer rests on an edge arrow.
  const raf = useRef(0)
  function hoverScroll(direction: 1 | -1 | 0) {
    cancelAnimationFrame(raf.current)
    if (!direction) return
    let last = performance.now()
    const step = (now: number) => {
      const node = stripRef.current
      if (!node) return
      node.scrollLeft += (direction * 350 * (now - last)) / 1000
      last = now
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  useEffect(() => {
    measureScroll()
  }, [cells])

  const total = cells.reduce((sum, cell) => sum + cell.done, 0)

  return (
    <RefPage>
      <div className="relative">
        <RefHeader title={t("Активность")}>
          <div className="relative top-[-2px] flex items-center" style={{ marginRight: filterOpen ? 164.7 : 8 }}>
            <div className="flex h-[36.3px] items-center text-[13px] font-bold text-[#4f71dc]">
              {caption(from)} - {caption(to)}
            </div>
            {selectedAgent && (
              <button type="button" onClick={() => router.push("/tracking?view=agents")} className="ml-[15px] flex h-6 items-center text-[13px] font-bold text-[#666]">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" /></svg>
                <span className="pl-[4px] pt-[4px]">{t("Показать на карте")}</span>
              </button>
            )}
            {filterOpen && (
          <div className="absolute left-0 top-[59px] z-30" style={{ width: 300 }}>
            <RefFilterPanel narrow className="!w-[300px]" onClose={() => setFilterOpen(false)} onApply={applyFilters} applyClassName="mt-[18px]">
              <DateField label={t("Дата")} begin={draftFrom} end={draftTo} onChange={(begin, end) => { setDraftFrom(begin); setDraftTo(end) }} />
              <div className="pt-[5px]"><FilterSelect label={t("Тип клиента")} value={clientType} onChange={setClientType} options={clientTypes} /></div>
              <div className="pt-[5px]"><FilterSelect label={t("Магазин с оборудованием")} value={equipmentStore} onChange={setEquipmentStore} options={equipmentStores.map((item) => t(item))} /></div>
            </RefFilterPanel>
          </div>
        )}
            {!filterOpen && (
              <span className="ml-[15px]">
                <RefButton exact icon={RI.filter} label={t("Показать фильтр")} onClick={() => setFilterOpen((open) => !open)} />
              </span>
            )}
          </div>
        </RefHeader>
      </div>

      <div className="relative -mx-7 -mt-[3px]">
        <div
          ref={stripRef}
          onScroll={measureScroll}
          className="flex h-[66px] overflow-x-auto bg-white text-[13px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <button type="button" onClick={() => go({ agentId: null })} className="flex min-w-[93.5px] shrink-0 items-center pl-[16px] pr-[15.5px] text-left">
            <span className="flex h-[35px] w-[35px] shrink-0 items-center justify-center rounded-full bg-[#9aa6b3]">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
            </span>
            <span className="ml-[5px] mt-[6px] block">
              <span className="block h-[18px] font-semibold leading-[18px] text-[#333]">{t("Все")}</span>
              <span className="block h-[18px] leading-[18px] text-[#666]">{total}</span>
            </span>
          </button>
          {cells.map((cell, cellIndex) => (
            <button
              key={`${cell.name}-${cellIndex}`}
              type="button"
              onClick={() => go({ fromDate: from, toDate: to, beginDate: today, endDate: today, agentId: String(cell.id) }, ["fromDate", "toDate", "beginDate", "endDate", "agentId"])}
              className={`shrink-0 whitespace-nowrap border-l border-[#efefef] px-[15px] pt-[6px] text-center ${selectedAgent === cell.id ? "bg-[#f3f6f9]" : ""}`}
            >
              <span className="block h-[18px] font-semibold leading-[18px] text-[#333]">{cell.name}</span>
              <span className="block h-[18px] bg-[#5869f0] leading-[18px] text-white">{cell.done}</span>
              <span className="block h-[18px] leading-[18px] text-[#666]">{cell.sales.toLocaleString("ru-RU")} SUM</span>
            </button>
          ))}
        </div>
        {scroll.back && (
          <button type="button" aria-label="«" onMouseEnter={() => hoverScroll(-1)} onMouseLeave={() => hoverScroll(0)} className="absolute left-[215px] top-px flex h-[63px] w-[51px] items-center justify-start rounded-r-[90px] bg-black/[0.31] pb-[5px] pl-[2px]">
            <span className="-mr-[0px] text-[13px] text-[#333]">‹</span>
            <span className="text-[13px] text-[#333]">‹</span>
          </button>
        )}
        {scroll.forward && (
          <button type="button" aria-label="»" onMouseEnter={() => hoverScroll(1)} onMouseLeave={() => hoverScroll(0)} className="absolute right-0 top-px flex h-[63px] w-[51px] items-center justify-end rounded-l-[90px] bg-black/[0.31] pb-[5px] pr-[2px]">
            <span className="-mr-[0px] text-[13px] text-[#333]">›</span>
            <span className="-ml-[0px] text-[13px] text-[#333]">›</span>
          </button>
        )}
      </div>

      {COLUMNS.every((kind) => columns[kind].items.length === 0) ? (
        <section className="relative mt-[29px] h-[216.25px]">
          <Image src="/robot-empty.png" alt={t("Робот-помощник")} width={150} height={155} priority className="absolute left-1/2 top-[30px] h-[154.7px] w-[150px] -translate-x-1/2 object-contain" />
          <p className="absolute inset-x-0 top-[200px] text-center text-[13px] leading-[16.25px] text-[#999]">{t("По вашему запросу ничего не найдено...")}</p>
        </section>
      ) : (
        <div className="-mx-7 mt-[3px] h-[755px] pb-[8px] pl-[25px] pr-[30px]">
          <div className="-mr-[30px] flex h-[773px] overflow-x-auto overflow-y-hidden pr-[30px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ marginLeft: -5, paddingLeft: 5 }}>
            {COLUMNS.map((kind) => (
              <FeedColumnView key={kind} kind={kind} column={columns[kind]} totals={totals} onOrder={(id) => openOrder(id)} onClient={openClient} onMore={() => loadMore(kind)} />
            ))}
          </div>
        </div>
      )}

      {orderDialog && <ActivityOrderDialog order={orderDialog.order} clientId={orderDialog.clientId} onClose={() => go({ orderDetails: null })} onClient={(id) => openClient(id)} />}
      {panelClient && <ClientDetail variant="activity" client={panelClient} onClose={() => go({ openShop: null })} onEdit={() => router.push(`/clients?openShop=${panelClient.id}&openUpdateDialog=true`)} onDelete={() => router.push(`/clients?openShop=${panelClient.id}`)} />}
    </RefPage>
  )
}
