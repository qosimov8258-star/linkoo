"use client"

import { useEffect, useMemo, useState } from "react"

import { useSearchParams } from "next/navigation"

import { FilterDate, FilterSelect, RI, RefButton, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefPage, RefTable, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { useRefRecords } from "@/lib/use-ref-records"

// "Интеграция" of the "Продажи" menu: orders that arrived from an external integration and wait to be turned into real
// orders (the reference's #/draft/order).
export type DraftOrder = {
  id: number
  type: string
  serviceId?: string | null
  clientName: string
  clientId: string
  createdAt: string
  delivererName: string
  delivererId: string
  deliveryDate: string
  agentName: string
  agentId: string
  total: string
  comment?: string
}

const MONTH_PREFIX = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

/** "04 сент. 2026" -> "2026-09-04" */
function toIso(text: string) {
  const match = text.trim().toLowerCase().match(/^(\d{1,2})\s+([а-я]+)\.?\s+(\d{4})/)
  if (!match) return ""
  const month = MONTH_PREFIX.findIndex((prefix) => match[2].startsWith(prefix))
  return month < 0 ? "" : `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`
}

type Filters = { deliverer: string; begin: string; end: string; noClient: string; noAgent: string; noDeliverer: string }
const EMPTY: Filters = { deliverer: "", begin: "", end: "", noClient: "", noAgent: "", noDeliverer: "" }
const YES = "Да"
const NO = "Нет"
const names = (rows: unknown) => (Array.isArray(rows) ? (rows as { name?: string }[]).map((row) => row.name ?? "").filter(Boolean) : [])

export function DraftOrdersView() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const { rows, loading } = useRefRecords<DraftOrder>("draft-order")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(searchParams.get("openFilterDialog") === "true")
  const [draft, setDraft] = useState<Filters>(EMPTY)
  const [applied, setApplied] = useState<Filters>(EMPTY)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<number[]>([])
  const [notice, setNotice] = useState("")
  const [lists, setLists] = useState<Record<string, string[]>>({})
  useEffect(() => {
    const load = (key: string, url: string) =>
      fetch(url)
        .then((response) => (response.ok ? response.json() : []))
        .then((data) => setLists((current) => ({ ...current, [key]: names(data) })))
        .catch(() => {})
    void load("product", "/api/products")
    void load("productType", "/api/product-types")
    void load("clientType", "/api/client-types")
    void load("branch", "/api/branches")
    void load("organization", "/api/organizations")
  }, [])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (term && !`${row.serviceId ?? row.id} ${row.clientName} ${row.delivererName} ${row.agentName}`.toLowerCase().includes(term)) return false
      if (applied.deliverer && row.delivererName !== applied.deliverer) return false
      const iso = toIso(row.deliveryDate)
      if (applied.begin && iso && iso < applied.begin) return false
      if (applied.end && iso && iso > applied.end) return false
      if (applied.noClient === YES && row.clientName) return false
      if (applied.noClient === NO && !row.clientName) return false
      if (applied.noAgent === YES && row.agentName) return false
      if (applied.noAgent === NO && !row.agentName) return false
      if (applied.noDeliverer === YES && row.delivererName) return false
      if (applied.noDeliverer === NO && !row.delivererName) return false
      return true
    })
  }, [rows, query, applied])
  const deliverers = useMemo(() => [...new Set(rows.map((row) => row.delivererName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows])
  const paging = usePaging(visible.length)
  const pageRows = visible.slice(paging.start, paging.end)

  const person = (name: string, id: string) => (
    <>
      <b className="font-semibold">{t("Не указано")}</b>
      <br />
      {name} ({id})
    </>
  )

  return (
    <RefPage>
      <RefHeader title={t("Интеграция")}>
        <RefButton icon={RI.chart} label={t("Импортировать")} onClick={() => setNotice(t("Интеграция не подключена: нет новых заказов для импорта"))} />
      </RefHeader>
      {notice && <div className="mb-3 rounded bg-[#e9f8ed] px-4 py-3 text-[13px] text-[#278549]">{notice}</div>}
      <RefCard>
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <RefFilterPanel narrow onClose={() => setFilterOpen(false)} onApply={() => { setApplied(draft); paging.setPage(1); setFilterOpen(false) }}>
              <div>
                <FilterSelect label={t("Доставщик")} value={draft.deliverer} options={deliverers} onChange={(deliverer) => setDraft((current) => ({ ...current, deliverer }))} />
                {([["Товар", "product"], ["Тип товара", "productType"], ["Тип клиента", "clientType"], ["Филиалы", "branch"], ["Организация", "organization"]] as const).map(([label, key]) => (
                  <FilterSelect key={label} label={t(label)} value="" options={lists[key] ?? []} onChange={() => {}} />
                ))}
                <FilterDate label={t("Дата доставки")} begin={draft.begin} end={draft.end} words onChange={(begin, end) => setDraft((current) => ({ ...current, begin, end }))} />
                <FilterSelect label={t("Клиент не указан")} value={draft.noClient} options={[YES, NO]} onChange={(noClient) => setDraft((current) => ({ ...current, noClient }))} />
                <FilterSelect label={t("Агент не указано")} value={draft.noAgent} options={[YES, NO]} onChange={(noAgent) => setDraft((current) => ({ ...current, noAgent }))} />
                <FilterSelect label={t("Доставщик не указано")} value={draft.noDeliverer} options={[YES, NO]} onChange={(noDeliverer) => setDraft((current) => ({ ...current, noDeliverer }))} />
              </div>
            </RefFilterPanel>
          }
          query={query}
          onQuery={(value) => { setQuery(value); paging.setPage(1) }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={visible.length ? paging.start + 1 : 0}
          to={paging.end}
          total={visible.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
          icons={<RefIconButton path={RI.checklist} label={t("Выбрать из списка")} color="#5d6474" active={selectMode} onClick={() => setSelectMode((value) => !value)} />}
        />
        <RefTable
          headPad={24}
          cols="minmax(0,1fr) minmax(0,1fr) minmax(0,2fr) minmax(0,1fr) minmax(0,2fr) minmax(0,2fr) minmax(0,2fr) minmax(0,1fr)"
          heads={[t("№"), t("Тип"), t("Клиент"), t("Дата создания"), t("Доставщик"), t("Дата доставки"), t("Агент"), t("Сумма заказа")]}
          rows={pageRows}
          rowKey={(row) => row.id}
          empty={loading ? "" : t("Ничего не найдено")}
          render={(row) => [
            <span key="id" className="flex items-center gap-2">
              {selectMode && <input type="checkbox" checked={checked.includes(row.id)} onChange={() => setChecked((current) => (current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]))} />}
              {row.serviceId ?? row.id}
            </span>,
            t(row.type),
            person(row.clientName, row.clientId),
            row.createdAt,
            person(row.delivererName, row.delivererId),
            row.deliveryDate,
            person(row.agentName, row.agentId),
            row.total,
          ]}
        />
      </RefCard>
    </RefPage>
  )
}
