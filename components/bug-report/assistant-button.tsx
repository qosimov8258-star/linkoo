"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { BotMessageSquare } from "lucide-react"

import { installBugTracker } from "@/lib/bug-reports/tracker"
import { useLanguage } from "@/lib/i18n/language-context"

import { AssistantPanel } from "./assistant-panel"

/**
 * «AI yordamchi» of the top navigation (just before the bell). A click opens the panel at once; the panel then takes
 * the screenshot of the page while it is open (it is left out of the picture by its data attribute and shows
 * «Снимаем экран…», and the customer can already type), so a slow page never delays the panel. The button also
 * installs the context tracker: the top navigation is on every signed-in page.
 */
export function AssistantButton() {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  // The comment typed before the panel was closed without sending (an overlay click must not lose it).
  const [draft, setDraft] = useState("")
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    installBugTracker()
  }, [])

  const closeAssistant = useCallback(() => {
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        // BUG_REPORT_UI_ATTRIBUTE: the assistant's own clicks are not the customer's steps.
        data-bug-report="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("AI помощник")}
        title={t("Нашёл ошибку")}
        // Hidden below 1100 px: the bar is tightened there to fit 1024 px (top-nav.tsx) and has no 50 px to spare.
        className="flex h-10 w-[50px] items-center justify-center border-r border-white/[0.12] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white max-[1099px]:hidden"
      >
        <BotMessageSquare className="h-6 w-6 text-white" />
      </button>
      {open &&
        // On <body>: the sticky top bar is its own stacking context, which would keep the drawer under page dialogs.
        createPortal(<AssistantPanel draft={draft} onDraftChange={setDraft} onClose={closeAssistant} />, document.body)}
    </>
  )
}
