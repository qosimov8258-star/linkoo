"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

import { useLanguage } from "@/lib/i18n/language-context"

/**
 * The reference app shows its icon-button hints as dark react-tooltip boxes (measured on #/shift: bottom placement, centered,
 * 9.5 px below the button, #2d3037, 13px/400, padding 8px 21px, radius 2px, opacity .9), not as the browser's native `title`
 * bubble. This turns the `title` of buttons / links / role=button elements into that box (the native one is suppressed
 * while hovering) so every icon hint of the app looks like the reference.
 */
const ICON_HINTS = new Set(["Изменить", "Удалить", "Отменить", "Установить курс", "Ограничить доступ", "Выбрать из списка", "Скачать Excel", "Вкл/Выкл колонки", "Расширенный вид", "Дублировать", "Edit", "Delete"])

// The reference hints its green toolbar «Добавить» button with a page-specific text (measured on each page's own hover bubble).
const ADD_TIPS: Record<string, string> = {
  "/clients": "Добавить клиента",
  "/clients/territory": "Добавить зону",
  "/tracking": "Добавить зону",
  "/analytics/marketing-campaigns": "Добавить акцию",
  "/analytics/supplier-incomings": "Добавить поставку",
  "/analytics/internal-transfers": "Добавить передачу",
  "/analytics/products": "Добавить продукт",
  "/analytics/raw-materials": "Добавить сырье",
  "/analytics/production-batches": "Добавить партию",
  "/analytics/inventory-management": "Добавить инвентарь",
  "/analytics/repricing": "Добавить",
}

export function TitleTooltips() {
  const { t } = useLanguage()
  const pathname = usePathname()
  const tRef = useRef(t)
  const pathRef = useRef(pathname)
  useEffect(() => {
    tRef.current = t
    pathRef.current = pathname
  }, [t, pathname])

  useEffect(() => {
    let tip: HTMLDivElement | null = null
    let host: HTMLElement | null = null
    let saved = ""

    const hide = () => {
      if (host && saved && !host.getAttribute("title")) host.setAttribute("title", saved)
      host = null
      saved = ""
      tip?.remove()
      tip = null
    }

    const onOver = (event: MouseEvent) => {
      const target = event.target as Element | null
      const found = target?.closest?.("[title]") as HTMLElement | null
      // icon controls only: a button / link, or a wrapper around an icon / button without text of its own (text cells keep the native hint)
      let element = found && (found.matches("button, a, [role=button]") || (found.querySelector("svg, button") && !found.textContent?.trim())) ? found : null
      let text = element?.getAttribute("title") ?? ""
      const translate = tRef.current
      const hints = new Set([...ICON_HINTS, ...[...ICON_HINTS].map((hint) => translate(hint))])
      if (!element) {
        // icon-only buttons that carry just an aria-label: the reference hints these actions (row edit / delete, rate, access, select)
        const icon = target?.closest?.("button[aria-label]") as HTMLElement | null
        const label = icon?.getAttribute("aria-label") ?? ""
        if (icon && !icon.textContent?.trim() && hints.has(label)) {
          element = icon
          text = label
        }
      }
      if (!element) {
        // the toolbar «Добавить» button of a list page
        const button = target?.closest?.("button") as HTMLElement | null
        const key = ADD_TIPS[pathRef.current ?? ""]
        if (button && key) {
          const rect = button.getBoundingClientRect()
          const label = (button.textContent ?? "").replace(/^\s*\+\s*/, "").trim()
          if (rect.left > 440 && rect.top < 130 && (label === "Добавить" || label === translate("Добавить"))) {
            element = button
            text = translate(key)
          }
        }
      }
      if (!element || element === host || !text) return
      const hadTitle = element.hasAttribute("title")
      hide()
      host = element
      saved = hadTitle ? text : "" // only a real title is put back afterwards
      element.removeAttribute("title")
      tip = document.createElement("div")
      tip.textContent = text
      tip.setAttribute("role", "tooltip")
      Object.assign(tip.style, {
        position: "fixed",
        zIndex: "2147483647",
        background: "#2d3037",
        color: "#fff",
        font: '400 13px/16.9px "Open Sans", sans-serif',
        padding: "8px 21px",
        borderRadius: "2px",
        opacity: "0.9",
        pointerEvents: "none",
        whiteSpace: "nowrap",
      })
      document.body.appendChild(tip)
      const rect = element.getBoundingClientRect()
      const width = tip.offsetWidth
      const height = tip.offsetHeight
      const centered = rect.left + rect.width / 2 - width / 2
      let left = centered
      // The reference's own icon button is a 30 × 25 box; ours are 24 × 24, so small icons sit 1px higher.
      let top = rect.bottom + (rect.height <= 28 ? 10.5 : 9.5)
      if (top + height > window.innerHeight - 4) top = rect.top - 9.5 - height
      // react-tooltip moves a bubble that would leave the window to the side of the icon (12px gap, vertically centered).
      if (centered + width > window.innerWidth) {
        left = rect.left - 12 - width
        top = rect.top + rect.height / 2 - height / 2
      } else if (centered < 0) {
        left = rect.right + 12
        top = rect.top + rect.height / 2 - height / 2
      }
      tip.style.left = `${Math.max(0, left)}px`
      tip.style.top = `${top}px`
    }

    const onOut = (event: MouseEvent) => {
      if (host && !host.contains(event.relatedTarget as Node | null)) hide()
    }

    document.addEventListener("mouseover", onOver, true)
    document.addEventListener("mouseout", onOut, true)
    document.addEventListener("mousedown", hide, true)
    window.addEventListener("scroll", hide, true)
    return () => {
      document.removeEventListener("mouseover", onOver, true)
      document.removeEventListener("mouseout", onOut, true)
      document.removeEventListener("mousedown", hide, true)
      window.removeEventListener("scroll", hide, true)
      hide()
    }
  }, [])
  return null
}
