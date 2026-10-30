import "server-only"

import { isolated } from "@/lib/db"

/**
 * Runs the notification step of a document write (its own lookups plus notifyTemplate /
 * notifyUsers of lib/user-notifications-repo.ts) inside the document's transaction, so the
 * notification commits or rolls back with the document, but can never break it: the step runs
 * in a savepoint (a failing statement does not abort the surrounding transaction) and any error
 * is logged, never thrown. Call it after the document's own writes, with
 * ensureUserNotificationsSchema() awaited before the transaction was opened.
 */
export async function notifySafely(event: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await isolated(step)
  } catch (error) {
    console.warn(`[notifications] "${event}" was not written:`, error instanceof Error ? error.message : error)
  }
}
