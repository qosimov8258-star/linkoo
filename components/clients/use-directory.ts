"use client"

import { useEffect, useState } from "react"

// Names from the factory's own directories, for pickers and filter lists of
// pages that have no data source of their own yet (never invented people).

export type DirectorySource = "employees" | "clients" | "clientTypes" | "warehouses" | "branches" | "zones" | "organizations" | "productTypes" | "brands"
type Source = DirectorySource

const URLS: Record<Source, string> = {
  employees: "/api/employees",
  clients: "/api/clients?balances=0",
  clientTypes: "/api/client-types",
  warehouses: "/api/warehouses",
  branches: "/api/branches",
  zones: "/api/clients?balances=0",
  organizations: "/api/organizations",
  productTypes: "/api/product-types",
  brands: "/api/brands",
}

function nameOf(source: Source, row: Record<string, unknown>): string {
  if (source === "zones") return String(row.zone ?? "").trim()
  if (source === "employees") return `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`.trim() || String(row.name ?? "")
  return String(row.name ?? "")
}

const cache = new Map<Source, Promise<string[]>>()

function load(source: Source): Promise<string[]> {
  let pending = cache.get(source)
  if (!pending) {
    pending = fetch(URLS[source])
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : []))
      .then((rows) =>
        Array.isArray(rows)
          ? [...new Set(rows.map((row) => nameOf(source, row as Record<string, unknown>)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"))
          : [],
      )
      .catch(() => {
        cache.delete(source)
        return []
      })
    cache.set(source, pending)
  }
  return pending
}

/** Sorted, distinct names of a directory ([] while loading or on error). */
export function useDirectoryNames(source: Source): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    void load(source).then((rows) => {
      if (!cancelled) setNames(rows)
    })
    return () => {
      cancelled = true
    }
  }, [source])
  return names
}
