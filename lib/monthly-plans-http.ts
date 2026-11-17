import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { MonthlyPlanError } from "@/lib/monthly-plans-repo"

// Shared request parts of /api/monthly-plans and /api/monthly-plans/products.

export const planPeriodSchema = {
  employeeId: z.number().int().positive(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
}

/** A planned value: a non-negative number, or null for none. */
export const planAmount = z.number().finite().min(0).max(1e15).nullable()

/** employeeId, year, month of the query, or null. */
export function planPeriodOf(params: URLSearchParams): { employeeId: number; year: number; month: number } | null {
  const parsed = z.object(planPeriodSchema).safeParse({ employeeId: Number(params.get("employeeId")), year: Number(params.get("year")), month: Number(params.get("month")) })
  return parsed.success ? parsed.data : null
}

export function planErrorResponse(error: unknown) {
  if (error instanceof MonthlyPlanError) return NextResponse.json({ error: error.message }, { status: error.status })
  throw error
}
