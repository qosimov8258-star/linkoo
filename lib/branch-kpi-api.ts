import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { dbErrorResponse } from "@/lib/db-errors"
import { BRANCH_KPI_CALC_TYPE_IDS } from "@/lib/branch-kpi-types"
import { MAX_ID, MAX_MONEY } from "@/lib/finance/api"
import { strictNum } from "@/lib/strict-number"
import { zodErrorResponse } from "@/lib/validation"

// Request schemas + error mapping of /api/branch-kpi-plans/* ("KPI план филиалов").

export class BranchKpiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export function branchKpiErrorResponse(error: unknown): NextResponse {
  if (error instanceof BranchKpiError) return NextResponse.json({ error: error.message }, { status: error.status })
  const busy = dbErrorResponse(error)
  if (busy) return busy
  throw error
}

export function invalidQueryResponse(error: z.ZodError): NextResponse {
  return zodErrorResponse(error)
}

export function searchParamsObject(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(params.entries())
}

const month = strictNum(z.number().int().min(1).max(12))
const year = strictNum(z.number().int().min(2000).max(2100))
const plan = strictNum(z.number().finite().min(0).max(MAX_MONEY))

/** Demo listFilterSerializer: search, month, year (+ grid page/ordering). */
export const branchKpiListQuerySchema = z.object({
  month,
  year,
  search: z.string().trim().max(200).optional().default(""),
  ordering: z.enum(["name", "-name", "salary", "-salary", ""]).optional().default(""),
  page: strictNum(z.number().int().min(1).optional().default(1)),
  pageSize: strictNum(z.number().int().min(1).max(2000).optional().default(25)),
})
export type BranchKpiListQuery = z.infer<typeof branchKpiListQuerySchema>

export const branchKpiPeriodQuerySchema = z.object({ month, year })

/** Demo bulk_set_plan (bulkUpdateSerializer). */
export const branchKpiBulkSchema = z.object({
  month,
  year,
  branches: z
    .array(
      z.object({
        branch: z.number().int().positive().max(MAX_ID),
        performanceIndicators: z.array(z.object({ performanceIndicator: z.number().int().positive().max(MAX_ID), plan })).max(500),
      }),
    )
    .min(1)
    .max(2000),
  /** Indicators the dialog edited: missing (emptied) plans of these are removed. */
  indicators: z.array(z.number().int().positive().max(MAX_ID)).max(500),
})
export type BranchKpiBulkInput = z.infer<typeof branchKpiBulkSchema>

/** Demo copy (duplicateSerializer). */
export const branchKpiCopySchema = z.object({
  branches: z.array(z.number().int().positive().max(MAX_ID)).max(2000).default([]),
  isAll: z.boolean().default(false),
  fromMonth: month,
  fromYear: year,
  toMonth: month,
  toYear: year,
})
export type BranchKpiCopyInput = z.infer<typeof branchKpiCopySchema>

export const branchKpiRecalcSchema = z.object({ month, year })

/** Reward levels + bonus fund of one indicator (+ the month to recalculate afterwards). */
export const branchKpiRulesSchema = z.object({
  bonusFund: strictNum(z.number().finite().min(0).max(MAX_MONEY).default(0)),
  levels: z
    .array(
      z.object({
        fromAmount: strictNum(z.number().finite().min(0).max(1e6)),
        toAmount: strictNum(z.number().finite().min(0).max(1e6)),
        bonus: strictNum(z.number().finite().min(0).max(MAX_MONEY)),
        calculationType: z.enum(BRANCH_KPI_CALC_TYPE_IDS),
        excludeLowLevel: z.boolean().default(false),
      }),
    )
    .max(50),
  month: month.optional(),
  year: year.optional(),
})
export type BranchKpiRulesInput = z.infer<typeof branchKpiRulesSchema>
