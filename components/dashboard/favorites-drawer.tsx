"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Star } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

type FavoriteItem = { label: string; href: string }

const DEFAULT_ITEMS: FavoriteItem[] = [
  { label: "Клиенты", href: "/clients" },
  { label: "Заказы", href: "/analytics/sales" },
  { label: "Виджеты", href: "/" },
  { label: "Заказы", href: "/analytics/sales" },
  { label: "Ограничение продуктов", href: "/analytics/product-restrictions" },
  { label: "Продукты", href: "/analytics/products" },
]

const STORAGE_KEY = "linko-favorites"

function loadItems(): FavoriteItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as FavoriteItem[]
      if (Array.isArray(parsed)) return parsed
    }
  } catch {}
  return DEFAULT_ITEMS
}

/**
 * Shared "★ | Избранные" header trigger. The star adds / removes the current page
 * (like the reference app); the label opens the slide-in favorites drawer.
 */
export function FavoritesButton({ className = "flex items-center gap-2 text-[#4f71dc]" }: { className?: string }) {
  const { t } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FavoriteItem[]>(DEFAULT_ITEMS)
  const [hovered, setHovered] = useState<number | null>(null)
  const [tip, setTip] = useState(false)
  const [pageTitle, setPageTitle] = useState("")
  const rowRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    setItems(loadItems())
  }, [])

  const save = (next: FavoriteItem[]) => {
    setItems(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {}
  }

  const isFavorite = items.some((item) => item.href === pathname)

  const toggleFavorite = () => {
    if (isFavorite) {
      save(items.filter((item) => item.href !== pathname))
      return
    }
    const heading = rowRef.current?.closest("h1")
    const label = (heading?.textContent ?? pageTitle).replace(t("Избранные"), "").trim() || document.title.split("—")[0].trim()
    save([...items, { label, href: pathname }])
    setPageTitle(label)
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  const removeItem = (index: number) => save(items.filter((_, itemIndex) => itemIndex !== index))

  const goTo = (item: FavoriteItem) => {
    setOpen(false)
    router.push(item.href)
  }

  return (
    <>
      <span
        ref={(node) => {
          rowRef.current = node
          // Mark the title row and its page header so global CSS can give every page the reference look.
          const row = node?.parentElement
          if (!row) return
          row.setAttribute("data-ref-title", "")
          const header = row.closest("header")
          if (header) header.setAttribute("data-ref-header", "")
        }}
        className="relative flex items-center"
      >
        <button
          type="button"
          onClick={toggleFavorite}
          onMouseEnter={() => setTip(true)}
          onMouseLeave={() => setTip(false)}
          aria-label={isFavorite ? t("Удалить из избранного") : t("Добавить в избранные")}
          className="flex items-center"
        >
          <Star className={`h-6 w-6 ${isFavorite ? "fill-[#4f71dc] text-[#4f71dc]" : "fill-slate-500 text-slate-500"}`} />
        </button>
        {tip && (
          <span className="pointer-events-none absolute left-[30px] top-[-6px] z-50 whitespace-nowrap rounded-[2px] bg-[#333] px-[21px] py-[8px] text-[13px] font-bold text-white opacity-90">
            {isFavorite ? t("Удалить из избранного") : t("Добавить в избранные")}
          </span>
        )}
        <button type="button" onClick={() => setOpen(true)} className={className.replace(/gap-\[5px\]|gap-2/, "ml-[5px]")}>
          {t("Избранные")}
        </button>
      </span>

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
            const isActive = item.href === pathname
            return (
              <li
                key={`${item.label}-${index}`}
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
                  <span>{t(item.label)}</span>
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
