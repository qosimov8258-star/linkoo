"use client"

import { useCallback, useEffect, useState } from "react"

import type { BalanceEntityKind, BalanceListResult, FinanceCurrency, ManagementBalanceResult, StatementResult } from "@/lib/finance/types"

// Client-side fetch hooks for the shared /api/balances/** routes. Query
// values: string | number | boolean | string[] (arrays become repeated
// params, e.g. organization=A&organization=B); undefined/""/false/[] are
// dropped.

export type BalanceQuery = Record<string, string | number | boolean | string[] | null | undefined>

export function buildBalanceQuery(query: BalanceQuery): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue
    if (Array.isArray(value)) value.filter(Boolean).forEach((item) => params.append(name, item))
    else params.set(name, value === true ? "1" : String(value))
  }
  return params.toString()
}

type FetchState<T> = { data: T | null; loading: boolean; error: string; reload: () => void }

function useJson<T>(url: string | null): FetchState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(Boolean(url))
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error((body as { error?: string } | null)?.error || `HTTP ${response.status}`)
        setData(body as T)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [url, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { data, loading: Boolean(url) && loading, error, reload }
}

/** GET /api/balances/{kind}?… — rows per entity per currency + totals. */
export function useBalanceList(kind: BalanceEntityKind, query: BalanceQuery): FetchState<BalanceListResult> {
  return useJson<BalanceListResult>(`/api/balances/${kind}?${buildBalanceQuery(query)}`)
}

/** GET /api/balances/{kind}/statement?key=…; pass key = null to not fetch. */
export function useBalanceStatement(kind: BalanceEntityKind, key: string | null, query: BalanceQuery): FetchState<StatementResult> {
  return useJson<StatementResult>(key ? `/api/balances/${kind}/statement?${buildBalanceQuery({ ...query, key })}` : null)
}

/** GET /api/balances/management?from&to&organization…&branch… */
export function useManagementBalance(query: BalanceQuery): FetchState<ManagementBalanceResult> {
  return useJson<ManagementBalanceResult>(`/api/balances/management?${buildBalanceQuery(query)}`)
}

/** GET /api/balances/currencies — canonical currency list, base first. */
export function useFinanceCurrencies(): FetchState<{ base: string; currencies: FinanceCurrency[] }> {
  return useJson<{ base: string; currencies: FinanceCurrency[] }>("/api/balances/currencies")
}

/** Generic GET of a JSON list (lookups such as /api/cashboxes); [] while loading or on error. */
export function useLookup<T>(url: string | null): T[] {
  const { data } = useJson<T[]>(url)
  return Array.isArray(data) ? data : []
}
