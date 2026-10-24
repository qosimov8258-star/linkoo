import "server-only"

import { getRecord, listRecords, updateRecord } from "@/lib/ref-records-repo"

export type Lang = "ru" | "uz" | "en"

export type BotPage = {
  key: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
  content: Record<Lang, string>
}

// "Страницы телеграм бота": the 3 system pages of the reference (kind "tg-page" of the shared reference store, id = key).

type Stored = { id?: string; key: string; title: string; description: string; createdAt: string; updatedAt: string; content?: Partial<Record<Lang, string>> }

function toPage(data: Record<string, unknown>): BotPage {
  const stored = data as unknown as Stored
  return {
    key: stored.key,
    title: stored.title,
    description: stored.description,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    content: { ru: stored.content?.ru ?? "", uz: stored.content?.uz ?? "", en: stored.content?.en ?? "" },
  }
}

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."]

function formatNow(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

export async function listBotPages(): Promise<BotPage[]> {
  return (await listRecords("tg-page")).map((record) => toPage(record.data)).sort((a, b) => a.key.localeCompare(b.key))
}

export async function getBotPage(key: string): Promise<BotPage | null> {
  const record = await getRecord("tg-page", key)
  return record ? toPage(record.data) : null
}

export type BotPageInput = {
  title: string
  description: string
  content: Record<Lang, string>
}

export function parseBotPageInput(body: unknown): BotPageInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const title = typeof value.title === "string" ? value.title.trim() : ""
  const description = typeof value.description === "string" ? value.description : ""
  const contentValue = value.content && typeof value.content === "object" ? (value.content as Record<string, unknown>) : {}
  const content: Record<Lang, string> = {
    ru: typeof contentValue.ru === "string" ? contentValue.ru : "",
    uz: typeof contentValue.uz === "string" ? contentValue.uz : "",
    en: typeof contentValue.en === "string" ? contentValue.en : "",
  }
  return { title, description, content }
}

export async function updateBotPage(key: string, input: BotPageInput): Promise<BotPage | null> {
  const existing = await getBotPage(key)
  if (!existing) return null
  const title = input.title.trim() ? input.title.trim() : existing.title
  const record = await updateRecord("tg-page", key, { title, description: input.description, content: input.content, updatedAt: formatNow() })
  return record ? toPage(record.data) : null
}
