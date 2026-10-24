"use client"

import { useEffect, useMemo, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { MaterialBody, MaterialDate, MaterialDialog, MaterialFooter, MaterialInput } from "@/components/analytics/cash-material"
import { FilterDate, FilterSelect, RI, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefPage, RefTabs, RefTable, RefToolbar } from "@/components/ref/list-kit"
import { BatchDetail } from "@/components/analytics/production/batch-detail"
import {
  api,
  formatDate,
  formatDateTime,
  STATUS_DOT,
  STATUS_LABELS,
  todayIso,
  useApiData,
  type CatalogItem,
  type PartyStatus,
  type Stage,
} from "@/components/analytics/production/production-ui"
import { notify } from "@/lib/notify"

type Party = {
  id: number
  stageId: number | null
  stageName: string
  date: string
  comment: string
  status: PartyStatus
  userName: string
  createdAt: string
  finishedAt: string
}

type Filters = { madeKey: string; rawKey: string; stageId: string; finishedFrom: string; finishedTo: string; createdFrom: string; createdTo: string }
const EMPTY_FILTERS: Filters = { madeKey: "", rawKey: "", stageId: "", finishedFrom: "", finishedTo: "", createdFrom: "", createdTo: "" }

/** The reference pre-fills both date ranges with the current month when the filter opens. */
function monthRange() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(last)}` }
}

const TABS: Array<[PartyStatus | "", string]> = [
  ["pending", "В процессе"],
  ["finished", "Завершенные"],
  ["", "Все"],
]
const HEADERS = ["№", "Дата начала", "Дата завершения", "Дата партии", "Этап производства", "Пользователь", "Статус"]

export function ProductionBatchesView() {
  const { t } = useLanguage()
  const [status, setStatus] = useState<PartyStatus | "">("")
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<number | null>(null)
  // The open batch lives in the URL (?party=ID) like the reference's #/party/ID: the browser's back button closes it.
  const openParty = (id: number | null) => {
    setExpanded(id)
    const url = new URL(window.location.href)
    if (id == null) url.searchParams.delete("party")
    else url.searchParams.set("party", String(id))
    window.history.pushState(null, "", url)
  }
  useEffect(() => {
    const sync = () => {
      const value = Number(new URLSearchParams(window.location.search).get("party"))
      setExpanded(Number.isInteger(value) && value > 0 ? value : null)
    }
    sync()
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const listUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (status) params.set("status", status)
    if (search) params.set("search", search)
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    // Finish times are stored as UTC instants; send the local day bounds.
    if (filters.finishedFrom) params.set("finishedFrom", new Date(`${filters.finishedFrom}T00:00:00`).toISOString())
    if (filters.finishedTo) params.set("finishedTo", new Date(`${filters.finishedTo}T23:59:59.999`).toISOString())
    if (filters.createdFrom) params.set("createdFrom", new Date(`${filters.createdFrom}T00:00:00`).toISOString())
    if (filters.createdTo) params.set("createdTo", new Date(`${filters.createdTo}T23:59:59.999`).toISOString())
    return `/api/production/parties?${params}`
  }, [filters, search, status])

  const { data: parties, reload } = useApiData<Party[]>(listUrl, [])
  const { data: stages } = useApiData<Stage[]>("/api/production/stages", [])
  const { data: catalog } = useApiData<CatalogItem[]>(filterOpen ? "/api/production/items" : null, [])
  const products = useMemo(() => catalog.filter((item) => item.kind === "product"), [catalog])

  const pageCount = Math.max(1, Math.ceil(parties.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = parties.slice((safePage - 1) * pageSize, safePage * pageSize)
  const first = parties.length ? (safePage - 1) * pageSize + 1 : 0
  const last = Math.min(safePage * pageSize, parties.length)
  const activeFilters = Object.values(filters).filter(Boolean).length

  function exportExcel() {
    const body = parties.map((party) => [
      party.id,
      formatDateTime(party.createdAt),
      party.finishedAt ? formatDateTime(party.finishedAt) : "",
      formatDate(party.date),
      party.stageName,
      party.userName,
      t(STATUS_LABELS[party.status]),
    ])
    downloadExcelTable("production-batches", [HEADERS.map(t), ...body])
  }

  const nameToKey = (items: Array<{ key: string; name: string }>) => new Map(items.map((item) => [item.name, item.key]))
  const madeKeys = useMemo(() => nameToKey(products), [products])
  const rawKeys = useMemo(() => nameToKey(catalog), [catalog])
  const keyToName = (items: Array<{ key: string; name: string }>, key: string) => items.find((item) => item.key === key)?.name ?? ""
  const expandedIndex = expanded == null ? -1 : visible.findIndex((party) => party.id === expanded)
  const expandedParty = expandedIndex >= 0 ? visible[expandedIndex] : expanded != null ? { id: expanded } : null
  const before = expandedIndex < 0 ? [] : visible.slice(0, expandedIndex)
  const after = expandedIndex < 0 ? (expanded != null ? visible : []) : visible.slice(expandedIndex + 1)
  const tableHeads = HEADERS.map((header, index) => (index === 0 ? <span key={header} className="-ml-2">{t(header)}</span> : t(header)))
  const tableProps = {
    cols: "115.3px 230.7px 230.7px 230.7px 230.7px 230.7px minmax(0,1fr)",
    rowKey: (party: Party) => party.id,
    minWidth: 1100,
    onRowClick: (party: Party) => openParty(expanded === party.id ? null : party.id),
    render: (party: Party) => [
      party.id,
      formatDateTime(party.createdAt),
      party.finishedAt ? formatDateTime(party.finishedAt) : "",
      formatDate(party.date),
      party.stageName,
      party.userName,
      <span key="status" className="flex items-center">
        <span className={`mr-[11px] inline-block h-[5px] w-[5px] rounded-full ${STATUS_DOT[party.status]}`} />
        {t(STATUS_LABELS[party.status])}
      </span>,
    ],
  }
  const closeFilter = () => setFilterOpen(false)
  const applyFilters = () => {
    setFilters(draft)
    setPage(1)
    setFilterOpen(false)
  }

  return (
    <RefPage>
      <RefHeader title={t("Партии")}>
        <button type="button" onClick={() => setCreateOpen(true)} title={t("Добавление партии")} aria-label={t("Добавление партии")} className="flex h-10 w-10 items-center justify-center rounded-[3px] bg-[#4f71dc] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
        </button>
      </RefHeader>

      <RefTabs
        separate
        labels={TABS.map(([, label]) => label)}
        value={TABS.find(([value]) => value === status)?.[1] ?? "Все"}
        onChange={(label) => {
          setStatus(TABS.find(([, tabLabel]) => tabLabel === label)?.[0] ?? "")
          setPage(1)
          openParty(null)
        }}
      />

      <RefCard className="mt-5 bg-white">
        <RefToolbar
          filterOpen={filterOpen}
          leftSlot={
            <button
              type="button"
              onClick={() => {
                const month = monthRange()
                setDraft({ ...filters, createdFrom: filters.createdFrom || month.from, createdTo: filters.createdTo || month.to, finishedFrom: filters.finishedFrom || month.from, finishedTo: filters.finishedTo || month.to })
                setFilterOpen((value) => !value)
              }}
              className="text-[13px] text-[#4f71dc]"
            >
              {filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")} ⌄
            </button>
          }
          filterPanel={
            <RefFilterPanel narrow className="!w-[300px]" onClose={closeFilter} onApply={applyFilters} applyClassName="mt-[10px]">
              <FilterSelect label={t("Готовый продукт")} value={keyToName(products, draft.madeKey)} onChange={(name) => setDraft({ ...draft, madeKey: madeKeys.get(name) ?? "" })} options={products.map((item) => item.name)} />
              <FilterSelect label={t("Сырье")} value={keyToName(catalog, draft.rawKey)} onChange={(name) => setDraft({ ...draft, rawKey: rawKeys.get(name) ?? "" })} options={catalog.map((item) => item.name)} />
              <FilterSelect label={t("Этап производства")} value={stages.find((stage) => String(stage.id) === draft.stageId)?.name ?? ""} onChange={(name) => setDraft({ ...draft, stageId: String(stages.find((stage) => stage.name === name)?.id ?? "") })} options={stages.map((stage) => stage.name)} />
              <FilterDate label={t("Дата доставки")} words begin={draft.createdFrom} end={draft.createdTo} onChange={(createdFrom, createdTo) => setDraft({ ...draft, createdFrom, createdTo })} />
              <FilterDate label={t("Период сдачи")} words begin={draft.finishedFrom} end={draft.finishedTo} onChange={(finishedFrom, finishedTo) => setDraft({ ...draft, finishedFrom, finishedTo })} />
            </RefFilterPanel>
          }
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setPage(1)
          }}
          pageSize={pageSize}
          onPageSize={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          from={first}
          to={last}
          total={parties.length}
          page={safePage}
          pageCount={pageCount}
          onPage={setPage}
          icons={<RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={exportExcel} color="#5d6474" />}
        />
        <RefTable {...tableProps} heads={tableHeads} rows={expandedParty ? before : visible} hideBody={expandedParty != null && before.length === 0} empty={t("По вашему запросу ничего не найдено...")} />
      </RefCard>

      {expandedParty && (
        <>
          <BatchDetail partyId={expandedParty.id} stages={stages} onChanged={reload} />
          {after.length > 0 && (
            <RefCard className="bg-white">
              <RefTable {...tableProps} heads={tableHeads} rows={after} hideHead />
            </RefCard>
          )}
        </>
      )}

      {createOpen && (
        <CreatePartyDialog
          stages={stages}
          onClose={() => setCreateOpen(false)}
          onCreated={(party) => {
            setCreateOpen(false)
            setStatus("")
            setPage(1)
            openParty(party.id)
            reload()
          }}
        />
      )}
    </RefPage>
  )
}

function CreatePartyDialog({ stages, onClose, onCreated }: { stages: Stage[]; onClose: () => void; onCreated: (party: Party) => void }) {
  const { t } = useLanguage()
  const [stageName, setStageName] = useState("")
  const [date, setDate] = useState(todayIso())
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)
  const stageId = stages.find((stage) => stage.name === stageName)?.id

  async function save() {
    if (!stageId) return
    setSaving(true)
    try {
      onCreated(await api<Party>("/api/production/parties", { method: "POST", body: { stageId, date, comment } }))
    } catch (error) {
      notify((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <MaterialDialog title={t("Добавление партии")} onClose={onClose} width={700} top={64} onSubmit={() => void save()} footer={<MaterialFooter label={t("Сохранить")} busy={saving} disabled={!stageId} />}>
      <MaterialBody className="pb-[40px] pt-[40px]">
        <FilterSelect compact label={`${t("Этап производства")} *`} value={stageName} onChange={setStageName} options={stages.map((stage) => stage.name)} />
        <MaterialDate label={t("Дата партии")} required value={date} onChange={setDate} />
        <MaterialInput placeholderLabel label={`${t("Комментарий")}...`} value={comment} onChange={setComment} className="mt-[10px]" />
      </MaterialBody>
    </MaterialDialog>
  )
}
