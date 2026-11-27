import "server-only"

import { outsideTransaction, withTransaction } from "@/lib/db"

// The table of «Xato haqida xabar berish» (lib/bug-reports/types.ts). Created lazily, once per
// process, on the maintenance pool (outsideTransaction) under an advisory lock, like the other
// module schemas (lib/field-activity/schema.ts): parallel dev-server workers and a request that
// waits for it never deadlock. Every statement is idempotent. No other module reads the table, so
// it is not part of the lib/db.ts bootstrap.
//
// The screenshot is stored in the row (bytea, ≤ BUG_SCREENSHOT_MAX_BYTES): reports are few, and
// the admin page and the Telegram message read it by the report's id.
//
// v2: the Telegram message is tracked apart from the delivery (notified_at, notify_attempts), so the
// sweep sends again a message that a restart or a Telegram failure left unsent (lib/bug-reports/deliver.ts).

const SCHEMA_VERSION = 2

const DDL = `
CREATE TABLE IF NOT EXISTS bug_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL,
  screenshot BYTEA,
  screenshot_type TEXT,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_analysis JSONB,
  ai_status TEXT NOT NULL DEFAULT 'PENDING',
  ai_error TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  helper_result JSONB,
  resolved_by_ai BOOLEAN NOT NULL DEFAULT false,
  delivery TEXT NOT NULL DEFAULT 'awaiting_feedback',
  telegram_message_id BIGINT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bug_reports_ai_status_check CHECK (ai_status IN ('PENDING', 'DONE', 'FAILED')),
  CONSTRAINT bug_reports_status_check CHECK (status IN ('NEW', 'IN_PROGRESS', 'FIXED', 'REJECTED')),
  CONSTRAINT bug_reports_delivery_check CHECK (delivery IN ('awaiting_feedback', 'awaiting_answer', 'delivered', 'resolved_by_ai'))
);
-- The admin list (newest first) and its filters: status, the analysis' severity, "AI hal qildi".
CREATE INDEX IF NOT EXISTS bug_reports_created ON bug_reports (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS bug_reports_status_created ON bug_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_severity_created ON bug_reports ((ai_analysis->>'jiddiylik'), created_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_resolved_created ON bug_reports (created_at DESC) WHERE resolved_by_ai;
-- The sweep that delivers reports whose customer never answered the helper.
CREATE INDEX IF NOT EXISTS bug_reports_waiting ON bug_reports (created_at) WHERE delivery IN ('awaiting_feedback', 'awaiting_answer');
CREATE INDEX IF NOT EXISTS bug_reports_user_created ON bug_reports (user_id, created_at DESC);
-- v2. notified_at: the report's Telegram message went out (or there was nothing to send: Telegram is not
-- configured). Reports delivered before the column existed count as notified, so the first start of this
-- version does not send them all again; the backfill runs only in the statement that adds the column (a
-- current schema only reads the catalog here and takes no table lock).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'bug_reports'::regclass AND attname = 'notified_at' AND NOT attisdropped) THEN
    ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
    UPDATE bug_reports SET notified_at = COALESCE(delivered_at, created_at) WHERE delivery = 'delivered';
  END IF;
END $$;
-- The attempts at that message so far (bounded, see deliver.ts NOTIFY_MAX_ATTEMPTS).
ALTER TABLE bug_reports ADD COLUMN IF NOT EXISTS notify_attempts INTEGER NOT NULL DEFAULT 0;
-- The sweep that sends a missed message again.
CREATE INDEX IF NOT EXISTS bug_reports_unnotified ON bug_reports (id) WHERE delivery = 'delivered' AND notified_at IS NULL;
`

declare global {
  var __mezonBugReportsSchema: { version: number; ready: Promise<void> } | undefined
}

/** Creates the bug_reports table and its indexes once per process (idempotent, fresh-install safe). */
export function ensureBugReportsSchema(): Promise<void> {
  if (globalThis.__mezonBugReportsSchema?.version !== SCHEMA_VERSION) {
    const ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('mezon:bug-reports:schema'))")
        await tx.exec(DDL)
      }),
    ).catch((error) => {
      globalThis.__mezonBugReportsSchema = undefined
      throw error
    })
    globalThis.__mezonBugReportsSchema = { version: SCHEMA_VERSION, ready }
  }
  return globalThis.__mezonBugReportsSchema.ready
}
