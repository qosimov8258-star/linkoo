import "server-only"

import { NextResponse } from "next/server"

import { dbErrorResponse } from "@/lib/db-errors"

// Refusals of the Посещаемость APIs (work attendance, check-ins): a Russian i18n key as
// `error`, the field it belongs to, and for the Excel import the list of row issues.

export type AttendanceIssue = { row: number; column?: number; error: string; value?: string }

export class AttendanceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: string,
    readonly errors?: AttendanceIssue[],
  ) {
    super(message)
  }
}

/** JSON answer of an AttendanceError or a busy-database error, else null (rethrow). */
export function attendanceErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AttendanceError) {
    return NextResponse.json(
      { error: error.message, ...(error.field ? { field: error.field } : {}), ...(error.errors ? { errors: error.errors } : {}) },
      { status: error.status },
    )
  }
  return dbErrorResponse(error)
}
