"use client"

import { Pencil, Star, Trash2, X } from "lucide-react"
import { FormEvent, useState } from "react"

type Category = { id: number; name: string }

const seed: Category[] = [
  { id: 1, name: "Water" },
  { id: 2, name: "напитки" },
  { id: 3, name: "Zavod23" },
  { id: 4, name: "Sardoraka Malochniy" },
  { id: 5, name: "energetik" },
  { id: 6, name: "toshkent filial" },
  { id: 7, name: "Ноутбук" },
  { id: 8, name: "Компьютер/Орг-техника" },
  { id: 9, name: "operator" },
  { id: 10, name: "Бозор" },
  { id: 11, name: "Бозор" },
]

export function SupplierCategoriesView({ embedded = false }: { embedded?: boolean }) {
  const [categories, setCategories] = useState(seed)
  const [favorite, setFavorite] = useState(false)
  const [editing, setEditing] = useState<Category | "new" | null>(null)
  const [name, setName] = useState("")

  function openCreate() {
    setName("")
    setEditing("new")
  }

  function openEdit(category: Category) {
    setName(category.name)
    setEditing(category)
  }

  function save(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (editing !== "new" && editing) {
      setCategories((current) => current.map((category) => (category.id === editing.id ? { ...category, name: trimmed } : category)))
    } else {
      const id = Math.max(0, ...categories.map((category) => category.id)) + 1
      setCategories((current) => [...current, { id, name: trimmed }])
    }
    setEditing(null)
  }

  function remove(id: number) {
    if (!window.confirm("Удалить категорию поставщика?")) return
    setCategories((current) => current.filter((category) => category.id !== id))
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <button type="button" onClick={() => setFavorite((value) => !value)} className="inline-flex items-center gap-2 text-[#4f70e7]">
              <Star className={`h-5 w-5 ${favorite ? "fill-amber-400 text-amber-400" : ""}`} /> Избранные
            </button>
            <span className="mx-2 text-slate-400">|</span> Категории поставщиков
          </h1>
        </header>
      )}

      <div className={embedded ? "" : ""}>
        <button type="button" onClick={openCreate} className="mb-4 text-[17px] text-[#4f70e7] hover:underline">
          + Добавить категорию поставщика
        </button>

        <div className="overflow-hidden rounded bg-white shadow">
          <table className="w-full text-left">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                <th className="px-9 py-5">Категории</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-5">{category.name}</td>
                  <td className="px-5 py-5">
                    <div className="hidden items-center justify-end gap-3 pr-4 text-slate-500 group-hover:flex">
                      <button type="button" onClick={() => openEdit(category)} aria-label="Изменить">
                        <Pencil className="h-5 w-5" />
                      </button>
                      <button type="button" onClick={() => remove(category.id)} aria-label="Удалить">
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-9 py-10 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Добавить тип поставщика" : "Изменить тип поставщика"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование категории <span className="text-red-500">*</span>
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-2 block w-full outline-none" />
              </label>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={!name.trim()} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                Сохранить
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
