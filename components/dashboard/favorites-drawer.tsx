"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter } from "next/navigation"

import { navSectionLabel } from "@/components/dashboard/top-nav"
import { useLanguage } from "@/lib/i18n/language-context"
import { routeTitle } from "@/lib/route-titles"

type FavoriteItem = { label: string; href: string }

// Favorites are only what this user starred (kept in this browser): a new user starts with an empty list.
const DEFAULT_ITEMS: FavoriteItem[] = []

// An older build started every browser with the reference account's own list (these 20 entries, in this order)
// and saved it together with the first page the user starred. A stored list that begins with exactly that list
// loses it; whatever the user added after it stays.
const LEGACY_DEFAULT: ReadonlyArray<readonly [string, string]> = [
  ["Клиенты", "/clients"],
  ["Заказы", "/analytics/sales"],
  ["Виджеты", "/"],
  ["Заказы", "/analytics/sales"],
  ["Ограничение продуктов", "/analytics/product-restrictions"],
  ["Продукты", "/analytics/products"],
  ["Клиенты", "/clients"],
  ["Клиенты", "/clients"],
  ["Финансовые счета", "/clients/financial-accounts"],
  ["Финансовые счета", "/clients/financial-accounts"],
  ["Пользователи Телеграм бота", "/clients/telegram-users"],
  ["Пользователи Телеграм бота", "/clients/telegram-users"],
  ["Ограничения по клиентам", "/clients/client-restrictions"],
  ["Ограничения по клиентам", "/clients/client-restrictions"],
  ["Территория", "/clients/territory"],
  ["Территория", "/clients/territory"],
  ["Виджеты", "/"],
  ["Виджеты", "/"],
  ["Анализ маршрутов", "/clients/routes"],
  ["Анализ маршрутов", "/clients/routes"],
]

const STORAGE_KEY = "linko-favorites-v2"

/** Longest name of a starred page (a page title is a few words). */
const MAX_LABEL = 120
/** Marks the elements this component renders inside the page heading (the star, the drawer with
 * the list): they are left out when the heading is read for the page's name. */
const OWN_UI = "data-favorites-ui"
/** "Избранные" in every UI language: a stored name that starts with it was read from a heading
 * together with the drawer (see pageName). */
const DRAWER_TITLES = ["Избранные", "Sevimlilar", "Saýlananlar", "Favorites"]

const EMPTY_LIST = "По вашему запросу ничего не найдено..."

const tidy = (text: string) => text.replace(/\s+/g, " ").trim()

/**
 * The name of the page a star is clicked on: the text of its heading without this component's own
 * elements. The drawer is rendered inside the heading, so reading the heading as it is returned
 * the drawer's title and the name of every page starred before in front of the page's own name —
 * each new star was as long as all the earlier ones together, and after some twenty stars the
 * list weighed megabytes and every page froze while drawing it.
 */
function pageName(heading: Element | null | undefined): string {
  if (!heading) return ""
  const copy = heading.cloneNode(true) as Element
  copy.querySelectorAll(`[${OWN_UI}]`).forEach((node) => node.remove())
  return tidy(copy.textContent ?? "").slice(0, MAX_LABEL)
}

/** A stored name written by the older reading of the heading (too long, or starting with the
 * drawer's title): the page's menu name instead, or the last words when the page has none. */
function repairLabel(item: FavoriteItem, t: (text: string) => string): FavoriteItem {
  const label = tidy(item.label)
  const broken = label.length > MAX_LABEL || DRAWER_TITLES.some((title) => label.startsWith(title))
  if (!broken) return label === item.label ? item : { ...item, label }
  const title = routeTitle(item.href.split("?")[0])
  if (title) return { ...item, label: t(title) }
  // No menu name: drop what the older reading put in front (the drawer's title and its "nothing
  // found" line); of a name that swallowed a whole list only the end is the page's own.
  let rest = label
  for (const text of DRAWER_TITLES) if (rest.startsWith(text)) rest = rest.slice(text.length)
  for (const text of [EMPTY_LIST, t(EMPTY_LIST)]) if (rest.startsWith(text)) rest = rest.slice(text.length)
  rest = tidy(rest)
  return { ...item, label: rest && rest.length <= MAX_LABEL ? rest : rest.slice(-40).trim() }
}

function loadItems(): FavoriteItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const items = parsed.filter(
          (item): item is FavoriteItem =>
            !!item && typeof item.label === "string" && typeof item.href === "string" && item.href.startsWith("/") && !item.href.startsWith("//"),
        )
        const legacy = items.length >= LEGACY_DEFAULT.length && LEGACY_DEFAULT.every(([label, href], index) => items[index].label === label && items[index].href === href)
        if (!legacy) return items
        const own = items.slice(LEGACY_DEFAULT.length)
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(own))
        return own
      }
    }
  } catch {}
  return DEFAULT_ITEMS
}

/**
 * Shared "★ | Избранные" header trigger. The star adds / removes the current page
 * (like the reference app); the label opens the slide-in favorites drawer.
 */
export function FavoritesButton({ className = "flex items-center gap-2 text-[#1E4A9A]" }: { className?: string }) {
  const { t } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<FavoriteItem[]>(DEFAULT_ITEMS)
  const [hovered, setHovered] = useState<number | null>(null)
  const [tip, setTip] = useState(false)
  const [pageTitle, setPageTitle] = useState("")
  const rowRef = useRef<HTMLSpanElement>(null)
  const [titleTip, setTitleTip] = useState<{ left: number; top: number } | null>(null)
  const sectionLabel = navSectionLabel(pathname)

  // Hovering the page title shows the name of its top-nav section, like the reference.
  useEffect(() => {
    const row = rowRef.current?.parentElement
    if (!row || !sectionLabel) return
    const onOver = (event: MouseEvent) => {
      if (rowRef.current?.contains(event.target as Node)) return setTitleTip(null)
      const rect = row.getBoundingClientRect()
      setTitleTip({ left: rect.right + 10, top: rect.top + rect.height / 2 - 16.5 })
    }
    const onLeave = () => setTitleTip(null)
    row.addEventListener("mouseover", onOver)
    row.addEventListener("mouseleave", onLeave)
    return () => {
      row.removeEventListener("mouseover", onOver)
      row.removeEventListener("mouseleave", onLeave)
    }
  }, [sectionLabel, pathname])

  useEffect(() => {
    const stored = loadItems()
    const repaired = stored.map((item) => repairLabel(item, t))
    setItems(repaired)
    // Names written by the older build are replaced in the browser's storage too (once).
    if (repaired.some((item, index) => item !== stored[index])) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(repaired))
      } catch {}
    }
    // Only when the page opens: the stored list is this browser's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = (next: FavoriteItem[]) => {
    setItems(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {}
  }

  // Like the reference app, the star never turns "on": every click appends the current page again.
  const addFavorite = () => {
    const label = pageName(rowRef.current?.closest("h1")) || pageTitle || document.title.split("—")[0].trim().slice(0, MAX_LABEL)
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
        {...{ [OWN_UI]: "" }}
        className="relative flex items-center"
      >
        <button
          type="button"
          onClick={addFavorite}
          onMouseEnter={() => setTip(true)}
          onMouseLeave={() => setTip(false)}
          aria-label={t("Добавить в избранные")}
          className="flex items-center"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
        </button>
        {tip && (
          <span role="tooltip" className="pointer-events-none absolute left-[34px] top-[-5px] z-50 whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-bold leading-[17px] text-white opacity-90">
            {t("Добавить в избранные")}
          </span>
        )}
        <button type="button" onClick={() => setOpen(true)} className={className.replace(/gap-\[5px\]|gap-2/, "ml-[5px]")}>
          {t("Избранные")}
        </button>
      </span>

      {titleTip &&
        sectionLabel &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: titleTip.left, top: titleTip.top }}
            className="pointer-events-none fixed z-[1000] whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] font-sans text-[13px] font-normal leading-[17px] text-white opacity-90"
          >
            {t(sectionLabel)}
          </span>,
          document.body,
        )}
      <div
        {...{ [OWN_UI]: "" }}
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-[1200] bg-black/[0.54] transition-opacity duration-[400ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        {...{ [OWN_UI]: "" }}
        aria-hidden={!open}
        className={`fixed left-0 top-0 z-[1300] h-full w-[334px] max-w-full overflow-y-auto bg-white [&::-webkit-scrollbar-button]:h-0 [&::-webkit-scrollbar-thumb]:rounded-[10px] [&::-webkit-scrollbar-thumb]:bg-[#0d99ff] [&::-webkit-scrollbar-thumb]:shadow-[inset_0_0_6px_rgba(0,0,0,0.3)] [&::-webkit-scrollbar-track-piece]:bg-transparent [&::-webkit-scrollbar]:w-[8px] font-sans text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)] transition-transform duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${open ? "translate-x-0" : "-translate-x-full invisible"}`}
      >
        <header className="flex items-center justify-between border-b border-[#efefef] py-[10px] pl-[30px] pr-[10px]">
          <h2 className="text-[16px] font-semibold leading-[20px] text-[#333]">{t("Избранные")}</h2>
          <button type="button" aria-label={t("Закрыть")} onClick={() => setOpen(false)} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-[25px] w-[25px] fill-[#333]">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>
        {items.length === 0 && <div className="p-[10px] text-[13px] leading-[16.25px] text-[#333]">{t(EMPTY_LIST)}</div>}
        <ul data-no-translate="" className="m-0 mb-20 list-none p-0">
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
                    className="flex h-5 w-[18.72px] shrink-0 cursor-pointer items-center justify-center"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]">
                      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => goTo(item)}
                  className={`flex h-5 flex-1 cursor-pointer items-center justify-between px-[10px] text-left text-[13px] font-semibold leading-[16.25px] ${isActive ? "text-[#1E4A9A]" : "text-[#333]"}`}
                >
                  <span>{item.label}</span>
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
