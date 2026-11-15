"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { useCanManage } from "@/components/analytics/cash-management-shared"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { TrackingDay } from "@/lib/tracking-types"

import { AgentDayPanel } from "./agent-day-panel"
import { ClientDrawer, FieldRecordDialog, LocationLockDialog, OptimizeDialog, OrderSummaryDialog } from "./agents-tracking-dialogs"

// The agent drawer of the visit reports (Linko's drawer_agent_visit): a click on an agent's name in Системная
// дистрибуция, Визиты агента, Визиты по дням, Время работы агента … opens the agent's day on the right — сделки,
// посещено, Заказ оформлен / Отказы / Надо посетить, the day switcher and the timeline of clients — the same day
// as Отслеживание (GET /api/tracking/agents/<id>/day). The day is the end of the report's period, as Linko's.

type Dialog =
  | { kind: "order"; id: number }
  | { kind: "record"; record: "refusal" | "photo_report"; id: number }
  | { kind: "client"; id: number }
  | { kind: "optimize" }
  | { kind: "lock" }

export function AgentVisitDrawer({ employeeId, name, date, onClose }: { employeeId: number; name?: string; date?: string; onClose: () => void }) {
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
    if (dialog) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [dialog, onClose])

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
    <div className="fixed inset-0 z-[700]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={current?.employee.name ?? name ?? t("Агент")}
        className="absolute bottom-0 right-0 top-0 w-[600px] max-w-full bg-white shadow-[-2px_0_10px_rgba(0,0,0,0.2)]"
      >
        <AgentDayPanel
          variant="drawer"
          employeeId={employeeId}
          name={current?.employee.name ?? name ?? ""}
          day={current}
          loading={loading}
          error={loading ? "" : state.error}
          date={day}
          onDate={(next) => {
            setSelected([])
            setDay(next)
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
      </aside>

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
    </div>
  )
}

// ---------------------------------------------------------------------------
// One drawer per page: any agent name inside <AgentDrawerScope> opens it
// ---------------------------------------------------------------------------

type OpenAgent = (agent: { employeeId: number; name?: string; date?: string }) => void

const AgentDrawerContext = createContext<OpenAgent | null>(null)

/** Hosts the agent drawer of a page; <AgentLink> inside opens it. `date` = the day it opens on (the report's end). */
export function AgentDrawerScope({ date, children }: { date?: string; children: ReactNode }) {
  const [agent, setAgent] = useState<{ employeeId: number; name?: string; date?: string } | null>(null)
  const open = useCallback<OpenAgent>((next) => setAgent(next), [])
  return (
    <AgentDrawerContext.Provider value={open}>
      {children}
      {agent && <AgentVisitDrawer key={`${agent.employeeId}|${agent.date ?? date ?? ""}`} employeeId={agent.employeeId} name={agent.name} date={agent.date ?? date} onClose={() => setAgent(null)} />}
    </AgentDrawerContext.Provider>
  )
}

/** An agent's name as Linko's blue link: a click opens the agent drawer of the page (plain text outside a scope). */
export function AgentLink({ employeeId, name, date, className = "" }: { employeeId: number | null | undefined; name: ReactNode; date?: string; className?: string }) {
  const open = useContext(AgentDrawerContext)
  if (!open || !employeeId) return <>{name}</>
  return (
    <button
      type="button"
      onClick={(event) => {
        // A grouped row toggles itself on click: the name opens the drawer only.
        event.stopPropagation()
        open({ employeeId, name: typeof name === "string" ? name : undefined, date })
      }}
      className={`max-w-full truncate text-left text-[#1E4A9A] hover:underline ${className}`}
    >
      {name}
    </button>
  )
}
