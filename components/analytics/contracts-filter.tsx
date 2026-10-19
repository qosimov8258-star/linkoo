"use client"

import { useEffect, useState } from "react"
import { ChevronDown, Pencil, X } from "lucide-react"

import { FormField, MultiPick, SearchSelect, inputClass, type PickOption } from "@/components/analytics/cash-management-shared"
import { ClientMultiSelect, useContractClients, type ClientPick } from "@/components/analytics/contracts-fields"
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
        <button type="button" onClick={open ? onClose : onOpen} className="flex items-center gap-1 whitespace-nowrap font-medium text-[rgb(79,113,220)]">
          {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {open && <ContractsFilterPopup filters={filters} options={options} onClose={onClose} onApply={onApply} />}
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
  const options: PickOption[] = rows.map((row) => ({ value: String(row.id), label: `${t("Договор №")}: ${row.fullNumber}`, hint: row.officialName }))
  return (
    <SearchSelect
      value={value ? String(value) : ""}
      onChange={(next) => onChange(next ? Number(next) : null)}
      options={options}
      onSearch={setQuery}
      loading={loading}
      selectedLabel={selectedLabel}
      placeholder={t("Договор")}
    />
  )
}

function ContractsFilterPopup({
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

  return (
    <>
      <div className="fixed inset-0 z-[55]" onMouseDown={onClose} aria-hidden />
      <form
        className="absolute left-0 top-0 z-[60] w-[min(320px,calc(100vw-2rem))] bg-white px-5 py-3 shadow-[0_2px_10px_rgba(0,0,0,0.2)]"
        onSubmit={(event) => {
          event.preventDefault()
          onApply({ ...draft, clientIds: shownClients.map((client) => client.id) })
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[15px] text-[#5d6474]">{t("Фильтр")}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#8f8f8f] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <FormField label={t("Договор")}>
            <ContractPicker value={draft.contractId} onChange={(contractId) => setDraft((current) => ({ ...current, contractId }))} />
          </FormField>
          <div className="flex flex-col gap-1 text-[13px] text-[#586174]">
            <span>{t("Клиент")}</span>
            <ClientMultiSelect
              value={shownClients}
              onChange={(next) => {
                setClientsTouched(true)
                setClients(next)
              }}
              placeholder={t("Все")}
            />
          </div>
          <MultiPick label={t("Агент")} options={named(options?.agentNames ?? [], draft.agents)} value={draft.agents} onChange={(agents) => setDraft((current) => ({ ...current, agents }))} />
          <MultiPick label={t("Зона")} options={named(options?.zones ?? [], draft.zones)} value={draft.zones} onChange={(zones) => setDraft((current) => ({ ...current, zones }))} />
          <FormField label={t("Диапазон дат")}>
            <span className="flex items-center gap-2">
              <input
                type="date"
                value={draft.fromDate}
                onChange={(event) => setDraft((current) => ({ ...current, fromDate: event.target.value }))}
                aria-label={t("С")}
                className={`${inputClass} px-2`}
              />
              <span>—</span>
              <input
                type="date"
                value={draft.toDate}
                onChange={(event) => setDraft((current) => ({ ...current, toDate: event.target.value }))}
                aria-label={t("По")}
                className={`${inputClass} px-2`}
              />
            </span>
          </FormField>
        </div>
        <button type="submit" className="mt-4 h-9 rounded-sm bg-[rgb(79,113,220)] px-5 text-[13px] font-semibold uppercase text-white shadow hover:brightness-95">
          {t("Применить")}
        </button>
      </form>
    </>
  )
}
