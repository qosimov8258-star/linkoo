"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// The signed-in user's own notifications (GET/PATCH/DELETE /api/notifications), shared by the
// bell panel of the top bar (notifications-menu.tsx) and the /notifications page.
// title / text are Russian i18n keys with {placeholders}; params holds the values (data).
// The filled texts are rendered with data-no-translate: t() has already translated the template,
// and the DOM translator (lib/i18n/dom-translator.tsx) must not translate the names inside them
// (a cashbox called "Касса", a client called "Клиент …").

export type NotificationItem = {
  id: number
  title: string
  text: string
  template: string
  objectId: number
  link: string
  params: Record<string, string | number>
  viewed: boolean
  createdDate: string
}

type NotificationsPage = { count: number; unviewed: number; results: NotificationItem[] }

/** Fills the {name} placeholders of an already translated text with the notification's values. */
export function fillNotificationText(text: string, params: Record<string, string | number> | undefined): string {
  const values = params ?? {}
  return text
    .replace(/\{([A-Za-z_][A-Za-z0-9_.]*)\}/g, (_match, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : ""))
    .replace(/ {2,}/g, " ")
    .trim()
}

/** In-app page a notification opens, or null when it has none. Only local paths are followed. */
export function notificationHref(item: NotificationItem): string | null {
  if (item.link && /^\/(?![/\\])/.test(item.link)) return item.link
  if (item.template === "order_delivered" && item.objectId > 0) return `/analytics/sales/${item.objectId}`
  if (item.template === "transfer_create" || item.template === "finance_transaction") return "/analytics/cash-management"
  return null
}

/** Tells the user why a change of a notification was refused: the server's message (already
 * translated at the edge, or a Russian key from the route), else `fallback`. */
async function reportRefusal(response: Response | null, fallback: string, t: (key: string) => string): Promise<void> {
  if (!response) {
    notify(t("Сервер недоступен, попробуйте ещё раз"))
    return
  }
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  const message = typeof body?.error === "string" && body.error.trim() ? body.error : fallback
  notify(t(message))
}

/**
 * The list with its paging (a cursor: the next page starts after the last row shown, so
 * deleting rows never skips one), optimistic delete / mark viewed that roll back when the
 * server refuses (and say why), and the caller's unviewed count.
 */
export function useNotifications(pageSize: number) {
  const { t } = useLanguage()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [total, setTotal] = useState(0)
  const [unviewed, setUnviewed] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const loadingRef = useRef(false)
  // The rows shown, for the cursor of the next page and the rollback of a delete (event handlers).
  const itemsRef = useRef<NotificationItem[]>([])
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const load = useCallback(
    async (more: boolean) => {
      if (loadingRef.current) return
      loadingRef.current = true
      setLoading(true)
      try {
        const query = new URLSearchParams({ page: "1", pageSize: String(pageSize) })
        const last = more ? itemsRef.current[itemsRef.current.length - 1] : undefined
        if (last) query.set("beforeId", String(last.id))
        const response = await fetch(`/api/notifications?${query}`, { cache: "no-store" })
        if (!response.ok) {
          if (!more) setFailed(true)
          return
        }
        const data = (await response.json()) as NotificationsPage
        const results = Array.isArray(data.results) ? data.results : []
        const count = Number(data.count) || 0
        const shown = (more ? itemsRef.current.length : 0) + results.length
        setFailed(false)
        setTotal(count)
        setUnviewed(Number(data.unviewed) || 0)
        // A short page is the end; a full one has more while fewer than `count` are shown.
        setHasMore(results.length >= pageSize && shown < count)
        setItems((current) => (more ? [...current, ...results.filter((item) => !current.some((known) => known.id === item.id))] : results))
      } catch {
        if (!more) setFailed(true)
      } finally {
        loadingRef.current = false
        setLoading(false)
      }
    },
    [pageSize],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  const remove = useCallback(
    async (id: number) => {
      const item = itemsRef.current.find((known) => known.id === id)
      if (!item) return
      setItems((current) => current.filter((known) => known.id !== id))
      setTotal((current) => Math.max(0, current - 1))
      if (!item.viewed) setUnviewed((current) => Math.max(0, current - 1))
      const response = await fetch(`/api/notifications/${id}`, { method: "DELETE" }).catch(() => null)
      // 404: it is gone already. Anything else that failed: say why and show what the server has.
      if (!response || (!response.ok && response.status !== 404)) {
        await reportRefusal(response, "Не удалось удалить", t)
        await load(false)
      }
    },
    [load, t],
  )

  const markViewed = useCallback(async (item: NotificationItem) => {
    if (item.viewed) return
    const setViewed = (viewed: boolean) => setItems((current) => current.map((known) => (known.id === item.id ? { ...known, viewed } : known)))
    setViewed(true)
    setUnviewed((current) => Math.max(0, current - 1))
    const response = await fetch(`/api/notifications/${item.id}`, { method: "PATCH" }).catch(() => null)
    if (!response || (!response.ok && response.status !== 404)) {
      setViewed(false)
      setUnviewed((current) => current + 1)
      await reportRefusal(response, "Не удалось сохранить", t)
    }
  }, [t])

  return { items, total, unviewed, hasMore, loading, failed, loadMore: () => load(true), reload: () => load(false), remove, markViewed }
}

/** The caller's unviewed notifications (0 while unknown, on an error or with none), refreshed
 * every minute and when the window regains focus: the badge of the bell. */
export function useUnviewedNotificationsCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const response = await fetch("/api/notifications?page=1&pageSize=1", { cache: "no-store" })
        if (!response.ok) return
        const data = (await response.json()) as Partial<NotificationsPage>
        if (!cancelled) setCount(Math.max(0, Number(data.unviewed) || 0))
      } catch {
        // keep the last count
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60_000)
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }, [])
  return count
}

/** The /notifications page: the same notifications as the bell, as cards. */
export function NotificationsFeed() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const { items, hasMore, loading, failed, loadMore, remove, markViewed } = useNotifications(20)

  function open(item: NotificationItem) {
    void markViewed(item)
    const href = notificationHref(item)
    if (href) router.push(href)
  }

  if (failed && !items.length) {
    return <p className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">{t("Не удалось загрузить данные")}</p>
  }
  if (!items.length) {
    return loading ? null : <p className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">{t("Нет уведомлений")}</p>
  }
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <article
          key={item.id}
          onClick={() => open(item)}
          className={`cursor-pointer rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ${item.viewed ? "opacity-60" : ""}`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 data-no-translate className="text-lg font-semibold text-slate-900">
                {fillNotificationText(t(item.title), item.params)}
              </h2>
              <p data-no-translate className="mt-1 text-sm leading-6 text-slate-600">
                {fillNotificationText(t(item.text), item.params)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-500">
                {formatDateText(item.createdDate, language, { withTime: true, utc: true })}
              </span>
              <button
                type="button"
                aria-label={t("Удалить")}
                onClick={(event) => {
                  event.stopPropagation()
                  void remove(item.id)
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-100"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#dadada] hover:fill-[#e57373]" aria-hidden>
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                </svg>
              </button>
            </div>
          </div>
        </article>
      ))}
      {hasMore && (
        <div className="text-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadMore()}
            className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-[#129fdd] shadow-sm disabled:opacity-50"
          >
            {t("Показать еще")}
          </button>
        </div>
      )}
    </div>
  )
}
