"use client"

import { usePathname } from "next/navigation"
import { useLayoutEffect } from "react"

import { useAppCurrencyInfo } from "@/lib/app-currency-context"
import { appCurrencyTextConverter, setAppCurrencyText } from "@/lib/app-currency-text"
import { useLanguage } from "@/lib/i18n/language-context"
import { translate } from "@/lib/i18n/translate"

// Настройки → Валюта приложения (lib/app-currency.ts), the display side: with an app currency every
// amount a screen prints with another currency ("12 000 SOM", "110 ЕВРО", "-8 156 244 800 SUM") is
// shown converted into it with the current rates of Валюты ("0,96 USD"). The balances, P&L and
// reports are already computed in the app currency on the server; this pass covers the document
// lists, cards and dialogs that print each stored amount with its own currency. The DOM pass of
// lib/i18n/dom-translator.tsx works the same way (and both leave each other's output alone: a
// converted amount carries the app currency only). The text rules are lib/app-currency-text.ts (the Excel
// export uses them too). Without an app currency it does nothing.
// [data-keep-currency] keeps a subtree as stored (Валюты: "1 USD = 12 500 SOM" is a rate, not an amount).

// div[hidden][id^="S:"] / template: a streamed Suspense segment waiting to be moved into place (React's $RC).
const SKIP = 'script,style,template,textarea,input,select,[contenteditable],[data-keep-currency],div[hidden][id^="S:"]'

// What each text node held before the pass changed it, and what the pass wrote: kept across the effect's
// runs (language or page changes), so a node emptied earlier still counts with its own text.
const originals = new WeakMap<Text, string>()
const written = new WeakMap<Text, string>()

export function AppCurrencyDom() {
  const info = useAppCurrencyInfo()
  const { language } = useLanguage()
  const pathname = usePathname()

  useLayoutEffect(() => {
    const convert = appCurrencyTextConverter(info.code, info.rates, translate(language, "ЕВРО"))
    setAppCurrencyText(convert)
    if (!convert) return

    // JSX like {money(x)} {currency} renders separate text nodes ("12 000", " ", "SOM"): each run of
    // sibling text nodes is read as one text. The converted text goes into the first node and the
    // others are emptied; what React writes into a node later is that node's new original.
    const originalOf = (node: Text) => {
      const current = node.nodeValue ?? ""
      if (written.get(node) !== current) {
        originals.set(node, current)
        written.delete(node)
      }
      return originals.get(node) ?? current
    }
    const handleRun = (run: Text[]) => {
      const sources = run.map(originalOf)
      const joined = sources.join("")
      const next = convert(joined)
      run.forEach((node, index) => {
        const value = next === joined ? sources[index] : index === 0 ? next : ""
        if (node.nodeValue !== value) node.nodeValue = value
        if (value === sources[index]) written.delete(node)
        else written.set(node, value)
      })
    }
    const handleElement = (element: Element) => {
      let run: Text[] = []
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) run.push(child as Text)
        // React's server HTML separates adjacent texts with <!-- -->: still one run.
        else if (child.nodeType === Node.COMMENT_NODE) continue
        else {
          if (run.length) handleRun(run)
          run = []
        }
      }
      if (run.length) handleRun(run)
      const title = element.getAttribute("title")
      if (title) {
        const next = convert(title)
        if (next !== title) element.setAttribute("title", next)
      }
    }

    // A streamed Suspense boundary React has not hydrated yet must keep the server's text (changing it
    // first is a hydration error): its nodes carry no fiber yet and follow the boundary's "$" comment.
    // They are converted by the next mutation or sweep, once hydrated.
    const fiberKey = Object.keys(document.body).find((key) => key.startsWith("__reactFiber$"))
    const dehydrated = (element: Element): boolean => {
      if (!fiberKey) return false
      for (let node: Node | null = element; node && node !== document.body; node = node.parentNode) {
        if (fiberKey in node) return false
        for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
          if (sibling.nodeType !== Node.COMMENT_NODE) continue
          if (sibling.nodeValue === "/$") break
          if (/^\$[?!]?$/.test(sibling.nodeValue ?? "")) return true
        }
      }
      return false
    }

    const walk = (root: Node) => {
      const element = root.nodeType === Node.TEXT_NODE ? root.parentElement : root.nodeType === Node.ELEMENT_NODE ? (root as Element) : null
      if (!element || element.closest(SKIP) || dehydrated(element)) return
      handleElement(element)
      if (root.nodeType === Node.TEXT_NODE) return
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (node) => ((node as Element).matches(SKIP) || dehydrated(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      })
      for (let node = walker.nextNode(); node; node = walker.nextNode()) handleElement(node as Element)
    }

    walk(document.body)

    const pending = new Set<Node>()
    let frame = 0
    const flush = () => {
      frame = 0
      observer.disconnect()
      pending.forEach((node) => {
        if (node.isConnected) walk(node)
      })
      pending.clear()
      observe()
    }
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") {
          record.addedNodes.forEach((node) => pending.add(node))
          // A text node added to or removed from a run changes the run.
          if (record.target.nodeType === Node.ELEMENT_NODE) pending.add(record.target)
        } else pending.add(record.target)
      }
      if (!frame) frame = requestAnimationFrame(flush)
    })
    const observe = () => observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title"] })
    observe()

    // Late hydration and the translator's own sweeps: look again a few times.
    const sweeps = [300, 800, 1600, 3200, 6500].map((delay) =>
      window.setTimeout(() => {
        observer.disconnect()
        walk(document.body)
        observe()
      }, delay),
    )

    return () => {
      setAppCurrencyText(null)
      observer.disconnect()
      sweeps.forEach((id) => window.clearTimeout(id))
      if (frame) cancelAnimationFrame(frame)
    }
  }, [info, language, pathname])

  return null
}
