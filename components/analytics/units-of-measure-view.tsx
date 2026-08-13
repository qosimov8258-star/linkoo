"use client"

import { ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from "lucide-react"
import { Fragment, FormEvent, useEffect, useMemo, useState } from "react"

import type { UnitOfMeasure } from "./units-of-measure-data"

function emptyDraft() {
  return { parentId: "", name: "" }
}

export function UnitsOfMeasureView({ embedded = false }: { embedded?: boolean }) {
  const [units, setUnits] = useState<UnitOfMeasure[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<UnitOfMeasure | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/units-of-measure")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить единицы измерения")
        return (await response.json()) as UnitOfMeasure[]
      })
      .then((data) => {
        if (cancelled) return
        setUnits(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить единицы измерения с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const topLevel = useMemo(() => units.filter((unit) => unit.parentId === null), [units])
  const childrenOf = (id: number) => units.filter((unit) => unit.parentId === id)

  const filtered = useMemo(() => {
    if (!query.trim()) return null
    const q = query.trim().toLowerCase()
    return units.filter((unit) => unit.name.toLowerCase().includes(q))
  }, [units, query])

  const flatCount = filtered ? filtered.length : topLevel.length
  const pageCount = Math.max(1, Math.ceil(flatCount / pageSize))
  const safePage = Math.min(page, pageCount)

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditing("new")
  }

  function openEdit(unit: UnitOfMeasure) {
    setDraft({ parentId: unit.parentId !== null ? String(unit.parentId) : "", name: unit.name })
    setFormError("")
    setEditing(unit)
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить единицу измерения?")) return
    try {
      const response = await fetch(`/api/units-of-measure/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить единицу измерения")
        return
      }
      // Server also removes direct children pointing at this unit — mirror that locally.
      setUnits((current) => current.filter((unit) => unit.id !== id && unit.parentId !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const trimmed = draft.name.trim()
    if (!trimmed) return
    const parentId = draft.parentId ? Number(draft.parentId) : null

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editing !== "new" && editing !== null
      const targetId = isEdit ? (editing as UnitOfMeasure).id : null
      const response = await fetch(isEdit ? `/api/units-of-measure/${targetId}` : "/api/units-of-measure", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, parentId }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить единицу измерения")
        return
      }
      const saved = (await response.json()) as UnitOfMeasure
      setUnits((current) => (isEdit ? current.map((unit) => (unit.id === targetId ? saved : unit)) : [saved, ...current]))
      setEditing(null)
      setPage(1)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function renderRow(unit: UnitOfMeasure, isChild: boolean) {
    return (
      <tr key={unit.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
        <td className={isChild ? "py-4 pl-20 pr-5" : "px-9 py-4 font-medium"}>{unit.name}</td>
        <td className="px-5 py-4">{unit.createdDate}</td>
        <td className="px-5 py-4">
          <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
            <button type="button" onClick={() => openEdit(unit)} aria-label="Изменить">
              <Pencil className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => remove(unit.id)} aria-label="Удалить">
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  const flatVisible = filtered ? filtered.slice((safePage - 1) * pageSize, safePage * pageSize) : null

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-white px-9 py-5"}>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <button type="button" onClick={openCreate} className="text-[16px] text-[#4f70e7] hover:underline">
          + добавить измерение
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
          {flatCount ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, flatCount)} из {flatCount}
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
            <th className="px-5 py-5">Дата создания</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={3} className="px-9 py-10 text-center text-slate-400">Загрузка единиц измерения...</td></tr>
          ) : loadError ? (
            <tr><td colSpan={3} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
          ) : filtered ? (
            flatVisible!.map((unit) => renderRow(unit, false))
          ) : (
            topLevel.slice((safePage - 1) * pageSize, safePage * pageSize).map((unit) => (
              <Fragment key={unit.id}>
                {renderRow(unit, false)}
                {childrenOf(unit.id).map((child) => renderRow(child, true))}
              </Fragment>
            ))
          )}
          {!loading && !loadError && flatCount === 0 && (
            <tr>
              <td colSpan={3} className="px-9 py-10 text-center text-slate-400">
                Ничего не найдено
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Добавить единицу измерения" : "Изменить единицу измерения"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Родительское измерение
                <select value={draft.parentId} onChange={(event) => setDraft((value) => ({ ...value, parentId: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="">Нет</option>
                  {topLevel.filter((unit) => editing === "new" || unit.id !== (editing as UnitOfMeasure).id).map((unit) => (
                    <option key={unit.id} value={unit.id}>{unit.name}</option>
                  ))}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
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
