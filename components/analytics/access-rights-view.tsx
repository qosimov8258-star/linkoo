"use client"

import { ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from "lucide-react"
import { FormEvent, useEffect, useMemo, useState } from "react"

import type { AccessRight, Capability, Permission } from "./access-rights-data"

function emptyDraft() {
  return { name: "", capabilityIds: [] as number[] }
}

export function AccessRightsView() {
  const [roles, setRoles] = useState<AccessRight[]>([])
  const [capabilities, setCapabilities] = useState<Capability[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<AccessRight | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [capabilityModalOpen, setCapabilityModalOpen] = useState(false)
  const [capabilityName, setCapabilityName] = useState("")
  const [editingCapability, setEditingCapability] = useState<Capability | null>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch("/api/access-rights").then((response) => (response.ok ? (response.json() as Promise<AccessRight[]>) : Promise.reject())),
      fetch("/api/capabilities").then((response) => (response.ok ? (response.json() as Promise<Capability[]>) : Promise.reject())),
      fetch("/api/permissions").then((response) => (response.ok ? (response.json() as Promise<Permission[]>) : Promise.reject())),
    ])
      .then(([accessRights, caps, perms]) => {
        if (cancelled) return
        setRoles(accessRights)
        setCapabilities(caps)
        setPermissions(perms)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить данные с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const capabilityById = useMemo(() => new Map(capabilities.map((item) => [item.id, item])), [capabilities])

  const filtered = useMemo(() => roles.filter((role) => role.name.toLowerCase().includes(query.toLowerCase())), [roles, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setDraft(emptyDraft())
    setEditing("new")
  }

  function openEdit(role: AccessRight) {
    setDraft({ name: role.name, capabilityIds: [...role.capabilityIds] })
    setEditing(role)
  }

  function toggleCapability(id: number) {
    setDraft((current) => ({
      ...current,
      capabilityIds: current.capabilityIds.includes(id) ? current.capabilityIds.filter((value) => value !== id) : [...current.capabilityIds, id],
    }))
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    setSaving(true)
    try {
      const isEdit = editing !== "new" && editing !== null
      const response = await fetch(isEdit ? `/api/access-rights/${(editing as AccessRight).id}` : "/api/access-rights", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), capabilityIds: draft.capabilityIds }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось сохранить права доступа")
        return
      }
      const saved = (await response.json()) as AccessRight
      setRoles((list) => (isEdit ? list.map((role) => (role.id === saved.id ? saved : role)) : [saved, ...list]))
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить эти права доступа?")) return
    try {
      const response = await fetch(`/api/access-rights/${id}`, { method: "DELETE" })
      if (!response.ok) return
      setRoles((list) => list.filter((role) => role.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function saveCapability(event: FormEvent) {
    event.preventDefault()
    const name = capabilityName.trim()
    if (!name) return
    try {
      const response = await fetch("/api/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось создать возможность")
        return
      }
      const created = (await response.json()) as Capability
      setCapabilities((current) => [...current, created])
      setCapabilityName("")
      setCapabilityModalOpen(false)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  return (
    <main className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-6 px-5 py-4">
        <button type="button" onClick={openCreate} className="text-[16px] text-[#4f70e7] hover:underline">
          + создать права доступа
        </button>
        <button type="button" onClick={() => setCapabilityModalOpen(true)} className="text-[16px] text-[#4f70e7] hover:underline">
          + создать возможности
        </button>
        <label className="relative ml-4 w-64">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
          <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
        </label>
        <span className="ml-auto text-slate-500">25</span>
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

      {loadError && <p className="px-5 pb-3 text-sm text-red-500">{loadError}</p>}

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="w-64 px-5 py-4 font-semibold text-slate-800">Права доступа</th>
            <th className="px-5 py-4 font-semibold text-slate-800">Возможности</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {visible.map((role) => (
            <tr key={role.id} className="group border-b border-dashed border-slate-200 align-top hover:bg-slate-50">
              <td className="whitespace-nowrap px-5 py-5 font-medium text-slate-800">{role.name}</td>
              <td className="px-5 py-5">
                <div className="flex flex-wrap gap-3">
                  {role.capabilityIds.map((id) => {
                    const capability = capabilityById.get(id)
                    if (!capability) return null
                    return (
                      <span key={id} className="rounded bg-slate-100 px-4 py-2 text-sm text-slate-700">
                        {capability.name}
                      </span>
                    )
                  })}
                </div>
              </td>
              <td className="px-5 py-5">
                <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                  <button type="button" onClick={() => openEdit(role)} aria-label="Изменить">
                    <Pencil className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => remove(role.id)} aria-label="Удалить">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!loading && visible.length === 0 && (
            <tr>
              <td colSpan={3} className="px-5 py-10 text-center text-slate-400">
                Ничего не найдено
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Создать права доступа" : "Изменить права доступа"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-8">
              <label className="mb-6 block border-b border-slate-200 pb-2 font-medium">
                Наименование <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <p className="mb-3 font-medium text-slate-700">Возможности</p>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {capabilities.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-sm">
                    <label className="flex flex-1 items-center gap-2 truncate">
                      <input type="checkbox" checked={draft.capabilityIds.includes(item.id)} onChange={() => toggleCapability(item.id)} />
                      <span className="truncate">{item.name}</span>
                    </label>
                    <button type="button" onClick={() => setEditingCapability(item)} aria-label={`Изменить «${item.name}»`} className="shrink-0 text-slate-400 hover:text-[#4f70e7]">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </footer>
          </form>
        </div>
      )}

      {capabilityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={saveCapability} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex justify-between">
              <h2 className="text-xl font-bold">Создать возможность</h2>
              <button type="button" onClick={() => setCapabilityModalOpen(false)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <label className="mb-2 block font-medium">
              Наименование <span className="text-red-500">*</span>
            </label>
            <input autoFocus value={capabilityName} onChange={(event) => setCapabilityName(event.target.value)} className="mb-4 w-full border-b border-slate-300 py-2 outline-none focus:border-[#4f70e7]" />
            <div className="mt-6 flex justify-end">
              <button type="submit" className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold uppercase text-white hover:brightness-95">
                Сохранить
              </button>
            </div>
          </form>
        </div>
      )}

      {editingCapability && (
        <CapabilityPermissionsModal
          capability={editingCapability}
          allPermissions={permissions}
          onClose={() => setEditingCapability(null)}
          onSaved={(updated) => {
            setCapabilities((current) => current.map((item) => (item.id === updated.id ? updated : item)))
            setEditingCapability(null)
          }}
        />
      )}
    </main>
  )
}

function permissionMatches(permission: Permission, category: string, type: string, query: string) {
  if (category && permission.category !== category) return false
  if (type && permission.type !== type) return false
  if (query) {
    const needle = query.toLowerCase()
    if (!permission.label.toLowerCase().includes(needle) && !permission.code.toLowerCase().includes(needle)) return false
  }
  return true
}

function CapabilityPermissionsModal({
  capability,
  allPermissions,
  onClose,
  onSaved,
}: {
  capability: Capability
  allPermissions: Permission[]
  onClose: () => void
  onSaved: (capability: Capability) => void
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>(capability.permissionIds)
  const [saving, setSaving] = useState(false)
  const [availableCategory, setAvailableCategory] = useState("")
  const [availableType, setAvailableType] = useState("")
  const [availableQuery, setAvailableQuery] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("")
  const [selectedType, setSelectedType] = useState("")
  const [selectedQuery, setSelectedQuery] = useState("")

  const categories = useMemo(() => Array.from(new Set(allPermissions.map((item) => item.category))).filter(Boolean).sort(), [allPermissions])
  const types = useMemo(() => Array.from(new Set(allPermissions.map((item) => item.type))).filter(Boolean).sort(), [allPermissions])

  const available = useMemo(
    () => allPermissions.filter((item) => !selectedIds.includes(item.id) && permissionMatches(item, availableCategory, availableType, availableQuery)),
    [allPermissions, selectedIds, availableCategory, availableType, availableQuery],
  )
  const selected = useMemo(() => {
    const byId = new Map(allPermissions.map((item) => [item.id, item]))
    return selectedIds
      .map((id) => byId.get(id))
      .filter((item): item is Permission => Boolean(item))
      .filter((item) => permissionMatches(item, selectedCategory, selectedType, selectedQuery))
  }, [allPermissions, selectedIds, selectedCategory, selectedType, selectedQuery])

  function addPermission(id: number) {
    setSelectedIds((current) => (current.includes(id) ? current : [...current, id]))
  }

  function removePermission(id: number) {
    setSelectedIds((current) => current.filter((value) => value !== id))
  }

  async function save() {
    setSaving(true)
    try {
      const response = await fetch(`/api/capabilities/${capability.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: capability.name, permissionIds: selectedIds }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось сохранить возможность")
        return
      }
      const updated = (await response.json()) as Capability
      onSaved(updated)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-white">
      <div className="flex h-full w-full flex-col">
        <header className="flex items-center justify-between border-b p-6">
          <b className="uppercase">Изменить возможность — {capability.name}</b>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-6 overflow-hidden p-6 sm:grid-cols-2">
          <div className="flex min-h-0 flex-col">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <select value={availableCategory} onChange={(event) => setAvailableCategory(event.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
                <option value="">Категория</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select value={availableType} onChange={(event) => setAvailableType(event.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
                <option value="">Тип</option>
                {types.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <label className="relative min-w-[160px] flex-1">
                <input value={availableQuery} onChange={(event) => setAvailableQuery(event.target.value)} placeholder="Поиск из разрешения" className="w-full border-b border-slate-300 py-1.5 pr-8 text-sm outline-none focus:border-[#4f70e7]" />
                <Search className="pointer-events-none absolute right-1 top-1.5 h-4 w-4 text-slate-300" />
              </label>
            </div>
            <div className="flex-1 overflow-y-auto rounded border border-slate-200">
              {available.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addPermission(item.id)}
                  className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-left text-sm text-[#4f70e7] hover:bg-slate-50"
                >
                  <span className="truncate">
                    {item.category}/{item.label} ({item.code})
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </button>
              ))}
              {available.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Ничего не найдено</p>}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
                <option value="">Категория</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select value={selectedType} onChange={(event) => setSelectedType(event.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
                <option value="">Тип</option>
                {types.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <label className="relative min-w-[160px] flex-1">
                <input value={selectedQuery} onChange={(event) => setSelectedQuery(event.target.value)} placeholder="Поиск из выбранных разрешения" className="w-full border-b border-slate-300 py-1.5 pr-8 text-sm outline-none focus:border-[#4f70e7]" />
                <Search className="pointer-events-none absolute right-1 top-1.5 h-4 w-4 text-slate-300" />
              </label>
            </div>
            <div className="flex-1 overflow-y-auto rounded border border-slate-200">
              {selected.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-sm text-slate-700">
                  <span className="truncate">
                    {item.category}/{item.label} ({item.code})
                  </span>
                  <button type="button" onClick={() => removePermission(item.id)} aria-label="Убрать" className="shrink-0 text-[#4f70e7] hover:text-rose-500">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {selected.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Ничего не выбрано</p>}
            </div>
          </div>
        </div>

        <footer className="flex justify-end border-t p-5">
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold uppercase text-white hover:brightness-95 disabled:opacity-60">
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </footer>
      </div>
    </div>
  )
}
