"use client"

import { useCallback, useEffect, useState } from "react"

// Client side of /api/ref-records/<kind>: loads the rows of a "Продажи" list page and keeps them in sync after
// create / update / remove. `T` is the page's own row shape (it must carry a numeric or string `id`).
export function useRefRecords<T extends { id: number | string }>(kind: string) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const response = await fetch(`/api/ref-records/${kind}`, { cache: "no-store" })
    if (response.ok) setRows((await response.json()) as T[])
    setLoading(false)
  }, [kind])

  useEffect(() => {
    void reload()
  }, [reload])

  const create = useCallback(
    async (row: Omit<T, "id"> & { id?: T["id"] }): Promise<T | null> => {
      const response = await fetch(`/api/ref-records/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) })
      if (!response.ok) return null
      const created = (await response.json()) as T
      setRows((current) => [created, ...current])
      return created
    },
    [kind],
  )

  const update = useCallback(
    async (id: T["id"], patch: Partial<T>): Promise<T | null> => {
      const response = await fetch(`/api/ref-records/${kind}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })
      if (!response.ok) return null
      const updated = (await response.json()) as T
      setRows((current) => current.map((row) => (row.id === id ? updated : row)))
      return updated
    },
    [kind],
  )

  const remove = useCallback(
    async (id: T["id"]) => {
      const response = await fetch(`/api/ref-records/${kind}/${id}`, { method: "DELETE" })
      if (response.ok) setRows((current) => current.filter((row) => row.id !== id))
      return response.ok
    },
    [kind],
  )

  return { rows, loading, reload, create, update, remove }
}
