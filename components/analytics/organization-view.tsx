"use client"

import { ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from "lucide-react"
import { FormEvent, useEffect, useMemo, useState } from "react"

import type { Organization } from "./organization-data"

function emptyDraft() {
  return { name: "", limitByDebt: false }
}

export function OrganizationView({ embedded = false }: { embedded?: boolean }) {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/organizations")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить организации")
        return (await response.json()) as Organization[]
      })
      .then((data) => {
        if (cancelled) return
        setOrganizations(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить организации с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return organizations
    const q = query.trim().toLowerCase()
    return organizations.filter((organization) => organization.name.toLowerCase().includes(q))
  }, [organizations, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(organization: Organization) {
    setDraft({ name: organization.name, limitByDebt: organization.limitByDebt })
    setFormError("")
    setEditingId(organization.id)
    setModalOpen(true)
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить организацию?")) return
    try {
      const response = await fetch(`/api/organizations/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить организацию")
        return
      }
      setOrganizations((current) => current.filter((organization) => organization.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const name = draft.name.trim()
    if (!name) return

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/organizations/${editingId}` : "/api/organizations", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, limitByDebt: draft.limitByDebt }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить организацию")
        return
      }
      const saved = (await response.json()) as Organization
      setOrganizations((current) => (isEdit ? current.map((organization) => (organization.id === editingId ? saved : organization)) : [saved, ...current]))
      setModalOpen(false)
      setPage(1)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-white px-9 py-5"}>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <button type="button" onClick={openCreate} className="text-[16px] text-[#4f70e7] hover:underline">
          + добавить организацию
        </button>
        <label className="relative ml-auto w-64">
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1) }}
            placeholder="Поиск"
            className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]"
          />
          <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
        </label>
        <span className="text-slate-500">25</span>
        <span className="text-slate-500">
          {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
        </span>
        <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
          <ChevronLeft className="h-5 w-5 text-slate-400" />
        </button>
        <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </button>
      </div>

      <table className="w-full text-left">
        <thead className="bg-[#626b7e] text-white">
          <tr>
            <th className="px-9 py-5">Наименование</th>
            <th className="px-5 py-5">Ограничение по долгу клиента</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={3} className="px-9 py-10 text-center text-slate-400">Загрузка организаций...</td></tr>
          ) : loadError ? (
            <tr><td colSpan={3} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
          ) : visible.map((organization) => (
            <tr key={organization.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
              <td className="px-9 py-4 font-medium text-[#4f70e7]">{organization.name}</td>
              <td className="px-5 py-4">{organization.limitByDebt ? "С ограничением" : "Без ограничения"}</td>
              <td className="px-5 py-4">
                <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                  <button type="button" onClick={() => openEdit(organization)} aria-label="Изменить">
                    <Pencil className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => remove(organization.id)} aria-label="Удалить">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!loading && !loadError && visible.length === 0 && (
            <tr>
              <td colSpan={3} className="px-9 py-10 text-center text-slate-400">
                Ничего не найдено
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? "Изменить организацию" : "Добавить организацию"}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.limitByDebt} onChange={(event) => setDraft((value) => ({ ...value, limitByDebt: event.target.checked }))} className="h-4 w-4 accent-[#4f70e7]" />
                Ограничить по долгу клиента
              </label>
              {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
