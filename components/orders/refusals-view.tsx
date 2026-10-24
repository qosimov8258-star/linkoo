"use client"

import { useMemo, useState } from "react"

import { FilterDate, FilterSelect, RefFilterPanel, SimpleListPage } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { useRefRecords } from "@/lib/use-ref-records"

import type { RefusalRow } from "./refusals-data"

const MONTH_PREFIX = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

/** "10 мар. 2026" -> "2026-03-10" */
function toIso(text: string) {
  const match = text.trim().toLowerCase().match(/^(\d{1,2})\s+([а-я]+)\.?\s+(\d{4})/)
  if (!match) return ""
  const month = MONTH_PREFIX.findIndex((prefix) => match[2].startsWith(prefix))
  return month < 0 ? "" : `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`
}

function currentMonth() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return { begin: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(last)}` }
}

type Filters = { begin: string; end: string; agent: string; reason: string }

export function RefusalsView() {
  const { t } = useLanguage()
  const { rows, loading } = useRefRecords<RefusalRow>("refusal")
  // Like the reference, the panel offers the current month but the list stays unfiltered until "Применить".
  const [draft, setDraft] = useState<Filters>({ ...currentMonth(), agent: "", reason: "" })
  const [applied, setApplied] = useState<Filters | null>(null)

  const agents = useMemo(() => [...new Set(rows.map((row) => row.agent))].sort((a, b) => a.localeCompare(b)), [rows])
  const reasons = useMemo(() => [...new Set(rows.map((row) => row.reason))].sort((a, b) => a.localeCompare(b)), [rows])
  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (!applied) return true
        const iso = toIso(row.date)
        if (applied.begin && iso && iso < applied.begin) return false
        if (applied.end && iso && iso > applied.end) return false
        if (applied.agent && row.agent !== applied.agent) return false
        if (applied.reason && row.reason !== applied.reason) return false
        return true
      }),
    [rows, applied],
  )

  return (
    <SimpleListPage
      title={t("Отказы")}
      linkFilter="flush"
      loading={loading}
      cols="minmax(0,1fr) minmax(0,3fr) minmax(0,3fr) minmax(0,3fr) minmax(0,2fr)"
      heads={[t("№"), t("Дата создания"), t("Агент"), t("Клиент"), t("Причина")]}
      rows={visible}
      rowKey={(row) => row.id}
      searchText={(row) => `${row.id} ${row.client} ${row.agent} ${row.reason}`}
      filterPanel={(close) => (
        <RefFilterPanel narrow onClose={close} onApply={() => { setApplied(draft); close() }}>
          <div className="px-5">
            <FilterDate label={t("Период")} begin={draft.begin} end={draft.end} words onChange={(begin, end) => setDraft((current) => ({ ...current, begin, end }))} />
            <FilterSelect label={t("Агент")} value={draft.agent} options={agents} onChange={(agent) => setDraft((current) => ({ ...current, agent }))} />
            <FilterSelect label={t("Тип отказа")} value={draft.reason} options={reasons} onChange={(reason) => setDraft((current) => ({ ...current, reason }))} />
          </div>
        </RefFilterPanel>
      )}
      render={(row) => [row.id, row.date, row.agent, row.client, t(row.reason)]}
    />
  )
}
