"use client"

import { useEffect, useMemo, useState } from "react"

import {
  FilterCheck,
  FilterDate,
  FilterSelect,
  RI,
  RefFilterPanel,
  RefIconButton,
  RefTabs,
  SimpleListPage,
} from "@/components/ref/list-kit"
import { csvText } from "@/lib/csv"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate } from "@/lib/ref-date"

type Account = { id: number; name: string; address: string; date: string; created: string; agent: string; type: string }
type Filters = { agent: string; begin: string; end: string; type: string; blacklist: boolean; deleted: boolean }

const emptyFilters: Filters = { agent: "", begin: "", end: "", type: "", blacklist: false, deleted: false }

export function FinancialAccountsView() {
  const { t, language } = useLanguage()
  const [tab, setTab] = useState("Все")
  const [rows, setRows] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>(emptyFilters)

  useEffect(() => {
    let cancelled = false
    fetch("/api/financial-accounts")
      .then((response) => (response.ok ? response.json() : []))
      .then((clients: { id: number; name: string; address?: string; createdAt?: string; agent?: string; type?: string }[]) => {
        if (cancelled || !Array.isArray(clients)) return
        setRows(
          clients
            .slice()
            .sort((a, b) => b.id - a.id)
            .map((client) => ({
              id: client.id,
              name: client.name,
              address: client.address || "Не указано",
              date: refDate(client.createdAt),
              created: (client.createdAt ?? "").slice(0, 10),
              agent: client.agent ?? "",
              type: client.type ?? "",
            })),
        )
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  const agents = useMemo(() => [...new Set(rows.map((row) => row.agent).filter((value) => value && value !== "Не указано"))].sort((a, b) => a.localeCompare(b, "ru")), [rows])
  const types = useMemo(() => [...new Set(rows.map((row) => row.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")), [rows])

  const shown = useMemo(() => {
    const base = tab === "Все" || tab === "Один счет" ? rows : []
    return base.filter((row) => {
      if (filters.agent && row.agent !== filters.agent) return false
      if (filters.type && row.type !== filters.type) return false
      if (filters.begin && (!row.created || row.created < filters.begin || row.created > (filters.end || filters.begin))) return false
      return true
    })
  }, [rows, tab, filters])

  function download() {
    const csv = csvText([["№", t("Наименование"), t("Адрес"), t("Дата добавления")], ...shown.map((row) => [row.id, row.name, row.address === "Не указано" ? t(row.address) : row.address, formatDateText(row.date, language)])])
    const a = document.createElement("a")
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv)
    a.download = "financial-accounts.csv"
    a.click()
  }

  return (
    <SimpleListPage
      title={t("Финансовые счета")}
      tabs={<RefTabs separate labels={["Один счет", "Несколько счетов", "Все"]} value={tab} onChange={setTab} />}
      tabsSeparate
      loading={loading}
      cols="103px 412px 412px minmax(0,1fr)"
      heads={[t("№"), t("Наименование"), t("Адрес"), t("Дата добавления")]}
      rows={shown}
      rowKey={(row) => row.id}
      searchText={(row) => `${row.id} ${row.name} ${row.address}`}
      filterPanel={(close) => (
        <FinanceFilter value={filters} agents={agents} types={types} onClose={close} onApply={(next) => { setFilters(next); close() }} />
      )}
      icons={<RefIconButton path={RI.download} label={t("Скачать")} onClick={download} />}
      render={(row) => [row.id, row.name, row.address === "Не указано" ? t(row.address) : row.address, formatDateText(row.date, language)]}
    />
  )
}

function FinanceFilter({ value, agents, types, onClose, onApply }: { value: Filters; agents: string[]; types: string[]; onClose: () => void; onApply: (filters: Filters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(value)
  const set = <K extends keyof Filters>(key: K) => (next: Filters[K]) => setDraft((current) => ({ ...current, [key]: next }))
  return (
    <RefFilterPanel onClose={onClose} onApply={() => onApply(draft)}>
      <div className="grid grid-cols-4 gap-x-[9.33px]">
        <FilterSelect label={t("Ответственный агент")} value={draft.agent} onChange={set("agent")} options={agents} />
        <FilterDate label={t("Дата создания")} begin={draft.begin} end={draft.end} onChange={(begin, end) => setDraft((current) => ({ ...current, begin, end }))} />
        <FilterSelect label={t("Тип клиента")} value={draft.type} onChange={set("type")} options={types} />
        <div className="pt-[26px]">
          <FilterCheck label={t("В черном списке")} checked={draft.blacklist} onChange={set("blacklist")} />
        </div>
      </div>
      <div className="mt-[6px]">
        <FilterCheck label={t("Показать удаленные счета")} checked={draft.deleted} onChange={set("deleted")} />
      </div>
    </RefFilterPanel>
  )
}
