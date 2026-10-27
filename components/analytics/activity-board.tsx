"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"

import { Spinner } from "@/components/analytics/activity-dialogs"
import { moneyLines } from "@/components/analytics/activity-strip"
import { ACTIVITY_PAGE_SIZE, type ActivityCard, type ActivityColumn, type ActivityFeedPage } from "@/lib/activity-types"
import type { FieldPhoto, KindTotal } from "@/lib/field-activity/types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// The board of the Активность page: one column per activity kind (Сделки, Отказы, Отчеты,
// Возвраты, Сбор денег, Доставки — the demo's fixed order), each with its header total and a
// list of cards that loads 25 at a time ("Загрузить еще..."). Only columns with cards render.
// Card texts are built here from structured data with i18n templates, so every language is
// right (the demo server sends them in Russian).

export type ActivityActions = {
  openOrder: (orderId: number) => void
  openReturn: (returnId: number) => void
  openClient: (card: ActivityCard) => void
  openPhotos: (photos: FieldPhoto[], index: number) => void
}

const HEADERS: Record<ActivityColumn, { label: string; pieces: boolean; sum: boolean }> = {
  order: { label: "Сделки", pieces: true, sum: true },
  refusal: { label: "Отказы", pieces: false, sum: false },
  photo_report: { label: "Отчеты", pieces: false, sum: false },
  return: { label: "Возвраты", pieces: true, sum: true },
  payment: { label: "Сбор денег", pieces: true, sum: true },
  delivery: { label: "Доставки", pieces: false, sum: false },
}

/** Fills "{name}" slots (a linear scan; values are data and inserted as they are). */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

function amountText(card: ActivityCard): string {
  if (card.amount === null) return "—"
  return card.currency ? `${formatMoney(card.amount)} ${currencyLabel(card.currency)}` : formatMoney(card.amount)
}

function Thumb({ photo, label, onOpen }: { photo: FieldPhoto; label?: string; onOpen: () => void }) {
  const { t } = useLanguage()
  const [broken, setBroken] = useState(false)
  if (broken) return null
  return (
    <button type="button" onClick={onOpen} className="relative block overflow-hidden bg-[#f2f5f8]" aria-label={label ?? t("Фото")} title={label ?? t("Фото")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt={label ?? t("Фото")} loading="lazy" onError={() => setBroken(true)} className="block h-full w-full object-cover" />
      {label && <span className="absolute left-0 top-0 bg-[#333] px-[6px] py-[2px] text-[11px] leading-[14px] text-white">{label}</span>}
    </button>
  )
}

function CardShell({ card, onClick, marker, children }: { card: ActivityCard; onClick?: () => void; marker?: boolean; children: ReactNode }) {
  const { t, language } = useLanguage()
  const clickable = Boolean(onClick)
  return (
    <article
      onClick={onClick}
      onKeyDown={(event) => {
        if (clickable && (event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
          event.preventDefault()
          onClick?.()
        }
      }}
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? "button" : undefined}
      className={`mb-[10px] w-[300px] rounded-[2px] bg-white px-[15px] py-[20px] text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] transition-shadow ${
        clickable ? "cursor-pointer hover:shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words font-semibold leading-[18px]">{card.employeeName || t("Не указано")}</p>
        {marker && <span className="mt-[6px] h-[4px] w-[30px] shrink-0 bg-[rgb(146,206,149)]" aria-hidden="true" />}
      </div>
      <p className="mb-[6px] text-[10px] leading-[14px] text-[#999]">{formatDateText(card.at, language, { withTime: card.kind !== "delivery" })}</p>
      {children}
    </article>
  )
}

function ClientLink({ card, actions }: { card: ActivityCard; actions: ActivityActions }) {
  const { t } = useLanguage()
  if (!card.clientName) return <p className="leading-[18px] text-[#999]">{t("Клиент не указан")}</p>
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        actions.openClient(card)
      }}
      className="block max-w-full break-words text-left leading-[18px] text-[#4f71dc] hover:underline"
    >
      {card.clientName}
    </button>
  )
}

function CardView({ card, actions }: { card: ActivityCard; actions: ActivityActions }) {
  const { t } = useLanguage()
  const text = (template: string, values: Record<string, string>) => <p className="mt-[4px] break-words leading-[18px]">{fill(t(template), values)}</p>

  switch (card.kind) {
    case "order":
      return (
        <CardShell card={card} marker onClick={() => actions.openOrder(card.orderId ?? card.sourceId)}>
          <ClientLink card={card} actions={actions} />
          {text("Сделка №{no} с магазина {client} на сумму {amount}", { no: String(card.orderId ?? card.sourceId), client: card.clientName || t("Не указано"), amount: amountText(card) })}
        </CardShell>
      )
    case "refusal": {
      const photo = card.photos[0]
      return (
        <CardShell card={card}>
          {photo && (
            <div className="mb-[8px] h-[180px] w-[270px]">
              <Thumb photo={photo} onOpen={() => actions.openPhotos(card.photos, 0)} />
            </div>
          )}
          <ClientLink card={card} actions={actions} />
          {card.reason && <p className="mt-[4px] break-words font-semibold leading-[18px]">{card.reason}</p>}
          {card.comment && <p className="mt-[2px] break-words leading-[18px]">{card.comment}</p>}
        </CardShell>
      )
    }
    case "photo_report": {
      const beforeIndex = card.photos.findIndex((photo) => photo.slot === "before")
      const afterIndex = card.photos.findIndex((photo) => photo.slot === "after")
      return (
        <CardShell card={card}>
          <ClientLink card={card} actions={actions} />
          {(beforeIndex >= 0 || afterIndex >= 0) && (
            <div className="mt-[8px] grid grid-cols-2 gap-[10px]">
              {[beforeIndex, afterIndex].map((index, position) =>
                index >= 0 ? (
                  <div key={position} className="h-[120px]">
                    <Thumb photo={card.photos[index]} label={position === 0 ? t("Фото до") : t("Фото после")} onOpen={() => actions.openPhotos(card.photos, index)} />
                  </div>
                ) : (
                  <div key={position} className="flex h-[120px] items-center justify-center bg-[#f2f5f8] text-[11px] text-[#999]">
                    {position === 0 ? t("Фото до") : t("Фото после")}
                  </div>
                ),
              )}
            </div>
          )}
          {card.comment && <p className="mt-[8px] break-words leading-[18px]">{card.comment}</p>}
        </CardShell>
      )
    }
    case "return":
      return (
        <CardShell card={card} onClick={() => actions.openReturn(card.sourceId)}>
          <ClientLink card={card} actions={actions} />
          {text("Возврат №{no} от магазина {client} на сумму {amount}", { no: String(card.sourceId), client: card.clientName || t("Не указано"), amount: amountText(card) })}
        </CardShell>
      )
    case "payment":
      return (
        <CardShell card={card}>
          <ClientLink card={card} actions={actions} />
          {text("Принято {amount} с магазина {client}", { amount: amountText(card), client: card.clientName || t("Не указано") })}
        </CardShell>
      )
    case "delivery": {
      const orderId = card.orderId ?? card.sourceId
      return (
        <CardShell card={card}>
          <ClientLink card={card} actions={actions} />
          <button type="button" onClick={() => actions.openOrder(orderId)} className="mt-[4px] block text-left leading-[18px] hover:text-[#4f71dc] hover:underline">
            {fill(t("Доставили заказ №{no}"), { no: String(orderId) })}
          </button>
        </CardShell>
      )
    }
  }
}

function ColumnHeader({ column, total, baseCurrency }: { column: ActivityColumn; total: KindTotal; baseCurrency: string }) {
  const { t } = useLanguage()
  const header = HEADERS[column]
  return (
    <div className="mb-[10px] flex w-[300px] items-start justify-between gap-3 text-[13px] leading-[18px] text-[#333]">
      <span className="whitespace-nowrap">
        {t(header.label)}: <b className="font-semibold">{total.count}</b>
        {header.pieces && ` ${t("шт.")}`}
      </span>
      {header.sum && (
        <b className="flex flex-col items-end text-right font-semibold">
          {moneyLines(total.byCurrency, baseCurrency).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </b>
      )}
    </div>
  )
}

/** One column: header + the cards, 25 per page. Reloads when `queryKey` changes. */
function ActivityColumnView({
  column,
  total,
  baseCurrency,
  queryKey,
  actions,
}: {
  column: ActivityColumn
  total: KindTotal
  baseCurrency: string
  queryKey: string
  actions: ActivityActions
}) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<ActivityCard[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const loadPage = useCallback(
    async (next: number, signal?: AbortSignal) => {
      setLoading(true)
      setError("")
      const params = new URLSearchParams(queryKey)
      params.set("column", column)
      params.set("page", String(next))
      params.set("pageSize", String(ACTIVITY_PAGE_SIZE))
      try {
        const response = await fetch(`/api/activity/feed?${params.toString()}`, { cache: "no-store", signal })
        const body = (await response.json().catch(() => null)) as (ActivityFeedPage & { error?: string }) | null
        if (!response.ok || !body || !Array.isArray(body.rows)) {
          setError(body?.error ?? "Не удалось загрузить данные")
          setLoading(false)
          return
        }
        // Rows that moved to a later page while paging (new events) are not shown twice.
        setRows((current) => {
          const base = next === 1 ? [] : current
          const seen = new Set(base.map((row) => row.id))
          return [...base, ...body.rows.filter((row) => !seen.has(row.id))]
        })
        setPage(next)
        setHasMore(body.hasMore)
        setLoading(false)
      } catch (cause) {
        if ((cause as { name?: string }).name === "AbortError") return
        setError("Не удалось загрузить данные")
        setLoading(false)
      }
    },
    [column, queryKey],
  )

  useEffect(() => {
    const controller = new AbortController()
    setRows([])
    setPage(0)
    setHasMore(false)
    void loadPage(1, controller.signal)
    return () => controller.abort()
  }, [loadPage])

  return (
    <section className="shrink-0" aria-label={t(HEADERS[column].label)}>
      <ColumnHeader column={column} total={total} baseCurrency={baseCurrency} />
      <div className="h-[calc(100vh-215px)] min-h-[320px] w-[315px] overflow-y-auto pb-2 pl-[2px] pr-[13px] pt-[2px] [scrollbar-color:#4f71dc_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-[#4f71dc] [&::-webkit-scrollbar]:w-[4px]">
        {rows.map((card) => (
          <CardView key={card.id} card={card} actions={actions} />
        ))}
        {loading && (
          <div className="flex w-[300px] justify-center py-4">
            <Spinner />
          </div>
        )}
        {!loading && error && (
          <div className="w-[300px] py-3 text-center text-[13px]">
            <p className="text-[#e57373]">{t(error)}</p>
            <button type="button" onClick={() => void loadPage(Math.max(1, page + 1))} className="mt-1 text-[#129fdd] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}
        {!loading && !error && hasMore && (
          <div className="w-[300px] py-2 text-center">
            <button type="button" onClick={() => void loadPage(page + 1)} className="text-[13px] text-[#129fdd] hover:underline">
              {t("Загрузить еще...")}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

export function ActivityColumns({
  columns,
  order,
  baseCurrency,
  queryKey,
  actions,
}: {
  columns: Record<ActivityColumn, KindTotal>
  order: readonly ActivityColumn[]
  baseCurrency: string
  queryKey: string
  actions: ActivityActions
}) {
  return (
    <div className="flex gap-[15px] overflow-x-auto px-[30px] pb-3 pt-5 [scrollbar-color:#4f71dc_transparent] [scrollbar-width:thin]">
      {order
        .filter((column) => columns[column].count > 0)
        .map((column) => (
          <ActivityColumnView key={column} column={column} total={columns[column]} baseCurrency={baseCurrency} queryKey={queryKey} actions={actions} />
        ))}
    </div>
  )
}
