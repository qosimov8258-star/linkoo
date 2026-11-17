"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { useCanManage } from "@/components/analytics/cash-management-shared"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { TrackingDay } from "@/lib/tracking-types"

import { AgentDayPanel } from "./agent-day-panel"
import { ClientDrawer, FieldRecordDialog, LocationLockDialog, OptimizeDialog, OrderSummaryDialog } from "./agents-tracking-dialogs"

// An agent's day with its dialogs: the drawer of the visit reports (agent-visit-drawer.tsx) and the agent's page of
// Анализ маршрутов (components/clients/agent-route-view.tsx). The day comes from GET /api/tracking/agents/<id>/day.

type Dialog =
  | { kind: "order"; id: number }
  | { kind: "record"; record: "refusal" | "photo_report"; id: number }
  | { kind: "client"; id: number }
  | { kind: "optimize" }
  | { kind: "lock" }

/** The agent's day with its dialogs (order, field record, client card, route optimisation, location lock): the drawer
 * of the visit reports and the agent page of Анализ маршрутов (variant "plan", `planHeader` gets the shown day). */
export function AgentDayView({
  employeeId,
  name,
  date,
  variant,
  onClose,
  closeOnEscape = false,
  planHeader,
  onDayChange,
}: {
  employeeId: number
  name?: string
  date?: string
  variant: "drawer" | "plan"
  onClose: () => void
  closeOnEscape?: boolean
  planHeader?: (shown: { day: string; data: TrackingDay | null }) => ReactNode
  /** The shown day changed (the page's agent list follows it). */
  onDayChange?: (day: string) => void
}) {
  const { t } = useLanguage()
  const router = useRouter()
  const canManage = useCanManage(["clients.manage"])
  const [day, setDay] = useState(() => date || todayIso())
  const [tick, setTick] = useState(0)
  const [state, setState] = useState<{ key: string; data: TrackingDay | null; error: string }>({ key: "", data: null, error: "" })
  const [selected, setSelected] = useState<number[]>([])
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const key = `${employeeId}|${day}|${tick}`

  useEffect(() => {
    let cancelled = false
    fetch(`/api/tracking/agents/${employeeId}/day?date=${day}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (TrackingDay & { error?: string }) | null
        if (!response.ok || !body) throw new Error(t(body?.error || "Не удалось загрузить данные"))
        return body
      })
      .then((data) => {
        if (!cancelled) setState({ key, data, error: "" })
      })
      .catch((reason: unknown) => {
        if (!cancelled) setState({ key, data: null, error: reason instanceof Error ? reason.message : t("Не удалось загрузить данные") })
      })
    return () => {
      cancelled = true
    }
  }, [employeeId, day, key, t])

  // Escape closes the open dialog first, then the drawer.
  useEffect(() => {
    if (dialog || !closeOnEscape) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [dialog, onClose, closeOnEscape])

  const loading = state.key !== key
  const current = state.data
  const openClient = useCallback((clientId: number) => setDialog({ kind: "client", id: clientId }), [])
  const selectableIds = useMemo(() => (current?.clients ?? []).flatMap((client) => (client.clientId !== null ? [client.clientId] : [])), [current])
  const plannedOptions = useMemo(
    () => (current?.clients ?? []).filter((client) => client.planned && client.clientId !== null).map((client) => ({ id: client.clientId as number, label: client.clientName })),
    [current],
  )
  const reload = () => setTick((value) => value + 1)

  return (
    <>
      <AgentDayPanel
        variant={variant}
        planHeader={planHeader?.({ day, data: current && !loading ? current : null })}
        employeeId={employeeId}
        name={current?.employee.name ?? name ?? ""}
        day={current}
        loading={loading}
        error={loading ? "" : state.error}
        date={day}
        onDate={(next) => {
          setSelected([])
          setDay(next)
          onDayChange?.(next)
        }}
        onPrev={null}
        onNext={null}
        onClose={onClose}
        status="all"
        onStatus={() => {}}
        selected={selected}
        onToggle={(clientId) => setSelected((list) => (list.includes(clientId) ? list.filter((id) => id !== clientId) : [...list, clientId]))}
        onSelectAll={() => setSelected((list) => (selectableIds.length && selectableIds.every((id) => list.includes(id)) ? [] : selectableIds))}
        canManage={canManage}
        planShown={false}
        onTogglePlan={() => {}}
        onOptimize={() => setDialog({ kind: "optimize" })}
        onEditRoute={() => router.push(`/clients?select=${selected.join(",")}`)}
        onEditLock={() => setDialog({ kind: "lock" })}
        actions={{
          onOpenClient: openClient,
          onOpenOrder: (id) => setDialog({ kind: "order", id }),
          onOpenRecord: (record, id) => setDialog({ kind: "record", record, id }),
        }}
      />

      {dialog?.kind === "optimize" && (
        <OptimizeDialog
          employeeId={employeeId}
          date={day}
          clients={plannedOptions}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            reload()
          }}
        />
      )}
      {dialog?.kind === "lock" && (
        <LocationLockDialog
          clientIds={selected}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setSelected([])
            reload()
          }}
        />
      )}
      {dialog?.kind === "record" && <FieldRecordDialog kind={dialog.record} id={dialog.id} onClose={() => setDialog(null)} onOpenClient={openClient} />}
      {dialog?.kind === "order" && <OrderSummaryDialog orderId={dialog.id} onClose={() => setDialog(null)} onNavigate={(href) => router.push(href)} />}
      {dialog?.kind === "client" && <ClientDrawer clientId={dialog.id} onClose={() => setDialog(null)} onNavigate={(href) => router.push(href)} />}
    </>
  )
}
