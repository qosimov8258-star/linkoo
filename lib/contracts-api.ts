import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { dbErrorResponse } from "@/lib/db-errors"
import { ContractError } from "@/lib/contracts-repo"
import { CONTRACT_TABS, normalizeContractStatus, type ContractListQuery, type ContractTab } from "@/lib/contracts-types"
import { MAX_ID } from "@/lib/finance/api"
import { dbId, INVALID_ID, strictId, strictNum } from "@/lib/strict-number"
import { invalidFieldResponse } from "@/lib/validation"

// HTTP helpers of /api/contracts/** (route files export only handlers).

export type Parsed<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

function bad(name: string, hint: string) {
  return invalidFieldResponse(name, hint)
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function ids(values: string[]): number[] {
  // Canonical digits only ("0x10" / "1e1" never select another record).
  return [...new Set(values.flatMap((value) => value.split(/[-,]/)).map((value) => value.trim()).filter((value) => /^\d+$/.test(value)).map(Number).filter((value) => value > 0 && value <= MAX_ID))]
}

function texts(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

/**
 * GET /api/contracts?status=active|completed|all (also pending / finished) &search &ordering
 * &page &pageSize (0 = all) &fromDate &toDate (YYYY-MM-DD) &client=<id>* &zone=<name>* &agent=<name>* &ids=<contract id>
 */
export function parseContractListQuery(url: string): Parsed<ContractListQuery> {
  const search = new URL(url).searchParams
  const rawStatus = (search.get("status") ?? search.get("tab") ?? "all").trim().toLowerCase()
  const tab: ContractTab | null = rawStatus === "all" || rawStatus === "" ? "all" : (normalizeContractStatus(rawStatus) as ContractTab | null)
  if (!tab || !CONTRACT_TABS.includes(tab)) return { error: bad("status", "active | completed | all") }
  const page = Number(search.get("page") ?? 1)
  const pageSize = Number(search.get("pageSize") ?? search.get("page_size") ?? 25)
  if (!Number.isInteger(page) || page < 1 || page > 1_000_000) return { error: bad("page", "1..1000000") }
  if (!Number.isInteger(pageSize) || pageSize < 0 || pageSize > 5000) return { error: bad("pageSize", "0..5000") }
  const fromDate = (search.get("fromDate") ?? search.get("begin_date") ?? "").trim()
  const toDate = (search.get("toDate") ?? search.get("end_date") ?? "").trim()
  if (fromDate && !ISO_DAY.test(fromDate)) return { error: bad("fromDate", "YYYY-MM-DD") }
  if (toDate && !ISO_DAY.test(toDate)) return { error: bad("toDate", "YYYY-MM-DD") }
  const contract = (search.get("ids") ?? "").trim()
  const contractId = contract ? Number(contract) : null
  if (contractId !== null && (!/^\d+$/.test(contract) || !Number.isInteger(contractId) || contractId <= 0 || contractId > MAX_ID)) return { error: bad("ids", "contract id") }
  const ordering = (search.get("ordering") ?? "").trim()
  if (ordering && !/^-?[a-z_]+$/.test(ordering)) return { error: bad("ordering", "field or -field") }
  return {
    data: {
      tab,
      search: (search.get("search") ?? "").trim().slice(0, 200),
      ordering,
      page,
      pageSize,
      fromDate,
      toDate,
      clientIds: ids([...search.getAll("client"), ...search.getAll("market")]),
      zones: texts([...search.getAll("zone"), ...search.getAll("border")]),
      agents: texts(search.getAll("agent")),
      contractId,
    },
  }
}

const optionalId = z.preprocess((value) => (value === "" || value === undefined ? null : value), dbId().nullable())

/** POST /api/contracts, PUT /api/contracts/[id] (demo ContractsCreateForm). Business rules live in the repo. */
export const contractBodySchema = z.object({
  contractNumber: z.preprocess((value) => (value === "" || value === undefined ? null : value), strictNum(z.number().int().min(0).max(MAX_ID).nullable())).optional(),
  contractPrefix: z.string().max(20).optional(),
  contractSuffix: z.string().max(20).optional(),
  createdDate: z.string().max(40).optional(),
  officialName: z.string().max(300).default(""),
  inn: z.string().max(40).default(""),
  clientIds: z.array(dbId()).max(500).default([]),
  // 0 / null / "" / missing = no agent; otherwise a number or a digit text within int4 ("2e9", true → 400).
  agentId: z.preprocess((value) => (value === undefined || value === null || value === "" ? 0 : value), dbId(INVALID_ID, { allowZero: true })),
  status: z.string().default("active"),
  comment: z.string().max(2000).optional(),
  organizationId: optionalId.optional(),
})

/** PATCH /api/contracts/[id] — status change (complete / cancel / reactivate). */
export const contractStatusSchema = z.object({ status: z.string() })

/** POST /api/contracts/import — rows of the Excel file. */
export const contractImportSchema = z.object({
  rows: z
    .array(
      z.object({
        contractNumber: z.coerce.string().max(20).optional(),
        contractPrefix: z.coerce.string().max(20).optional(),
        contractSuffix: z.coerce.string().max(20).optional(),
        createdDate: z.coerce.string().max(40).optional(),
        officialName: z.coerce.string().max(300).optional(),
        inn: z.coerce.string().max(40).optional(),
        clients: z.coerce.string().max(4000).optional(),
        agent: z.coerce.string().max(200).optional(),
        status: z.coerce.string().max(60).optional(),
        comment: z.coerce.string().max(2000).optional(),
        organization: z.coerce.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(2000),
})

/** Route param → positive 32-bit id (the INTEGER columns), else null (→ 404). */
export function parseIdParam(value: string): number | null {
  // Canonical digits only: "0x10" or "1e1" must never resolve to record 16 / 10.
  if (!/^\d+$/.test(String(value ?? "").trim())) return null
  const id = Number(String(value).trim())
  return Number.isInteger(id) && id > 0 && id <= MAX_ID ? id : null
}

/** Optional query id (?clientId=, ?includeId=, ?year=): canonical digits within int4, else null ("0x10" is no id). */
export function optionalNumberParam(search: URLSearchParams, name: string): number | null {
  return strictId(search.get(name) ?? "")
}

export function contractErrorResponse(error: unknown): NextResponse {
  if (error instanceof ContractError) {
    return NextResponse.json({ error: error.message, field: error.field ?? null, ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
  }
  const busy = dbErrorResponse(error)
  if (busy) return busy
  throw error
}
