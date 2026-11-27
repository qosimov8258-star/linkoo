"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { AiSummary, StatusBadge, SeverityBadge, STATUS_LABELS, apiError, formatDateTime, shortPageUrl } from "@/components/bug-report/admin-ui"
import { FilterCheck, RefCard, RefHeader, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit"
import { BUG_REPORT_STATUSES, BUG_SEVERITIES, type BugReportListItem, type BugReportStatus, type BugSeverity } from "@/lib/bug-reports/types"
import { useLanguage } from "@/lib/i18n/language-context"

type ListAnswer = { rows: BugReportListItem[]; total: number }

const COLS = "minmax(0,1fr) minmax(0,1.1fr) minmax(0,1.6fr) minmax(0,2.8fr) minmax(0,0.8fr) minmax(0,0.8fr)"
const HEADS = ["Дата", "Пользователь", "Страница", "Анализ ИИ", "Серьёзность", "Статус"]

const SELECT_CLASS = "h-[30px] rounded-[5px] border border-[#e0e0e0] bg-white px-2 text-[13px] font-semibold text-black outline-none focus:border-[#5d6474]"

/** «Xato xabarlari» (admin): the reports of the AI assistant, newest first, filtered and paged on the server. */
export function BugReportsAdminList() {
  const { t } = useLanguage()
  const router = useRouter()
  const [status, setStatus] = useState<BugReportStatus | "">("")
  const [severity, setSeverity] = useState<BugSeverity | "">("")
  const [resolvedByAi, setResolvedByAi] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [data, setData] = useState<ListAnswer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (status) params.set("status", status)
    if (severity) params.set("severity", severity)
    if (resolvedByAi) params.set("resolvedByAi", "1")
    setLoading(true)
    fetch(`/api/admin/bug-reports?${params}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiError(response, "Не удалось загрузить данные"))
        return (await response.json()) as ListAnswer
      })
      .then((answer) => {
        if (cancelled) return
        setData({ rows: Array.isArray(answer.rows) ? answer.rows : [], total: Number(answer.total) || 0 })
        setError("")
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setData({ rows: [], total: 0 })
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить данные")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status, severity, resolvedByAi, page, pageSize])

  const total = data?.total ?? 0
  const rows = data?.rows ?? []
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(page * pageSize, total)

  // A filter change starts again from the first page (the old page may not exist any more).
  const filtered = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setPage(1)
  }

  const filters = (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-[10px] pl-[5px]">
      <label className="flex items-center gap-2">
        <span className="text-[#5d6474]">{t("Статус")}</span>
        <select value={status} onChange={(event) => filtered(setStatus)(event.target.value as BugReportStatus | "")} className={SELECT_CLASS}>
          <option value="">{t("Все")}</option>
          {BUG_REPORT_STATUSES.map((value) => (
            <option key={value} value={value}>{t(STATUS_LABELS[value])}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <span className="text-[#5d6474]">{t("Серьёзность")}</span>
        <select value={severity} onChange={(event) => filtered(setSeverity)(event.target.value as BugSeverity | "")} className={SELECT_CLASS} data-no-translate>
          <option value="">{t("Все")}</option>
          {BUG_SEVERITIES.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <FilterCheck label="Решено ИИ" checked={resolvedByAi} onChange={filtered(setResolvedByAi)} compact />
    </div>
  )

  return (
    <RefPage>
      <RefHeader title="Сообщения об ошибках" />
      <RefCard>
        <RefToolbar
          leftSlot={filters}
          filterWidth={620}
          hideSearch
          query=""
          onQuery={() => undefined}
          pageSize={pageSize}
          onPageSize={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          from={from}
          to={to}
          total={total}
          page={page}
          pageCount={pageCount}
          onPage={(next) => setPage(Math.min(Math.max(1, next), pageCount))}
        />
        {error ? <div className="border-t border-[#efefef] bg-white px-[35px] py-2 text-[#c62828]">{t(error)}</div> : null}
        <RefTable
          cols={COLS}
          // Plain headings: the list is sorted on the server (newest first), a sort within one page would mislead.
          heads={HEADS.map((head) => <span key={head}>{t(head)}</span>)}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading && !data}
          minWidth={1000}
          empty={t("Ничего не найдено")}
          rowHref={(row) => `/admin/bug-reports/${row.id}`}
          rowLabel={(row) => `${t("Сообщение об ошибке")} #${row.id}`}
          onRowClick={(row) => router.push(`/admin/bug-reports/${row.id}`)}
          render={(row) => [
            <span key="date" className="whitespace-nowrap">{formatDateTime(row.createdAt)}</span>,
            <span key="user" data-no-translate className="block truncate" title={row.userName}>{row.userName || `#${row.userId}`}</span>,
            <span key="page" data-no-translate className="block truncate text-[#1E4A9A]" title={row.pageUrl}>{shortPageUrl(row.pageUrl)}</span>,
            <AiSummary key="ai" short={row.short} aiStatus={row.aiStatus} delivery={row.delivery} resolvedByAi={row.resolvedByAi} />,
            <SeverityBadge key="severity" value={row.severity} />,
            <StatusBadge key="status" value={row.status} />,
          ]}
        />
      </RefCard>
    </RefPage>
  )
}
