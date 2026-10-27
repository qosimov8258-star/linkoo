"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, X } from "lucide-react"

import { OrderDetailCard } from "@/components/orders/order-detail"
import { orderApiErrorText, type AgentLimitExceeded, type Order, type ProductRestrictionRefusal } from "@/components/orders/orders-data"
import type { FieldPhoto } from "@/lib/field-activity/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of the Активность page: the app's order card ("Заказ №…", the same component the
// orders list expands) shown over the page, and an image viewer for refusal / report photos.

/** The order card of `orderId` over the page (demo `orderDetails=<id>`). */
export function ActivityOrderDialog({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { t } = useLanguage()
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(`/api/orders/${orderId}`, { cache: "no-store", signal })
        const body = (await response.json().catch(() => null)) as (Order & { error?: string }) | null
        if (!response.ok || !body) {
          setError(body?.error ?? "Не удалось загрузить данные")
          return
        }
        setError("")
        setOrder(body)
      } catch (cause) {
        if ((cause as { name?: string }).name !== "AbortError") setError("Не удалось загрузить данные")
      }
    },
    [orderId],
  )

  useEffect(() => {
    const controller = new AbortController()
    setOrder(null)
    setError("")
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // Escape closes the dialog unless one of the order card's own dialogs is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("[data-order-overlay]")) return
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(""), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function updateOrder(id: number, patch: Partial<Order>): Promise<boolean> {
    try {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const body = (await response.json().catch(() => null)) as (Order & { error?: string; agentLimit?: AgentLimitExceeded; productRestriction?: ProductRestrictionRefusal }) | null
      if (!response.ok || !body) {
        setNotice(orderApiErrorText(body, t, "Не удалось сохранить изменения на сервере"))
        return false
      }
      setOrder(body)
      return true
    } catch {
      setNotice(t("Не удалось сохранить изменения на сервере"))
      return false
    }
  }

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/[0.54] px-4 py-6 sm:px-8" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="relative mx-auto max-w-[1280px]" role="dialog" aria-modal="true" aria-label={`${t("Заказ №")}${orderId}`}>
        <div className="mb-2 flex justify-end">
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} title={t("Закрыть")} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#333] shadow hover:bg-[#f2f5f8]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {order ? (
          <OrderDetailCard order={order} onUpdate={updateOrder} refreshOrder={() => void load()} onNavigate={(href) => router.push(href)} onNotify={setNotice} />
        ) : (
          <div className="flex min-h-[240px] items-center justify-center bg-white text-[13px] text-[#999]">
            {error ? <span className="text-[#e57373]">{t(error)}</span> : <Spinner />}
          </div>
        )}
        {notice && (
          <div role="status" className="fixed bottom-6 left-1/2 z-[150] -translate-x-1/2 rounded-[4px] bg-[#333] px-5 py-3 text-[13px] text-white shadow-lg">
            {notice}
          </div>
        )}
      </div>
    </div>
  )
}

/** The blue dotted spinner of the reference app. */
export function Spinner({ className = "" }: { className?: string }) {
  const { t } = useLanguage()
  return (
    <span role="status" aria-label={t("Загрузка...")} className={`inline-flex items-center gap-[6px] ${className}`}>
      {[0, 1, 2].map((index) => (
        <span key={index} className="h-[10px] w-[10px] animate-bounce rounded-full bg-[#4f71dc]" style={{ animationDelay: `${index * 0.15}s` }} />
      ))}
    </span>
  )
}

/** Full-size viewer of a card's photos with ‹ › (arrow keys too); Escape closes. */
export function ActivityPhotoViewer({ photos, start, onClose }: { photos: FieldPhoto[]; start: number; onClose: () => void }) {
  const { t } = useLanguage()
  const [index, setIndex] = useState(() => Math.min(Math.max(0, start), Math.max(0, photos.length - 1)))
  const [broken, setBroken] = useState<Set<number>>(() => new Set())
  const photo = photos[index]
  const many = photos.length > 1
  const move = useCallback((step: number) => setIndex((current) => (current + step + photos.length) % photos.length), [photos.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
      else if (event.key === "ArrowLeft" && many) move(-1)
      else if (event.key === "ArrowRight" && many) move(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, move, many])

  if (!photo) return null
  const label = photo.slot === "before" ? t("Фото до") : photo.slot === "after" ? t("Фото после") : t("Фото")
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" onClick={onClose} aria-label={t("Закрыть")} title={t("Закрыть")} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#333] hover:bg-white">
        <X className="h-5 w-5" />
      </button>
      {many && (
        <button type="button" onClick={() => move(-1)} aria-label={t("Назад")} title={t("Назад")} className="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#333] hover:bg-white">
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      <figure className="flex max-h-full max-w-full flex-col items-center gap-3">
        {broken.has(photo.id) ? (
          <div className="flex h-[240px] w-[320px] items-center justify-center bg-white/10 text-[13px] text-white">{t("Не удалось загрузить данные")}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt={label}
            onError={() => setBroken((current) => new Set(current).add(photo.id))}
            className="max-h-[calc(100vh-120px)] max-w-[calc(100vw-140px)] object-contain"
          />
        )}
        <figcaption className="text-[13px] text-white">
          {label}
          {many ? ` · ${index + 1} / ${photos.length}` : ""}
        </figcaption>
      </figure>
      {many && (
        <button type="button" onClick={() => move(1)} aria-label={t("Вперед")} title={t("Вперед")} className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#333] hover:bg-white">
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
    </div>
  )
}
