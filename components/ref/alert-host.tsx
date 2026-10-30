"use client"

import { useEffect, useState } from "react"

import { MaterialAlert } from "@/components/analytics/cash-material"
import { useLanguage } from "@/lib/i18n/language-context"
import { subscribeNotify } from "@/lib/notify"

/** Renders the notices raised through lib/notify (one at a time, queued). */
export function AlertHost() {
  const { t } = useLanguage()
  const [queue, setQueue] = useState<string[]>([])

  useEffect(() => {
    subscribeNotify((message) => setQueue((current) => [...current, message]))
    return () => subscribeNotify(null)
  }, [])

  const current = queue[0]
  useEffect(() => {
    if (current === undefined) return
    // Capture phase, stopped there: Escape / Enter close this notice only, never the dialog or form under it
    // (their own key handlers listen on document / window in the bubble phase), and Enter does not also
    // click the focused OK button (that would drop the next queued notice too).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter") return
      event.preventDefault()
      event.stopPropagation()
      setQueue((items) => items.slice(1))
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [current])

  if (current === undefined) return null
  return <MaterialAlert message={t(current)} onClose={() => setQueue((items) => items.slice(1))} />
}
