"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, Star, Trash2, X } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

const FAVORITE_ITEMS = ["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"]

const FAVORITE_ROUTES: Record<string, string> = {
  "Клиенты": "/clients",
  "Заказы": "/analytics/sales",
  "Виджеты": "/",
  "Ограничение продуктов": "/analytics/product-restrictions",
  "Продукты": "/analytics/products",
}

/**
 * Shared "★ Избранные" trigger + slide-in drawer used across page headers.
 * Renders its own trigger button, so callers just drop it where the old
 * decorative star/label used to live.
 */
export function FavoritesButton({ className = "flex items-center gap-2 text-[#4f70e7]" }: { className?: string }) {
  const { t } = useLanguage()
  const router = useRouter()
  const [favorite, setFavorite] = useState(false)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(FAVORITE_ITEMS)
  const [hovered, setHovered] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  const removeItem = (index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const goTo = (item: string) => {
    setFavorite(true)
    setOpen(false)
    const href = FAVORITE_ROUTES[item]
    if (href) router.push(href)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        <Star className={`h-6 w-6 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-slate-500 text-slate-500"}`} />
        {t("Избранные")}
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex">
          <aside className="flex h-full w-[420px] max-w-[90vw] flex-col bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-2xl font-semibold">{t("Избранные")}</h2>
              <button aria-label={t("Закрыть")} onClick={() => setOpen(false)}>
                <X className="h-6 w-6 text-slate-600" />
              </button>
            </header>
            {items.map((item, index) => (
              <div
                key={`${item}-${index}`}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
                className={`flex w-full items-center justify-between border-b px-8 py-5 text-left text-lg ${hovered === index ? "bg-[#eaf0fd]" : ""}`}
              >
                <button type="button" onClick={() => goTo(item)} className="flex flex-1 items-center gap-3 text-left">
                  {hovered === index && (
                    <span
                      role="button"
                      aria-label={t("Удалить из избранного")}
                      onClick={(event) => {
                        event.stopPropagation()
                        removeItem(index)
                      }}
                      className="text-slate-600 hover:text-[#e5484d]"
                    >
                      <Trash2 className="h-5 w-5" />
                    </span>
                  )}
                  {t(item)}
                </button>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </div>
            ))}
          </aside>
          <button aria-label={t("Закрыть")} onClick={() => setOpen(false)} className="flex-1 bg-black/40" />
        </div>
      )}
    </>
  )
}
