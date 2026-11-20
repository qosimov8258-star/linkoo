"use client"

import { useEffect, useMemo, useState } from "react"

import { SearchSelect, type PickOption } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"

// «ИЗМЕНЕНИЕ МАРШРУТА» of the Клиенты page (Linko's #/shop?openPlanCreate=true, opened by «Уст. маршрут» and by the
// shop drawer's Маршруты pencil): on the left an agent, a visit frequency and weekdays with «Добавить» / «Удалить»
// (and «Удалить другие маршруты»), on the right each picked shop with its agents' routes, the days green. Nothing is
// written until «Сохранить»: then each changed route is saved (PUT /api/field-activity/route-plans) or removed
// (DELETE), shop by shop.

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
const FREQUENCIES = [
  { value: 1, label: "Раз в неделю" },
  { value: 2, label: "Раз в 2 недели" },
  { value: 3, label: "Раз в 3 недели" },
  { value: 4, label: "Раз в 4 недели" },
]
const frequencyLabel = (weeks: number) => FREQUENCIES.find((item) => item.value === weeks)?.label ?? FREQUENCIES[0].label

type Route = { employeeId: number; weekdays: number[]; intervalWeeks: number }
type ShopRoutes = Record<number, Route[]>
type Employee = { employeeId: number; name: string; active: boolean }

const sameRoute = (a: Route | undefined, b: Route | undefined) =>
  !!a && !!b && a.intervalWeeks === b.intervalWeeks && a.weekdays.length === b.weekdays.length && a.weekdays.every((day) => b.weekdays.includes(day))

async function send(method: "PUT" | "DELETE", body: unknown): Promise<string | null> {
  const response = await fetch("/api/field-activity/route-plans", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (response.ok) return null
  const data = (await response.json().catch(() => null)) as { error?: string } | null
  return response.status === 403 ? "Недостаточно прав" : data?.error || "Не удалось сохранить"
}

function DayChip({ day, on, onClick, size = "form" }: { day: number; on: boolean; onClick?: () => void; size?: "form" | "row" }) {
  const { t } = useLanguage()
  const look = on ? "bg-[#8de0a6] font-semibold text-white" : "bg-[#ececec] text-[#666]"
  const box = `flex h-[32px] w-[32px] items-center justify-center text-[13px] ${look}`
  // Linko's row chips: 11 px apart, the green ones 4 px.
  if (!onClick) return <div className={`${box} ${size === "row" ? (on ? "mr-[4px]" : "mr-[11px]") : ""}`}>{t(WEEKDAYS[day - 1])}</div>
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={box}>
      {t(WEEKDAYS[day - 1])}
    </button>
  )
}

export function RoutePlanDialog({ shops, onClose, onSaved }: { shops: Array<{ id: number; name: string }>; onClose: () => void; onSaved: (shopIds: number[]) => void }) {
  const { t } = useLanguage()
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [saved, setSaved] = useState<ShopRoutes | null>(null)
  const [draft, setDraft] = useState<ShopRoutes>({})
  const [agentId, setAgentId] = useState("")
  const [frequency, setFrequency] = useState("1")
  const [days, setDays] = useState<number[]>([])
  const [dropOthers, setDropOthers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const shopKey = shops.map((shop) => shop.id).join(",")

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/field-activity/employees?includeInactive=true", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ rows?: Array<{ employeeId: number; name: string; active: boolean }> }>) : { rows: [] }))
      .then((body) => setEmployees((body.rows ?? []).map((row) => ({ employeeId: row.employeeId, name: row.name, active: row.active !== false }))))
      .catch((cause: { name?: string }) => {
        if (cause?.name !== "AbortError") setEmployees([])
      })
    Promise.all(
      shopKey
        .split(",")
        .filter(Boolean)
        .map(async (id) => {
          const response = await fetch(`/api/field-activity/route-plans?clientId=${id}`, { cache: "no-store", signal: controller.signal })
          const body = (response.ok ? await response.json() : { rows: [] }) as { rows?: Array<{ id: number; employeeId: number; weekdays: number[]; intervalWeeks: number }> }
          // The newest route first, as the drawer's Маршруты and Linko's dialog list them.
          const rows = [...(body.rows ?? [])].sort((a, b) => b.id - a.id)
          return [Number(id), rows.map((row) => ({ employeeId: row.employeeId, weekdays: [...row.weekdays].sort((a, b) => a - b), intervalWeeks: row.intervalWeeks || 1 }))] as const
        }),
    )
      .then((entries) => {
        const routes = Object.fromEntries(entries) as ShopRoutes
        setSaved(routes)
        setDraft(routes)
      })
      .catch((cause: { name?: string }) => {
        if (cause?.name !== "AbortError") setError("Не удалось загрузить данные")
      })
    return () => controller.abort()
  }, [shopKey])

  const names = useMemo(() => new Map((employees ?? []).map((item) => [item.employeeId, item.name])), [employees])
  const agentOptions: PickOption[] = (employees ?? []).filter((item) => item.active).map((item) => ({ value: String(item.employeeId), label: item.name }))
  const frequencyOptions: PickOption[] = FREQUENCIES.map((item) => ({ value: String(item.value), label: t(item.label) }))
  const ready = saved !== null && employees !== null
  const canApply = ready && !!agentId && days.length > 0

  /** «Добавить»: the agent visits every picked shop on these days too (with this frequency); «Удалить»: not on them. */
  function apply(add: boolean) {
    if (!canApply) return
    const employeeId = Number(agentId)
    const weeks = Number(frequency) || 1
    setDraft((current) => {
      const next: ShopRoutes = {}
      for (const shop of shops) {
        const routes = current[shop.id] ?? []
        const mine = routes.find((route) => route.employeeId === employeeId)
        const others = routes.filter((route) => route.employeeId !== employeeId)
        if (add) {
          const weekdays = [...new Set([...(mine?.weekdays ?? []), ...days])].sort((a, b) => a - b)
          const route = { employeeId, weekdays, intervalWeeks: weeks }
          next[shop.id] = dropOthers ? [route] : mine ? routes.map((item) => (item.employeeId === employeeId ? route : item)) : [...routes, route]
        } else {
          const weekdays = (mine?.weekdays ?? []).filter((day) => !days.includes(day))
          next[shop.id] = mine && weekdays.length ? routes.map((item) => (item.employeeId === employeeId ? { ...item, weekdays } : item)) : others
        }
      }
      return next
    })
  }

  async function save() {
    if (!saved) return
    setSaving(true)
    setError("")
    try {
      for (const shop of shops) {
        const before = saved[shop.id] ?? []
        const after = draft[shop.id] ?? []
        for (const route of after) {
          if (sameRoute(route, before.find((item) => item.employeeId === route.employeeId))) continue
          const failed = await send("PUT", { employeeId: route.employeeId, clientIds: [shop.id], weekdays: route.weekdays, intervalWeeks: route.intervalWeeks })
          if (failed) throw new Error(failed)
        }
        for (const route of before) {
          if (after.some((item) => item.employeeId === route.employeeId)) continue
          const failed = await send("DELETE", { employeeId: route.employeeId, clientIds: [shop.id] })
          if (failed) throw new Error(failed)
        }
      }
      onSaved(shops.map((shop) => shop.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex bg-black/[0.54]">
      <div role="dialog" aria-modal="true" aria-label={t("Изменение маршрута")} className="flex h-full w-full flex-col bg-white font-sans text-[13px] text-[#333]">
        <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <h2 className="text-[13px] font-bold uppercase">{t("Изменение маршрута")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-[400px] shrink-0 overflow-y-auto border-r border-[#efefef] px-[30px] pt-[45px]">
            {/* Linko's «Агент» sits inside the empty field and moves above it once an agent is picked. */}
            <div className="relative mb-[14px] pt-[12px]">
              <p className={`pointer-events-none absolute left-0 z-[1] font-semibold ${agentId ? "top-0 text-[10px]" : "top-[20px] text-[13px]"}`}>{t("Агент")}</p>
              <SearchSelect variant="underline" value={agentId} onChange={(value) => setAgentId(value)} options={agentOptions} placeholder="" loading={employees === null} />
            </div>
            <div className="mb-[24px]">
              <p className="mb-[2px] text-[10px] font-semibold">{t("Частота посещения")}</p>
              <SearchSelect variant="underline" value={frequency} onChange={(value) => setFrequency(value)} options={frequencyOptions} placeholder="" />
            </div>
            <div className="mb-[25px] flex justify-between">
              {WEEKDAYS.map((_, index) => (
                <DayChip key={index} day={index + 1} on={days.includes(index + 1)} onClick={() => setDays((current) => (current.includes(index + 1) ? current.filter((day) => day !== index + 1) : [...current, index + 1]))} />
              ))}
            </div>
            <div className="flex justify-between">
              {/* Linko shows both buttons in full colour; they act once an agent and a day are picked. */}
              <button type="button" aria-disabled={!canApply} onClick={() => apply(true)} className="h-[35px] w-[49%] rounded-[2px] bg-[#4f71dc] text-[13px] text-white">
                {t("Добавить")}
              </button>
              <button type="button" aria-disabled={!canApply} onClick={() => apply(false)} className="h-[35px] w-[49%] rounded-[2px] bg-[#e57373] text-[13px] text-white">
                {t("Удалить")}
              </button>
            </div>
            <label className="mt-[10px] flex cursor-pointer items-center gap-[6px] font-semibold">
              <input type="checkbox" checked={dropOthers} onChange={(event) => setDropOthers(event.target.checked)} className="h-[18px] w-[18px] accent-[#333]" />
              {t("Удалить другие маршруты")}
            </label>
            {error && <p className="mt-[14px] text-[#e57373]">{t(error)}</p>}
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto px-[30px] pt-[30px]">
            <div className="flex h-[52px] items-center border-b border-dotted border-[#ccc] pb-[7px] pt-[5px] font-semibold">
              <div className="w-1/4 px-2">{t("Клиент")}</div>
              <div className="w-3/4 px-2">
                {t("Маршруты")} ({t("Частота посещений")})
              </div>
            </div>
            {!ready ? (
              <p className="py-6 text-center text-[#999]">{t("Загрузка...")}</p>
            ) : (
              shops.map((shop) => (
                <div key={shop.id} className="flex border-b border-dotted border-[#ccc] pb-[12px] pt-[5px]">
                  <div className="w-1/4 self-center px-2">{shop.name}</div>
                  <div className="flex w-3/4 flex-wrap gap-x-[35px] gap-y-[6px] px-2">
                    {(draft[shop.id] ?? []).map((route) => (
                      <div key={route.employeeId}>
                        <p className="mb-[4px]">
                          {names.get(route.employeeId) || `№${route.employeeId}`} ({t(frequencyLabel(route.intervalWeeks))}):
                        </p>
                        <div className="flex">
                          {WEEKDAYS.map((_, index) => (
                            <DayChip key={index} size="row" day={index + 1} on={route.weekdays.includes(index + 1)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="flex h-[60px] shrink-0 items-center justify-end border-t border-[#efefef] px-[10px]">
          <button type="button" disabled={!ready || saving} onClick={() => void save()} className="h-[36px] rounded-[2px] px-[16px] text-[13px] uppercase text-[#4f71dc] hover:bg-[#f5f5f5] disabled:opacity-50">
            {t("Сохранить")}
          </button>
        </div>
      </div>
    </div>
  )
}
