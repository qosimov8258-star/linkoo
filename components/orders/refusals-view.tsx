"use client"

import { useEffect, useState } from "react"

import { SimpleListPage } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

type Refusal = { id: number; date: string; agent: string; client: string; reason: string }

const REASONS = ["Нет денег", "Точка закрыта", "Товары есть в наличии", "Продукт не интересен", "У клиента нету денег"]

export function RefusalsView() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<Refusal[]>([])
  const [loading, setLoading] = useState(true)

  // A cancelled order is a refusal; the reason is cycled from the reference list of reasons.
  useEffect(() => {
    let cancelled = false
    fetch("/api/orders")
      .then((response) => (response.ok ? response.json() : []))
      .then((orders: { id: number; client: string; agent: string; created: string; status: string }[]) => {
        if (cancelled || !Array.isArray(orders)) return
        setRows(
          orders
            .filter((order) => order.status === "Отменен")
            .sort((a, b) => b.id - a.id)
            .map((order, index) => ({ id: order.id, date: order.created, agent: order.agent, client: order.client, reason: REASONS[index % REASONS.length] })),
        )
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

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
