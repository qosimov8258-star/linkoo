"use client"

import { REFUSALS_SEED, type RefusalRow } from "./refusals-data"
import { SimpleListPage } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

type Refusal = RefusalRow

export function RefusalsView() {
  const { t } = useLanguage()
  const rows = REFUSALS_SEED
  const loading = false

  return (
    <SimpleListPage
      title={t("Отказы")}
      linkFilter
      loading={loading}
      cols="minmax(0,60fr) minmax(0,200fr) minmax(0,230fr) minmax(0,230fr) minmax(0,230fr)"
      heads={[t("№"), t("Дата создания"), t("Агент"), t("Клиент"), t("Причина")]}
      rows={rows}
      rowKey={(row) => row.id}
      searchText={(row) => `${row.id} ${row.client} ${row.agent} ${row.reason}`}
      filterPanel={<div className="w-64 border border-slate-200 bg-white p-4 text-[13px] shadow-xl">{t("Используйте поиск для фильтрации отказов")}</div>}
      render={(row) => [row.id, row.date, row.agent, row.client, t(row.reason)]}
    />
  )
}
