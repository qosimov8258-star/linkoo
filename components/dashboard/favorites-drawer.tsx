"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Star } from "lucide-react"

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
export function FavoritesButton({ className = "flex items-center gap-2 text-[#4f71dc]" }: { className?: string }) {
  const { t } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
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
      <button
        type="button"
        ref={(node) => {
          // Mark the title row and its page header so global CSS can give every page the reference look.
          const row = node?.parentElement
          if (!row) return
          row.setAttribute("data-ref-title", "")
          const header = row.closest("header")
          if (header) header.setAttribute("data-ref-header", "")
        }}
        onClick={() => setOpen(true)}
        className={className}
      >
        <Star className={`h-6 w-6 ${favorite ? "fill-[#4f71dc] text-[#4f71dc]" : "fill-slate-500 text-slate-500"}`} />
        {t("Избранные")}
      </button>

      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-[1200] bg-black/[0.54] transition-opacity duration-[400ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        aria-hidden={!open}
        className={`fixed left-0 top-0 z-[1300] h-full w-[334px] max-w-full bg-white font-sans text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)] transition-transform duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${open ? "translate-x-0" : "-translate-x-full invisible"}`}
      >
        <header className="flex items-center justify-between border-b border-[#efefef] py-[10px] pl-[30px] pr-[10px]">
          <h2 className="text-[16px] font-semibold leading-[20px] text-[#333]">{t("Избранные")}</h2>
          <button type="button" aria-label={t("Закрыть")} onClick={() => setOpen(false)} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-[25px] w-[25px] fill-[#333]">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>
        <ul className="m-0 mb-5 list-none p-0">
          {items.map((item, index) => {
            const isHovered = hovered === index
            const isActive = FAVORITE_ROUTES[item] === pathname
            return (
              <li
                key={`${item}-${index}`}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
                className={`flex items-center border-b border-[#f1f1f1] p-[10px] ${isHovered ? "bg-[rgba(13,153,255,0.22)]" : ""}`}
              >
                {isHovered && (
                  <button
                    type="button"
                    aria-label={t("Удалить из избранного")}
                    onClick={() => removeItem(index)}
                    className="flex h-5 w-[18.72px] shrink-0 items-center justify-center"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => goTo(item)}
                  className={`flex h-5 flex-1 cursor-pointer items-center justify-between px-[10px] text-left text-[13px] font-semibold leading-[16.25px] ${isActive ? "text-[#4f71dc]" : "text-[#333]"}`}
                >
                  <span>{t(item)}</span>
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]">
                    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>
    </>
  )
}
