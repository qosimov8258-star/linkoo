"use client"

import { CircleAlert, FileSpreadsheet, Info, Loader2, SearchX } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { buildBalanceQuery, useLookup } from "@/components/analytics/balance/use-balance"
import { ManagementBranchCard, managementBranchName, managementExcelRows } from "@/components/analytics/management-balance-card"
import { ManagementFilterBar, type ManagementFilters } from "@/components/analytics/management-balance-filters"
import { RefHeader } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import { defaultBalancePeriod, isIsoDay, monthStartIso } from "@/lib/finance/dates"
import {
  MANAGEMENT_NAME_PREFIX,
  MANAGEMENT_NO_BRANCH,
  MANAGEMENT_NO_BRANCH_LABEL,
  type ManagementBranchOption,
  type ManagementReport,
} from "@/lib/finance-management-balance-types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Управленческий баланс по филиалам" (demo #/widget-balance/?beginDate&endDate,
// GET stats/branch_balance/): a balance sheet per branch (Активы / Пассивы /
// Собственный капитал / Курс) at the start of beginDate and at the end of
// endDate. Data: GET /api/balances/management-balance (the shared management
// balance of lib/finance). As in the demo, the filters (beginDate, endDate,
// division = organizations, branch) live in the URL query; the menu default is
// the 1st of the current month .. today.

type Named = { id: number; name: string }
type ReportState = { data: ManagementReport | null; loading: boolean; error: string; reload: () => void }

function useReport(url: string): ReportState {
  const [data, setData] = useState<ManagementReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error((body as { error?: string } | null)?.error || `HTTP ${response.status}`)
        setData(body as ManagementReport)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [url, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { data, loading, error, reload }
}

/** Applied filters from the URL (demo query beginDate/endDate/division/branch). */
function useAppliedFilters(): ManagementFilters & { complete: boolean } {
  const searchParams = useSearchParams()
  const fallback = defaultBalancePeriod()
  const pick = (...names: string[]) => names.map((name) => searchParams.get(name) ?? "").find(isIsoDay) ?? ""
  const endParam = pick("endDate", "toDate")
  const begin = pick("beginDate", "fromDate") || (endParam ? monthStartIso(endParam) : fallback.from)
  const end = endParam || (begin > fallback.to ? begin : fallback.to)
  const [from, to] = begin <= end ? [begin, end] : [end, begin]
  return {
    from,
    to,
    organizations: [...new Set(searchParams.getAll("division").filter(Boolean))],
    branch: (searchParams.get("branch") ?? "").trim(),
    complete: searchParams.get("beginDate") === from && searchParams.get("endDate") === to,
  }
}

function filtersQuery(filters: ManagementFilters): string {
  return buildBalanceQuery({ beginDate: filters.from, endDate: filters.to, division: filters.organizations, branch: filters.branch })
}

export function ManagementBalanceView() {
  const { t, language } = useLanguage()
  const pathname = usePathname()
  const applied = useAppliedFilters()
  const { from, to, organizations, branch, complete } = applied
  const query = filtersQuery({ from, to, organizations, branch })
  const { data, loading, error, reload } = useReport(`/api/balances/management-balance?${query}`)

  // The demo menu link always carries beginDate/endDate: put the defaults into the URL.
  useEffect(() => {
    if (!complete) window.history.replaceState(null, "", `${pathname}?${query}`)
  }, [complete, pathname, query])

  const organizationRows = useLookup<Named>("/api/organizations")
  const branchRows = useLookup<Named>("/api/branches")

  const organizationOptions = useMemo(() => {
    const names = organizationRows.map((row) => row.name).filter(Boolean)
    return [...new Set([...names.sort((a, b) => a.localeCompare(b, "ru")), ...organizations])]
  }, [organizationRows, organizations])

  const branchOptions = useMemo<ManagementBranchOption[]>(() => {
    const options = new Map<string, ManagementBranchOption>()
    for (const row of [...branchRows].sort((a, b) => a.id - b.id)) options.set(String(row.id), { value: String(row.id), name: row.name, virtual: false })
    for (const option of data?.options ?? []) if (!options.has(option.value)) options.set(option.value, option)
    // A filter value from the URL that matches no card ("name:<name>" or an unknown id) stays selectable.
    if (branch && !options.has(branch)) {
      const name = branch === MANAGEMENT_NO_BRANCH ? MANAGEMENT_NO_BRANCH_LABEL : branch.startsWith(MANAGEMENT_NAME_PREFIX) ? branch.slice(MANAGEMENT_NAME_PREFIX.length) : branch
      options.set(branch, { value: branch, name, virtual: true })
    }
    return [...options.values()].map((option) => ({ ...option, name: managementBranchName(option, t) }))
  }, [branchRows, data?.options, branch, t])

  // Expanded sections per card ("<branch value>:<section key>"); collapsed by default as in the demo.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const apply = (next: ManagementFilters) => {
    const nextQuery = filtersQuery(next)
    // Same filters: refetch like the demo "Применить" does. Compared with the
    // normalized applied query (not location.search, whose encoding/order may
    // differ, e.g. "%20" vs "+"), or a no-op pushState would skip the refetch.
    if (nextQuery === query) reload()
    else window.history.pushState(null, "", `${pathname}?${nextQuery}`)
  }

  const download = () => {
    if (data) downloadExcelTable(`management-balance-${data.from}-${data.to}`, managementExcelRows(data, t, language))
  }

  const filtered = organizations.length > 0 || Boolean(branch)
  const branches = data?.branches ?? []

  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#f2f5f8] px-[28px] pb-5">
      <RefHeader title={t("Управленческий баланс по филиалам")} />

      <ManagementFilterBar
        key={query}
        initial={{ from, to, organizations, branch }}
        organizations={organizationOptions}
        branches={branchOptions}
        onApply={apply}
      />

      {data && data.missingRates.length > 0 && (
        <p className="mb-5 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t("Не задан курс валют: {codes}. Суммы в этих валютах не включены в итоги разделов.").replace("{codes}", data.missingRates.map(currencyLabel).join(", "))}
        </p>
      )}

      {error && (
        <div className="mb-5 flex flex-col items-center gap-3 rounded bg-white py-10 text-center text-slate-600 shadow">
          <CircleAlert className="h-10 w-10 text-[#E27676]" />
          <p>
            {t("Не удалось загрузить данные")}: {t(error)}
          </p>
          <button type="button" onClick={reload} className="rounded-md border border-[#4f70e7] px-4 py-2 font-semibold text-[#4f70e7]">
            {t("Повторить")}
          </button>
        </div>
      )}

      {!data && loading && (
        <div className="flex items-center justify-center gap-2 rounded bg-white py-24 text-slate-500 shadow">
          <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
        </div>
      )}

      {data && !branches.length && !error && (
        <div className="flex flex-col items-center gap-3 rounded bg-white py-24 text-center text-sm text-slate-500 shadow">
          {loading ? <Loader2 className="h-10 w-10 animate-spin text-slate-400" /> : <SearchX className="h-12 w-12 text-slate-400" />}
          {loading ? t("Загрузка...") : filtered ? t("По вашему запросу ничего не найдено") : t("Нет данных")}
        </div>
      )}

      {data && !error && branches.length > 0 && (
        <div className={`relative space-y-[15px] transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`} aria-busy={loading}>
          {loading && (
            <div className="absolute inset-x-0 top-10 z-10 flex justify-center">
              <span className="flex items-center gap-2 rounded bg-white px-4 py-2 text-sm text-slate-600 shadow">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("Загрузка...")}
              </span>
            </div>
          )}
          {branches.map((card) => (
            <ManagementBranchCard
              key={card.value}
              branch={card}
              from={data.from}
              to={data.to}
              isOpen={(section) => expanded.has(`${card.value}:${section}`)}
              onToggle={(section) => toggle(`${card.value}:${section}`)}
            />
          ))}
        </div>
      )}
    </main>
  )
}
