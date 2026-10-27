"use client"

import { Fragment, FormEvent, useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Pencil, Search, X } from "lucide-react"
import { RefHeader, RefPage } from "@/components/ref/list-kit"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

type Lang = "ru" | "uz" | "en"

type BotPage = {
  key: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
  content: Record<Lang, string>
}

// Content language tabs (i18n keys: "РУ" / "Ўз" read "RU" / "O'z" in the other UI languages).
const langTabs: { key: Lang; label: string }[] = [
  { key: "ru", label: "РУ" },
  { key: "uz", label: "Ўз" },
  { key: "en", label: "EN" },
]

// Title and description the system pages are seeded with (lib/telegram-bot-pages-repo.ts
// DEFAULT_PAGES). While a page keeps them they are shown in the UI language (dictionary
// keys); a title or description the user typed is data and is shown as typed.
const SEEDED_TEXT: Record<string, { title: string; description: string }> = {
  start: { title: "Приветствие", description: "Сообщение при старте бота" },
  about: { title: "О компании", description: "Информация о компании" },
  contacts: { title: "Контакты", description: "Контактные данные" },
  faq: { title: "Частые вопросы", description: "Ответы на частые вопросы" },
}

function seededText(page: BotPage, field: "title" | "description", t: (text: string) => string): string {
  const value = page[field]
  return value && SEEDED_TEXT[page.key]?.[field] === value ? t(value) : value
}

const initialPages: BotPage[] = []

export function TelegramBotPagesView() {
  const { t, language } = useLanguage()
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
    return pages.filter((page) => page.key.toLowerCase().includes(normalized) || page.title.toLowerCase().includes(normalized) || seededText(page, "title", t).toLowerCase().includes(normalized))
  }, [pages, query, t])

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
        window.alert(t("Не удалось сохранить страницу"))
        return
      }
      const saved = (await response.json()) as BotPage
      setPages((list) => list.map((page) => (page.key === editing.key ? saved : page)))
      setEditing(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <RefPage>
      <RefHeader title="Страницы телеграм бота" />

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-3 pr-10 outline-none focus:border-[#4f71dc]" />
            <Search className="absolute right-2 top-3 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {rows.length ? 1 : 0} - {rows.length} {t("из")} {rows.length}
          </span>
          <ChevronLeft className="h-5 w-5 text-slate-300" />
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-5">{t("Ключ")}</th>
              <th className="px-5 py-5">{t("Заголовок")}</th>
              <th className="px-5 py-5">{t("Описание")}</th>
              <th className="px-5 py-5">{t("Дата создания")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((page) => (
              <Fragment key={page.key}>
                <tr className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50" onClick={() => toggle(page.key)}>
                  <td className="px-9 py-5">{page.key}</td>
                  <td className="px-5 py-5">{seededText(page, "title", t)}</td>
                  <td className="px-5 py-5">{seededText(page, "description", t)}</td>
                  <td className="px-5 py-5">{formatDateText(page.createdAt, language)}</td>
                </tr>
                {expanded === page.key && (
                  <tr>
                    <td colSpan={4} className="border-b border-slate-200 bg-white p-0">
                      <div className="p-8">
                        <div className="mb-6 flex items-center justify-between">
                          <h2 className="text-2xl font-semibold text-slate-800">{seededText(page, "title", t)}</h2>
                          <button type="button" onClick={() => openEdit(page)} aria-label={t("Изменить")} className="text-slate-500 hover:text-[#4f71dc]">
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
                              {t(tab.label)}
                            </button>
                          ))}
                        </div>
                        <div className="grid gap-10 md:grid-cols-2">
                          <div className="space-y-1 text-slate-700">
                            <p className="font-semibold text-slate-800">{t("Описание:")}</p>
                            {page.description && <p>{seededText(page, "description", t)}</p>}
                            <p className="pt-3">
                              {t("Дата создания:")} <b>{formatDateText(page.createdAt, language)}</b>
                            </p>
                            <p>
                              {t("Дата редактирования:")} <b>{formatDateText(page.updatedAt, language)}</b>
                            </p>
                          </div>
                          <div>
                            <p className="mb-2 font-semibold text-slate-800">{t("Содержание:")}</p>
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
                  {t("Ничего не найдено")}
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
              <b className="uppercase">{t("Изменить страницу")}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label={t("Закрыть")}>
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-4 p-8">
              <label className="block border-b pb-2">
                {t("Заголовок")}
                <input autoFocus value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} className="mt-3 block w-full outline-none" />
              </label>
              <label className="block border-b pb-2">
                {t("Описание")}
                <input value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} className="mt-3 block w-full outline-none" />
              </label>
              {langTabs.map((tab) => (
                <label key={tab.key} className="block border-b pb-2">
                  {t("Содержание")} ({t(tab.label)})
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
                {saving ? t("Сохранение...") : t("Сохранить")}
              </button>
            </footer>
          </form>
        </div>
      )}
    </RefPage>
  )
}
