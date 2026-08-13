"use client"

import { ChevronLeft, ChevronRight, Pencil, Search, Star, Trash2, X } from "lucide-react"
import { FormEvent, useEffect, useMemo, useState } from "react"

import type { Currency } from "./currencies-data"

function emptyDraft() {
  return { name: "", code: "", rate: "1", isBase: false }
}

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)

export function CurrenciesView() {
  const [favorite, setFavorite] = useState(false)
  const [currencies, setCurrencies] = useState<Currency[]>([])
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
    fetch("/api/currencies")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить валюты")
        return (await response.json()) as Currency[]
      })
      .then((data) => {
        if (cancelled) return
        setCurrencies(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить валюты с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return currencies
    const q = query.trim().toLocaleLowerCase("ru")
    return currencies.filter((currency) => currency.name.toLocaleLowerCase("ru").includes(q) || currency.code.toLocaleLowerCase("ru").includes(q))
  }, [currencies, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(currency: Currency) {
    setDraft({ name: currency.name, code: currency.code, rate: String(currency.rate), isBase: currency.isBase })
    setFormError("")
    setEditingId(currency.id)
    setModalOpen(true)
  }

  async function remove(id: number) {
    const target = currencies.find((currency) => currency.id === id)
    if (target?.isBase) {
      window.alert("Нельзя удалить базовую валюту")
      return
    }
    if (!window.confirm("Удалить валюту?")) return
    try {
      const response = await fetch(`/api/currencies/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить валюту")
        return
      }
      setCurrencies((current) => current.filter((currency) => currency.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const name = draft.name.trim()
    const code = draft.code.trim().toUpperCase()
    if (!name || !code) return
    const rate = draft.isBase ? 1 : Math.max(0, Number(draft.rate) || 0)

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/currencies/${editingId}` : "/api/currencies", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, rate, isBase: draft.isBase }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить валюту")
        return
      }
      const saved = (await response.json()) as Currency
      setCurrencies((current) => {
        const withoutBaseConflict = draft.isBase ? current.map((currency) => ({ ...currency, isBase: false })) : current
        if (isEdit) {
          return withoutBaseConflict.map((currency) => (currency.id === editingId ? saved : currency))
        }
        return [saved, ...withoutBaseConflict]
      })
      setModalOpen(false)
      setPage(1)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <button type="button" onClick={() => setFavorite((value) => !value)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Валюты</span>
        </button>
      </header>

      <div className="px-9 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <button type="button" onClick={openCreate} className="text-[16px] text-[#4f70e7] hover:underline">
            + добавить валюту
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
              <th className="px-5 py-5">Код</th>
              <th className="px-5 py-5">Курс к SUM</th>
              <th className="px-5 py-5">Базовая</th>
              <th className="px-5 py-5">Дата создания</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-9 py-10 text-center text-slate-400">Загрузка валют...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={6} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((currency) => (
              <tr key={currency.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4 font-medium">{currency.name}</td>
                <td className="px-5 py-4">
                  <span className="inline-block rounded bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600">{currency.code}</span>
                </td>
                <td className="px-5 py-4">{number(currency.rate)}</td>
                <td className="px-5 py-4">
                  {currency.isBase && <span className="inline-block rounded bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-600">Базовая</span>}
                </td>
                <td className="px-5 py-4">{currency.createdDate}</td>
                <td className="px-5 py-4">
                  <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => openEdit(currency)} aria-label="Изменить">
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => remove(currency.id)} aria-label="Удалить">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && !loadError && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-9 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? "Изменить валюту" : "Добавить валюту"}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Код <span className="text-red-500">*</span>
                <input value={draft.code} onChange={(event) => setDraft((value) => ({ ...value, code: event.target.value }))} placeholder="USD" maxLength={5} className="mt-2 block w-full uppercase outline-none" />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.isBase}
                  onChange={(event) => setDraft((value) => ({ ...value, isBase: event.target.checked }))}
                  className="h-4 w-4 accent-[#4f70e7]"
                />
                Базовая валюта
              </label>
              {!draft.isBase && (
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  Курс к SUM
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.rate}
                    onChange={(event) => setDraft((value) => ({ ...value, rate: event.target.value }))}
                    className="mt-2 block w-full outline-none"
                  />
                </label>
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
