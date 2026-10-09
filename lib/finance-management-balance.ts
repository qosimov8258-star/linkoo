import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import type { PgDb } from "@/lib/db"
import { defaultBalancePeriod, isIsoDay, monthStartIso } from "@/lib/finance/dates"
import { getManagementBalance, NO_BRANCH_LABEL } from "@/lib/finance/management"
import type { ManagementLine, ManagementSection } from "@/lib/finance/types"
import {
  MANAGEMENT_NAME_PREFIX,
  MANAGEMENT_NO_BRANCH,
  type ManagementReport,
  type ManagementReportBranch,
} from "@/lib/finance-management-balance-types"

// "Управленческий баланс по филиалам" (demo #/widget-balance/?beginDate&endDate,
// GET stats/branch_balance/). The balance math is the shared
// getManagementBalance (lib/finance/management.ts); this module only adapts it
// to the page:
//   * query params of the demo page: beginDate, endDate, division (organization
//     names, repeated), branch (one card: branches.id | "none" | "name:<name>");
//   * the branch filter is applied here, after the shared calculation, so the
//     virtual "Без филиала" card and branches known only by name can be picked
//     too (the shared filter matches registered names only);
//   * like the demo response, every category keeps its base-currency line even
//     when it is zero (the shared result drops zero lines except Склад/Касса).

const day = z.string().refine(isIsoDay, "YYYY-MM-DD")

export const managementBalanceQuerySchema = z.object({
  beginDate: day.optional(),
  endDate: day.optional(),
  division: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  branch: z.string().trim().max(200).optional(),
})

export type ManagementBalanceQuery = { from: string; to: string; organizations: string[]; branch: string }

type Parsed = { data: ManagementBalanceQuery; error?: undefined } | { data?: undefined; error: NextResponse }

export function parseManagementBalanceQuery(url: string): Parsed {
  const params = new URL(url).searchParams
  const raw: Record<string, string | string[]> = {}
  for (const name of ["beginDate", "endDate", "branch"]) {
    const value = params.get(name)
    if (value !== null && value.trim() !== "") raw[name] = value
  }
  const division = params.getAll("division").filter((value) => value.trim() !== "")
  if (division.length) raw.division = division

  const parsed = managementBalanceQuerySchema.safeParse(raw)
  if (!parsed.success) return { error: NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: parsed.error.flatten() }, { status: 400 }) }

  // Demo menu default: 1st of the current month .. today (only an end date →
  // 1st of its month .. that day); a reversed range is swapped.
  const fallback = defaultBalancePeriod()
  const begin = parsed.data.beginDate ?? (parsed.data.endDate ? monthStartIso(parsed.data.endDate) : fallback.from)
  const end = parsed.data.endDate ?? (begin > fallback.to ? begin : fallback.to)
  const [from, to] = begin <= end ? [begin, end] : [end, begin]
  return { data: { from, to, organizations: [...new Set(parsed.data.division ?? [])], branch: parsed.data.branch ?? "" } }
}

// Line catalogue in demo order (section → category); must follow LINES in
// lib/finance/management.ts. `balanceType` = the sibling list's filter that
// selects exactly the counterparties summed in the line (demo predecessor
// widgets: Задолженность клиентов → balanceType "debtor", Авансы → "creditor").
type CatalogueEntry = { section: "assets" | "passives"; key: string; label: string; perCurrency: boolean; page: string; balanceType?: "debtor" | "creditor" }
const CATALOGUE: CatalogueEntry[] = [
  { section: "assets", key: "stock", label: "Склад", perCurrency: false, page: "/analytics/stock-by-date" },
  { section: "assets", key: "cashbox", label: "Касса", perCurrency: true, page: "/analytics/cash-balance" },
  { section: "assets", key: "market_balance", label: "Задолженность клиентов", perCurrency: true, page: "/analytics/client-balance", balanceType: "debtor" },
  { section: "assets", key: "provider_balance", label: "Предоплаты поставщикам", perCurrency: true, page: "/analytics/supplier-balance", balanceType: "creditor" },
  { section: "assets", key: "staff_balance", label: "Авансы, выданные по оплате труда", perCurrency: true, page: "/analytics/employee-balance" },
  { section: "assets", key: "branch_balance", label: "Задолженность филиалов", perCurrency: true, page: "/analytics/branch-balance" },
  { section: "passives", key: "market_balance", label: "Авансы, полученные от покупателей", perCurrency: true, page: "/analytics/client-balance", balanceType: "creditor" },
  { section: "passives", key: "provider_balance", label: "Долги поставщикам", perCurrency: true, page: "/analytics/supplier-balance", balanceType: "debtor" },
  { section: "passives", key: "staff_balance", label: "Задолженность по оплате труда", perCurrency: true, page: "/analytics/employee-balance" },
  { section: "passives", key: "cashback_balance", label: "Кешбэк покупателей", perCurrency: false, page: "/analytics/loyalty-card" },
  { section: "passives", key: "branch_balance", label: "Авансы полученные от филиалов", perCurrency: true, page: "/analytics/branch-balance" },
]

type LinkContext = { from: string; to: string; organizations: string[]; card: { id: number | null; name: string; value: string } }

/** Drill-down of a line: the sibling page narrowed to what the line sums
 * (period; client/supplier lists also by sign, card branch and organizations;
 * the branch ledger by branch id). "Без филиала" cannot be expressed as a
 * branch filter, so its links are not narrowed by branch. */
function lineHref(entry: CatalogueEntry, link: LinkContext): string {
  if (entry.key === "cashback_balance") return entry.page
  const params = new URLSearchParams()
  const named = link.card.value !== MANAGEMENT_NO_BRANCH
  if (entry.key === "stock") params.set("branch", named ? link.card.name : "")
  params.set("fromDate", link.from)
  params.set("toDate", link.to)
  if (entry.balanceType) {
    params.set("balanceType", entry.balanceType)
    if (named) params.append("branch", link.card.name)
    for (const organization of link.organizations) params.append("division", organization)
  }
  if (entry.key === "branch_balance" && link.card.id !== null) params.append("branch", String(link.card.id))
  return `${entry.page}?${params.toString().replace(/\+/g, "%20")}`
}

/** Base-currency line of every category first (zero when missing), then the other currencies as returned. */
function completeLines(section: ManagementSection, base: string, link: LinkContext): ManagementLine[] {
  if (section.key !== "assets" && section.key !== "passives") return section.lines
  const lines: ManagementLine[] = []
  for (const entry of CATALOGUE.filter((candidate) => candidate.section === section.key)) {
    const href = lineHref(entry, link)
    const own = section.lines.filter((line) => line.key === entry.key && line.label === entry.label).map((line) => ({ ...line, href }))
    const baseLine = own.find((line) => line.currency === base) ?? {
      key: entry.key,
      label: entry.label,
      currency: base,
      perCurrency: entry.perCurrency,
      begin_balance: 0,
      end_balance: 0,
      difference: 0,
      href,
    }
    lines.push(baseLine, ...own.filter((line) => line !== baseLine))
  }
  // Lines the catalogue does not know (kept, in their original order).
  const known = new Set(CATALOGUE.map((entry) => `${entry.section}|${entry.key}|${entry.label}`))
  return [...lines, ...section.lines.filter((line) => !known.has(`${section.key}|${line.key}|${line.label}`))]
}

function branchValue(id: number | null, name: string): string {
  if (id !== null) return String(id)
  return name === NO_BRANCH_LABEL ? MANAGEMENT_NO_BRANCH : `${MANAGEMENT_NAME_PREFIX}${name}`
}

const nameKey = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase()

/** Does the card match the branch filter value (id, "none", "name:<name>" or a plain name)? */
function matchesBranch(card: ManagementReportBranch, filter: string): boolean {
  if (!filter) return true
  if (/^\d+$/.test(filter)) return card.id === Number(filter)
  if (filter === MANAGEMENT_NO_BRANCH) return card.value === MANAGEMENT_NO_BRANCH
  const name = filter.startsWith(MANAGEMENT_NAME_PREFIX) ? filter.slice(MANAGEMENT_NAME_PREFIX.length) : filter
  return card.value !== MANAGEMENT_NO_BRANCH && nameKey(card.name) === nameKey(name)
}

export async function getManagementBalanceReport(query: ManagementBalanceQuery, db?: PgDb): Promise<ManagementReport> {
  const result = await getManagementBalance({ from: query.from, to: query.to, organizations: query.organizations }, db)
  const cards: ManagementReportBranch[] = result.branches.map((branch) => {
    const value = branchValue(branch.id, branch.name)
    const link: LinkContext = { from: result.from, to: result.to, organizations: query.organizations, card: { id: branch.id, name: branch.name, value } }
    return {
      ...branch,
      value,
      virtual: branch.id === null,
      sections: branch.sections.map((section) => ({ ...section, lines: completeLines(section, result.baseCurrency, link) })),
    }
  })
  const branches = cards.filter((card) => matchesBranch(card, query.branch))
  // Currencies left out of the section totals (no rate), for the cards shown only.
  const rated = new Set(result.currencies.filter((currency) => currency.rate).map((currency) => currency.code))
  const missingRates = new Set(
    branches.flatMap((card) =>
      card.sections.flatMap((section) => section.lines.filter((line) => !rated.has(line.currency) && (line.begin_balance || line.end_balance)).map((line) => line.currency)),
    ),
  )
  return {
    ...result,
    missingRates: result.missingRates.filter((code) => missingRates.has(code)),
    organizations: query.organizations,
    branch: query.branch,
    options: cards.map((card) => ({ value: card.value, name: card.name, virtual: card.virtual })),
    branches,
  }
}
