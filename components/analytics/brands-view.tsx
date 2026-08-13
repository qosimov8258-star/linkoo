"use client"

import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { brandOrganizations as organizations, type Brand } from "./brands-data"

function emptyDraft() {
  return { name: "", organization: "", photoUrl: null as string | null }
}

export function BrandsView({ embedded = false }: { embedded?: boolean }) {
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/brands")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить бренды")
        return (await response.json()) as Brand[]
      })
      .then((data) => {
        if (cancelled) return
        setBrands(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить бренды с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return brands
    const q = query.trim().toLowerCase()
    return brands.filter((brand) => brand.name.toLowerCase().includes(q))
  }, [brands, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(brand: Brand) {
    setDraft({ name: brand.name, organization: brand.organization === "Не указано" ? "" : brand.organization, photoUrl: brand.photoUrl && brand.photoUrl !== "brand" ? brand.photoUrl : null })
    setFormError("")
    setEditingId(brand.id)
    setModalOpen(true)
    setOpenMenuId(null)
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить бренд?")) return
    try {
      const response = await fetch(`/api/brands/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить бренд")
        return
      }
      setBrands((current) => current.filter((brand) => brand.id !== id))
      setOpenMenuId(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setDraft((value) => ({ ...value, photoUrl: String(reader.result ?? "") }))
    reader.readAsDataURL(file)
    event.target.value = ""
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const name = draft.name.trim()
    if (!name || !draft.organization) return

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/brands/${editingId}` : "/api/brands", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, organization: draft.organization, photoUrl: draft.photoUrl }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить бренд")
        return
      }
      const saved = (await response.json()) as Brand
      setBrands((current) => (isEdit ? current.map((brand) => (brand.id === editingId ? saved : brand)) : [saved, ...current]))
      setModalOpen(false)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-600">Бренд</h1>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 text-[16px] font-medium text-[#4f70e7] hover:underline">
            <Plus className="h-4 w-4" /> Добавить бренд
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
              <th className="px-9 py-5">Id</th>
              <th className="px-5 py-5">Фото</th>
              <th className="px-5 py-5">Наименование</th>
              <th className="px-5 py-5">Организация</th>
              <th className="px-5 py-5">Дата создания</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-9 py-10 text-center text-slate-400">Загрузка брендов...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={6} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((brand) => (
              <tr key={brand.id} onClick={() => openEdit(brand)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{brand.id}</td>
                <td className="px-5 py-4">
                  {brand.photoUrl && brand.photoUrl !== "brand" && (
                    <img src={brand.photoUrl} alt={brand.name} className="h-9 w-9 rounded object-cover" />
                  )}
                  {brand.photoUrl === "brand" && (
                    <span className="flex h-9 w-9 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-300">
                      <ImagePlus className="h-4 w-4" />
                    </span>
                  )}
                </td>
                <td className="px-5 py-4 text-[#4f70e7]">{brand.name}</td>
                <td className="px-5 py-4">{brand.organization}</td>
                <td className="px-5 py-4">{brand.createdDate}</td>
                <td className="relative px-3 py-4 text-right">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => (current === brand.id ? null : brand.id)) }}
                    aria-label="Ещё"
                    className="text-slate-500 hover:text-slate-800"
                  >
                    <MoreVertical className="h-5 w-5" />
                  </button>
                  {openMenuId === brand.id && (
                    <div onClick={(event) => event.stopPropagation()} className="absolute right-3 top-12 z-30 w-44 rounded border border-slate-200 bg-white py-1 text-left shadow-xl">
                      <button type="button" onClick={() => openEdit(brand)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
                        <Pencil className="h-4 w-4" /> Изменить
                      </button>
                      <button type="button" onClick={() => remove(brand.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-rose-500 hover:bg-slate-50">
                        <Trash2 className="h-4 w-4" /> Удалить
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && !loadError && visible.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-10">
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-lg flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? "Изменить бренд" : "Добавить бренд"}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Организация <span className="text-red-500">*</span>
                <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="" disabled>Выберите организацию</option>
                  {organizations.map((org) => <option key={org} value={org}>{org}</option>)}
                </select>
              </label>

              <input ref={fileInputRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
              {draft.photoUrl ? (
                <div className="relative mx-auto w-fit">
                  <img src={draft.photoUrl} alt="Фото бренда" className="h-40 w-40 rounded object-cover" />
                  <button
                    type="button"
                    onClick={() => setDraft((value) => ({ ...value, photoUrl: null }))}
                    aria-label="Удалить фото"
                    className="absolute -right-2 -top-2 rounded-full bg-white p-1 text-slate-500 shadow hover:text-rose-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-2 block w-full text-center text-sm text-[#4f70e7] hover:underline">
                    Заменить фото
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mx-auto flex h-40 w-40 flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-slate-300 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
                >
                  <ImagePlus className="h-8 w-8" />
                  Добавьте фото
                </button>
              )}
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
