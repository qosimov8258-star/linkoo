import "server-only"

import { getDb, outsideTransaction, withTransaction } from "@/lib/db"
import { getJobPosition } from "@/lib/job-positions-repo"
import { keySql } from "@/lib/platform-refs"

// Tables of "База знания" (lib/knowledge-base-repo.ts), created lazily once per process on the
// maintenance pool (outsideTransaction), never inside a request transaction:
//   knowledge_base_files              uploaded PDFs (bytes in Postgres, served by an authenticated GET)
//   knowledge_base_articles           name (unique by keySql), text, active, file_id → files
//   knowledge_base_article_positions  article ↔ job position (Права доступа), both by FK
// An older database has the first draft of knowledge_base_articles (roles = JSON array of
// free-text role names): matching names become position links once per row (roles_migrated
// marks it); the original roles text is kept untouched.

const SCHEMA_VERSION = 2

declare global {
  var __linkoKnowledgeBaseSchema: { version: number; ready: Promise<void> } | undefined
}

async function install(): Promise<void> {
  // job_positions is created lazily by its own module; the link table references it.
  await getJobPosition(1)
  await withTransaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:knowledge_base:schema'))")
    await tx.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_base_files (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        data BYTEA NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `)
    await tx.exec(`
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
    await tx.exec("ALTER TABLE knowledge_base_articles ADD COLUMN IF NOT EXISTS file_id INTEGER REFERENCES knowledge_base_files (id)")
    await tx.exec("ALTER TABLE knowledge_base_articles ADD COLUMN IF NOT EXISTS created_by INTEGER")
    await tx.exec("ALTER TABLE knowledge_base_articles ADD COLUMN IF NOT EXISTS updated_by INTEGER")
    await tx.exec("ALTER TABLE knowledge_base_articles ADD COLUMN IF NOT EXISTS roles_migrated INTEGER NOT NULL DEFAULT 0")
    await tx.exec("CREATE UNIQUE INDEX IF NOT EXISTS knowledge_base_articles_file_key ON knowledge_base_articles (file_id) WHERE file_id IS NOT NULL")
    await tx.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_base_article_positions (
        article_id INTEGER NOT NULL REFERENCES knowledge_base_articles (id) ON DELETE CASCADE,
        position_id INTEGER NOT NULL REFERENCES job_positions (id) ON DELETE CASCADE,
        PRIMARY KEY (article_id, position_id)
      );
    `)
    await tx.exec("CREATE INDEX IF NOT EXISTS knowledge_base_article_positions_position ON knowledge_base_article_positions (position_id)")
    // Unique names (case / space-insensitive); skipped while an older database holds twins
    // (the API still refuses new ones under the names lock).
    await tx.exec(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'knowledge_base_articles_name_key') THEN
          BEGIN
            CREATE UNIQUE INDEX knowledge_base_articles_name_key ON knowledge_base_articles ((${keySql("name")}));
          EXCEPTION WHEN unique_violation THEN
            RAISE NOTICE 'knowledge_base_articles_name_key skipped: duplicate names exist';
          END;
        END IF;
      END $$;
    `)
    // First-draft roles (JSON names) → position links by name, once per row. The roles text is
    // kept as it was (no data is removed); roles_migrated stops a later restart from re-adding a
    // link the user has since removed.
    await tx.exec(`
      DO $$ BEGIN
        INSERT INTO knowledge_base_article_positions (article_id, position_id)
        SELECT a.id, p.id
          FROM knowledge_base_articles a
          CROSS JOIN LATERAL jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(a.roles::jsonb) = 'array' THEN a.roles::jsonb ELSE '[]'::jsonb END
          ) AS r(name)
          JOIN job_positions p ON ${keySql("p.name")} = ${keySql("r.name")}
         WHERE a.roles_migrated = 0 AND a.roles NOT IN ('', '[]')
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'knowledge_base roles backfill skipped: %', SQLERRM;
      END $$;
    `)
    await tx.exec("UPDATE knowledge_base_articles SET roles_migrated = 1 WHERE roles_migrated = 0")
  })
}

/** Ensures the knowledge base tables (once per process). Call before any transaction. */
export function ensureKnowledgeBaseSchema(): Promise<void> {
  if (globalThis.__linkoKnowledgeBaseSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(install).catch((error) => {
      globalThis.__linkoKnowledgeBaseSchema = undefined
      throw error
    })
    globalThis.__linkoKnowledgeBaseSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoKnowledgeBaseSchema!.ready
}

/** The pool db after the schema is ready (reads outside a transaction). */
export async function knowledgeBaseDb() {
  await ensureKnowledgeBaseSchema()
  return getDb()
}
