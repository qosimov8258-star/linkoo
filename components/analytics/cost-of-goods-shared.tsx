"use client"

import Link from "next/link"
import { XCircle } from "lucide-react"

import { docDate } from "@/components/analytics/internal-transfers-shared"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { NET_COST_DOC_LINKS, NET_COST_SOURCE_LABELS, type NetCostCheck, type NetCostDocument, type NetCostRecord } from "@/lib/net-cost-types"

// Shared bits of "Себестоимость": number / date formatting as the demo prints them,
// the check icon with its tooltip, document labels and links, and the mutation helper.

type Translate = (text: string) => string

/** Costs: up to 3 decimals ("1 084,783"). */
export const fmtCost = (value: number | null | undefined) => (value === null || value === undefined ? "" : formatMoney(value, 3))
/** Sums: up to 2 decimals. */
export const fmtSum = (value: number | null | undefined) => (value === null || value === undefined ? "" : formatMoney(value, 2))

export function recordDate(value: string, language: string): string {
  return docDate(value, language, value.length > 10)
}

/** "Анализ баланса: ✅ | Анализ отрицательного баланса: ❌ | …" (demo row tooltip). */
export function checksTitle(checks: NetCostCheck[], t?: Translate): string {
  return checks.map((check) => `${t ? t(check.name) : check.name}: ${check.isCorrect ? "✅" : "❌"}`).join(" | ")
}

export function CheckIcon({ ok, title }: { ok: boolean; title?: string }) {
  return ok ? (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8acb8d]" role="img" aria-label={title}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  ) : (
    <XCircle className="h-5 w-5 text-[#e57373]" aria-label={title} />
  )
}

/** "Поставка №12" / "Списание №4" … linked to the document page when it opens by id. */
export function DocumentLink({ docType, docId }: Pick<NetCostDocument, "docType" | "docId">) {
  const { t } = useLanguage()
  const label = `${t(NET_COST_SOURCE_LABELS[docType] ?? docType)} №${docId}`
  const page = NET_COST_DOC_LINKS[docType]
  if (!page) return <span>{label}</span>
  return (
    <Link href={`${page}?id=${docId}`} className="font-semibold text-[#4f71dc] hover:underline">
      {label}
    </Link>
  )
}

/** Excel sheet of the list (demo columns). */
export function netCostSheet(rows: NetCostRecord[], t: Translate, language: string): Array<Array<string | number>> {
  return [
    [t("Наименование"), t("Склад"), t("Дата"), t("Уср. Себестоимость"), t("Себестоимость"), t("Сумма переоценки"), t("Проверка")],
    ...rows.map((row) => [
      row.itemName,
      row.stock || t("Общий"),
      recordDate(row.date, language),
      Math.round(row.cost * 1000) / 1000,
      Math.round(row.realCost * 1000) / 1000,
      row.revaluation === null ? t("Не указано") : Math.round(row.revaluation * 100) / 100,
      checksTitle(row.checkData, t),
    ]),
  ]
}

export type MutationResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; rows: Array<{ row: number; error: string }> }

/** POST / PUT / DELETE to /api/cost-of-goods/**; never throws (errors are Russian i18n keys). */
export async function netCostMutate<T>(method: "POST" | "PUT" | "DELETE", url: string, body?: unknown): Promise<MutationResult<T>> {
  try {
    const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const json = (await response.json().catch(() => null)) as (T & { error?: string; errors?: Array<{ row: number; error: string }> }) | null
    if (!response.ok) {
      // The generic validation error is "Неверные данные" (older builds answered in Uzbek).
      const generic = json?.error === "Неверные данные"
      const error = response.status === 403 ? "Недостаточно прав" : generic ? "Проверьте правильность заполнения полей" : json?.error || `HTTP ${response.status}`
      return { ok: false, status: response.status, error, rows: json?.errors ?? [] }
    }
    return { ok: true, data: json as T }
  } catch {
    return { ok: false, status: 0, error: "Сервер недоступен, попробуйте ещё раз", rows: [] }
  }
}
