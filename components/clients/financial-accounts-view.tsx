"use client"

import { askDelete } from "@/lib/ask-confirm"
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
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate } from "@/lib/ref-date"
import { notify } from "@/lib/notify"

type Account = { id: number; name: string; address: string; date: string; created: string; agent: string; type: string; deleted: boolean; markets: { id: number; name: string }[] }
type Filters = { agent: string; begin: string; end: string; type: string; blacklist: boolean; deleted: boolean }

const emptyFilters: Filters = { agent: "", begin: "", end: "", type: "", blacklist: false, deleted: false }

export function FinancialAccountsView() {
  const { t } = useLanguage()
  const [tab, setTab] = useState("Все")
  const [rows, setRows] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [openId, setOpenId] = useState<number | null>(null)
  const [editing, setEditing] = useState<Account | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/financial-accounts")
      .then((response) => (response.ok ? response.json() : []))
      .then((clients: { id: number; name: string; address?: string; createdAt?: string; agent?: string; type?: string; deleted?: boolean; markets?: { id: number; name: string }[] }[]) => {
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
              deleted: Boolean(client.deleted),
              markets: client.markets ?? [],
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

  // Shops are linked to accounts by a one-off import; until it has run, every account counts as a single-shop one.
  const linked = useMemo(() => rows.some((row) => row.markets.length > 0), [rows])

  const shown = useMemo(() => {
    const base = rows.filter((row) => {
      if (tab === "Все") return true
      if (!linked) return tab === "Один счет"
      return tab === "Один счет" ? row.markets.length === 1 : row.markets.length > 1
    })
    return base.filter((row) => {
      if (row.deleted && !filters.deleted) return false
      if (filters.agent && row.agent !== filters.agent) return false
      if (filters.type && row.type !== filters.type) return false
      if (filters.begin && (!row.created || row.created < filters.begin || row.created > (filters.end || filters.begin))) return false
      return true
    })
  }, [rows, tab, filters, linked])

  async function save(account: Account, draft: { name: string; address: string }) {
    try {
      const response = await fetch(`/api/financial-accounts/${account.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!response.ok) return false
      setRows((current) => current.map((row) => (row.id === account.id ? { ...row, name: draft.name.trim(), address: draft.address.trim() || "Не указано" } : row)))
      setEditing(null)
      return true
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
      return false
    }
  }

  async function remove(account: Account) {
    if (!(await askDelete(account.name))) return
    const response = await fetch(`/api/financial-accounts/${account.id}`, { method: "DELETE" })
    if (!response.ok) return
    setRows((current) => current.map((row) => (row.id === account.id ? { ...row, deleted: true } : row)))
    setOpenId(null)
  }

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
      tabs={<RefTabs separate labels={["Один счет", "Несколько счетов", "Все"]} value={tab} onChange={(next) => { setTab(next); setOpenId(null) }} />}
      tabsSeparate
      loading={loading}
      cols="minmax(0,123.3fr) minmax(0,461.3fr) minmax(0,461.3fr) minmax(0,346.1fr)"
      heads={[t("№"), t("Наименование"), t("Адрес"), t("Дата добавления")]}
      rows={shown}
      rowKey={(row) => row.id}
      searchText={(row) => `${row.id} ${row.name} ${row.address}`}
      filterPanel={(close) => (
        <FinanceFilter value={filters} agents={agents} types={types} onClose={close} onApply={(next) => { setFilters(next); close() }} />
      )}
      icons={<RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={download} />}
      render={(row) => [row.id, row.name, row.address, row.date]}
      onRowClick={(row) => setOpenId((current) => (current === row.id ? null : row.id))}
      rowClass={(row) => (openId === row.id ? "hidden" : "")}
      expanded={(row) => (openId === row.id ? <AccountDetail account={row} onEdit={() => setEditing(row)} onDelete={() => void remove(row)} /> : null)}
      below={editing && <AccountDialog account={editing} onSave={(draft) => save(editing, draft)} onClose={() => setEditing(null)} />}
    />
  )
}

function AccountDetail({ account, onEdit, onDelete }: { account: Account; onEdit: () => void; onDelete: () => void }) {
  const { t } = useLanguage()
  const label = "mb-[3px] text-[11px] font-semibold uppercase leading-[14px] tracking-[0.4px] text-[#9ba0ac]"
  const value = "text-[14px] font-medium leading-5 text-[#333]"
  return (
    <div className="-mx-[15px] bg-[#f2f5f8] py-[20px]">
    <div className="border-b border-dotted border-[#eee] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="flex h-[65px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[44px]">
        <h3 className="text-[18px] font-bold text-[#333]">{account.name}</h3>
        <div className="-mt-1 flex items-center gap-[28px]">
          <button type="button" onClick={onEdit} aria-label={t("Изменить")}>
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
          </button>
          <button type="button" onClick={onDelete} aria-label={t("Удалить")}>
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[442px_1fr]">
        <div className="border-r border-[#efefef] px-[30px] py-[20px]">
          <div className={label}>{t("Адрес")}</div>
          <div className={value}>{account.address}</div>
          <div className={`${label} mt-[15px]`}>{t("Дата добавления")}</div>
          <div className={value}>{account.date}</div>
        </div>
        <div className="px-[30px] py-[20px]">
          <div className="flex items-center gap-4 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.4px] text-[#9ba0ac]">
            {t("Магазины")}
            <span className="rounded-full bg-[#eef1fb] px-[7px] py-[1px] text-[#4f71dc]">{account.markets.length}</span>
          </div>
          <div className="mt-[14px] flex flex-wrap gap-2">
            {account.markets.map((market) => (
              <span key={market.id} className="flex h-[30px] items-center gap-2 rounded-[16px] border border-[#e7e9f0] bg-white px-[13px] text-[13px] text-[#5d6474]">
                <span className="h-[6px] w-[6px] rounded-full bg-[#9aa7e8]" />
                {market.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}

function AccountDialog({ account, onSave, onClose }: { account: Account; onSave: (draft: { name: string; address: string }) => Promise<boolean>; onClose: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(account.name)
  const [address, setAddress] = useState(account.address === "Не указано" ? "" : account.address)
  const [saving, setSaving] = useState(false)
  const field = "block h-[34px] w-full border-b border-[#e0e0e0] bg-transparent pt-[6px] text-[13px] font-medium text-[#333] outline-none focus:border-[#5d6474]"
  const caption = "block text-[10px] font-semibold leading-3 text-black"
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!name.trim() || saving) return
          setSaving(true)
          if (!(await onSave({ name, address }))) setSaving(false)
        }}
        className="w-[500px] max-w-full bg-white shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
      >
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[28px]">
          <b className="text-[13px] font-bold uppercase text-[#333]">{t("Изменение финансового счета")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={RI.close} /></svg>
          </button>
        </header>
        <div className="space-y-[6px] px-[30px] pb-[29px] pt-[27px]">
          <label className="block">
            <span className={caption}>{t("Наименование")}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} autoFocus className={field} />
          </label>
          <label className="block">
            <span className={caption}>{t("Адрес")}</span>
            <input value={address} onChange={(event) => setAddress(event.target.value)} className={field} />
          </label>
        </div>
        <footer className="flex justify-end border-t border-[#efefef] p-[10px]">
          <button type="submit" disabled={!name.trim() || saving} className="h-[36px] rounded-[5px] bg-[#71ce87] px-[16px] text-[13px] font-semibold uppercase text-white hover:brightness-95 disabled:opacity-60">
            {t("Сохранить")}
          </button>
        </footer>
      </form>
    </div>
  )
}

function FinanceFilter({ value, agents, types, onClose, onApply }: { value: Filters; agents: string[]; types: string[]; onClose: () => void; onApply: (filters: Filters) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(value)
  const set = <K extends keyof Filters>(key: K) => (next: Filters[K]) => setDraft((current) => ({ ...current, [key]: next }))
  return (
    <RefFilterPanel onClose={onClose} onApply={() => onApply(draft)} applyClassName="mt-[25px]">
      <div className="grid grid-cols-4 gap-x-[9.33px]">
        <FilterSelect label={t("Ответственный агент")} value={draft.agent} onChange={set("agent")} options={agents} />
        <FilterDate iconLeft={243} label={t("Дата создания")} begin={draft.begin} end={draft.end} onChange={(begin, end) => setDraft((current) => ({ ...current, begin, end }))} />
        <FilterSelect label={t("Тип клиента")} value={draft.type} onChange={set("type")} options={types} />
        <div className="pt-[32px]">
          <FilterCheck compact label={t("В черном списке")} checked={draft.blacklist} onChange={set("blacklist")} />
        </div>
      </div>
      <div className="mt-[10px]">
        <FilterCheck compact label={t("Показать удаленные счета")} checked={draft.deleted} onChange={set("deleted")} />
      </div>
    </RefFilterPanel>
  )
}
