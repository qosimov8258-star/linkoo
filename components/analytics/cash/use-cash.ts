"use client"

import { useCallback, useEffect, useState } from "react"

import type {
  AcceptanceDetail,
  AcceptGroup,
  AgentPayment,
  CashboxListResult,
  CashListResult,
  CashOperation,
  CashOperationInput,
  CashTotalsResult,
  ConvertResult,
  MoneyRequest,
} from "@/lib/cash/types"

// Client helpers for the /api/cash/** routes (the cash core). Query values:
// string | number | boolean | (string | number)[]; arrays become repeated
// params (cashbox=1&cashbox=2); undefined / null / "" / false / [] are dropped.
// Every hook returns { data, loading, error, reload } — call reload() after a save.

export type CashQuery = Record<string, string | number | boolean | Array<string | number> | null | undefined>

export function buildCashQuery(query: CashQuery): string {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue
    if (Array.isArray(value)) value.filter((item) => item !== "" && item !== null && item !== undefined).forEach((item) => params.append(name, String(item)))
    else params.set(name, value === true ? "1" : String(value))
  }
  return params.toString()
}

export type CashFetchState<T> = { data: T | null; loading: boolean; error: string; reload: () => void }

/** Generic JSON GET; pass url = null to skip. `pollMs` refetches periodically (badge). */
export function useCashJson<T>(url: string | null, pollMs = 0): CashFetchState<T> {
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

  useEffect(() => {
    if (!url || !pollMs) return
    // Skip the poll while the tab is hidden; refresh once when it becomes visible again.
    const timer = window.setInterval(() => {
      if (!document.hidden) setVersion((value) => value + 1)
    }, pollMs)
    const onVisible = () => {
      if (!document.hidden) setVersion((value) => value + 1)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [url, pollMs])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { data, loading: Boolean(url) && loading, error, reload }
}

/** GET /api/cash/cashboxes — left column (balances). */
export function useCashboxes(): CashFetchState<CashboxListResult> {
  return useCashJson<CashboxListResult>("/api/cash/cashboxes")
}

/** GET /api/cash/operations?… — the list (CashListQuery params, see core.md). */
export function useCashOperations(query: CashQuery): CashFetchState<CashListResult> {
  return useCashJson<CashListResult>(`/api/cash/operations?${buildCashQuery(query)}`)
}

/** GET /api/cash/operations/total?… — summary bar. */
export function useCashTotals(query: CashQuery, enabled = true): CashFetchState<CashTotalsResult> {
  return useCashJson<CashTotalsResult>(enabled ? `/api/cash/operations/total?${buildCashQuery(query)}` : null)
}

/** GET /api/cash/unverified/count every 30 s (not while the tab is hidden) — clock badge. */
export function useUnverifiedCount(pollMs = 30_000): CashFetchState<{ count: number }> {
  return useCashJson<{ count: number }>("/api/cash/unverified/count", pollMs)
}

/** GET /api/cash/operations/[key] — operation + form input + popups (key = null to skip). */
export function useCashOperation(key: string | null): CashFetchState<{
  operation: CashOperation
  input: CashOperationInput | null
  children: Array<{ name: string; amount: number }>
  staff: Array<{ employee: { id: number; name: string }; amount: number; currency: string }>
}> {
  return useCashJson(key ? `/api/cash/operations/${encodeURIComponent(key)}` : null)
}

/** GET /api/cash/accept-cash?… — agent collections waiting. */
export function useAcceptGroups(query: CashQuery, enabled = true): CashFetchState<{ groups: AcceptGroup[] }> {
  return useCashJson(enabled ? `/api/cash/accept-cash?${buildCashQuery(query)}` : null)
}

/** GET /api/cash/accept-cash/payments?… — one expanded group (null = skip). */
export function useAgentPayments(
  query: CashQuery | null,
): CashFetchState<{ count: number; page: number; pageSize: number; rows: AgentPayment[]; total: number; currency: string }> {
  return useCashJson(query ? `/api/cash/accept-cash/payments?${buildCashQuery(query)}` : null)
}

/** GET /api/cash/acceptances/[id] (null = skip). */
export function useAcceptance(id: number | null): CashFetchState<AcceptanceDetail> {
  return useCashJson(id ? `/api/cash/acceptances/${id}` : null)
}

/** GET /api/cash/money-requests?… */
export function useMoneyRequests(query: CashQuery, enabled = true): CashFetchState<{ count: number; page: number; pageSize: number; rows: MoneyRequest[] }> {
  return useCashJson(enabled ? `/api/cash/money-requests?${buildCashQuery(query)}` : null)
}

export type CashMutationResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; field: string | null; details?: unknown }

/** POST / PUT / PATCH / DELETE to a cash route; never throws. Errors carry the
 * Russian message (render with t()) and the demo form field it belongs to. */
export async function cashMutate<T = unknown>(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<CashMutationResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await response.json().catch(() => null)) as (T & { error?: string; field?: string | null; details?: unknown }) | null
    if (!response.ok) return { ok: false, status: response.status, error: json?.error || `HTTP ${response.status}`, field: json?.field ?? null, details: json?.details }
    return { ok: true, data: json as T }
  } catch (reason) {
    return { ok: false, status: 0, error: reason instanceof Error ? reason.message : String(reason), field: null }
  }
}

/** POST /api/cash/convert (rate preview: "В основной валюте", "Сумма индивидуального покрытия"). */
export function convertCash(body: { from: string; to: string; amount?: number; fromRate?: number; toRate?: number; cashboxId?: number }) {
  return cashMutate<ConvertResult>("POST", "/api/cash/convert", body)
}
