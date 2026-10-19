"use client"

import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Download, Plus, Search, X } from "lucide-react"

import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { BatchDetail } from "@/components/analytics/production/batch-detail"
import {
  api,
  Field,
  formatDate,
  formatDateTime,
  inputClass,
  ItemPicker,
  Modal,
  SaveButton,
  STATUS_DOT,
  STATUS_LABELS,
  todayIso,
  useApiData,
  type CatalogItem,
  type PartyStatus,
  type Stage,
} from "@/components/analytics/production/production-ui"

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

type Filters = { madeKey: string; rawKey: string; stageId: string; finishedFrom: string; finishedTo: string; dateFrom: string; dateTo: string }
const EMPTY_FILTERS: Filters = { madeKey: "", rawKey: "", stageId: "", finishedFrom: "", finishedTo: "", dateFrom: "", dateTo: "" }

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

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 pb-10 text-slate-800">
      <header className="flex items-center justify-between px-8 py-4">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-semibold text-blue-600" />
          <span className="text-2xl text-slate-500">|</span>
          <span className="text-2xl font-semibold text-slate-600">{t("Партии")}</span>
        </div>
        <button onClick={() => setCreateOpen(true)} aria-label={t("Добавление партии")} className="rounded-md bg-[#5b7ce6] p-2.5 text-white shadow">
          <Plus className="h-6 w-6" />
        </button>
      </header>

      <section className="mx-8 mb-6 overflow-hidden rounded-sm bg-white shadow">
        <div className="grid grid-cols-3">
          {TABS.map(([value, label]) => (
            <button
              key={label}
              onClick={() => { setStatus(value); setPage(1); setExpanded(null) }}
              className={`border-b-4 px-4 py-4 ${status === value ? "border-blue-600 font-semibold" : "border-transparent"}`}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </section>

      <section className="relative mx-8 bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
          <button onClick={() => { setDraft(filters); setFilterOpen((value) => !value) }} className="flex items-center gap-1 text-blue-600">
            {t("Показать фильтр")} {activeFilters > 0 && <span className="rounded-full bg-blue-600 px-1.5 text-xs text-white">{activeFilters}</span>}
            <ChevronDown className="h-4 w-4" />
          </button>
          <label className="relative w-80 max-w-full">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-blue-600" />
            <Search className="absolute right-1 top-2 h-5 w-5 text-slate-400" />
          </label>
          <div className="flex items-center gap-4 text-slate-600">
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="bg-transparent">
              {[10, 25, 50, 100].map((size) => <option key={size}>{size}</option>)}
            </select>
            <span>{first} - {last} {t("из")} {parties.length}</span>
            <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1} aria-label={t("Предыдущая страница")} className="disabled:opacity-30"><ChevronLeft className="h-6 w-6" /></button>
            <button onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage === pageCount} aria-label={t("Следующая страница")} className="disabled:opacity-30"><ChevronRight className="h-6 w-6" /></button>
            <button onClick={exportExcel} aria-label={t("Скачать Excel")} title={t("Скачать Excel")}><Download className="h-6 w-6" /></button>
          </div>
        </div>

        {filterOpen && (
          <form
            onSubmit={(event) => { event.preventDefault(); setFilters(draft); setPage(1); setFilterOpen(false) }}
            className="absolute left-0 top-0 z-30 w-[340px] space-y-4 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold">{t("Фильтр")}</p>
              <button type="button" onClick={() => setFilterOpen(false)} aria-label={t("Закрыть")} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <Field label="Готовый продукт"><ItemPicker items={products} value={draft.madeKey} onChange={(madeKey) => setDraft({ ...draft, madeKey })} placeholder="Готовый продукт" /></Field>
            <Field label="Сырье"><ItemPicker items={catalog} value={draft.rawKey} onChange={(rawKey) => setDraft({ ...draft, rawKey })} placeholder="Сырье" /></Field>
            <Field label="Этап производства">
              <select value={draft.stageId} onChange={(event) => setDraft({ ...draft, stageId: event.target.value })} className={inputClass}>
                <option value="">{t("Все этапы")}</option>
                {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
              </select>
            </Field>
            <DateRange label="Дата завершения" from={draft.finishedFrom} to={draft.finishedTo} onChange={(finishedFrom, finishedTo) => setDraft({ ...draft, finishedFrom, finishedTo })} />
            <DateRange label="Дата партии" from={draft.dateFrom} to={draft.dateTo} onChange={(dateFrom, dateTo) => setDraft({ ...draft, dateFrom, dateTo })} />
            <div className="flex justify-between pt-2">
              <button type="button" onClick={() => { setDraft(EMPTY_FILTERS); setFilters(EMPTY_FILTERS); setPage(1); setFilterOpen(false) }} className="text-sm text-slate-500 hover:text-red-500">{t("Очистить")}</button>
              <button type="submit" className="rounded bg-[#5b7ce6] px-5 py-2 text-sm font-semibold uppercase text-white">{t("Применить")}</button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse">
            <thead className="bg-[#626b7e] text-left text-sm text-white">
              <tr>{HEADERS.map((header) => <th key={header} className="px-6 py-4 font-semibold">{t(header)}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map((party) => (
                <Fragment key={party.id}>
                  {expanded === party.id ? (
                    <tr>
                      <td colSpan={HEADERS.length} className="bg-slate-100 px-0">
                        <BatchDetail partyId={party.id} stages={stages} onChanged={reload} />
                        <button onClick={() => setExpanded(null)} className="mb-2 w-full text-center text-xs text-slate-500 hover:text-blue-600">{t("Свернуть")}</button>
                      </td>
                    </tr>
                  ) : (
                    <tr onClick={() => setExpanded(party.id)} className="cursor-pointer border-b border-dashed border-slate-300 text-sm hover:bg-slate-50">
                      <td className="px-6 py-4">{party.id}</td>
                      <td className="px-6 py-4">{formatDateTime(party.createdAt)}</td>
                      <td className="px-6 py-4">{party.finishedAt ? formatDateTime(party.finishedAt) : ""}</td>
                      <td className="px-6 py-4">{formatDate(party.date)}</td>
                      <td className="px-6 py-4">{party.stageName}</td>
                      <td className="px-6 py-4">{party.userName}</td>
                      <td className="px-6 py-4">
                        <span className={`mr-2 inline-block h-2 w-2 rounded-full ${STATUS_DOT[party.status]}`} />
                        {t(STATUS_LABELS[party.status])}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!visible.length && (
                <tr><td colSpan={HEADERS.length} className="p-16 text-center text-slate-400">{t("По вашему запросу ничего не найдено...")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {createOpen && (
        <CreatePartyDialog
          stages={stages}
          onClose={() => setCreateOpen(false)}
          onCreated={(party) => {
            setCreateOpen(false)
            setStatus("")
            setPage(1)
            setExpanded(party.id)
            reload()
          }}
        />
      )}
    </main>
  )
}

function DateRange({ label, from, to, onChange }: { label: string; from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="date" value={from} onChange={(event) => onChange(event.target.value, to)} className={inputClass} />
        <span className="text-slate-400">—</span>
        <input type="date" value={to} onChange={(event) => onChange(from, event.target.value)} className={inputClass} />
      </div>
    </Field>
  )
}

function CreatePartyDialog({ stages, onClose, onCreated }: { stages: Stage[]; onClose: () => void; onCreated: (party: Party) => void }) {
  const { t } = useLanguage()
  const [stageId, setStageId] = useState("")
  const [date, setDate] = useState(todayIso())
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!stageId) return
    setSaving(true)
    try {
      onCreated(await api<Party>("/api/production/parties", { method: "POST", body: { stageId: Number(stageId), date, comment } }))
    } catch (error) {
      window.alert((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={t("Добавление партии")} onClose={onClose} onSubmit={save} footer={<SaveButton saving={saving} disabled={!stageId} />}>
      <div className="space-y-6">
        <Field label="Этап производства" required>
          <select required value={stageId} onChange={(event) => setStageId(event.target.value)} className={inputClass}>
            <option value="">—</option>
            {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </select>
        </Field>
        {!stages.length && <p className="text-sm text-amber-600">{t("Сначала создайте этап в разделе «Этапы производства».")}</p>}
        <Field label="Дата партии" required>
          <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Комментарий">
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder={t("Комментарий...")} className={inputClass} />
        </Field>
      </div>
    </Modal>
  )
}
