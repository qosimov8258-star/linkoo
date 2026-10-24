"use client"

import { useEffect, useState } from "react"

import { ConfirmDialog } from "@/components/analytics/cash-management-shared"
import { subscribeConfirm, type ConfirmRequest } from "@/lib/ask-confirm"

/** Renders the dialog for lib/ask-confirm requests (one at a time, queued). */
export function ConfirmHost() {
  const [queue, setQueue] = useState<ConfirmRequest[]>([])

  useEffect(() => {
    subscribeConfirm((request) => setQueue((current) => [...current, request]))
    return () => subscribeConfirm(null)
  }, [])

  const current = queue[0]
  if (!current) return null
  const finish = (ok: boolean) => {
    current.resolve(ok)
    setQueue((items) => items.slice(1))
  }
  if (current.kind === "action") {
    return <ConfirmDialog title={current.title ?? ""} text={current.text} confirmLabel={current.confirmLabel ?? "Да"} onConfirm={() => finish(true)} onClose={() => finish(false)} />
  }
  return current.kind === "cancel" ? (
    <ConfirmDialog title="Подтверждение отмены" kind="cancel" item={current.item} confirmLabel="Да" onConfirm={() => finish(true)} onClose={() => finish(false)} />
  ) : (
    <ConfirmDialog title={current.item ?? "Удалить"} onConfirm={() => finish(true)} onClose={() => finish(false)} />
  )
}
