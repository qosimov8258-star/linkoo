"use client"

import { useEffect, useMemo, useState } from "react"

type AllowedAnswer = { restricted?: boolean; allowedProductIds?: number[] | null }

/**
 * Ограничение продуктов in the order forms: the ids of the products `agent` ("First Last", the
 * order's agent) may sell, from GET /api/product-restrictions/allowed; null while the agent is
 * not chosen, unknown, not restricted or the answer has not arrived. The order API refuses the
 * other products itself (409 "Агенту запрещено продавать товар"), so this only narrows the pickers.
 */
export function useAllowedProductIds(agent: string | null | undefined): Set<number> | null {
  const name = (agent ?? "").trim()
  const [answer, setAnswer] = useState<{ agent: string; ids: Set<number> | null } | null>(null)
  useEffect(() => {
    if (!name) return
    let cancelled = false
    void fetch(`/api/product-restrictions/allowed?agent=${encodeURIComponent(name)}`)
      .then((response) => (response.ok ? (response.json() as Promise<AllowedAnswer>) : null))
      .catch(() => null)
      .then((body) => {
        if (cancelled) return
        const ids = body?.restricted && Array.isArray(body.allowedProductIds) ? new Set(body.allowedProductIds.map(Number)) : null
        setAnswer({ agent: name, ids })
      })
    return () => {
      cancelled = true
    }
  }, [name])
  return name && answer?.agent === name ? answer.ids : null
}

/** `rows` limited to the allowed ids (all of them when `allowed` is null). */
export function useAllowedRows<T extends { id: number }>(rows: T[] | null, allowed: Set<number> | null): T[] | null {
  return useMemo(() => (rows && allowed ? rows.filter((row) => allowed.has(Number(row.id))) : rows), [rows, allowed])
}
