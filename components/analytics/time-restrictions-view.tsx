"use client"

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

// Linko's pager arrows (a triangle in a ring).
const ARROW_LEFT = "M22,12A10,10 0 0,0 12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12M20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12M14,7L9,12L14,17V7Z"
const ARROW_RIGHT = "M2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2A10,10 0 0,0 2,12M4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12M10,17L15,12L10,7V17Z"

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

/** The address / API query of a state; the defaults stay out, so the bare link stays bare as Linko's #/permission. */
function queryString(query: Query): string {
  const params = new URLSearchParams()
  if (query.search) params.set("search", query.search)
  if (query.page > 1) params.set("page", String(query.page))
  if (query.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize))
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
    const text = queryString(query)
    const url = `${window.location.pathname}${text ? `?${text}` : ""}${window.location.hash}`
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
    <main className={embedded ? "min-w-0 flex-1 bg-white text-[13px] text-[#333]" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7 text-[13px] text-[#333]"}>
      <section className={embedded ? "" : "overflow-hidden rounded bg-white shadow"}>
        {/* Linko's 60px bar: a 182px search field 15px from the left, «25 ▾», «1 - 2 из 2» and the round arrows. */}
        <div className="relative flex h-[60px] items-center pr-[5px] text-[13px]">
          <form role="search" onSubmit={submitSearch} className="absolute left-[15px] top-[11px] h-[48px] w-[182px] max-w-[45%]">
            <input
              value={input}
              maxLength={200}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="peer h-[48px] w-full bg-transparent pb-[6px] pr-[28px] text-[13px] text-black outline-none placeholder:text-black/30"
            />
            <span className="pointer-events-none absolute inset-x-0 top-[39px] h-px bg-[#e0e0e0] peer-focus:h-[2px] peer-focus:bg-[#5d6474]" />
            <button type="submit" aria-label={t("Поиск")} className="absolute right-[2px] top-[12px]">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#ccc]" aria-hidden>
                <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
            </button>
          </form>
          <div className="ml-auto flex items-center whitespace-nowrap">
            <div className="relative w-[56px]">
              <select
                value={pageSize}
                onChange={(event) => setQuery((value) => ({ search: value?.search ?? "", page: 1, pageSize: Number(event.target.value) }))}
                aria-label={t("Строк на странице")}
                className="h-[48px] w-full cursor-pointer appearance-none bg-transparent text-[13px] text-[#333] outline-none"
              >
                {ORDER_TIME_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-[16px] top-[12px] h-6 w-6 fill-[#e0e0e0]" aria-hidden>
                <path d="M7 10l5 5 5-5z" />
              </svg>
            </div>
            <span className="ml-[11px] text-[#5d6474]">
              {from} - {to} {t("из")} {count}
            </span>
            <button
              type="button"
              onClick={() => query && setQuery({ ...query, page: Math.max(1, page - 1) })}
              disabled={page <= 1}
              aria-label={t("Назад")}
              className="ml-[10px] flex h-6 w-6 items-center justify-center"
            >
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page <= 1 ? "fill-black/30" : "fill-black/55"}`} aria-hidden>
                <path d={ARROW_LEFT} />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => query && setQuery({ ...query, page: Math.min(lastPage, page + 1) })}
              disabled={page >= lastPage}
              aria-label={t("Вперед")}
              className="ml-[5px] flex h-6 w-6 items-center justify-center"
            >
              <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page >= lastPage ? "fill-black/30" : "fill-black/55"}`} aria-hidden>
                <path d={ARROW_RIGHT} />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[520px]">
            <div className="grid h-[50px] grid-cols-[5fr_5fr_2fr] items-center bg-[#5d6474] px-[30px] text-[13px] font-semibold text-white">
              <div className="pr-[8px]">{t("Наименование")}</div>
              <div className="px-[8px]">{t("Время работы")}</div>
              <div />
            </div>
            {rows.map((row) => (
              <div key={row.id} className={`grid h-[50px] grid-cols-[5fr_5fr_2fr] items-center px-[30px] text-[13px] text-[#333] ${dottedRow}`}>
                <div className="truncate pr-[8px]" title={t(row.name)}>{t(row.name)}</div>
                <div className="truncate px-[8px]">{workingTimeText(row, t)}</div>
                <div className="flex justify-end">
                  {canManage && (
                    <button type="button" onClick={() => setEditing(row)} title={t("Изменить")} aria-label={t("Изменить")} className="flex h-[22px] w-[22px] items-center justify-center">
                      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#5d6474]" aria-hidden>
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
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
