"use client"

import { ChevronLeft, ChevronRight, Pencil, Search } from "lucide-react"
import { FormEvent, useCallback, useEffect, useState } from "react"

import { CashSnackbar, ErrorBlock, LoadingBlock, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { EmptyState, dottedRow } from "@/components/analytics/catalog-ui"
import { TimeRestrictionDialog } from "@/components/analytics/time-restrictions-dialog"
import { useLanguage } from "@/lib/i18n/language-context"
import { ORDER_TIME_PAGE_SIZES, workingTimeText, type OrderTimeRestriction, type OrderTimeRestrictionPage } from "@/lib/order-time-restrictions-rules"

// Ограничение времени (Персонал → Заказ; also Настройки → Разное): the two system order
// time windows (Создания заказа, Редактировать заказ). Search, page size and page are kept in
// the URL (?search=&page=&pageSize=) like the reference; the pencil opens "Время работы".
// Only users who may change settings (settings.manage) see the pencil.

type Query = { search: string; page: number; pageSize: number }
type Loaded = { key: string; data: OrderTimeRestrictionPage | null; error: string | null }

const DEFAULT_PAGE_SIZE = 25

function queryFromUrl(): Query {
  const params = new URLSearchParams(window.location.search)
  const page = Number(params.get("page"))
  const pageSize = Number(params.get("pageSize"))
  return {
    search: (params.get("search") ?? "").slice(0, 200),
    page: Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1,
    pageSize: (ORDER_TIME_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  }
}

function queryString(query: Query): string {
  const params = new URLSearchParams()
  if (query.search) params.set("search", query.search)
  params.set("page", String(query.page))
  params.set("pageSize", String(query.pageSize))
  return params.toString()
}

export function TimeRestrictionsView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const canManage = useCanManage(["settings.manage"])
  const [query, setQuery] = useState<Query | null>(null)
  const [input, setInput] = useState("")
  const [reload, setReload] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [editing, setEditing] = useState<OrderTimeRestriction | null>(null)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  // The URL is read after mounting, so the server render and the first client render agree.
  useEffect(() => {
    const initial = queryFromUrl()
    setInput(initial.search)
    setQuery(initial)
  }, [])

  const key = query ? `${queryString(query)}#${reload}` : ""

  useEffect(() => {
    if (!query) return
    const url = `${window.location.pathname}?${queryString(query)}${window.location.hash}`
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== url) window.history.replaceState(window.history.state, "", url)
    const controller = new AbortController()
    fetch(`/api/order-time-restrictions?${queryString(query)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (OrderTimeRestrictionPage & { error?: string }) | null
        if (!response.ok || !body || !Array.isArray(body.results)) throw new Error(body?.error || "Не удалось загрузить ограничения")
        return body
      })
      .then((data) => {
        if (controller.signal.aborted) return
        // A page past the end (after a narrower search or an old link) goes to the last page.
        if (!data.results.length && data.count > 0 && query.page > 1) {
          setQuery({ ...query, page: Math.max(1, Math.ceil(data.count / query.pageSize)) })
          return
        }
        setLoaded({ key, data, error: null })
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return
        setLoaded({ key, data: null, error: error.message || "Не удалось загрузить ограничения" })
      })
    return () => controller.abort()
  }, [query, key])

  const current = loaded?.key === key ? loaded : null
  // While the next page loads, the previous rows stay (no flicker); the very first load shows a spinner.
  const data = current?.data ?? (loaded?.data && !current ? loaded.data : null)
  const error = current?.error ?? null
  const count = data?.count ?? 0
  const page = query?.page ?? 1
  const pageSize = query?.pageSize ?? DEFAULT_PAGE_SIZE
  const lastPage = Math.max(1, Math.ceil(count / pageSize))
  const rows = data?.results ?? []
  const from = rows.length ? (page - 1) * pageSize + 1 : 0
  const to = rows.length ? from + rows.length - 1 : 0

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    const search = input.trim().slice(0, 200)
    setQuery((value) => ({ search, page: 1, pageSize: value?.pageSize ?? DEFAULT_PAGE_SIZE }))
    setReload((value) => value + 1)
  }

  const closeDialog = useCallback(() => setEditing(null), [])
  const closeMessage = useCallback(() => setMessage(null), [])

  function saved() {
    setEditing(null)
    setMessage({ text: "Успешно сохранено", tone: "success" })
    setReload((value) => value + 1)
  }

  return (
    <main className={embedded ? "min-w-0 flex-1 text-[13px] text-[#333]" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7 text-[13px] text-[#333]"}>
      <section className={embedded ? "" : "overflow-hidden rounded bg-white shadow"}>
        <div className="flex min-h-[50px] flex-wrap items-center gap-x-[20px] gap-y-[6px] px-[16px] py-[6px] sm:px-[20px]">
          <form role="search" onSubmit={submitSearch} className="relative w-full max-w-[300px]">
            <input
              value={input}
              maxLength={200}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="h-[30px] w-full border-b border-[#dfe3ea] bg-transparent pr-8 text-[13px] outline-none placeholder:text-[#b9c0cc] focus:border-[#4f71dc]"
            />
            <button type="submit" aria-label={t("Поиск")} className="absolute right-1 top-[5px] text-[#9aa3b6] hover:text-[#4f71dc]">
              <Search className="h-[18px] w-[18px]" />
            </button>
          </form>
          <div className="ml-auto flex items-center gap-[12px] whitespace-nowrap">
            <select
              value={pageSize}
              onChange={(event) => setQuery((value) => ({ search: value?.search ?? "", page: 1, pageSize: Number(event.target.value) }))}
              aria-label={t("Строк на странице")}
              className="h-[28px] bg-transparent pr-1 text-[13px] outline-none"
            >
              {ORDER_TIME_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span>
              {from} - {to} {t("из")} {count}
            </span>
            <button
              type="button"
              onClick={() => query && setQuery({ ...query, page: Math.max(1, page - 1) })}
              disabled={page <= 1}
              aria-label={t("Назад")}
              className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-slate-700 text-slate-700 disabled:border-slate-300 disabled:text-slate-300"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => query && setQuery({ ...query, page: Math.min(lastPage, page + 1) })}
              disabled={page >= lastPage}
              aria-label={t("Вперед")}
              className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-slate-700 text-slate-700 disabled:border-slate-300 disabled:text-slate-300"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] table-fixed text-left">
            <colgroup>
              <col className="w-5/12" />
              <col className="w-5/12" />
              <col className="w-2/12" />
            </colgroup>
            <thead className="bg-[#5d6474] text-white">
              <tr className="h-[50px]">
                <th scope="col" className="pl-[30px] pr-[10px] text-[13px] font-semibold">{t("Наименование")}</th>
                <th scope="col" className="px-[10px] text-[13px] font-semibold">{t("Время работы")}</th>
                <th scope="col" className="pr-[30px]"><span className="sr-only">{t("Изменить")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={`h-[50px] hover:bg-[#f8f9fb] ${dottedRow}`}>
                  <td className="truncate pl-[30px] pr-[10px]" title={t(row.name)}>{t(row.name)}</td>
                  <td className="px-[10px]">{workingTimeText(row, t)}</td>
                  <td className="pr-[30px] text-right">
                    {canManage && (
                      <button type="button" onClick={() => setEditing(row)} title={t("Изменить")} aria-label={t("Изменить")} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#5d6474] hover:bg-[#eef0f4]">
                        <Pencil className="h-[18px] w-[18px]" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data && !error && <LoadingBlock />}
        {error && !rows.length && <ErrorBlock error={error} onRetry={() => setReload((value) => value + 1)} />}
        {data && !error && rows.length === 0 && <EmptyState />}
      </section>

      {editing && <TimeRestrictionDialog row={editing} onClose={closeDialog} onSaved={saved} />}
      <CashSnackbar message={message} onClose={closeMessage} />
    </main>
  )
}
