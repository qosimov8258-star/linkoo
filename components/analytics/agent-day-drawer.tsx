"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createPortal } from "react-dom"

import { RefFilterPanel } from "@/components/ref/list-kit"
import { DayCalendar, PlanCheck, PlanTimeline, RingSpinner } from "@/components/tracking/agent-plans-panel"
import type { AgentDay } from "@/components/tracking/agent-day"
import { useLanguage } from "@/lib/i18n/language-context"

// The reference's agent day card: opened from the attendance grid (800px, "Просмотреть на карте") and from the agents panel of the
// tracking map (530px, with the previous / next agent arrows and the status filter).
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
const pad = (n: number) => String(n).padStart(2, "0")
const longDate = (day: string) => `${day.slice(8, 10)} ${MONTHS_GEN[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`

const P = {
  x: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  left: "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  right: "M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  fire: "M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z",
  pin: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  chevronDown: "M7 10l5 5 5-5z",
  card: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z",
  file: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  editBorder: "M17.75 7L14 3.25l-10 10V17h3.75l10-10zm2.96-2.96c.39-.39.39-1.02 0-1.41L18.37.29c-.39-.39-1.02-.39-1.41 0L15 2.25 18.75 6l1.96-1.96z",
  cancel: "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z",
  returns: "M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  editPen: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  truck: "M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
}

function Icon({ d, size = 24, fill, className }: { d: string; size?: number; fill: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={{ fill, display: "block" }} aria-hidden>
      <path d={d} />
    </svg>
  )
}

type DayPlan = { orderTotal: number; paymentTotal: number; visitTasks: number; visitDone: number; noPlan: number; reportTasks: number; reportDone: number; deliveryTasks: number; deliveryDone: number; returnTotal: number; ordersDone: number; rejectionsDone: number; needVisit: number }
const money = (v: number) => v.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
const EMPTY_PLAN: DayPlan = { orderTotal: 0, paymentTotal: 0, visitTasks: 0, visitDone: 0, noPlan: 0, reportTasks: 0, reportDone: 0, deliveryTasks: 0, deliveryDone: 0, returnTotal: 0, ordersDone: 0, rejectionsDone: 0, needVisit: 0 }

/** The ids of the reference's status filter ("staticStatus") with their labels. */
const STATUS: [string, string][] = [
  ["all", "Все"],
  ["visit_no_plan_visit", "Посещенные точки"],
  ["rejection", "Отказы"],
  ["order", "Заказы"],
  ["no_plan_visit", "Внеплановые визиты"],
  ["visit", "Надо посетить"],
]

/** What the agent card of the tracking map shows besides the header: the day (loaded by the map page) and the status filter. */
export type TrackingCard = {
  day: AgentDay
  loading: boolean
  status: string
  onStatus: (status: string) => void
  onDate: (date: string) => void
  /** A client's number or distance was clicked: the map goes to the place where the action was done. */
  onLocate: (lat: number, lon: number) => void
}

export function AgentDayDrawer({
  name,
  date: initialDate,
  width,
  variant,
  onClose,
  onPrev,
  onNext,
  tracking,
  userId,
}: {
  userId?: number
  name: string
  date: string
  width: number
  variant: "attendance" | "tracking"
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  tracking?: TrackingCard
}) {
  const { t } = useLanguage()
  const router = useRouter()
  const [localDate, setDate] = useState(initialDate)
  const date = tracking ? initialDate : localDate
  const [attendancePlan, setAttendancePlan] = useState<DayPlan>(EMPTY_PLAN)
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusDraft, setStatusDraft] = useState("")
  const [statusOpen, setStatusOpen] = useState(false)
  const [calendar, setCalendar] = useState<{ top: number; left: number } | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [menu, setMenu] = useState<null | "optimize" | "edit">(null)
  // A click outside the open menu closes it; a click on a button then still acts on the menu that was open when the press began.
  const menuAtPress = useRef<null | "optimize" | "edit">(null)
  useEffect(() => {
    if (!menu) return
    const press = (event: MouseEvent) => {
      menuAtPress.current = menu
      if (!(event.target as HTMLElement).closest("[data-plan-menu]")) setMenu(null)
    }
    document.addEventListener("mousedown", press)
    return () => document.removeEventListener("mousedown", press)
  }, [menu])
  const linkRef = useRef<HTMLButtonElement>(null)
  useEffect(() => setDate(initialDate), [initialDate])
  useEffect(() => {
    if (tracking || userId === undefined) return
    let cancelled = false
    fetch(`/api/agent-day-plan?user=${userId}&date=${date}`)
      .then((r) => (r.ok ? r.json() : EMPTY_PLAN))
      .then((data: DayPlan) => {
        if (!cancelled) setAttendancePlan({ ...EMPTY_PLAN, ...data })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [date, userId, tracking])
  const shift = (s: number) => {
    const dt = new Date(`${date}T00:00:00`)
    dt.setDate(dt.getDate() + s)
    const next = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
    if (tracking) tracking.onDate(next)
    else setDate(next)
  }
  const pickDate = (next: string) => {
    setCalendar(null)
    if (tracking) tracking.onDate(next)
    else setDate(next)
  }
  const box = "flex h-[35px] flex-1 items-center justify-center rounded-[4px] text-white"
  const stat = (v: number, label: string) => (
    <div className="flex items-center gap-[4px] font-semibold">
      <span className="block text-[20px] leading-[25px]">{v}</span>
      <span className="block text-[11px] leading-[13.75px]">{t(label)}</span>
    </div>
  )

  // The numbers of the header: for the tracking card they come from the clients of the day (as the reference computes them), for the attendance card from the stored day totals.
  const plans = tracking?.day.plans ?? []
  const dayStats = tracking?.day.stats
  const withTask = (type: string, status: string) => plans.filter((item) => item.plans.some((task) => task.type === type && task.status === status)).length
  const noPlanDone = plans.filter((item) => item.plans.some((task) => task.type === "no_plan_visit" && task.status === "done")).length
  const statusSet = Boolean(tracking?.status)
  const view: DayPlan = tracking && dayStats
    ? {
        orderTotal: Number(dayStats.order_total_price) || 0,
        paymentTotal: Number(dayStats.client_transaction_total_price) || 0,
        visitTasks: dayStats.visit_tasks,
        visitDone: dayStats.visit_done_tasks,
        noPlan: dayStats.no_plan_count,
        reportTasks: dayStats.report_tasks,
        reportDone: dayStats.report_done_tasks,
        deliveryTasks: dayStats.deleveriy_tasks,
        deliveryDone: dayStats.delivery_done_tasks,
        returnTotal: Number(dayStats.order_return_total_price) || 0,
        ordersDone: withTask("order", "done"),
        rejectionsDone: withTask("rejection", "done"),
        needVisit: withTask("visit", "pending"),
      }
    : attendancePlan
  // With a status chosen the reference counts the visits from the list of clients instead.
  const visitedText = statusSet ? `${plans.length} / ${plans.length - noPlanDone}` : `${view.visitDone} / ${view.visitTasks}`
  const noPlan = statusSet ? noPlanDone : view.noPlan
  const sumGroup = "flex items-center font-semibold [&>div]:mr-[30px] [&>div:last-child]:mr-0"
  const block = (icon: string, top: React.ReactNode, label: string) => (
    <div className="flex select-none items-center leading-none">
      <Icon d={icon} size={32} fill="#999" className="mr-[5px]" />
      <div className="font-semibold text-[#666]">
        <span className="block text-[18px] leading-[18px]">{top}</span>
        <span className="block text-[13px] leading-[13px]">{t(label)}</span>
      </div>
    </div>
  )
  return createPortal(
    <>
      {variant === "attendance" && <div className="fixed inset-0 z-[140]" onMouseDown={onClose} />}
      <div className="fixed bottom-0 right-0 top-0 z-[150] overflow-y-auto bg-[#f4f4f4] font-sans text-[13px] leading-[16.25px] text-[#333]" style={{ width, boxShadow: "0 3px 10px rgba(0,0,0,.16), 0 3px 10px rgba(0,0,0,.23)" }}>
        <div className="relative rounded-[2px] border border-[#e9e9e9]">
          <div className="flex h-[59px] items-center justify-between border-b border-[#efefef] bg-white px-[20px]">
            <div className="flex items-center">
              <Image src="/default-avatar.png" alt="" width={32} height={32} className="mr-[10px] h-8 w-8 rounded-full" />
              {variant === "tracking" ? (
                <>
                  <button type="button" aria-label={t("Назад")} onClick={onPrev} className="flex h-[25px] w-[25px] items-center justify-center"><Icon d={P.left} size={25} fill="#666" /></button>
                  <span className="ml-[5px] text-[13px] font-semibold uppercase">{name}</span>
                  <button type="button" aria-label={t("Вперед")} onClick={onNext} className="ml-[5px] flex h-[25px] w-[25px] items-center justify-center"><Icon d={P.right} size={25} fill="#666" /></button>
                </>
              ) : (
                <span className="text-[13px] font-semibold">{name}</span>
              )}
            </div>
            {variant === "attendance" ? (
              <a onClick={() => router.push("/tracking?view=agents")} className="mr-[50px] flex cursor-pointer items-center text-[13px] text-[#129fdd]">
                <Icon d={P.reply} fill="#ccc" />
                <span className="ml-[10px]">{t("Просмотреть на карте")}</span>
              </a>
            ) : statusSet && !filterOpen ? (
              <div className="relative ml-[30px] mt-[0.6px] flex h-[48.3px] w-[185px] items-center justify-end bg-[#efefef] px-[30px] py-[16px]">
                <div className="w-[125px] text-[#666]">{t("Фильтр")}: 1 {t("элемента")}</div>
                <div className="absolute left-[89px] top-px flex h-[48px] w-[96px]">
                  <button type="button" aria-label={t("Показать фильтр")} onClick={() => { setStatusDraft(tracking?.status ?? ""); setFilterOpen(true) }} className="flex h-[48px] w-[48px] items-center justify-center border-l border-white">
                    <svg viewBox="0 0 24 24" width={24} height={24} style={{ fill: "#8f8f8f" }}><path fillOpacity=".36" d="M0 20h24v4H0z" /><path d={P.editBorder} /></svg>
                  </button>
                  <button type="button" aria-label={t("Очистить")} onClick={() => tracking?.onStatus("")} className="flex h-[48px] w-[48px] items-center justify-center border-l border-white">
                    <Icon d={P.cancel} size={20} fill="#8f8f8f" />
                  </button>
                </div>
              </div>
            ) : (
              <button ref={linkRef} type="button" onClick={() => { setStatusDraft(tracking?.status ?? ""); setFilterOpen((v) => !v) }} className="relative mr-[35px] block pr-[14px] text-[13px] text-[#4f71dc]">
                <div className="flex"><span>{t("Показать фильтр")}</span></div>
                <svg viewBox="0 0 24 24" width={13} height={20} className="absolute right-0 top-0" style={{ fill: "#4f71dc" }} aria-hidden><path d="M7.41 7.84L12 12.42l4.59-4.58L18 9.25l-6 6-6-6z" /></svg>
              </button>
            )}
            <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[13px] top-[5px] flex h-12 w-12 items-center justify-center">
              <Icon d={P.x} fill="#333" />
            </button>
          </div>
          <div className="flex h-[55px] items-center justify-between bg-white px-[20px]">
            <div className={sumGroup}>
              <div className="flex items-center">
                <Icon d={P.fire} size={32} fill="#999" className="mr-[5px]" />
                <div className="font-semibold text-[#666]">
                  <span className="block text-[18px] leading-[18px]">{money(view.orderTotal)} <small className="text-[13px] leading-[13px]">SUM</small></span>
                  <span className="block text-[13px] leading-[13px]">{t("сделки")}</span>
                </div>
              </div>
              {view.paymentTotal !== 0 && block(P.card, <>{money(view.paymentTotal)} <small className="text-[13px] leading-[13px]">SUM</small></>, "оплаты")}
            </div>
            <div className={sumGroup}>
              <div className="flex items-center">
                <Icon d={P.pin} size={32} fill="#999" className="mr-[5px]" />
                <div className="font-semibold text-[#666]">
                  <span className="flex text-[18px] leading-[18px]">
                    {visitedText}
                    {noPlan > 0 && <span className="ml-[4px] block text-[#ee667d]">+ {noPlan}</span>}
                  </span>
                  <span className="block text-[13px] leading-[13px]">{t("посещено")}</span>
                </div>
              </div>
              {view.reportTasks !== 0 && block(P.file, `${view.reportDone} / ${view.reportTasks}`, "отчеты")}
              {view.deliveryTasks !== 0 && block(P.truck, `${view.deliveryDone} / ${view.deliveryTasks}`, "доставки")}
              {view.returnTotal !== 0 && block(P.returns, <>{money(view.returnTotal)} <small className="text-[13px] leading-[13px]">SUM</small></>, "возвраты")}
            </div>
          </div>
        </div>
        {filterOpen && variant === "tracking" && (
          <div className="absolute right-px top-px z-10 w-[300px]">
            <RefFilterPanel narrow className="!w-[300px]" onClose={() => setFilterOpen(false)} onApply={() => { tracking?.onStatus(statusDraft); setFilterOpen(false) }} applyClassName="mt-[23px] mb-[-1px]">
              <div className="relative mt-[18px]">
                <button type="button" onClick={() => setStatusOpen((v) => !v)} className="relative flex h-[36px] w-full items-center border-b border-[#e8e8e8] text-left text-[13px] font-semibold text-black">
                  {statusDraft ? <><span className="absolute left-0 top-[-14px] text-[10px]">{t("Статус")}</span>{t(STATUS.find(([id]) => id === statusDraft)?.[1] ?? "")}</> : t("Статус")}
                  <svg viewBox="0 0 10 5" className="absolute right-[10px] top-[16px] h-[5px] w-[10px] fill-[#999]"><path d={statusOpen ? "M0 5l5-5 5 5z" : "M0 0l5 5 5-5z"} /></svg>
                </button>
                {statusOpen && (
                  <div className="absolute inset-x-0 top-[calc(100%-2px)] z-20 bg-white" style={{ boxShadow: "0 3px 10px rgba(0,0,0,.16), 0 3px 10px rgba(0,0,0,.23)" }}>
                    {STATUS.map(([id, label], index) => (
                      <div key={id} onClick={() => { setStatusDraft(id); setStatusOpen(false) }} className={`cursor-pointer px-[10px] py-[8px] text-[13px] font-semibold leading-[16.3px] ${statusDraft === id || (!statusDraft && index === 0) ? "bg-[#e6f2ff] text-[#333]" : "text-[#666]"}`}>{t(label)}</div>
                    ))}
                  </div>
                )}
              </div>
            </RefFilterPanel>
          </div>
        )}
        {tracking?.loading ? (
          <div className="mx-px mt-[20px] flex h-[132px] items-center justify-center border border-[#e9e9e9] bg-white"><RingSpinner /></div>
        ) : (
          <div className="grid grid-cols-3 gap-[15px] px-[20px] pt-[15px]">
            <div className={box} style={{ background: "#3ac977" }}>{stat(view.ordersDone, "Заказ оформлен")}</div>
            <div className={box} style={{ background: "#ff5e5e" }}>{stat(view.rejectionsDone, "Отказы")}</div>
            <div className={box} style={{ background: "#0d99ff" }}>{stat(view.needVisit, "Надо посетить")}</div>
          </div>
        )}
        {tracking && plans.length > 0 && !tracking.loading ? (
          <div className="relative px-[30px] pb-[20px] pt-[20px]">
            <div className="relative mt-[10px]">
              <div className="-mb-[11px] flex h-[61px] items-center justify-between">
                <div className="relative -left-[8px] -top-[15px] h-[28.25px] w-[150px] shrink-0">
                  <div className="absolute inset-0 cursor-pointer rounded-[5px] bg-[#22a6c6] py-[6px] text-center text-[13px] font-semibold leading-[16.3px] text-white" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setCalendar({ top: rect.bottom, left: rect.left }) }}>{longDate(date)}</div>
                  <button type="button" aria-label={t("Назад")} onClick={() => shift(-1)} className="absolute left-0 top-0"><Icon d={P.left} size={28} fill="#fff" /></button>
                  <button type="button" aria-label={t("Вперед")} onClick={() => shift(1)} className="absolute right-0 top-0"><Icon d={P.right} size={28} fill="#fff" /></button>
                </div>
                <div className="relative h-0 w-[245.5px] shrink-0">
                  <div className="-mt-[30px] flex h-[30px] items-center px-[14px]">
                    <div className="relative h-[30px]">
                      <button type="button" onClick={() => setMenu(menuAtPress.current === "optimize" ? null : "optimize")} className="mr-[8px] flex h-[30px] items-center whitespace-nowrap rounded-[5px] bg-[#4f71dc] px-[16px] text-[13px] font-semibold leading-[30px] text-white">{t("Оптимизировать маршрут")}</button>
                      {menu === "optimize" && (
                        <div data-plan-menu className="absolute left-0 top-[30px] z-[20] w-[224px] rounded-[8px] bg-white p-[4px]" style={{ boxShadow: "0 1px 6px rgba(0,0,0,.12), 0 1px 4px rgba(0,0,0,.12)" }}>
                          {["Оптимизировать маршрут", "Показать маршрут"].map((label) => (
                            <div key={label} onClick={() => setMenu(null)} className="h-[48px] cursor-pointer px-[16px] text-[13px] leading-[48px] hover:bg-[#f5f5f5]">{t(label)}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="-ml-px mb-[31px] flex h-[30px] w-[82px] shrink-0 items-center">
                  <PlanCheck glyph="all" checked={plans.length > 0 && plans.every((item) => selected.includes(item.market.id))} onChange={() => setSelected(plans.every((item) => selected.includes(item.market.id)) ? [] : plans.map((item) => item.market.id))} color="#5d6474" />
                  <div className="relative h-[30px] w-[52px]">
                    <button type="button" disabled={selected.length === 0} onClick={() => setMenu(menuAtPress.current === "edit" ? null : "edit")} className="mr-[8px] flex h-[30px] w-[44px] items-center justify-center rounded-[5px]" style={{ background: selected.length ? "#71ce87" : "#cfcfcf" }}>
                      <Icon d={P.editPen} size={18} fill="#fff" className="mb-[4px] mr-[6px]" />
                    </button>
                    {menu === "edit" && (
                      <div data-plan-menu className="absolute right-[8px] top-[30px] z-[20] w-[280px] rounded-[8px] bg-white p-[4px]" style={{ boxShadow: "0 1px 6px rgba(0,0,0,.12), 0 1px 4px rgba(0,0,0,.12)" }}>
                        {["Изменить маршрут", "Изменить блокировку локации"].map((label) => (
                          <div key={label} onClick={() => setMenu(null)} className="h-[48px] cursor-pointer whitespace-nowrap px-[16px] text-[13px] leading-[48px] hover:bg-[#f5f5f5]">{t(label)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <PlanTimeline items={plans} selected={selected} onSelect={setSelected} onLocate={tracking.onLocate} />
            </div>
            {calendar && <DayCalendar value={date} top={calendar.top} left={calendar.left} onPick={pickDate} onClose={() => setCalendar(null)} />}
          </div>
        ) : tracking?.loading ? (
          <div className="px-[30px] pt-[20px]"><div className="mt-[10px] flex h-[210px] items-center justify-center border border-[#e9e9e9] bg-white"><RingSpinner /></div></div>
        ) : (
          <div className="relative h-[250px]">
            <div className="absolute left-[22px] top-[5px] h-[28.3px] w-[150px]">
              <div className="absolute inset-0 cursor-pointer rounded-[5px] bg-[#22a6c6] py-[6px] text-center text-[13px] font-semibold leading-[16.3px] text-white" onClick={(event) => { if (!tracking) return; const rect = event.currentTarget.getBoundingClientRect(); setCalendar({ top: rect.bottom, left: rect.left }) }}>{longDate(date)}</div>
              <button type="button" aria-label={t("Назад")} onClick={() => shift(-1)} className="absolute left-0 top-0"><Icon d={P.left} size={28} fill="#fff" /></button>
              <button type="button" aria-label={t("Вперед")} onClick={() => shift(1)} className="absolute right-0 top-0"><Icon d={P.right} size={28} fill="#fff" /></button>
            </div>
            {calendar && <DayCalendar value={date} top={calendar.top} left={calendar.left} onPick={pickDate} onClose={() => setCalendar(null)} />}
            <div className="absolute inset-x-[30px] top-[37.3px] h-[208.25px] rounded-[2px] border border-[#e9e9e9] bg-white bg-[url('/robot-empty.png')] bg-[length:155px_auto] bg-[position:50%_calc(50%-1px)] bg-no-repeat pt-[170px] text-center text-[#666]">
              <div className="text-[13px] leading-[16.25px]">{t("Для выбранного агента в эту дату не найдено планов")}</div>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
