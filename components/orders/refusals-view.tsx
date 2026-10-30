"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { FilterDate, FilterSelect, RefCard, RefFilterPanel, RefHeader, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit"
import { optionLabels, type FieldRecordFacets, type FieldRecordPage, type FieldRecordRow } from "@/lib/field-activity/record-list-types"
import { monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// "Отказы" (Продажи): the visit refusals the agents record in the mobile app — the field data of
// Активность / Отслеживание (lib/field-activity, GET /api/field-activity/refusals), paged and
// filtered on the server. Agent and refusal type filter by id; a field employee sees their own.

/** The current month in the business time zone (Asia/Tashkent). */
function currentMonth() {
  const today = todayIso()
  return { begin: monthStartIso(today), end: monthEndIso(today) }
}

type Filters = { begin: string; end: string; agentId: number | null; typeId: number | null }

const EMPTY_FACETS: FieldRecordFacets = { employees: [], clients: [], refusalTypes: [] }

export function RefusalsView() {
  const { t, language } = useLanguage()
  // Like the reference, the panel offers the current month but the list stays unfiltered until "Применить".
  const [draft, setDraft] = useState<Filters>(() => ({ ...currentMonth(), agentId: null, typeId: null }))
  const [applied, setApplied] = useState<Filters | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [result, setResult] = useState<{ count: number; rows: FieldRecordRow[] }>({ count: 0, rows: [] })
  const [facets, setFacets] = useState<FieldRecordFacets | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // The search goes to the server (it spans every page), a moment after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  // The filter options come with the first answer only (a later filter change does not ask again).
  const facetsLoaded = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    const needFacets = !facetsLoaded.current
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search) params.set("q", search)
    if (applied) {
      if (applied.begin) params.set("from", applied.begin)
      if (applied.end) params.set("to", applied.end)
      if (applied.agentId) params.set("employeeId", String(applied.agentId))
      if (applied.typeId) params.set("refusalTypeId", String(applied.typeId))
    }
    if (needFacets) params.set("facets", "true")
    setLoading(true)
    fetch(`/api/field-activity/refusals?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (FieldRecordPage & { error?: string }) | null
        if (!response.ok || !body || !Array.isArray(body.rows)) throw new Error(body?.error || "Не удалось загрузить данные")
        setResult({ count: body.count, rows: body.rows })
        if (body.facets) {
          facetsLoaded.current = true
          setFacets(body.facets)
        }
        setError("")
        setLoading(false)
      })
      .catch((cause: Error) => {
        if (cause.name === "AbortError") return
        setResult({ count: 0, rows: [] })
        if (needFacets) setFacets((current) => current ?? EMPTY_FACETS)
        setError(cause.message || "Не удалось загрузить данные")
        setLoading(false)
      })
    return () => controller.abort()
  }, [page, pageSize, search, applied])

  const agents = useMemo(() => optionLabels(facets?.employees ?? []), [facets])
  const reasons = useMemo(() => optionLabels(facets?.refusalTypes ?? []), [facets])
  const pageCount = Math.max(1, Math.ceil(result.count / pageSize))
  const start = (page - 1) * pageSize

  return (
    <RefPage>
      <RefHeader title={t("Отказы")} />
      <RefCard>
        <RefToolbar
          linkFilter="flush"
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <RefFilterPanel
              narrow
              onClose={() => setFilterOpen(false)}
              onApply={() => {
                setApplied(draft)
                setPage(1)
                setFilterOpen(false)
              }}
            >
              <div className="px-5">
                <FilterDate label={t("Период")} begin={draft.begin} end={draft.end} words onChange={(begin, end) => setDraft((current) => ({ ...current, begin, end }))} />
                <FilterSelect
                  label={t("Агент")}
                  value={draft.agentId ? (agents.labelOf.get(draft.agentId) ?? "") : ""}
                  options={agents.labels}
                  onChange={(label) => setDraft((current) => ({ ...current, agentId: agents.idOf.get(label) ?? null }))}
                />
                <FilterSelect
                  label={t("Тип отказа")}
                  value={draft.typeId ? (reasons.labelOf.get(draft.typeId) ?? "") : ""}
                  options={reasons.labels}
                  onChange={(label) => setDraft((current) => ({ ...current, typeId: reasons.idOf.get(label) ?? null }))}
                />
              </div>
            </RefFilterPanel>
          }
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setPage(1)
          }}
          pageSize={pageSize}
          onPageSize={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          from={result.count ? start + 1 : 0}
          to={Math.min(start + result.rows.length, result.count)}
          total={result.count}
          page={Math.min(page, pageCount)}
          pageCount={pageCount}
          onPage={setPage}
        />
        <RefTable
          cols="minmax(0,1fr) minmax(0,3fr) minmax(0,3fr) minmax(0,3fr) minmax(0,2fr)"
          heads={[t("№"), t("Дата создания"), t("Агент"), t("Клиент"), t("Причина")]}
          rows={result.rows}
          rowKey={(row) => row.id}
          render={(row) => [
            row.id,
            formatDateText(row.at, language, { withTime: true }),
            row.employeeName || `#${row.employeeId}`,
            row.clientName || `#${row.clientId}`,
            <span key="reason" title={row.reason && row.comment ? row.comment : undefined}>
              {row.reason || row.comment || "—"}
            </span>,
          ]}
          empty={loading ? t("Загрузка...") : error ? t(error) : t("Ничего не найдено")}
        />
      </RefCard>
    </RefPage>
  )
}
