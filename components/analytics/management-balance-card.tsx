"use client"

import Link from "next/link"
import { Fragment, type KeyboardEvent } from "react"

import { currencyLabel, formatMoney, roundMoney } from "@/lib/finance/currency"
import { formatDayMonth } from "@/lib/finance/dates"
import type { ManagementLine } from "@/lib/finance/types"
import { MANAGEMENT_NO_BRANCH, type ManagementReport, type ManagementReportBranch } from "@/lib/finance-management-balance-types"
import { useLanguage } from "@/lib/i18n/language-context"

// One branch card of "Управленческий баланс по филиалам": Наименование |
// Баланс на <begin> | Баланс на <end> | Разница, with the collapsible sections
// Активы / Пассивы (lines inside) and the plain rows Собственный капитал / Курс.

type Translate = (text: string) => string

/** "Без филиала" is an i18n key; real branch names are shown as stored. */
export function managementBranchName(branch: Pick<ManagementReportBranch, "value" | "name">, t: Translate): string {
  return branch.value === MANAGEMENT_NO_BRANCH ? t(branch.name) : branch.name
}

/** "Касса SUM" for per-currency lines, "Склад" / "Кешбэк покупателей" otherwise. */
export function managementLineLabel(line: ManagementLine, t: Translate): string {
  return line.perCurrency ? `${t(line.label)} ${currencyLabel(line.currency)}` : t(line.label)
}

/** Column header "Баланс на 1 октября" (uz "1 oktabr holatiga balans"). */
export function balanceOnLabel(iso: string, t: Translate, language: string): string {
  return t("Баланс на {date}").replace("{date}", formatDayMonth(iso, language))
}

/** Linko's filled triangle of a section row: ▾ closed, ▴ open. */
function SectionArrow({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 10 5" aria-hidden className={`h-[5px] w-[10px] fill-[#1E4A9A] ${open ? "rotate-180" : ""}`}>
      <path d="M0 0h10L5 5z" />
    </svg>
  )
}

const cell = "whitespace-nowrap border border-[#dcdcdc] px-[9px] tabular-nums"

export function ManagementBranchCard({
  branch,
  from,
  to,
  isOpen,
  onToggle,
}: {
  branch: ManagementReportBranch
  from: string
  to: string
  isOpen: (section: string) => boolean
  onToggle: (section: string) => void
}) {
  const { t, language } = useLanguage()
  const onKey = (section: string) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onToggle(section)
  }

  return (
    <section className="rounded-[10px] bg-white px-[10px] pb-[10px] pt-[1px]">
      <h2 className="py-[8px] text-[15px] font-bold text-[#333]">{managementBranchName(branch, t)}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-[13px]">
          <colgroup>
            <col className="w-[33.5%]" />
            <col className="w-[26%]" />
            <col className="w-[27.5%]" />
            <col className="w-[13%]" />
          </colgroup>
          <thead>
            <tr className="bg-white text-[#333]">
              <th className="border border-[#dcdcdc] px-[9px] py-[8px] font-semibold">{t("Наименование")}</th>
              <th className="whitespace-nowrap border border-[#dcdcdc] px-[9px] py-[8px] font-semibold">{balanceOnLabel(from, t, language)}</th>
              <th className="whitespace-nowrap border border-[#dcdcdc] px-[9px] py-[8px] font-semibold">{balanceOnLabel(to, t, language)}</th>
              <th className="whitespace-nowrap border border-[#dcdcdc] px-[9px] py-[8px] font-semibold">{t("Разница")}</th>
            </tr>
          </thead>
          <tbody>
            {branch.sections.map((section) => {
              // Linko: every row (also Собственный капитал / Курс, which have no lines) toggles its arrow; the
              // amounts are bold and black (no colours, also in Разница).
              const open = isOpen(section.key)
              return (
                <Fragment key={section.key}>
                  <tr
                    onClick={() => onToggle(section.key)}
                    onKeyDown={onKey(section.key)}
                    tabIndex={0}
                    aria-expanded={open}
                    className="cursor-pointer bg-[#edf1fd] outline-none hover:bg-[#e3e9fb] focus-visible:bg-[#e3e9fb]"
                  >
                    <td className="border border-[#dcdcdc] px-[9px] py-[9px] font-semibold text-[#333]">
                      <span className="inline-flex items-center gap-[10px]">
                        {t(section.label)}
                        <SectionArrow open={open} />
                      </span>
                    </td>
                    <td className={`${cell} py-[9px] font-semibold text-[#333]`}>{formatMoney(section.begin_balance)}</td>
                    <td className={`${cell} py-[9px] font-semibold text-[#333]`}>{formatMoney(section.end_balance)}</td>
                    <td className={`${cell} py-[9px] font-semibold text-[#333]`}>{formatMoney(section.difference)}</td>
                  </tr>
                  {open &&
                    section.lines.map((line) => (
                      <tr key={`${line.key}|${line.label}|${line.currency}`} className="bg-white text-[#333]">
                        <td className="border border-[#dcdcdc] px-[9px] py-[9px]">
                          {line.href ? (
                            <Link href={line.href} className="text-[#333] hover:underline">
                              {managementLineLabel(line, t)}
                            </Link>
                          ) : (
                            managementLineLabel(line, t)
                          )}
                        </td>
                        <td className={`${cell} py-[9px]`}>{formatMoney(line.begin_balance)}</td>
                        <td className={`${cell} py-[9px]`}>{formatMoney(line.end_balance)}</td>
                        <td className={`${cell} py-[9px]`}>{formatMoney(line.difference)}</td>
                      </tr>
                    ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Rows for downloadExcelTable: one row per section and per line (lines indented), all cards. */
export function managementExcelRows(report: ManagementReport, t: Translate, language: string): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = [[t("Филиал"), t("Наименование"), balanceOnLabel(report.from, t, language), balanceOnLabel(report.to, t, language), t("Разница")]]
  for (const branch of report.branches) {
    const name = managementBranchName(branch, t)
    for (const section of branch.sections) {
      rows.push([name, t(section.label), roundMoney(section.begin_balance), roundMoney(section.end_balance), roundMoney(section.difference)])
      for (const line of section.lines) {
        rows.push([name, `    ${managementLineLabel(line, t)}`, roundMoney(line.begin_balance), roundMoney(line.end_balance), roundMoney(line.difference)])
      }
    }
  }
  return rows
}
