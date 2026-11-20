import "server-only"

import { nowLocalIso } from "@/lib/finance/dates"
import { getRecord, listRecords, updateRecord } from "@/lib/ref-records-repo"

export type Lang = "ru" | "uz" | "en"

export const PAGE_LANGS: readonly Lang[] = ["ru", "uz", "en"]

/** One language of a page, as the reference keeps it (main/system-pages/<id>/ translations.<lang>). */
export type PageText = {
  title: string
  description: string
  /** «Ссылка на статью» (telegraph_link): free text in the reference, not checked as a URL. */
  telegraphLink: string
  /** «Содержание» (body): the text the bot sends. */
  body: string
}

export type BotPage = {
  key: string
  /** Linko's id of a page copied from it (its links name a page by it, #/system-pages/2); null for another page. */
  id: number | null
  /** The Russian title and description (the list's fallback when a language has none). */
  title: string
  description: string
  createdAt: string
  updatedAt: string
  translations: Record<Lang, PageText>
}

// "Страницы телеграм бота": the system pages of the reference (kind "tg-page" of the shared reference store, id = key).
// Every page has a title, description, article link and body per language (ru / uz / en), like the reference's
// translations. Records stored before that kept one title / description and a body per language (`content`); they
// are read as the same title, description and link in every language.

type StoredText = Partial<Record<keyof PageText, unknown>>
type Stored = {
  key: string
  linkoId?: unknown
  title?: string
  description?: string
  telegraphLink?: string
  createdAt: string
  updatedAt: string
  content?: Partial<Record<Lang, string>>
  translations?: Partial<Record<Lang, StoredText>>
}

const str = (value: unknown) => (typeof value === "string" ? value : "")

function toPage(data: Record<string, unknown>): BotPage {
  const stored = data as unknown as Stored
  const translations = {} as Record<Lang, PageText>
  for (const lang of PAGE_LANGS) {
    const own = stored.translations?.[lang]
    translations[lang] = own
      ? { title: str(own.title), description: str(own.description), telegraphLink: str(own.telegraphLink), body: str(own.body) }
      : { title: str(stored.title), description: str(stored.description), telegraphLink: str(stored.telegraphLink), body: str(stored.content?.[lang]) }
  }
  const linkoId = Number(stored.linkoId)
  return {
    key: stored.key,
    id: Number.isSafeInteger(linkoId) && linkoId > 0 ? linkoId : null,
    title: translations.ru.title || str(stored.title),
    description: translations.ru.description,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    translations,
  }
}

export async function listBotPages(): Promise<BotPage[]> {
  return (await listRecords("tg-page")).map((record) => toPage(record.data)).sort((a, b) => a.key.localeCompare(b.key))
}

export async function getBotPage(key: string): Promise<BotPage | null> {
  const record = await getRecord("tg-page", key)
  return record ? toPage(record.data) : null
}

export type BotPageInput = { translations: Record<Lang, PageText> }

/** The PUT body (already checked by the route's schema): every language and field, missing ones empty. */
export function parseBotPageInput(body: unknown): BotPageInput | null {
  if (!body || typeof body !== "object") return null
  const source = (body as { translations?: unknown }).translations
  if (!source || typeof source !== "object") return null
  const translations = {} as Record<Lang, PageText>
  for (const lang of PAGE_LANGS) {
    const value = ((source as Record<string, unknown>)[lang] ?? {}) as StoredText
    translations[lang] = { title: str(value.title).trim(), description: str(value.description), telegraphLink: str(value.telegraphLink).trim(), body: str(value.body) }
  }
  return { translations }
}

/** Saves the page's texts of every language (an empty title keeps the stored one) and its edit moment (Asia/Tashkent). */
export async function updateBotPage(key: string, input: BotPageInput): Promise<BotPage | null> {
  const existing = await getBotPage(key)
  if (!existing) return null
  const translations = {} as Record<Lang, PageText>
  for (const lang of PAGE_LANGS) {
    const next = input.translations[lang]
    translations[lang] = { ...next, title: next.title || existing.translations[lang].title }
  }
  const record = await updateRecord("tg-page", key, {
    translations,
    // The single-language fields older readers use stay in step with the Russian texts.
    title: translations.ru.title,
    description: translations.ru.description,
    telegraphLink: translations.ru.telegraphLink,
    content: { ru: translations.ru.body, uz: translations.uz.body, en: translations.en.body },
    updatedAt: nowLocalIso().slice(0, 16),
  })
  return record ? toPage(record.data) : null
}
