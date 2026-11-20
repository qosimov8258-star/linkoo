"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// The list state of a Linko grid page kept in the URL, like its hash routes: the opened record is a path segment
// (#/client-bonuses/2055 → /analytics/client-bonuses/2055, #/prices/111 → /analytics/marketing-campaigns/111) and the
// rest are query parameters with Linko's names (pageSize, page, search, ordering, status, the filter fields,
// openFilterDialog, excelImport …). Opening or closing a record adds a history entry (Back closes it again); every other
// change replaces the current one. The page reads the URL once it is mounted and again on Back / Forward.

export type LinkoUrlState = { id: string | null; query: Record<string, string> }

function readUrl(base: string): LinkoUrlState {
  const path = window.location.pathname.replace(/\/+$/, "")
  let id: string | null = null
  if (path.startsWith(`${base}/`)) {
    try {
      id = decodeURIComponent(path.slice(base.length + 1)) || null
    } catch {
      id = null
    }
  }
  return { id, query: Object.fromEntries(new URLSearchParams(window.location.search).entries()) }
}

function buildUrl(base: string, state: LinkoUrlState): string {
  const params = new URLSearchParams(Object.entries(state.query).filter(([, value]) => value !== ""))
  params.sort()
  const search = params.toString()
  return `${state.id ? `${base}/${encodeURIComponent(state.id)}` : base}${search ? `?${search}` : ""}`
}

export function useLinkoUrlState(base: string, initial: LinkoUrlState = { id: null, query: {} }) {
  const [state, setState] = useState<LinkoUrlState>(initial)
  const [ready, setReady] = useState(false)
  const written = useRef<string | null>(null)

  useEffect(() => {
    const sync = () => {
      const next = readUrl(base)
      written.current = next.id
      setState(next)
    }
    sync()
    setReady(true)
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [base])

  useEffect(() => {
    if (!ready) return
    const url = buildUrl(base, state)
    if (url === `${window.location.pathname}${window.location.search}`) {
      written.current = state.id
      return
    }
    if (written.current !== state.id) window.history.pushState(null, "", url)
    else window.history.replaceState(window.history.state, "", url)
    written.current = state.id
  }, [base, ready, state])

  /** Sets the opened record (undefined keeps it) and query values ("" or null drops a parameter). */
  const update = useCallback((patch: { id?: string | null; query?: Record<string, string | number | null | undefined> }) => {
    setState((current) => {
      const query = { ...current.query }
      for (const [key, value] of Object.entries(patch.query ?? {})) {
        if (value === null || value === undefined || value === "") delete query[key]
        else query[key] = String(value)
      }
      return { id: patch.id === undefined ? current.id : patch.id, query }
    })
  }, [])

  return { state, ready, update }
}

/** A positive integer query value, else the fallback. */
export function queryInt(value: string | undefined, fallback: number, max = 2000): number {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback
}
