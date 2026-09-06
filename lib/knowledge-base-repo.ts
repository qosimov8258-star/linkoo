import "server-only"

import { getDb } from "@/lib/db"

export type KnowledgeBaseArticle = {
  id: number
  name: string
  text: string
  active: boolean
  roles: string[]
}

type Row = { id: number; name: string; text: string; active: number; roles: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_base_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 0,
      roles TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function parseRoles(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function rowToArticle(row: Row): KnowledgeBaseArticle {
  return { id: row.id, name: row.name, text: row.text, active: !!row.active, roles: parseRoles(row.roles) }
}

export type KnowledgeBaseArticleInput = { name: string; text: string; active: boolean; roles: string[] }

export async function listKnowledgeBaseArticles(): Promise<KnowledgeBaseArticle[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM knowledge_base_articles ORDER BY id DESC").all()) as Row[]).map(rowToArticle)
}

export async function getKnowledgeBaseArticle(id: number): Promise<KnowledgeBaseArticle | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM knowledge_base_articles WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToArticle(row) : null
}

export async function createKnowledgeBaseArticle(input: KnowledgeBaseArticleInput): Promise<KnowledgeBaseArticle> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO knowledge_base_articles (name, text, active, roles) VALUES (@name, @text, @active, @roles)")
      .run({ name: input.name, text: input.text, active: input.active ? 1 : 0, roles: JSON.stringify(input.roles) }))
  return (await getKnowledgeBaseArticle(Number(result.lastInsertRowid)))!
}

export async function updateKnowledgeBaseArticle(id: number, input: KnowledgeBaseArticleInput): Promise<KnowledgeBaseArticle | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getKnowledgeBaseArticle(id))) return null
  await db.prepare(
        "UPDATE knowledge_base_articles SET name = @name, text = @text, active = @active, roles = @roles, updated_at = datetime('now') WHERE id = @id",
      ).run({ id, name: input.name, text: input.text, active: input.active ? 1 : 0, roles: JSON.stringify(input.roles) })
  return (await getKnowledgeBaseArticle(id))
}

export async function deleteKnowledgeBaseArticle(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM knowledge_base_articles WHERE id = ?").run(id)).changes > 0
}
