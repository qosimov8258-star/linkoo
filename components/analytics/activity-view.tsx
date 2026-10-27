"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { MapPin } from "lucide-react"

import { ActivityColumns, type ActivityActions } from "@/components/analytics/activity-board"
import { ActivityOrderDialog, ActivityPhotoViewer, Spinner } from "@/components/analytics/activity-dialogs"
import { ActivityFilterPanel, type ClientTypeOption } from "@/components/analytics/activity-filter"
import { ActivityStrip } from "@/components/analytics/activity-strip"
import { ClientDrawer } from "@/components/clients/clients-view"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { ClientReturnDialog } from "@/components/orders/returns-view"
import {
  ACTIVITY_COLUMNS,
  activityFilterQuery,
  activitySearch,
  parseActivityState,
  type ActivityBoard,
  type ActivityState,
} from "@/lib/activity-types"
import type { FieldPhoto } from "@/lib/field-activity/types"
import { todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// Активность (Personal → Контроль, demo #/activity): the agent strip and the activity board of
// a period, from real data (lib/activity-repo.ts over the field event stream). All of the
// page's state lives in the query string (fromDate, toDate, agentId, marketType, withGear,
// orderDetails), like the demo, so a link or Back restores it. Default period: today.

/** "26 Окт. 2026" — the header label capitalises the month like the demo. */
function headerDay(day: string, language: Parameters<typeof formatDateText>[1]): string {
  return formatDateText(day, language, { withTime: false }).replace(/^(\d+\s+)(\p{Ll})/u, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`)
}

export function ActivityView() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const today = useMemo(() => todayIso(), [])
  const state = useMemo(() => parseActivityState(new URLSearchParams(searchParams.toString()), today), [searchParams, today])

  const [board, setBoard] = useState<{ key: string; data: ActivityBoard } | null>(null)
  const [boardError, setBoardError] = useState<{ key: string; message: string } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [filterOpen, setFilterOpen] = useState(false)
  const [clientTypes, setClientTypes] = useState<ClientTypeOption[]>([])
  const [viewer, setViewer] = useState<{ photos: FieldPhoto[]; index: number } | null>(null)
  const [returnId, setReturnId] = useState<number | null>(null)

  /** Writes a new state into the URL (useSearchParams follows, no server round-trip). */
  const navigate = useCallback(
    (patch: Partial<ActivityState>) => {
      const next = activitySearch({ ...state, ...patch }, today)
      window.history.replaceState(null, "", `${pathname}${next ? `?${next}` : ""}`)
    },
    [state, pathname, today],
  )

  const filterKey = activityFilterQuery(state).toString()
  const boardKey = useMemo(() => {
    const params = new URLSearchParams(filterKey)
    if (state.agentId !== null) params.set("employeeId", String(state.agentId))
    return params.toString()
  }, [filterKey, state.agentId])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/activity/board?${boardKey}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (ActivityBoard & { error?: string }) | null
        if (!response.ok || !body || !Array.isArray(body.agents)) {
          setBoardError({ key: boardKey, message: body?.error ?? "Не удалось загрузить данные" })
          return
        }
        setBoardError(null)
        setBoard({ key: boardKey, data: body })
      })
      .catch((cause: { name?: string }) => {
        if (cause?.name !== "AbortError") setBoardError({ key: boardKey, message: "Не удалось загрузить данные" })
      })
    return () => controller.abort()
  }, [boardKey, reloadKey])

  // Client types for the filter (all of them, by name).
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/client-types", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<Array<{ id: number; name: string }>>) : []))
      .then((rows) => {
        if (!Array.isArray(rows)) return
        setClientTypes(
          rows
            .filter((row) => Number.isInteger(row.id) && typeof row.name === "string")
            .map((row) => ({ id: row.id, name: row.name }))
            .sort((a, b) => a.name.localeCompare(b.name, "ru")),
        )
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const closeFilter = useCallback(() => setFilterOpen(false), [])
  const closeOrder = useCallback(() => navigate({ orderId: null }), [navigate])
  const closeViewer = useCallback(() => setViewer(null), [])
  const closeShop = useCallback(() => navigate({ shopId: null }), [navigate])
  const closeReturn = useCallback(() => {
    setReturnId(null)
    setReloadKey((key) => key + 1)
  }, [])

  const actions = useMemo<ActivityActions>(
    () => ({
      openOrder: (orderId) => navigate({ orderId }),
      openReturn: (id) => setReturnId(id),
      openClient: (card) => {
        if (card.clientId !== null) navigate({ shopId: card.clientId })
        else if (card.clientName) router.push(`/clients?openClient=${encodeURIComponent(card.clientName)}`)
      },
      openPhotos: (photos, index) => setViewer({ photos, index }),
    }),
    [navigate, router],
  )

  const current = board?.key === boardKey ? board.data : null
  const error = boardError?.key === boardKey ? boardError.message : ""
  const stripData = board?.data ?? null
  const loading = !current && !error
  const empty = current !== null && ACTIVITY_COLUMNS.every((column) => current.columns[column].count === 0)

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f2f5f8] font-sans text-[13px] text-[#333]">
      <header className="flex flex-wrap items-center justify-between gap-3 px-[30px] py-[14px]">
        <div className="flex items-center gap-[10px] text-[17px] font-bold">
          <FavoritesButton className="flex items-center gap-2 text-[#4f71dc]" />
          <span className="font-normal text-[#999]">|</span>
          <h1 className="text-[#555]">{t("Активность")}</h1>
        </div>
        <div className="relative flex flex-wrap items-center gap-4">
          <strong className="text-[12px] text-[#4f71dc]">
            {headerDay(state.from, language)} - {headerDay(state.to, language)}
          </strong>
          {state.agentId !== null && (
            <Link href={`/tracking?view=agents&agent=${state.agentId}&date=${state.to}`} className="flex items-center gap-1 text-[13px] font-semibold text-[#4f71dc] hover:underline">
              <MapPin className="h-4 w-4" />
              {t("Показать на карте")}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            aria-expanded={filterOpen}
            className="inline-flex h-9 items-center gap-2 rounded-[4px] bg-[#5869f0] px-4 text-[13px] font-semibold text-white hover:brightness-95"
          >
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden="true">
              <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
            </svg>
            {t("Показать фильтр")}
          </button>
          {filterOpen && (
            <ActivityFilterPanel
              state={state}
              today={today}
              clientTypes={clientTypes}
              onClose={closeFilter}
              onApply={(draft) => {
                setFilterOpen(false)
                navigate(draft)
              }}
            />
          )}
        </div>
      </header>

      {stripData && (
        <ActivityStrip
          agents={stripData.agents}
          totalVisits={stripData.totalVisits}
          baseCurrency={stripData.baseCurrency}
          selected={state.agentId}
          loading={loading}
          onSelect={(agentId) => navigate({ agentId })}
        />
      )}

      {loading && (
        <div className="flex min-h-[320px] items-center justify-center">
          <Spinner />
        </div>
      )}
      {error && (
        <div className="flex min-h-[320px] flex-col items-center justify-center gap-2">
          <p className="text-[#e57373]">{t(error)}</p>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="text-[#129fdd] hover:underline">
            {t("Повторить")}
          </button>
        </div>
      )}
      {current && !empty && (
        <ActivityColumns columns={current.columns} order={ACTIVITY_COLUMNS} baseCurrency={current.baseCurrency} queryKey={boardKey} actions={actions} />
      )}
      {empty && (
        <section className="flex min-h-[420px] flex-col items-center justify-center gap-4 py-12">
          <Image src="/robot-empty.png" alt={t("Робот-помощник")} width={150} height={150} priority className="h-36 w-36 object-contain" />
          <p className="text-[13px] text-[#999]">{t("По вашему запросу ничего не найдено...")}</p>
        </section>
      )}

      {state.orderId !== null && <ActivityOrderDialog key={state.orderId} orderId={state.orderId} onClose={closeOrder} />}
      {viewer && <ActivityPhotoViewer photos={viewer.photos} start={viewer.index} onClose={closeViewer} />}
      {state.shopId !== null && <ClientDrawer key={state.shopId} clientId={state.shopId} onClose={closeShop} />}
      {returnId !== null && <ClientReturnDialog key={returnId} id={returnId} onClose={closeReturn} />}
    </main>
  )
}
