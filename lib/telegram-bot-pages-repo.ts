import "server-only"

import { getDb } from "@/lib/db"

export type Lang = "ru" | "uz" | "en"

export type BotPage = {
  key: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
  content: Record<Lang, string>
}

type Row = {
  key: string
  title: string
  description: string
  content_ru: string
  content_uz: string
  content_en: string
  created_at: string
  updated_at: string
}

const DEFAULT_PAGES: { key: string; title: string; description: string }[] = [
  { key: "start", title: "Приветствие", description: "Сообщение при старте бота" },
  { key: "about", title: "О компании", description: "Информация о компании" },
  { key: "contacts", title: "Контакты", description: "Контактные данные" },
  { key: "faq", title: "Частые вопросы", description: "Ответы на частые вопросы" },
]

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_bot_pages (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      content_ru TEXT NOT NULL DEFAULT '',
      content_uz TEXT NOT NULL DEFAULT '',
      content_en TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  const insert = db.prepare("INSERT OR IGNORE INTO telegram_bot_pages (key, title, description) VALUES (@key, @title, @description)")
  for (const page of DEFAULT_PAGES) insert.run(page)
}

function formatDate(sqliteDate: string): string {
  const isoLike = sqliteDate.includes("T") ? sqliteDate : `${sqliteDate.replace(" ", "T")}Z`
  const date = new Date(isoLike)
  if (Number.isNaN(date.getTime())) return sqliteDate
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .format(date)
    .replace(" г.", "")
}

function rowToPage(row: Row): BotPage {
  return {
    key: row.key,
    title: row.title,
    description: row.description,
    createdAt: formatDate(row.created_at),
    updatedAt: formatDate(row.updated_at),
    content: { ru: row.content_ru, uz: row.content_uz, en: row.content_en },
  }
}

export async function listBotPages(): Promise<BotPage[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM telegram_bot_pages ORDER BY key ASC").all()) as Row[]).map(rowToPage)
}

export async function getBotPage(key: string): Promise<BotPage | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM telegram_bot_pages WHERE key = ?").get(key)) as Row | undefined
  return row ? rowToPage(row) : null
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
  const db = getDb()
  await ensureSchema(db)
  const existing = (await getBotPage(key))
  if (!existing) return null

  const title = input.title.trim() ? input.title.trim() : existing.title
  await db.prepare(
        `UPDATE telegram_bot_pages SET title = @title, description = @description,
       content_ru = @contentRu, content_uz = @contentUz, content_en = @contentEn, updated_at = datetime('now')
     WHERE key = @key`,
      ).run({
        key,
        title,
        description: input.description,
        contentRu: input.content.ru,
        contentUz: input.content.uz,
        contentEn: input.content.en,
      })
  return (await getBotPage(key))
}
