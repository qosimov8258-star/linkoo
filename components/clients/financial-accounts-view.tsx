"use client"

import { useEffect, useState } from "react"

import { RI, RefIconButton, RefTabs, SimpleListPage } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

type Account = { id: number; name: string; address: string; date: string }

export function FinancialAccountsView() {
  const { t } = useLanguage()
  const [tab, setTab] = useState("Все")
  const [rows, setRows] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch("/api/clients")
      .then((response) => (response.ok ? response.json() : []))
      .then((clients: { id: number; name: string; address?: string }[]) => {
        if (cancelled || !Array.isArray(clients)) return
        setRows(clients.slice().sort((a, b) => b.id - a.id).map((client) => ({ id: client.id, name: client.name, address: client.address || "Не указано", date: "24 мая 2026" })))
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const shown = tab === "Все" ? rows : tab === "Один счет" ? rows : []

  function download() {
    const csv = ["№;Наименование;Адрес;Дата добавления", ...shown.map((row) => `${row.id};${row.name};${row.address};${row.date}`)].join("\n")
    const a = document.createElement("a")
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv)
    a.download = "financial-accounts.csv"
    a.click()
  }

  return (
    <SimpleListPage
      title={t("Финансовые счета")}
      tabs={<RefTabs labels={["Один счет", "Несколько счетов", "Все"]} value={tab} onChange={setTab} />}
      loading={loading}
      cols="minmax(0,90fr) minmax(0,300fr) minmax(0,300fr) minmax(0,200fr)"
      heads={[t("№"), t("Наименование"), t("Адрес"), t("Дата добавления")]}
      rows={shown}
      rowKey={(row) => row.id}
      searchText={(row) => `${row.id} ${row.name} ${row.address}`}
      filterPanel={<div className="w-64 border border-slate-200 bg-white p-4 text-[13px] shadow-xl">{t("Используйте поиск для фильтрации")}</div>}
      icons={<RefIconButton path={RI.download} label={t("Скачать")} onClick={download} />}
      render={(row) => [row.id, row.name, row.address, row.date]}
    />
  )
}
