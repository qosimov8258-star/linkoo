"use client"

import { useLayoutEffect } from "react"

import { useLanguage } from "./language-context"
import { usePathname } from "next/navigation"

import { isUntranslated, translate } from "./translate"
import type { LanguageCode } from "./types"

const CYRILLIC = /[А-Яа-яЁё]/
const ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"] as const
const SKIP = "script,style,textarea,[contenteditable],[data-no-translate]"

// Module scope so the originals survive a language switch (effect re-run).
const originals = new WeakMap<Node, string>()
const written = new WeakMap<Node, string>()
const attrOriginals = new WeakMap<Element, Record<string, string>>()
const attrWritten = new WeakMap<Element, Record<string, string>>()
const hydratedElements = new WeakSet<Element>()

// Browser dialogs aren't DOM text, so alert/confirm/prompt are wrapped once and
// translate whatever message they receive into the current language.
let currentLanguage: LanguageCode = "ru"
let dialogsPatched = false

function patchDialogs() {
  if (dialogsPatched || typeof window === "undefined") return
  dialogsPatched = true
  const wrap = <T extends (message?: string, ...rest: never[]) => unknown>(original: T) =>
    function (this: unknown, message?: string, ...rest: never[]) {
      const text = typeof message === "string" ? translate(currentLanguage, message) : message
      return original.call(this, text, ...rest)
    } as T
  window.alert = wrap(window.alert.bind(window))
  window.confirm = wrap(window.confirm.bind(window))
  window.prompt = wrap(window.prompt.bind(window))
}

let titleSource = ""
let titleWritten = ""

const reported = new Set<string>()
let reportTimer: ReturnType<typeof setTimeout> | undefined

// Development only: shows Russian text that has no translation yet, so missing
// strings are noticed while building a screen (run `npm run i18n:check` for the full list).
function reportMissing(language: LanguageCode, text: string) {
  if (process.env.NODE_ENV === "production" || language === "ru") return
  const key = `${language}:${text}`
  if (reported.has(key) || !isUntranslated(language, text)) return
  reported.add(key)
  const store = ((window as unknown as { __i18nMissing?: Set<string> }).__i18nMissing ??= new Set<string>())
  store.add(text)
  clearTimeout(reportTimer)
  reportTimer = setTimeout(() => {
    console.warn(`[i18n] ${store.size} untranslated string(s) for "${language}" (window.__i18nMissing):`, [...store].slice(-20))
  }, 1500)
}

/**
 * Safety net for screens that render Russian literals without calling t().
 * Walks the DOM, translates any text/attribute found in the dictionary and
 * remembers the original so switching back to Russian restores it.
 */
export function DomTranslator() {
  const { language } = useLanguage()
  const pathname = usePathname() ?? ""

  // A layout effect: the first pass runs right after hydration, before the
  // browser paints again, so hydrated screens never flash their Russian literals.
  useLayoutEffect(() => {
    currentLanguage = language
    patchDialogs()

    // Server HTML of a Suspense boundary that React has not hydrated yet has no fiber key. Rewriting its text
    // would make hydration fail ("server rendered text didn't match the client"), so it is skipped and picked
    // up by the delayed passes below once React has attached to it.
    const hydrated = (element: Element) => {
      if (hydratedElements.has(element)) return true
      const ok = Object.keys(element).some((key) => key.startsWith("__reactFiber$"))
      if (ok) hydratedElements.add(element)
      return ok
    }
    const skipped = (node: Node) => {
      const element = node.nodeType === 1 ? (node as Element) : node.parentElement
      return !element || !!element.closest(SKIP) || !hydrated(element)
    }

    // Every text with a translation is translated on every page (the user's decision of 2026-10-30): the
    // reference's habit of printing some dictionary texts and dates in Russian on some pages is not copied.
    const convert = (source: string) => {
      const lead = source.match(/^\s*/)?.[0] ?? ""
      const trail = source.match(/\s*$/)?.[0] ?? ""
      const core = source.trim()
      return core ? lead + translate(language, core) + trail : source
    }

    const handleText = (node: Text) => {
      if (skipped(node)) return
      const current = node.nodeValue ?? ""
      // React rewrote the node: whatever is there now is the new original.
      if (written.get(node) !== current) originals.set(node, current)
      const original = originals.get(node) ?? current
      if (language === "ru") {
        if (current !== original) node.nodeValue = original
        written.delete(node)
        return
      }
      if (!CYRILLIC.test(original)) return
      const next = convert(original)
      if (next !== current) node.nodeValue = next
      written.set(node, next)
      reportMissing(language, next)
    }

    const handleElement = (element: Element) => {
      if (skipped(element)) return
      const savedOriginals = attrOriginals.get(element) ?? {}
      const savedWritten = attrWritten.get(element) ?? {}
      for (const name of ATTRIBUTES) {
        const current = element.getAttribute(name)
        if (current === null) continue
        if (savedWritten[name] !== current) savedOriginals[name] = current
        const original = savedOriginals[name] ?? current
        if (language === "ru") {
          if (current !== original) element.setAttribute(name, original)
          delete savedWritten[name]
          continue
        }
        if (!CYRILLIC.test(original)) continue
        const next = convert(original)
        if (next !== current) element.setAttribute(name, next)
        savedWritten[name] = next
        reportMissing(language, next)
      }
      attrOriginals.set(element, savedOriginals)
      attrWritten.set(element, savedWritten)
    }

    const walk = (root: Node) => {
      if (root.nodeType === 3) return handleText(root as Text)
      if (root.nodeType !== 1) return
      if ((root as Element).closest(SKIP)) return
      handleElement(root as Element)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      let node = walker.nextNode()
      while (node) {
        if (node.nodeType === 3) handleText(node as Text)
        else handleElement(node as Element)
        node = walker.nextNode()
      }
    }

    // <title> lives outside <body>, so it gets its own pass.
    const syncTitle = () => {
      if (document.title !== titleWritten) titleSource = document.title
      if (language === "ru") {
        titleWritten = titleSource
        if (document.title !== titleSource) document.title = titleSource
        return
      }
      const next = CYRILLIC.test(titleSource) ? convert(titleSource) : titleSource
      titleWritten = next
      if (document.title !== next) document.title = next
    }
    syncTitle()
    const titleObserver = new MutationObserver(syncTitle)
    const titleElement = document.querySelector("title")
    if (titleElement) titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true })

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
        if (record.type === "childList") record.addedNodes.forEach((node) => pending.add(node))
        else pending.add(record.target)
      }
      if (!frame) frame = requestAnimationFrame(flush)
    })
    const observe = () =>
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [...ATTRIBUTES],
      })
    observe()

    // Late hydration of Suspense boundaries changes no DOM, so the observer never sees it: sweep again.
    const sweeps = [250, 700, 1500, 3000, 6000].map((delay) =>
      window.setTimeout(() => {
        observer.disconnect()
        walk(document.body)
        observe()
      }, delay),
    )

    return () => {
      titleObserver.disconnect()
      observer.disconnect()
      sweeps.forEach((id) => window.clearTimeout(id))
      if (frame) cancelAnimationFrame(frame)
    }
  }, [language, pathname])

  return null
}
