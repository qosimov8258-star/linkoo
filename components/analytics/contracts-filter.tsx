"use client"

import { useEffect, useState } from "react"
import { Pencil, X } from "lucide-react"

import { type PickOption } from "@/components/analytics/cash-management-shared"
import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { FilterDate, RefFilterPanel } from "@/components/ref/list-kit"
import { useContractClients, type ClientPick } from "@/components/analytics/contracts-fields"
import type { ContractFormOptions, ContractListResult, ContractTab } from "@/lib/contracts-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Demo ContractsFilter (module 4293): "Показать фильтр" link → 300px popup with
// Договор (one contract), Клиент (multi), Агент (multi), Зона (multi),
// Диапазон дат, "Применить"; applied state "Фильтр: N элемента" + edit + clear.

export type ContractFilters = {
  contractId: number | null
  clientIds: number[]
  agents: string[]
  zones: string[]
  fromDate: string
  toDate: string
}

export const EMPTY_CONTRACT_FILTERS: ContractFilters = { contractId: null, clientIds: [], agents: [], zones: [], fromDate: "", toDate: "" }

/** Demo getCount: every set CONTRACTS_FILTER_KEY except fromDate — the status tab counts too (the date range once). */
export function contractFilterCount(filters: ContractFilters, tab: ContractTab): number {
  return [
    tab !== "all",
    filters.contractId !== null,
    filters.clientIds.length > 0,
    filters.agents.length > 0,
    filters.zones.length > 0,
    Boolean(filters.fromDate || filters.toDate),
  ].filter(Boolean).length
}

export function ContractsFilterBar({
  filters,
  tab,
  open,
  onOpen,
  onClose,
  onClear,
  onApply,
  options,
}: {
  filters: ContractFilters
  tab: ContractTab
  open: boolean
  onOpen: () => void
  onClose: () => void
  onClear: () => void
  onApply: (filters: ContractFilters) => void
  options: ContractFormOptions | null
}) {
  const { t } = useLanguage()
  const count = contractFilterCount(filters, tab)
  return (
    <div className="relative">
      {count > 0 ? (
        <div className="flex items-center gap-2 rounded-md bg-[#efefef] px-4 py-1.5 text-[#666]">
          <span className="whitespace-nowrap">
            {t("Фильтр")}: {count} {t("элемента")}
          </span>
          <button type="button" onClick={onOpen} aria-label={t("Изменить фильтр")} className="border-l border-white pl-2 text-[#8f8f8f] hover:text-[#17233b]">
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClear} aria-label={t("Очистить фильтр")} className="border-l border-white pl-2 text-[#8f8f8f] hover:text-[#17233b]">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={open ? onClose : onOpen} className="whitespace-nowrap pl-[5px] text-[13px] text-[rgb(79,113,220)]">
          {open ? t("Скрыть фильтр") : t("Показать фильтр")} ⌄
        </button>
      )}
    </div>
  )
}

type ContractPickRow = { id: number; fullNumber: string; officialName: string }

/** "Договор" field (demo ContractSearchField): list API search, text "Договор №: …". */
function ContractPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { t } = useLanguage()
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<ContractPickRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState("")
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      fetch(`/api/contracts?status=all&pageSize=50&search=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<ContractListResult>) : null))
        .then((body) => setRows((body?.results ?? []).map((row) => ({ id: row.id, fullNumber: row.fullNumber, officialName: row.officialName }))))
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])
  useEffect(() => {
    if (!value) return
    const controller = new AbortController()
    fetch(`/api/contracts?status=all&pageSize=1&ids=${value}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<ContractListResult>) : null))
      .then((body) => {
        const row = body?.results[0]
        if (row) setSelectedLabel(`${t("Договор №")}: ${row.fullNumber}`)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [value, t])
  const items: RefSelectItem[] = rows.map((row) => ({ value: String(row.id), label: `${t("Договор №")}: ${row.fullNumber}` }))
  const selected: RefSelectItem[] = value ? [{ value: String(value), label: selectedLabel || `#${value}` }] : []
  return (
    <RefSearchSelect
      label={t("Договор")}
      items={items}
      selected={selected}
      onChange={(next) => {
        setSelectedLabel(next[0]?.label ?? "")
        onChange(next[0] ? Number(next[0].value) : null)
      }}
      onQuery={setQuery}
      loading={loading}
    />
  )
}

export function ContractsFilterPopup({
  filters,
  options,
  onClose,
  onApply,
}: {
  filters: ContractFilters
  options: ContractFormOptions | null
  onClose: () => void
  onApply: (filters: ContractFilters) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<ContractFilters>(filters)
  const [clients, setClients] = useState<ClientPick[]>([])
  const [clientsTouched, setClientsTouched] = useState(false)
  // Names of the clients already in the URL (ids only).
  const known = useContractClients("", filters.clientIds, filters.clientIds.length > 0)
  const shownClients = clientsTouched ? clients : filters.clientIds.map((id) => known.items.find((item) => item.id === id) ?? { id, name: `#${id}`, zone: "" })
  const named = (values: string[], selected: string[]): PickOption[] => [...new Set([...values, ...selected])].map((value) => ({ value, label: value }))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const [clientQuery, setClientQuery] = useState("")
  const clientPick = useContractClients(clientQuery, [], true)
  return (
    <>
      <div className="fixed inset-0 z-[55]" onMouseDown={onClose} aria-hidden />
      <div className="absolute left-0 top-0 z-[60]">
        <RefFilterPanel
          narrow
          className="!w-[300px]"
          onClose={onClose}
          onApply={() => onApply({ ...draft, clientIds: shownClients.map((client) => client.id) })}
          applyClassName="mt-1"
        >
          <ContractPicker value={draft.contractId} onChange={(contractId) => setDraft((current) => ({ ...current, contractId }))} />
          <RefSearchSelect
            multi
            label={t("Клиент")}
            items={clientPick.items.map((client) => ({ value: String(client.id), label: client.name }))}
            selected={shownClients.map((client) => ({ value: String(client.id), label: client.name || `#${client.id}` }))}
            onQuery={setClientQuery}
            loading={clientPick.loading}
            onChange={(next) => {
              setClientsTouched(true)
              setClients(next.map((item) => clientPick.items.find((client) => String(client.id) === item.value) ?? shownClients.find((client) => String(client.id) === item.value) ?? { id: Number(item.value), name: item.label, zone: "" }))
            }}
          />
          <RefSearchSelect multi label={t("Агент")} items={named(options?.agentNames ?? [], draft.agents).map((o) => ({ value: o.value, label: o.label }))} selected={draft.agents.map((value) => ({ value, label: value }))} onChange={(next) => setDraft((current) => ({ ...current, agents: next.map((item) => item.value) }))} />
          <RefSearchSelect multi label={t("Зона")} items={named(options?.zones ?? [], draft.zones).map((o) => ({ value: o.value, label: o.label }))} selected={draft.zones.map((value) => ({ value, label: value }))} onChange={(next) => setDraft((current) => ({ ...current, zones: next.map((item) => item.value) }))} />
          <FilterDate label={t("Диапазон дат")} begin={draft.fromDate} end={draft.toDate} onChange={(begin, end) => setDraft((current) => ({ ...current, fromDate: begin, toDate: end }))} />
        </RefFilterPanel>
      </div>
    </>
  )
}
