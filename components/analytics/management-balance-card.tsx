"use client"

import Link from "next/link"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Fragment, type KeyboardEvent } from "react"

import { currencyLabel, formatMoney, roundMoney } from "@/lib/finance/currency"
import { formatDayMonth } from "@/lib/finance/dates"
import type { ManagementLine, ManagementSection } from "@/lib/finance/types"
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

/** Demo colored formatter: >0 green, <0 red (bold); reversed for liabilities, neutral for the rate. */
function differenceClass(value: number, section: ManagementSection["key"]): string {
  if (section === "rate" || !value) return ""
  const good = section === "passives" ? value < 0 : value > 0
  return good ? "font-semibold text-[#48a34b]" : "font-semibold text-[#E27676]"
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
              const expandable = section.lines.length > 0
              const open = expandable && isOpen(section.key)
              return (
                <Fragment key={section.key}>
                  <tr
                    onClick={expandable ? () => onToggle(section.key) : undefined}
                    onKeyDown={expandable ? onKey(section.key) : undefined}
                    tabIndex={expandable ? 0 : undefined}
                    aria-expanded={expandable ? open : undefined}
                    className={`bg-[#edf1fd] ${expandable ? "cursor-pointer outline-none hover:bg-[#e3e9fb] focus-visible:bg-[#e3e9fb]" : ""}`}
                  >
                    <td className="border border-[#dcdcdc] px-[9px] py-[9px] font-semibold text-[#333]">
                      <span className="inline-flex items-center gap-1.5">
                        {t(section.label)}
                        {expandable && (open ? <ChevronUp className="h-4 w-4 text-[#4f71dc]" /> : <ChevronDown className="h-4 w-4 text-[#4f71dc]" />)}
                      </span>
                    </td>
                    <td className={`${cell} py-[9px]`}>{formatMoney(section.begin_balance)}</td>
                    <td className={`${cell} py-[9px]`}>{formatMoney(section.end_balance)}</td>
                    <td className={`${cell} py-[9px] ${differenceClass(section.difference, section.key)}`}>{formatMoney(section.difference)}</td>
                  </tr>
                  {open &&
                    section.lines.map((line) => (
                      <tr key={`${line.key}|${line.label}|${line.currency}`} className="border-b border-dashed border-slate-200">
                        <td className="px-9 py-2.5 text-slate-600">
                          {line.href ? (
                            <Link href={line.href} className="text-[#4f70e7] hover:underline">
                              {managementLineLabel(line, t)}
                            </Link>
                          ) : (
                            managementLineLabel(line, t)
                          )}
                        </td>
                        <td className={`${cell} py-2.5`}>{formatMoney(line.begin_balance)}</td>
                        <td className={`${cell} py-2.5`}>{formatMoney(line.end_balance)}</td>
                        <td className={`${cell} py-2.5 ${differenceClass(line.difference, section.key)}`}>{formatMoney(line.difference)}</td>
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
