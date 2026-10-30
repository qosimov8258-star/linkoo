"use client"

import { useCallback, useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// Client side of /api/ref-records/<kind>: loads the rows of a "Продажи" list page and keeps them in sync after
// create / update / remove. `T` is the page's own row shape (it must carry a numeric or string `id`). The server serves
// only the kinds and methods a page uses and validates every write (lib/ref-records-repo.ts); a refused write resolves to
// null / false here, the rows stay as they were, and (unless `notifyErrors` is false, for a page that reports it itself)
// the server's reason — a Russian i18n key — is shown in the app's alert.
export function useRefRecords<T extends { id: number | string }>(kind: string, options: { notifyErrors?: boolean } = {}) {
  const { t } = useLanguage()
  const notifyErrors = options.notifyErrors !== false
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

  /** Shows why the server refused a write (its `error` key), or that it could not be reached. */
  const report = useCallback(
    async (response: Response | null) => {
      if (!notifyErrors) return
      const body = response ? ((await response.json().catch(() => ({}))) as { error?: unknown }) : {}
      notify(t(typeof body.error === "string" && body.error ? body.error : response ? "Не удалось сохранить изменения на сервере" : "Сервер недоступен, попробуйте ещё раз"))
    },
    [notifyErrors, t],
  )

  const send = useCallback(
    async (url: string, init: RequestInit): Promise<Response | null> => {
      try {
        const response = await fetch(url, init)
        if (!response.ok) await report(response)
        return response
      } catch {
        await report(null)
        return null
      }
    },
    [report],
  )

  const create = useCallback(
    async (row: Omit<T, "id"> & { id?: T["id"] }): Promise<T | null> => {
      const response = await send(`/api/ref-records/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) })
      if (!response?.ok) return null
      const created = (await response.json()) as T
      setRows((current) => [created, ...current])
      return created
    },
    [kind, send],
  )

  const update = useCallback(
    async (id: T["id"], patch: Partial<T>): Promise<T | null> => {
      const response = await send(`/api/ref-records/${kind}/${encodeURIComponent(String(id))}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) })
      if (!response?.ok) return null
      const updated = (await response.json()) as T
      setRows((current) => current.map((row) => (row.id === id ? updated : row)))
      return updated
    },
    [kind, send],
  )

  const remove = useCallback(
    async (id: T["id"]) => {
      const response = await send(`/api/ref-records/${kind}/${encodeURIComponent(String(id))}`, { method: "DELETE" })
      if (response?.ok) setRows((current) => current.filter((row) => row.id !== id))
      return response?.ok === true
    },
    [kind, send],
  )

  return { rows, loading, reload, create, update, remove }
}
