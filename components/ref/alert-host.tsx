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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") setQueue((items) => items.slice(1))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [current])

  if (current === undefined) return null
  return <MaterialAlert message={t(current)} onClose={() => setQueue((items) => items.slice(1))} />
}
