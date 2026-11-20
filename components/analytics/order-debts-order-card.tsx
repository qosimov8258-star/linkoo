"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { Spinner } from "@/components/analytics/activity-dialogs"
import { OrderDetailCard } from "@/components/orders/order-detail"
import type { Order } from "@/components/orders/orders-data"
import { useLanguage } from "@/lib/i18n/language-context"

// The read-only order card of Долги с заказов («ЗАКАЗ № 1529»), shown over the page, the shop drawer included: from an
// order number of the ЗАКАЗЫ list, and from the drawer's ЗАДАЧИ «Просмотреть» (Linko's ?orderDetails=<id>). The
// title and a close button replace the card's action bar.

export function OrderDebtOrderCard({ orderId, onClose, onNotify }: { orderId: number; onClose: () => void; onNotify: (text: string, error?: boolean) => void }) {
  const { t } = useLanguage()
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(`/api/orders/${orderId}`, { cache: "no-store", signal })
        const body = (await response.json().catch(() => null)) as (Order & { error?: string }) | null
        if (!response.ok || !body || typeof body.id !== "number") {
          setError(body?.error || "Не удалось загрузить данные")
          return
        }
        setError("")
        setOrder(body)
      } catch (cause) {
        if ((cause as { name?: string })?.name !== "AbortError") setError("Не удалось загрузить данные")
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

  const closeButton = (
    <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="absolute right-[10px] top-[6px] flex h-12 w-12 items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
      </svg>
    </button>
  )
  const title = (
    <h2 className="absolute left-[30px] top-0 flex h-[60px] items-center text-[13px] font-bold uppercase text-[#333]">
      {t("Заказ")} № {orderId}
    </h2>
  )

  return (
    <div className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-black/[0.54] pt-[16px]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {order ? (
        <div role="dialog" aria-modal="true" aria-label={`${t("Заказ")} № ${orderId}`} className="relative mb-[16px] w-[1200px] max-w-[calc(100vw-32px)] [&>div>div:first-child>div]:hidden [&>div>div:first-child>h2]:hidden [&_.w-1\/3:last-child>div]:hidden [&>div]:shadow-none [&>div>div:first-child]:h-[60px]">
          <OrderDetailCard order={order} onUpdate={() => {}} refreshOrder={() => void load()} onNavigate={(href) => router.push(href)} onNotify={onNotify} />
          {title}
          {closeButton}
        </div>
      ) : (
        <div role="dialog" aria-modal="true" aria-label={`${t("Заказ")} № ${orderId}`} className="relative mb-[16px] flex min-h-[240px] w-[1200px] max-w-[calc(100vw-32px)] items-center justify-center bg-white pt-[60px] text-[13px]">
          {title}
          {closeButton}
          {error ? <span className="text-[#e57373]">{t(error)}</span> : <Spinner />}
        </div>
      )}
    </div>
  )
}
