import "server-only"

import { withTransaction } from "@/lib/db"
import { createRecord, deleteRecord, listRecords } from "@/lib/ref-records-repo"

// "План опроса": plan rows per month (kind "survey-plan" of the shared reference store). The reference has no plan for the
// current month, so the list starts empty.

export type SurveyPlanEntry = { period: string; employee: string; survey: string }

export type SurveyPlanReplaceInput = { period: string; entries: { employee: string; survey: string }[] }

export function parseSurveyPlanReplaceInput(body: unknown): SurveyPlanReplaceInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const period = typeof value.period === "string" ? value.period.trim() : ""
  if (!period) return null
  const entriesRaw = Array.isArray(value.entries) ? value.entries : []
  const entries = entriesRaw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      employee: typeof item.employee === "string" ? item.employee.trim() : "",
      survey: typeof item.survey === "string" ? item.survey.trim() : "",
    }))
    .filter((item) => item.employee && item.survey)
  return { period, entries }
}

function toEntry(data: Record<string, unknown>): SurveyPlanEntry {
  return { period: String(data.period ?? ""), employee: String(data.employee ?? ""), survey: String(data.survey ?? "") }
}

export async function listSurveyPlans(): Promise<SurveyPlanEntry[]> {
  return (await listRecords("survey-plan")).map((record) => toEntry(record.data))
}

/** Replaces the plan of one month atomically: two parallel saves of the same month are serialised
 * (per-month advisory lock), so the month ends with exactly one of them, never both mixed. */
export async function replaceSurveyPlanPeriod(input: SurveyPlanReplaceInput): Promise<SurveyPlanEntry[]> {
  // Installs the store's schema before the transaction (no DDL inside it).
  await listRecords("survey-plan")
  return withTransaction(async (tx) => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:survey-plans:' || @period::text)) AS ok").get({ period: input.period })
    // getDb() is this transaction: the reads and writes below (createRecord / deleteRecord nest as savepoints) commit together.
    const existing = (await listRecords("survey-plan")).filter((record) => record.data.period === input.period)
    for (const record of existing) await deleteRecord("survey-plan", record.id)
    for (const entry of input.entries) await createRecord("survey-plan", { period: input.period, employee: entry.employee, survey: entry.survey })
    return (await listRecords("survey-plan")).map((record) => toEntry(record.data)).filter((entry) => entry.period === input.period)
  })
}
