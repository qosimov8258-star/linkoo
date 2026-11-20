"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { RefHeader, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { RefTip } from "@/components/ref/ref-tip"
import { SplitDetailList } from "@/components/ref/split-detail"
import { MaterialField } from "@/components/analytics/material-field"
import { SortHead, sortByOrdering, toggleOrdering, useListUrlState } from "@/components/analytics/list-url-state"
import { parseAnyDate } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

type Lang = "ru" | "uz" | "en"
type PageText = { title: string; description: string; telegraphLink: string; body: string }

type BotPage = {
  key: string
  /** Linko's id of a copied page (lib/telegram-bot-pages-repo.ts). */
  id?: number | null
  title: string
  description: string
  createdAt: string
  updatedAt: string
  translations: Record<Lang, PageText>
}

// «Страницы телеграм бота» (reference #/system-pages, API main/system-pages/): the texts the Telegram bot sends, each in
// Russian, Uzbek and English. The list shows them in the UI language, like the reference's API does; a row opens a card
// in its place with the page in one language per tab, and the pencil opens «Редактирование новости» with every language.

const LANGS: Lang[] = ["ru", "uz", "en"]
// Tab captions (i18n keys "РУ" / "Ўз" / "EN"; shown upper-case like the reference's "Ру" / "Ўз" / "En").
const TAB_LABEL: Record<Lang, string> = { ru: "РУ", uz: "Ўз", en: "EN" }
const BASE = "/analytics/telegram-pages"
const ORDERINGS = ["title", "description", "created_date"] as const
// The reference's material "edit" icon of the card header.
const EDIT_ICON = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const CLOSE_ICON = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

const EMPTY_TEXT: PageText = { title: "", description: "", telegraphLink: "", body: "" }

/** The language the list shows (the reference asks its API in the UI language; there is no Turkmen text, so Russian). */
function listLang(language: string): Lang {
  return language === "uz" || language === "en" ? language : "ru"
}

function pageText(page: BotPage, lang: Lang): PageText {
  const text = page.translations?.[lang] ?? EMPTY_TEXT
  return { ...text, title: text.title || page.title, description: text.description }
}

const dateKey = (value: string) => parseAnyDate(value) ?? ""

/** A page's address segment: Linko's id when it has one (its links read #/system-pages/2), else its key. */
const routeOf = (page: BotPage) => (page.id != null ? String(page.id) : page.key)

export function TelegramBotPagesView({ initialKey = null }: { initialKey?: string | null }) {
  const { t, language } = useLanguage()
  const [pages, setPages] = useState<BotPage[]>([])
  const { state, update } = useListUrlState({ base: BASE, dialogParam: "openUpdateDialog", orderings: ORDERINGS, initialId: initialKey })
  const [tab, setTab] = useState<Lang>("ru")

  useEffect(() => {
    fetch("/api/telegram-bot-pages", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<BotPage[]>) : Promise.reject()))
      .then(setPages)
      .catch(() => {})
  }, [])

  const lang = listLang(language)
  // The reference's search request is ignored by its server (every page stays listed); here it finds pages by key and title.
  const rows = useMemo(() => {
    const term = state.search.trim().toLowerCase()
    const found = term ? pages.filter((page) => page.key.toLowerCase().includes(term) || pageText(page, lang).title.toLowerCase().includes(term)) : pages
    return sortByOrdering(found, state.ordering, {
      title: (a, b) => pageText(a, lang).title.localeCompare(pageText(b, lang).title, "ru"),
      description: (a, b) => pageText(a, lang).description.localeCompare(pageText(b, lang).description, "ru"),
      created_date: (a, b) => dateKey(a.createdAt).localeCompare(dateKey(b.createdAt)),
    })
  }, [pages, state.search, state.ordering, lang])

  const pageCount = Math.max(1, Math.ceil(rows.length / state.pageSize))
  const page = Math.min(state.page, pageCount)
  const start = (page - 1) * state.pageSize
  const end = Math.min(start + state.pageSize, rows.length)
  const selected = state.id ? pages.find((item) => routeOf(item) === state.id || item.key === state.id) ?? null : null
  const editing = state.dialog === true && selected ? selected : null
  const sort = (field: string) => update({ ordering: toggleOrdering(state.ordering, field), page: 1 })

  function open(key: string | null) {
    setTab("ru")
    update({ id: key })
  }

  return (
    <RefPage>
      <RefHeader title={t("Страницы телеграм бота")} />

      <SplitDetailList
        rows={rows.slice(start, end)}
        selectedKey={selected ? routeOf(selected) : state.id}
        rowKey={(item) => routeOf(item)}
        toolbar={
          <RefToolbar
            hideFilter
            pageSizeMenu
            query={state.search}
            onQuery={(value) => update({ search: value, page: 1 })}
            pageSize={state.pageSize}
            onPageSize={(size) => update({ pageSize: size, page: 1 })}
            from={rows.length ? start + 1 : 0}
            to={end}
            total={rows.length}
            page={page}
            pageCount={pageCount}
            onPage={(next) => update({ page: next })}
          />
        }
        tableProps={{
          cols: "minmax(0,3fr) minmax(0,3fr) minmax(0,3fr) minmax(0,3fr)",
          // As in the reference: «Ключ» (title and cells) starts 8px left of the other columns and does not sort.
          heads: [
            <span key="key" className="-ml-2 font-semibold">{t("Ключ")}</span>,
            <SortHead key="title" label={t("Заголовок")} field="title" ordering={state.ordering} onSort={sort} />,
            <SortHead key="description" label={t("Описание")} field="description" ordering={state.ordering} onSort={sort} />,
            <SortHead key="created" label={t("Дата создания")} field="created_date" ordering={state.ordering} onSort={sort} />,
          ],
          rowKey: (item: BotPage) => routeOf(item),
          onRowClick: (item: BotPage) => open(routeOf(item)),
          empty: t("Ничего не найдено"),
          render: (item: BotPage) => [
            <b key="key" className="-ml-2 block font-semibold">{item.key}</b>,
            <b key="title" className="block font-semibold">{pageText(item, lang).title}</b>,
            <span key="description" className="block">{pageText(item, lang).description}</span>,
            <b key="date" className="block font-semibold">{formatDateText(item.createdAt, language)}</b>,
          ],
        }}
        detail={(item) => (
          <PageCard
            page={item}
            tab={tab}
            onTab={setTab}
            onClose={() => open(null)}
            onEdit={() => update({ dialog: true })}
          />
        )}
      />

      {editing && (
        <EditDialog
          key={editing.key}
          page={editing}
          onClose={() => update({ dialog: false })}
          onSaved={(saved) => {
            setPages((list) => list.map((item) => (item.key === saved.key ? saved : item)))
            update({ dialog: false })
          }}
        />
      )}
    </RefPage>
  )
}

/** Field captions of a card tab: the Russian tab follows the UI language, the Uzbek and English ones keep their own. */
function cardLabels(lang: Lang, t: (text: string) => string) {
  if (lang === "uz") return { description: "Tavsif:", created: "Yaratilgan sana:", modified: "O'zgartirilgan sana:", content: "Matn:" }
  if (lang === "en") return { description: "Description:", created: "Created date:", modified: "Modified date:", content: "Content:" }
  return { description: t("Описание:"), created: t("Дата создания:"), modified: t("Дата редактирования:"), content: t("Содержание:") }
}

function LangTabs({ value, onChange, width }: { value: Lang; onChange: (lang: Lang) => void; width: string }) {
  const { t } = useLanguage()
  const index = LANGS.indexOf(value)
  return (
    <div className="relative flex">
      {LANGS.map((lang) => (
        <button key={lang} type="button" onClick={() => onChange(lang)} className={`h-[48px] text-[13px] font-medium uppercase text-black ${width}`}>
          {t(TAB_LABEL[lang])}
        </button>
      ))}
      <span className={`absolute bottom-0 left-0 h-[2px] bg-[#1E4A9A] transition-transform duration-300 ${width}`} style={{ transform: `translateX(${index * 100}%)` }} />
    </div>
  )
}

/** The card that replaces the row (reference: a 65px header whose click closes it, the pencil «Изменить», and two halves —
 * the language tabs with the description and dates, the content). */
function PageCard({ page, tab, onTab, onClose, onEdit }: { page: BotPage; tab: Lang; onTab: (lang: Lang) => void; onClose: () => void; onEdit: () => void }) {
  const { t, language } = useLanguage()
  const text = pageText(page, tab)
  const labels = cardLabels(tab, t)
  // The reference's card sits 1px higher than its mailing card (20px under the list), sets 16.25px lines and ends with a
  // 1px dotted line.
  return (
    <div className="-mt-px border-b border-dotted border-[#eee] text-[13px] leading-[16.25px] text-[#333]">
      <div className="relative flex h-[65px] items-center justify-between border-b border-[#efefef] px-[30px]">
        <div className="text-[18px] font-semibold text-[#333]">{text.title}</div>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="absolute inset-0 z-[1] cursor-pointer" />
        <div className="relative z-[2] flex">
          <RefTip text={t("Изменить")} side="bottom">
            <button type="button" onClick={onEdit} aria-label={t("Изменить")} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]" aria-hidden><path d={EDIT_ICON} /></svg>
            </button>
          </RefTip>
        </div>
      </div>
      <div className="flex">
        <div className="w-1/2 border-r border-[#efefef] px-[30px] pb-[20px]">
          <div className="w-[360px]"><LangTabs value={tab} onChange={onTab} width="w-[120px]" /></div>
          <ul className="pt-[20px]">
            <li className="mb-[5px] font-semibold">{labels.description} <span className="font-normal">{text.description}</span></li>
            <li className="mb-[5px] font-semibold">{labels.created} <span className="font-normal">{formatDateText(page.createdAt, language)}</span></li>
            <li className="font-semibold">{labels.modified} <span className="font-normal">{formatDateText(page.updatedAt, language)}</span></li>
          </ul>
        </div>
        <div className="w-1/2 px-[30px] py-[20px]">
          <div className="mb-[10px] text-[14px] font-semibold leading-[17.5px]">{labels.content}</div>
          <div className="whitespace-pre-line">{text.body}</div>
        </div>
      </div>
    </div>
  )
}

/** Field captions of a dialog tab (the reference's own words per language; the Russian ones follow the UI language). */
function dialogLabels(lang: Lang, t: (text: string) => string) {
  if (lang === "uz") return { title: "Sarlavha", description: "Tavsif", link: "Maqolaga havola", add: "+ qo'shish", content: "Matn" }
  if (lang === "en") return { title: "Title", description: "Description", link: "Telegraph link", add: "+ add", content: "Content" }
  return { title: t("Заголовок"), description: t("Описание"), link: t("Ссылка на статью"), add: t("+ добавить"), content: t("Содержание") }
}

/**
 * «Редактирование новости» (reference: 768px, modal — neither Escape nor the backdrop closes it). Left: the language tabs,
 * each with its title, description and article link (+ a link to telegra.ph); right: the content of the chosen tab.
 * Each tab starts from its own language's texts (the reference fills all three with the Russian ones, so saving there
 * overwrites the Uzbek and English texts).
 */
function EditDialog({ page, onClose, onSaved }: { page: BotPage; onClose: () => void; onSaved: (page: BotPage) => void }) {
  const { t } = useLanguage()
  const [tab, setTab] = useState<Lang>("ru")
  const [draft, setDraft] = useState<Record<Lang, PageText>>(() => ({
    ru: { ...EMPTY_TEXT, ...page.translations?.ru },
    uz: { ...EMPTY_TEXT, ...page.translations?.uz },
    en: { ...EMPTY_TEXT, ...page.translations?.en },
  }))
  const [saving, setSaving] = useState(false)
  const labels = dialogLabels(tab, t)
  const set = (field: keyof PageText) => (value: string) => setDraft((current) => ({ ...current, [tab]: { ...current[tab], [field]: value } }))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const response = await fetch(`/api/telegram-bot-pages/${encodeURIComponent(page.key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ translations: draft }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: unknown }
        notify(t(typeof body.error === "string" && body.error ? body.error : "Не удалось сохранить страницу"))
        return
      }
      onSaved((await response.json()) as BotPage)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/[0.54]">
      <form onSubmit={save} className="w-[768px] max-w-[calc(100vw-32px)] bg-white text-[13px] text-[#333] shadow-[0_19px_60px_rgba(0,0,0,0.3),0_15px_20px_rgba(0,0,0,0.22)]">
        <div className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <h2 className="text-[13px] font-bold uppercase leading-[16.25px] text-[#333]">{t("Редактирование новости")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden><path d={CLOSE_ICON} /></svg>
          </button>
        </div>
        <div className="flex">
          <div className="w-1/2 border-r border-[#efefef]">
            <LangTabs value={tab} onChange={setTab} width="w-1/3" />
            <div className="px-[30px] pb-[20px] pt-[10px]">
              <MaterialField key={`title-${tab}`} label={labels.title} value={draft[tab].title} onChange={set("title")} />
              <MaterialField key={`description-${tab}`} label={labels.description} value={draft[tab].description} onChange={set("description")} />
              {/* The reference's link field keeps 231px in every language; «+ добавить» sits at the column's right edge. */}
              <div className="flex items-center">
                <MaterialField key={`link-${tab}`} label={labels.link} hint="http://telegra.ph/" value={draft[tab].telegraphLink} onChange={set("telegraphLink")} className="w-[231px] shrink-0" />
                <a href="http://telegra.ph" target="_blank" rel="noreferrer" className="ml-auto shrink-0 whitespace-nowrap text-right text-[#129fdd]">{labels.add}</a>
              </div>
            </div>
          </div>
          <div className="w-1/2 px-[30px] pt-[5px]">
            <MaterialField key={`body-${tab}`} label={labels.content} rows={7} value={draft[tab].body} onChange={set("body")} />
          </div>
        </div>
        <div className="border-t border-[#efefef] p-[10px] text-right">
          <button type="submit" disabled={saving} className="h-9 min-w-[88px] rounded-[2px] px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[rgba(153,153,153,0.2)] disabled:opacity-60">
            {t("Сохранить")}
          </button>
        </div>
      </form>
    </div>
  )
}
