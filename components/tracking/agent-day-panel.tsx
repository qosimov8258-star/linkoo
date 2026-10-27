"use client"

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  DollarSign,
  Flame,
  ListChecks,
  Lock,
  MapPin,
  Pencil,
  RotateCcw,
  Truck,
  Undo2,
  User,
  X,
} from "lucide-react"

import { formatMoney } from "@/lib/finance/currency"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import type { LanguageCode } from "@/lib/i18n/types"
import type { TrackingClient, TrackingDay, TrackingEvent } from "@/lib/tracking-types"

import { distanceColor, formatPillDay, moneyLines, secondsOf, shiftDay, timeOf, type DetailStatus } from "./agents-tracking-data"
import { StatusFilterPanel } from "./agents-tracking-dialogs"

// Right panel of Отслеживание in agent detail mode ("Показать путь"): header with the agent
// switcher and the status filter, the stats row, the three counters, the toolbar (date,
// route optimisation, selection, bulk edit) and the day's timeline of clients.

type Tone = "done" | "bad" | "pending"

const BADGE: Record<Tone, string> = { done: "#92ce95", bad: "#e57373", pending: "#f0ad4e" }

/** Whether a client card passes the detail's status filter. */
export function matchesStatus(client: TrackingClient, status: DetailStatus): boolean {
  switch (status) {
    case "visited":
      return client.visited
    case "refusal":
      return client.refused
    case "order":
      return client.events.some((event) => event.kind === "order")
    case "no_plan_visit":
      return client.unplanned
    case "todo":
      return client.planned && !client.visited
    default:
      return true
  }
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)

/** "7 мин. 43 сек." / "12 сек." */
export function durationText(seconds: number, t: (text: string) => string): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes >= 60) return fill(t("{h} ч. {m} мин."), { h: String(Math.floor(minutes / 60)), m: String(minutes % 60) })
  return minutes > 0 ? fill(t("{m} мин. {s} сек."), { m: String(minutes), s: String(rest) }) : fill(t("{s} сек."), { s: String(rest) })
}

const amountText = (event: TrackingEvent) => (event.amount !== null && event.currency ? `${formatMoney(event.amount)} ${event.currency}` : "")

/** Plain-text lines of a client's events (the map popup uses them too). */
export function eventSummary(client: TrackingClient, day: string, t: (text: string) => string, language: LanguageCode): string[] {
  if (!client.events.length) return [fill(t("Следует посетить {date}"), { date: formatDateText(day, language) })]
  return client.events.map((event) => {
    switch (event.kind) {
      case "visit":
        return event.visit?.finishedAt
          ? fill(t("Начало {start} - Конец {end}"), { start: secondsOf(event.visit.startedAt), end: secondsOf(event.visit.finishedAt) })
          : fill(t("Начало {start} - визит не завершен"), { start: secondsOf(event.at) })
      case "refusal":
        return fill(t("Отказ: {reason}"), { reason: event.reason || event.comment || "—" })
      case "photo_report":
        return fill(t("Фото отчет № {id}"), { id: String(event.sourceId) })
      case "order":
        return fill(t(event.cancelled ? "Отменен заказ {id}" : "Заказ {id}"), { id: String(event.sourceId) })
      case "delivery":
        return fill(t("Доставлен заказ № {id}"), { id: String(event.orderId ?? event.sourceId) })
      case "payment":
        return fill(t("Оплата {amount}"), { amount: amountText(event) })
      case "return":
        return fill(t("Возврат № {id}: {amount}"), { id: String(event.sourceId), amount: amountText(event) })
      default:
        return ""
    }
  })
}

type Actions = {
  onOpenClient: (clientId: number) => void
  onOpenOrder: (orderId: number) => void
  onOpenRecord: (kind: "refusal" | "photo_report", id: number) => void
}

function ViewLink({ onClick }: { onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <>
      {" ("}
      <button type="button" onClick={onClick} className="text-[#4f71dc] hover:underline">
        {t("Просмотреть")}
      </button>
      {")"}
    </>
  )
}

function EventLine({ time, tone, children }: { time: string; tone: Tone; children: ReactNode }) {
  return (
    <li className="li-plan flex items-start gap-[8px] py-[3px]">
      <span className="mt-[1px] shrink-0 rounded-[3px] px-[5px] text-[11px] font-semibold text-white" style={{ background: BADGE[tone] }}>
        {time || "—"}
      </span>
      <span className="min-w-0 flex-1 break-words text-[12px] leading-[18px] text-[#444]">{children}</span>
    </li>
  )
}

function EventLines({ client, day, actions }: { client: TrackingClient; day: string; actions: Actions }) {
  const { t, language } = useLanguage()
  if (!client.events.length) {
    return (
      <ul>
        <li className="li-plan flex items-center gap-[8px] py-[3px] text-[12px] text-[#444]">
          <RotateCcw className="h-4 w-4 shrink-0 text-[#f0ad4e]" />
          {fill(t("Следует посетить {date}"), { date: formatDateText(day, language) })}
        </li>
      </ul>
    )
  }
  return (
    <ul>
      {client.events.map((event) => {
        const time = timeOf(event.at)
        switch (event.kind) {
          case "visit": {
            const visit = event.visit
            return (
              <Fragment key={event.id}>
                {visit && !visit.planned && (
                  <EventLine time={time} tone="bad">
                    {fill(t("Внеплановый визит {date} в {time}"), { date: formatDateText(event.at, language, { withTime: false }), time })}
                  </EventLine>
                )}
                <EventLine time={time} tone="done">
                  {visit?.finishedAt ? (
                    <>
                      {fill(t("Начало {start} - Конец {end}"), { start: secondsOf(visit.startedAt), end: secondsOf(visit.finishedAt) })}
                      {visit.durationSec !== null && (
                        <span className="ml-[6px] inline-block rounded-full bg-[#ff5e5e] px-[7px] text-[11px] font-semibold text-white">{durationText(visit.durationSec, t)}</span>
                      )}
                    </>
                  ) : (
                    fill(t("Начало {start} - визит не завершен"), { start: secondsOf(visit?.startedAt ?? event.at) })
                  )}
                </EventLine>
                {visit?.result === "no_sale" && (
                  <EventLine time={timeOf(visit.finishedAt)} tone="pending">
                    {t("Визит без продажи")}
                  </EventLine>
                )}
              </Fragment>
            )
          }
          case "refusal":
            return (
              <EventLine key={event.id} time={time} tone="bad">
                {fill(t("Отказ: {reason}"), { reason: event.reason || "—" })}
                {event.comment && <span className="text-[#777]"> — {event.comment}</span>}
                <ViewLink onClick={() => actions.onOpenRecord("refusal", event.sourceId)} />
              </EventLine>
            )
          case "photo_report":
            return (
              <EventLine key={event.id} time={time} tone="done">
                {fill(t("Фото отчет № {id}"), { id: String(event.sourceId) })}
                <ViewLink onClick={() => actions.onOpenRecord("photo_report", event.sourceId)} />
              </EventLine>
            )
          case "order":
            return (
              <EventLine key={event.id} time={time} tone={event.cancelled ? "bad" : event.counted ? "done" : "pending"}>
                {fill(t(event.cancelled ? "Отменен заказ {id}" : "Заказ {id}"), { id: String(event.sourceId) })}
                {amountText(event) && <span className="text-[#777]"> · {amountText(event)}</span>}
                {!event.cancelled && !event.counted && event.status && <span className="text-[#777]"> · {t(event.status)}</span>}
                <ViewLink onClick={() => actions.onOpenOrder(event.sourceId)} />
              </EventLine>
            )
          case "delivery":
            return (
              <EventLine key={event.id} time={time} tone={event.cancelled ? "bad" : "done"}>
                {fill(t("Доставлен заказ № {id}"), { id: String(event.orderId ?? event.sourceId) })}
                <ViewLink onClick={() => actions.onOpenOrder(event.orderId ?? event.sourceId)} />
              </EventLine>
            )
          case "payment":
            return (
              <EventLine key={event.id} time={time} tone={event.status === "pending" ? "pending" : "done"}>
                {fill(t("Оплата {amount}"), { amount: amountText(event) })}
                {event.status === "pending" && <span className="text-[#777]"> · {t("Ожидает подтверждения")}</span>}
              </EventLine>
            )
          case "return":
            return (
              <EventLine key={event.id} time={time} tone={event.status === "pending" ? "pending" : "done"}>
                {fill(t("Возврат № {id}: {amount}"), { id: String(event.sourceId), amount: amountText(event) })}
              </EventLine>
            )
          default:
            return null
        }
      })}
    </ul>
  )
}

function Stat({ icon, value, caption }: { icon: ReactNode; value: ReactNode; caption: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex shrink-0 items-center gap-[8px] pr-[18px]">
      <span className="text-[#999]">{icon}</span>
      <span>
        <b className="block whitespace-nowrap text-[14px] leading-[18px] text-[#333]">{value}</b>
        <span className="block text-[11px] text-[#777]">{t(caption)}</span>
      </span>
    </div>
  )
}

function Counter({ value, label, color }: { value: number; label: string; color: string }) {
  const { t } = useLanguage()
  return (
    <div className="flex h-[35px] min-w-0 flex-1 items-center justify-center gap-[6px] rounded-[4px] px-[6px] text-white" style={{ background: color }}>
      <b className="text-[20px] leading-none">{value}</b>
      <span className="truncate text-[11px] font-semibold">{t(label)}</span>
    </div>
  )
}

/** Small menu anchored under a button; closes on outside click and Escape. */
function Menu({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.parentElement?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} role="menu" className="absolute right-0 top-full z-[650] mt-[4px] min-w-[230px] bg-white py-[4px] text-[13px] shadow-[0_2px_10px_rgba(0,0,0,0.25)]">
      {children}
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button type="button" role="menuitem" onClick={onClick} className="block w-full px-[14px] py-[8px] text-left text-[#333] hover:bg-[#f2f4f7]">
      {t(label)}
    </button>
  )
}

export function AgentDayPanel({
  employeeId,
  name,
  day,
  loading,
  error,
  date,
  onDate,
  onPrev,
  onNext,
  onClose,
  status,
  onStatus,
  selected,
  onToggle,
  onSelectAll,
  canManage,
  planShown,
  onTogglePlan,
  onOptimize,
  onEditRoute,
  onEditLock,
  actions,
}: {
  employeeId: number
  name: string
  day: TrackingDay | null
  loading: boolean
  error: string
  date: string
  onDate: (day: string) => void
  onPrev: (() => void) | null
  onNext: (() => void) | null
  onClose: () => void
  status: DetailStatus
  onStatus: (status: DetailStatus) => void
  selected: number[]
  onToggle: (clientId: number) => void
  onSelectAll: () => void
  canManage: boolean
  planShown: boolean
  onTogglePlan: () => void
  onOptimize: () => void
  onEditRoute: () => void
  onEditLock: () => void
  actions: Actions
}) {
  const { t, language } = useLanguage()
  const [filterOpen, setFilterOpen] = useState(false)
  const [optimizeMenu, setOptimizeMenu] = useState(false)
  const [editMenu, setEditMenu] = useState(false)
  const current = day && day.employee.employeeId === employeeId && day.date === date ? day : null
  const clients = (current?.clients ?? []).filter((client) => matchesStatus(client, status))
  const base = current?.baseCurrency ?? ""
  const stats = current?.stats

  return (
    <div className="relative flex h-full flex-col text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center gap-[10px] border-b border-[#eee] px-[16px]">
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#d5d9e0] text-white">
          <User className="h-6 w-6" />
        </span>
        <button type="button" disabled={!onPrev} onClick={() => onPrev?.()} aria-label={t("Предыдущий агент")} className="text-[#555] disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <b className="min-w-0 flex-1 truncate text-center uppercase">{name}</b>
        <button type="button" disabled={!onNext} onClick={() => onNext?.()} aria-label={t("Следующий агент")} className="text-[#555] disabled:opacity-30">
          <ChevronRight className="h-5 w-5" />
        </button>
        {status === "all" ? (
          <button type="button" onClick={() => setFilterOpen((open) => !open)} className="flex shrink-0 items-center gap-[2px] text-[#4f71dc]">
            {t("Показать фильтр")}
            <ChevronDown className="h-4 w-4" />
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-[6px] rounded-full bg-[#eceff3] px-[10px] py-[4px] text-[12px]">
            {t("Фильтр: 1 элемент")}
            <button type="button" onClick={() => setFilterOpen(true)} aria-label={t("Изменить")}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => onStatus("all")} aria-label={t("Очистить")}>
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="shrink-0 text-[#555]">
          <X className="h-6 w-6" />
        </button>
      </header>
      {filterOpen && <StatusFilterPanel value={status} onApply={onStatus} onClose={() => setFilterOpen(false)} />}

      <div className="flex shrink-0 overflow-x-auto border-b border-[#eee] px-[16px] py-[10px]">
        <Stat icon={<Flame className="h-6 w-6" />} value={moneyLines(stats?.orders, base).join(" · ")} caption="сделки" />
        <Stat icon={<DollarSign className="h-6 w-6" />} value={moneyLines(stats?.payments, base).join(" · ")} caption="оплаты" />
        <Stat
          icon={<MapPin className="h-6 w-6" />}
          value={
            <>
              {stats?.done ?? 0} / {stats?.todo ?? 0}
              {(stats?.unplanned ?? 0) > 0 && <span className="text-[#ee667d]"> + {stats?.unplanned}</span>}
            </>
          }
          caption="посещено"
        />
        <Stat icon={<ClipboardList className="h-6 w-6" />} value={stats?.reports ?? 0} caption="отчеты" />
        <Stat icon={<Truck className="h-6 w-6" />} value={stats?.deliveries ?? 0} caption="доставки" />
        <Stat icon={<Undo2 className="h-6 w-6" />} value={moneyLines(stats?.returns, base).join(" · ")} caption="возвраты" />
      </div>

      <div className="flex shrink-0 gap-[8px] px-[16px] pt-[12px]">
        <Counter value={current?.counters.ordered ?? 0} label="Заказ оформлен" color="rgb(58,201,119)" />
        <Counter value={current?.counters.refusals ?? 0} label="Отказы" color="rgb(255,94,94)" />
        <Counter value={current?.counters.toVisit ?? 0} label="Надо посетить" color="rgb(13,153,255)" />
      </div>

      <div className="flex shrink-0 items-center gap-[8px] px-[16px] py-[12px]">
        <div className="flex h-[34px] items-center rounded-[4px] bg-[#20abc8] text-white">
          <button type="button" onClick={() => onDate(shiftDay(date, -1))} aria-label={t("Предыдущий день")} className="h-full px-[8px]">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="whitespace-nowrap text-[12px] font-bold">{formatPillDay(date, language)}</span>
          <button type="button" onClick={() => onDate(shiftDay(date, 1))} aria-label={t("Следующий день")} className="h-full px-[8px]">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="relative ml-auto">
          <button type="button" onClick={() => setOptimizeMenu((open) => !open)} className="flex h-[34px] items-center gap-[4px] rounded-[4px] bg-[#536fe1] px-[12px] text-[12px] font-bold text-white">
            {t("Оптимизировать маршрут")}
            <ChevronDown className="h-4 w-4" />
          </button>
          <Menu open={optimizeMenu} onClose={() => setOptimizeMenu(false)}>
            {canManage && (
              <MenuItem
                label="Оптимизировать маршрут"
                onClick={() => {
                  setOptimizeMenu(false)
                  onOptimize()
                }}
              />
            )}
            <MenuItem
              label={planShown ? "Скрыть маршрут" : "Показать маршрут"}
              onClick={() => {
                setOptimizeMenu(false)
                onTogglePlan()
              }}
            />
          </Menu>
        </div>
        {canManage && (
          <>
            <button type="button" onClick={onSelectAll} title={t("Выбрать все")} aria-label={t("Выбрать все")} className="flex h-[34px] w-[34px] items-center justify-center rounded-[4px] text-[#5d6474] hover:bg-[#eef1f5]">
              <ListChecks className="h-5 w-5" />
            </button>
            <div className="relative">
              <button
                type="button"
                disabled={!selected.length}
                onClick={() => setEditMenu((open) => !open)}
                aria-label={t("Изменить")}
                className={`flex h-[34px] w-[34px] items-center justify-center rounded-[4px] text-white ${selected.length ? "bg-[#3ac977]" : "bg-[#c8c8c8]"}`}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <Menu open={editMenu && selected.length > 0} onClose={() => setEditMenu(false)}>
                <MenuItem
                  label="Изменить маршрут"
                  onClick={() => {
                    setEditMenu(false)
                    onEditRoute()
                  }}
                />
                <MenuItem
                  label="Изменить блокировку локации"
                  onClick={() => {
                    setEditMenu(false)
                    onEditLock()
                  }}
                />
              </Menu>
            </div>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[20px]">
        {error ? (
          <p className="px-[20px] py-[16px] text-center text-[#e53935]">{error}</p>
        ) : !current ? (
          <p className="px-[20px] py-[16px] text-center text-[#777]">{loading ? t("Загрузка...") : ""}</p>
        ) : clients.length === 0 ? (
          <div className="flex flex-col items-center px-4 pt-[20px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/robot-empty.png" alt="" className="w-[110px]" />
            <p className="-mt-[4px] text-center text-[13px] text-[#777]">
              {current.clients.length === 0 ? t("Для выбранного агента в эту дату не найдено планов") : t("Ничего не найдено")}
            </p>
          </div>
        ) : (
          <div className="relative pl-[96px] pr-[16px]">
            <span className="absolute bottom-0 left-[76px] top-0 w-[3px] bg-[#20abc8]" />
            {current.truncated && <p className="mb-[8px] text-[12px] text-[#e57373]">{t("Показаны не все события дня")}</p>}
            {clients.map((client) => {
              const seq = current.clients.indexOf(client) + 1
              const ring = client.refused ? "#ff5e5e" : client.unplanned ? "#d06000" : "#dde007"
              return (
                <div key={client.key} className="relative mb-[10px]">
                  <div className="absolute -left-[96px] top-[10px] w-[60px] text-right">
                    <b className="block text-[13px]">{timeOf(client.firstAt)}</b>
                    {client.distanceM !== null && (
                      <span className="block text-[11px] font-semibold" style={{ color: distanceColor(client.distanceM) }}>
                        {Math.round(client.distanceM)} {t("м.")}
                      </span>
                    )}
                  </div>
                  <span
                    className="absolute -left-[33px] top-[8px] flex h-[24px] w-[24px] items-center justify-center rounded-full border-[3px] bg-white text-[11px] font-bold"
                    style={{ borderColor: client.visited ? ring : "#536fe1" }}
                  >
                    {client.visited ? seq : ""}
                  </span>
                  <div className="rounded-[3px] bg-white px-[12px] py-[8px] shadow-[0_1px_4px_rgba(0,0,0,0.18)]">
                    <div className="mb-[4px] flex items-center gap-[8px]">
                      {canManage && client.clientId !== null && (
                        <input
                          type="checkbox"
                          checked={selected.includes(client.clientId)}
                          onChange={() => onToggle(client.clientId as number)}
                          aria-label={client.clientName}
                          className="h-4 w-4 shrink-0"
                        />
                      )}
                      {client.clientId !== null ? (
                        <button type="button" onClick={() => actions.onOpenClient(client.clientId as number)} className="min-w-0 truncate text-left text-[14px] font-bold text-[#333] hover:text-[#4f71dc] hover:underline">
                          {client.clientName}
                        </button>
                      ) : (
                        <span className="min-w-0 truncate text-[14px] font-bold">{client.clientName || "—"}</span>
                      )}
                      {client.locationLocked && <Lock className="h-3.5 w-3.5 shrink-0 text-[#777]" aria-label={t("Локация заблокирована")} />}
                    </div>
                    <EventLines client={client} day={date} actions={actions} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
