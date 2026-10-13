"use client"

import { Fragment, FormEvent, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Pencil, Search, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type Lang = "ru" | "uz" | "en"

type BotPage = {
  key: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
  content: Record<Lang, string>
}

const langTabs: { key: Lang; label: string }[] = [
  { key: "ru", label: "РУ" },
  { key: "uz", label: "Ўз" },
  { key: "en", label: "EN" },
]

const initialPages: BotPage[] = []

export function TelegramBotPagesView() {
  const [pages, setPages] = useState(initialPages)
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [lang, setLang] = useState<Lang>("ru")
  const [editing, setEditing] = useState<BotPage | null>(null)
  const [draft, setDraft] = useState<{ title: string; description: string; content: Record<Lang, string> }>({
    title: "",
    description: "",
    content: { ru: "", uz: "", en: "" },
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch("/api/telegram-bot-pages")
      .then((response) => (response.ok ? (response.json() as Promise<BotPage[]>) : Promise.reject()))
      .then(setPages)
      .catch(() => {})
  }, [])

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return pages
    return pages.filter((page) => page.key.toLowerCase().includes(normalized) || page.title.toLowerCase().includes(normalized))
  }, [pages, query])

  function toggle(key: string) {
    setExpanded((current) => (current === key ? null : key))
    setLang("ru")
  }

  function openEdit(page: BotPage) {
    setDraft({ title: page.title, description: page.description, content: { ...page.content } })
    setEditing(page)
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    setSaving(true)
    try {
      const response = await fetch(`/api/telegram-bot-pages/${editing.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title, description: draft.description, content: draft.content }),
      })
      if (!response.ok) {
        window.alert("Не удалось сохранить страницу")
        return
      }
      const saved = (await response.json()) as BotPage
      setPages((list) => list.map((page) => (page.key === editing.key ? saved : page)))
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-slate-600">
          <FavoritesButton className="inline-flex items-center gap-2 text-[#4f71dc]" />
          <span className="mx-2 text-slate-400">|</span> Страницы телеграм бота
        </h1>
      </header>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-3 pr-10 outline-none focus:border-[#4f71dc]" />
            <Search className="absolute right-2 top-3 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            1 - {rows.length} из {rows.length}
          </span>
          <ChevronLeft className="h-5 w-5 text-slate-300" />
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-5">Ключ</th>
              <th className="px-5 py-5">Заголовок</th>
              <th className="px-5 py-5">Описание</th>
              <th className="px-5 py-5">Дата создания</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((page) => (
              <Fragment key={page.key}>
                <tr className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50" onClick={() => toggle(page.key)}>
                  <td className="px-9 py-5">{page.key}</td>
                  <td className="px-5 py-5">{page.title}</td>
                  <td className="px-5 py-5">{page.description}</td>
                  <td className="px-5 py-5">{page.createdAt}</td>
                </tr>
                {expanded === page.key && (
                  <tr>
                    <td colSpan={4} className="border-b border-slate-200 bg-white p-0">
                      <div className="p-8">
                        <div className="mb-6 flex items-center justify-between">
                          <h2 className="text-2xl font-semibold text-slate-800">{page.title}</h2>
                          <button type="button" onClick={() => openEdit(page)} aria-label="Изменить" className="text-slate-500 hover:text-[#4f71dc]">
                            <Pencil className="h-5 w-5" />
                          </button>
                        </div>
                        <div className="mb-6 flex gap-6 border-b border-slate-200">
                          {langTabs.map((tab) => (
                            <button
                              key={tab.key}
                              type="button"
                              onClick={() => setLang(tab.key)}
                              className={`border-b-2 pb-3 text-base font-medium ${lang === tab.key ? "border-[#4f71dc] text-[#4f71dc]" : "border-transparent text-slate-500 hover:text-slate-700"}`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                        <div className="grid gap-10 md:grid-cols-2">
                          <div className="space-y-1 text-slate-700">
                            <p className="font-semibold text-slate-800">Описание:</p>
                            {page.description && <p>{page.description}</p>}
                            <p className="pt-3">
                              Дата создания: <b>{page.createdAt}</b>
                            </p>
                            <p>
                              Дата редактирования: <b>{page.updatedAt}</b>
                            </p>
                          </div>
                          <div>
                            <p className="mb-2 font-semibold text-slate-800">Содержание:</p>
                            <p className="whitespace-pre-line text-[#4f71dc]">{page.content[lang]}</p>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={saveEdit} className="w-full max-w-xl rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Изменить страницу</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-4 p-8">
              <label className="block border-b pb-2">
                Заголовок
                <input autoFocus value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} className="mt-3 block w-full outline-none" />
              </label>
              <label className="block border-b pb-2">
                Описание
                <input value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} className="mt-3 block w-full outline-none" />
              </label>
              {langTabs.map((tab) => (
                <label key={tab.key} className="block border-b pb-2">
                  Содержание ({tab.label})
                  <textarea
                    value={draft.content[tab.key]}
                    onChange={(event) => setDraft((value) => ({ ...value, content: { ...value.content, [tab.key]: event.target.value } }))}
                    rows={2}
                    className="mt-3 block w-full resize-none outline-none"
                  />
                </label>
              ))}
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#71ce87] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
