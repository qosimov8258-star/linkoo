"use client"

import { useMemo, useState } from "react"

import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { useLookup } from "@/components/analytics/balance/use-balance"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { RefHeader } from "@/components/ref/list-kit"
import { formatRangeLabel, parseISODate } from "@/lib/dashboard-date-range"
import { defaultBalancePeriod, isIsoDay } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { useRouter, useSearchParams } from "next/navigation"

// "Движения денежных средств" (demo #/cash-flow/?beginDate&endDate): a filter card (Организация | Филиалы | Касса | date range |
// Применить) over a white card. The reference account's `stats/cashflow/` endpoint answers 404, so the card always says
// "Нет данных" there; the filters still work and the period lives in the URL like the demo's hash route.
const CARD = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"

type Named = { id: number; name: string }

export function CashFlowView() {
  const { t } = useLanguage()
  const router = useRouter()
  const params = useSearchParams()
  const fallback = useMemo(() => defaultBalancePeriod(), [])
  const begin = params.get("beginDate")
  const end = params.get("endDate")
  const [range, setRange] = useState({ from: isIsoDay(begin) ? begin : fallback.from, to: isIsoDay(end) ? end : fallback.to })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [organization, setOrganization] = useState<RefSelectItem[]>([])
  const [branch, setBranch] = useState<RefSelectItem[]>([])
  const [cashbox, setCashbox] = useState<RefSelectItem[]>([])
  const organizations = useLookup<Named>("/api/organizations")
  const branches = useLookup<Named>("/api/branches")
  const cashboxes = useLookup<Named>("/api/cashboxes")
  const items = (rows: Named[]): RefSelectItem[] => rows.map((row) => ({ value: String(row.id), label: row.name }))

  const apply = () => {
    const query = new URLSearchParams({ beginDate: range.from, endDate: range.to })
    for (const item of organization) query.append("division", item.value)
    if (branch[0]) query.set("branch", branch[0].value)
    if (cashbox[0]) query.set("cashbox", cashbox[0].value)
    router.replace(`/analytics/cash-flow?${query.toString()}`)
  }

  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#f2f5f8] font-sans text-[13px] text-[#333]">
      <div className="pl-[28px] pr-[36px]">
        <RefHeader title={t("Движения денежных средств")} />
      </div>

      <section className={`relative mx-[28px] h-[78px] ${CARD}`}>
        <div className="absolute left-[30px] top-[4px] w-[327px]"><RefSearchSelect label={t("Организация")} items={items(organizations)} selected={organization} onChange={setOrganization} multi /></div>
        <div className="absolute left-[372px] top-[4px] w-[281px]"><RefSearchSelect label={t("Филиалы")} items={items(branches)} selected={branch} onChange={setBranch} /></div>
        <div className="absolute left-[668px] top-[4px] w-[280px]"><RefSearchSelect label={t("Касса")} items={items(cashboxes)} selected={cashbox} onChange={setCashbox} /></div>
        <div className="absolute left-[963px] top-[26px] h-[36px] w-[327px] border-b border-[#e8e8e8]">
          <button type="button" onClick={() => setPickerOpen((open) => !open)} className="absolute left-0 top-[9px] text-[13px] text-black">
            {formatRangeLabel(parseISODate(range.from), parseISODate(range.to)).toLowerCase()}
          </button>
          {pickerOpen && (
            <DateRangePicker
              positionClassName="left-0 top-[36px]"
              begin={range.from}
              end={range.to}
              onClose={() => setPickerOpen(false)}
              onApply={(from, to) => {
                setRange({ from, to })
                setPickerOpen(false)
              }}
            />
          )}
        </div>
        <button type="button" onClick={apply} className="absolute left-[1305px] top-[26px] h-[30px] rounded-[4px] bg-[#4f71dc] px-[16px] text-[13px] font-bold text-white">
          {t("Применить")}
        </button>
      </section>

      <section className="mx-[28px] mt-[16px] flex h-[130px] items-center justify-center rounded-[16px] bg-white">
        <span className="text-[14px] font-semibold text-[#a0a7b5]">{t("Нет данных")}</span>
      </section>
    </main>
  )
}
