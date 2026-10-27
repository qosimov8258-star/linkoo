import "server-only"

import { NextResponse } from "next/server"

// Database errors that mean "busy, try again", not "bug" (C1). lib/db.ts bounds every wait
// for the database: a free pool connection (POOL_WAIT_MS), a lock (lock_timeout, advisory
// locks included) and a transaction left idle while it holds locks
// (idle_in_transaction_session_timeout). When one of them runs out, or Postgres breaks a
// deadlock, the request gets a clean JSON answer with a Russian key (translated by the
// client like every API error) instead of an empty 500 or a request that never ends.

/** No free connection / the server ended a stuck session: retry later. */
export const DB_BUSY = "Сервер занят, повторите попытку"
/** A lock wait ran out or Postgres broke a deadlock: another operation changes the same data. */
export const DB_LOCKED = "Данные сейчас изменяет другая операция, повторите попытку"

/** Thrown by lib/db.ts when no pool connection became free within the wait limit. */
export class DbBusyError extends Error {
  readonly status = 503

  constructor(cause?: unknown) {
    super(DB_BUSY, { cause })
    this.name = "DbBusyError"
  }
}

// lock_not_available (lock_timeout), deadlock_detected, serialization_failure.
const LOCKED_CODES = new Set(["55P03", "40P01", "40001"])
// query_canceled (statement_timeout), idle_in_transaction_session_timeout, too_many_connections,
// admin_shutdown / crash_shutdown / cannot_connect_now.
const BUSY_CODES = new Set(["57014", "25P03", "53300", "57P01", "57P02", "57P03"])
const BUSY_MESSAGES = [
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
  "Connection terminated unexpectedly",
  "Client was closed and is not queryable",
  "Client has encountered a connection error and is not queryable",
]

/** "busy" / "locked" for the errors above (also when wrapped as a `cause`), else null. */
export function dbErrorKind(error: unknown): "busy" | "locked" | null {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof DbBusyError) return "busy"
    if (typeof current !== "object") return null
    const { code, message, cause } = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof code === "string" && LOCKED_CODES.has(code)) return "locked"
    if (typeof code === "string" && BUSY_CODES.has(code)) return "busy"
    if (typeof message === "string" && BUSY_MESSAGES.some((text) => message.includes(text))) return "busy"
    current = cause
  }
  return null
}

/** 503 / 409 JSON for a busy-database error, null for any other error. */
export function dbErrorResponse(error: unknown): NextResponse | null {
  const kind = dbErrorKind(error)
  if (!kind) return null
  console.warn(`[db] request refused (${kind}):`, error instanceof Error ? error.message : error)
  return NextResponse.json({ error: kind === "busy" ? DB_BUSY : DB_LOCKED }, { status: kind === "busy" ? 503 : 409, headers: { "Retry-After": "2" } })
}

/** Wraps a route handler: busy-database errors become dbErrorResponse, others propagate. */
export function withDbErrors<A extends unknown[], R extends Response>(handler: (...args: A) => Promise<R>): (...args: A) => Promise<R | NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args)
    } catch (error) {
      const response = dbErrorResponse(error)
      if (response) return response
      throw error
    }
  }
}
