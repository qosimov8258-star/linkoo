"use client"

import { Fragment, FormEvent, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Pencil, Search, X } from "lucide-react"
import { RefCard, RefHeader, RefPage, RefTable, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { notify } from "@/lib/notify"

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
  const paging = usePaging(rows.length)

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
        notify("Не удалось сохранить страницу")
        return
      }
      const saved = (await response.json()) as BotPage
      setPages((list) => list.map((page) => (page.key === editing.key ? saved : page)))
      setEditing(null)
    } catch {
      notify("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <RefPage>
      <RefHeader title="Страницы телеграм бота" />

      <RefCard>
        <RefToolbar
          hideFilter
          query={query}
          onQuery={(value) => { setQuery(value); paging.setPage(1) }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={rows.length ? paging.start + 1 : 0}
          to={paging.end}
          total={rows.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
        />
        <RefTable
          cols="minmax(0,3fr) minmax(0,3fr) minmax(0,3fr) minmax(0,3fr)"
          heads={["Ключ", "Заголовок", "Описание", "Дата создания"]}
          rows={rows.slice(paging.start, paging.end)}
          rowKey={(page) => page.key}
          onRowClick={(page) => toggle(page.key)}
          empty="Ничего не найдено"
          render={(page) => [<b key="key" className="font-semibold">{page.key}</b>, <b key="title" className="font-semibold">{page.title}</b>, page.description, <b key="date" className="font-semibold">{page.createdAt}</b>]}
          expanded={(page) => (expanded === page.key ? <div className="border-b border-slate-200 bg-white">
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
          </div> : null)}
        />
      </RefCard>

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
    </RefPage>
  )
}
