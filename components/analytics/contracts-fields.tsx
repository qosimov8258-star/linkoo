"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react"

import { inputClass } from "@/components/analytics/cash-management-shared"
import { CONTRACT_STATUS_COLORS, CONTRACT_STATUS_LABELS, type ContractStatus } from "@/lib/contracts-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Small shared pieces of the "Договоры" page: status badge (demo dot + label) and
// the multi client picker (demo MarketMultiSearchField) backed by
// GET /api/contracts/clients?q&ids.

export type ClientPick = { id: number; name: string; zone: string; inn?: string }

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  const { t } = useLanguage()
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" style={{ color: CONTRACT_STATUS_COLORS[status] }}>
      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: CONTRACT_STATUS_COLORS[status] }} />
      <span className="text-[#17233b]">{t(CONTRACT_STATUS_LABELS[status])}</span>
    </span>
  )
}

/** Clients for the picker: search (debounced) + the selected ids so their labels resolve. */
export function useContractClients(query: string, ids: number[], enabled: boolean): { items: ClientPick[]; loading: boolean } {
  const [debounced, setDebounced] = useState(query.trim())
  const [state, setState] = useState<{ key: string; items: ClientPick[]; loading: boolean }>({ key: "", items: [], loading: false })
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  const idsKey = ids.join(",")
  const key = `${debounced}|${idsKey}`
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState((current) => ({ key, items: current.items, loading: true }))
    const params = new URLSearchParams()
    if (debounced) params.set("q", debounced)
    if (idsKey) params.set("ids", idsKey)
    fetch(`/api/contracts/clients?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<ClientPick[]>) : []))
      .then((items) => setState({ key, items: Array.isArray(items) ? items : [], loading: false }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, items: [], loading: false })
      })
    return () => controller.abort()
  }, [debounced, idsKey, key, enabled])
  return { items: state.items, loading: state.loading }
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open, close])
  return ref
}

/** Multi client select with server search; `value` keeps names so chips render without a lookup. */
export function ClientMultiSelect({
  value,
  onChange,
  invalid,
  placeholder,
}: {
  value: ClientPick[]
  onChange: (next: ClientPick[]) => void
  invalid?: boolean
  placeholder?: string
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const close = useCallback(() => setOpen(false), [])
  const ref = useOutside(open, close)
  const { items, loading } = useContractClients(query, [], open)
  const selected = new Set(value.map((item) => item.id))
  const toggle = (client: ClientPick) =>
    onChange(selected.has(client.id) ? value.filter((item) => item.id !== client.id) : [...value, { id: client.id, name: client.name, zone: client.zone, inn: client.inn }])
  return (
    <div ref={ref} className="relative min-w-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") setOpen((current) => !current)
        }}
        className={`${inputClass} flex h-auto min-h-10 cursor-pointer flex-wrap items-center gap-1.5 py-1.5 pr-8 ${invalid ? "border-[#e57373]" : ""}`}
      >
        {!value.length && <span className="text-[#9aa3b6]">{placeholder || t("Выберите")}</span>}
        {value.map((client) => (
          <span key={client.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#eef1fb] px-2.5 py-0.5 text-[13px] text-[#17233b]">
            <span className="truncate">{client.name || `#${client.id}`}</span>
            <button
              type="button"
              aria-label={t("Удалить")}
              onClick={(event) => {
                event.stopPropagation()
                onChange(value.filter((item) => item.id !== client.id))
              }}
              className="text-[#7b8497] hover:text-[#e57373]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-[#9aa3b6]" />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[30] mt-1 rounded-md border border-[#e1e5eb] bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#eef1f5] px-3">
            <Search className="h-4 w-4 shrink-0 text-[#9aa3b6]" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Escape closes the list, not the surrounding modal.
                if (event.key === "Escape") {
                  // React listens on the document (same node as the modal's listener).
                  event.stopPropagation()
                  event.nativeEvent.stopImmediatePropagation()
                  setOpen(false)
                }
              }}
              placeholder={t("Поиск")}
              className="h-9 w-full min-w-0 text-[14px] outline-none"
            />
            {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#9aa3b6]" />}
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {!items.length && <p className="px-3 py-2 text-[13px] text-[#9aa3b6]">{loading ? t("Загрузка...") : t("Ничего не найдено")}</p>}
            {items.map((client) => (
              <button key={client.id} type="button" onClick={() => toggle(client)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-[#f2f5f8]">
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected.has(client.id) ? "border-[#4f70e7] bg-[#4f70e7] text-white" : "border-[#c4cbd6]"}`}>
                  {selected.has(client.id) && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{client.name}</span>
                {client.zone && <span className="shrink-0 text-[12px] text-[#9aa3b6]">{client.zone}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
