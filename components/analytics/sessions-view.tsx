"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { EmptyRows, SettingsToolbar, kitHead, kitRow } from "@/components/analytics/settings-list-kit"
import { FilterChip, FilterLink, StaffTabs } from "@/components/staff/staff-kit"
import { FilterDate, FilterSelect, RefFilterPanel } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { formatDateText } from "@/lib/i18n/format-date"
import { notify } from "@/lib/notify"
import { RefTip } from "@/components/ref/ref-tip"

// "Сессия" (demo #/session/, Settings → Персонал; API main/auth_log/?show_tab=active|not_active): tabs Активные /
// Не активные, filter (Пользователь, Дата входа, Дата последнего запроса), grid № | Дата входа | Пользователь (name + IP)
// | [Дата последнего запроса] | Статус with "Завершить" / "Восстановить" and an ⓘ that shows the browser string.
// Moments are stored in UTC ("YYYY-MM-DD HH:MM:SS") and shown in the business time zone, in the UI language.

type AuthLog = {
  id: number
  ip: string | null
  browser: string
  device: string | null
  createdAt: string
  lastResponseAt: string | null
  isActive: boolean
  user: { id: number; name: string }
}
type Employee = { id: number; name: string; active: boolean }
type Filters = { userId: number | null; createdFrom: string; createdTo: string; lastFrom: string; lastTo: string }

const NO_FILTERS: Filters = { userId: null, createdFrom: "", createdTo: "", lastFrom: "", lastTo: "" }
const COLS_ACTIVE = "139px 304px 405px 203px 1fr"
const COLS_INACTIVE = "139px 203px 303px 203px 203px 1fr"

function InfoIcon({ text }: { text: string }) {
  return (
    <RefTip text={text} side="left" gap={12}>
      <span className="flex h-6 w-6 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#4f71dc]"><path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z" /></svg>
      </span>
    </RefTip>
  )
}

export function SessionsView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const [tab, setTab] = useState<"active" | "not_active">("active")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [draft, setDraft] = useState<Filters>(NO_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [data, setData] = useState<{ count: number; results: AuthLog[] } | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  /** Ending / restoring a session is admin-only on the server (PATCH /api/auth-logs/[id]): others do not get the button. */
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ role?: string }>) : null))
      .then((user) => {
        if (!cancelled) setIsAdmin(user?.role === "admin")
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void fetch("/api/employees", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((list: Employee[]) => setEmployees(list.filter((employee) => employee.active)))
      .catch(() => setEmployees([]))
  }, [])

  const load = useCallback(async () => {
    const params = new URLSearchParams({ tab, page: String(page), pageSize: String(pageSize) })
    if (query.trim()) params.set("search", query.trim())
    if (filters.userId) params.set("user", String(filters.userId))
    if (filters.createdFrom) params.set("createdFrom", filters.createdFrom)
    if (filters.createdTo) params.set("createdTo", filters.createdTo)
    if (filters.lastFrom) params.set("lastFrom", filters.lastFrom)
    if (filters.lastTo) params.set("lastTo", filters.lastTo)
    try {
      const response = await fetch(`/api/auth-logs?${params}`, { cache: "no-store" })
      if (!response.ok) throw new Error("load")
      setData((await response.json()) as { count: number; results: AuthLog[] })
    } catch {
      setData({ count: 0, results: [] })
    }
  }, [tab, page, pageSize, query, filters])
  useEffect(() => { void load() }, [load])

  async function toggle(log: AuthLog) {
    if (busyId !== null) return
    setBusyId(log.id)
    try {
      const response = await fetch(`/api/auth-logs/${log.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !log.isActive }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(body.error || "Не удалось изменить сессию"))
        return
      }
      await load()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setBusyId(null)
    }
  }

  const userNames = useMemo(() => employees.map((employee) => employee.name), [employees])
  const total = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(page * pageSize, total)
  const filterCount = [filters.userId, filters.createdFrom, filters.lastFrom].filter(Boolean).length
  const active = tab === "active"
  const cols = active ? COLS_ACTIVE : COLS_INACTIVE

  function applyFilters() {
    setFilters(draft)
    setPage(1)
    setFilterOpen(false)
  }
  function selectTab(label: string) {
    setTab(label === "Активные" ? "active" : "not_active")
    setPage(1)
  }

  const body = (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <StaffTabs labels={["Активные", "Не активные"]} value={active ? "Активные" : "Не активные"} onChange={selectTab} height={50} />
      <div className="relative">
        <SettingsToolbar
          left={
            filterCount > 0
              ? <FilterChip count={filterCount} onEdit={() => { setDraft(filters); setFilterOpen(true) }} onClear={() => { setFilters(NO_FILTERS); setDraft(NO_FILTERS); setPage(1) }} />
              : <FilterLink onClick={() => { setDraft(filters); setFilterOpen((open) => !open) }} />
          }
          className="h-[50px]"
          searchClassName="left-[335px] top-[10px]"
          query={query}
          onQuery={(value) => { setQuery(value); setPage(1) }}
          pager={{
            pageSize,
            onPageSize: (size) => { setPageSize(size); setPage(1) },
            from,
            to,
            total,
            onPrev: page > 1 ? () => setPage(page - 1) : undefined,
            onNext: page < pageCount ? () => setPage(page + 1) : undefined,
          }}
        />
        {filterOpen && (
          <div className="absolute left-0 top-0 z-30">
            <RefFilterPanel narrow className="!w-[300px]" onClose={() => setFilterOpen(false)} onApply={applyFilters}>
              <FilterSelect
                label={t("Пользователь")}
                value={employees.find((employee) => employee.id === draft.userId)?.name ?? ""}
                options={userNames}
                onChange={(name) => setDraft((current) => ({ ...current, userId: employees.find((employee) => employee.name === name)?.id ?? null }))}
              />
              <FilterDate className="-mt-[8px]" label={t("Дата входа")} begin={draft.createdFrom} end={draft.createdTo} onChange={(createdFrom, createdTo) => setDraft((current) => ({ ...current, createdFrom, createdTo }))} />
              <FilterDate className="-mt-[10px]" label={t("Дата последнего запроса")} begin={draft.lastFrom} end={draft.lastTo} onChange={(lastFrom, lastTo) => setDraft((current) => ({ ...current, lastFrom, lastTo }))} />
              <div className="h-[7px]" />
            </RefFilterPanel>
          </div>
        )}
      </div>
      <div className={kitHead} style={{ gridTemplateColumns: cols }}>
        <span className="pl-[30px]">№</span>
        <span>{t("Дата входа")}</span>
        <span>{t("Пользователь")}</span>
        {!active && <span className="pr-[70px] leading-[18px]">{t("Дата последнего запроса")}</span>}
        <span>{t("Статус")}</span>
        <span />
      </div>
      {data?.results.map((log) => (
        <div key={log.id} className={kitRow} style={{ gridTemplateColumns: cols }}>
          <span className="pl-[30px]">{log.id}</span>
          <span>{formatDateText(log.createdAt, language, { withTime: true, utc: true })}</span>
          <span className="py-[7px] leading-[16px]">
            {log.user.name}
            {log.ip && <><br /><span className="text-[#4f71dc]">{log.ip}</span></>}
          </span>
          {!active && <span>{log.lastResponseAt ? formatDateText(log.lastResponseAt, language, { withTime: true, utc: true }) : t("Не указано")}</span>}
          <span>{active ? t("Активный") : t("Не активный")}</span>
          <span className="flex items-center gap-[14px]">
            {isAdmin && (
              <button
                type="button"
                disabled={busyId === log.id}
                onClick={() => void toggle(log)}
                className={`h-[30px] rounded-[3px] text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-60 ${active ? "bg-[#71ce87] px-[14px]" : "bg-[#4f71dc] px-[16px]"}`}
              >
                {active ? t("Завершить") : t("Восстановить")}
              </button>
            )}
            <InfoIcon text={log.browser} />
          </span>
        </div>
      ))}
      {data && data.results.length === 0 && <EmptyRows />}
    </section>
  )
  return embedded ? body : <main className="min-h-[calc(100vh-4rem)] bg-white">{body}</main>
}
