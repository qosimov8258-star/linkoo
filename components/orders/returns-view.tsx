"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

import { FilterDate, FilterSelect, FilterText, RI, RefBand, RefButton, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefPage, RefTable, RefTabs, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { askDelete } from "@/lib/ask-confirm"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

import { AddReturnDialog } from "./add-return-dialog"

// Продажи → Возвраты: client returns stored by /api/client-returns. A return
// is created "pending"; "Принять на склад" accepts it — only then the goods
// come back into its warehouse (stock) and the client is credited by its
// amount (client balance). A pending return can be edited or cancelled.

export type ClientReturnItem = { id: number; productId: number | null; productName: string; unit: string; quantity: number; price: number; total: number; orderItemId: number | null }

export type ClientReturnRow = {
  id: number
  clientId: number | null
  client: string
  zone: string
  warehouse: string
  orderId: number | null
  returnDate: string
  status: "pending" | "accepted" | "cancelled"
  currency: string
  amount: number
  comment: string
  deliverer: string
  agent: string
  createdBy: string
  createdAt: string
  acceptedAt: string | null
  acceptedBy: string
  items?: ClientReturnItem[]
  itemCount?: number
}

// Like the reference: three tabs, and the list opens on «Все».
const TABS = ["Надо принять", "Принятые", "Все"] as const
const TAB_QUERY: Record<(typeof TABS)[number], string> = { "Надо принять": "pending", Принятые: "accepted", Все: "all" }
const STATUS_LABEL: Record<ClientReturnRow["status"], string> = { pending: "Ожидает", accepted: "Принят", cancelled: "Отменен" }
const STATUS_COLOR: Record<ClientReturnRow["status"], string> = { pending: "text-[#f0ad4e]", accepted: "text-[#48a34b]", cancelled: "text-[#e57373]" }
// moment's Russian short months, as the reference prints them ("04 мар. 2026", "17 июля 2026").
const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

type Filters = { warehouse: string; deliverer: string; creator: string; agent: string; client: string; zone: string; status: string; orderNo: string; begin: string; end: string }
const EMPTY_FILTERS: Filters = { warehouse: "", deliverer: "", creator: "", agent: "", client: "", zone: "", status: "", orderNo: "", begin: "", end: "" }

function displayDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "")
  return match ? `${match[3]} ${SHORT_MONTHS[Number(match[2]) - 1] ?? ""} ${match[1]}` : value
}

function displayMoment(value: string | null) {
  if (!value) return ""
  const date = new Date(/[zZ]$/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return value
  return `${String(date.getDate()).padStart(2, "0")} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function money(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

function formatNumber(value: number, maxFraction = 3) {
  const [whole, fraction] = value.toFixed(maxFraction).replace(/\.?0+$/, "").split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return fraction ? `${grouped},${fraction}` : grouped
}

async function call<T>(url: string, init?: { method?: string; body?: unknown }): Promise<{ ok: true; body: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
    if (!response.ok || body === null) return { ok: false, error: body?.error ?? "Не удалось сохранить изменения на сервере" }
    return { ok: true, body }
  } catch {
    return { ok: false, error: "Не удалось сохранить изменения на сервере" }
  }
}

export function ReturnsView({ initialId }: { initialId?: number } = {}) {
  const { t } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  const warehouses = useDirectoryNames("warehouses")
  const [rows, setRows] = useState<ClientReturnRow[]>([])
  const [totals, setTotals] = useState<Array<{ currency: string; amount: number }>>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<(typeof TABS)[number]>("Все")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(initialId ?? null)
  const [addOpen, setAddOpen] = useState(false)
  const [initialOrderId, setInitialOrderId] = useState<number | undefined>()
  const [filterOpen, setFilterOpen] = useState(false)
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<number[]>([])
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ tab: TAB_QUERY[tab] })
    if (filters.warehouse) params.set("warehouse", filters.warehouse)
    const result = await call<{ rows: ClientReturnRow[]; totals: Array<{ currency: string; amount: number }> }>(`/api/client-returns?${params}`)
    if (result.ok) {
      setRows(result.body.rows)
      setTotals(result.body.totals)
    } else {
      setNotice({ tone: "error", text: t(result.error) })
    }
    setLoading(false)
  }, [tab, filters.warehouse, t])

  useEffect(() => {
    void load()
  }, [load])

  // Deep links: ?o=<order>&openCreateDialog=true (from an order card), ?r=<return>, /analytics/returns/<id>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const order = Number(params.get("o"))
    if (params.get("openCreateDialog") === "true") {
      setInitialOrderId(Number.isInteger(order) && order > 0 ? order : undefined)
      setAddOpen(true)
    }
    const ret = Number(params.get("r"))
    if (Number.isInteger(ret) && ret > 0) {
      setTab("Все")
      setSelectedId(ret)
    }
  }, [])

  const options = useMemo(() => {
    const unique = (pick: (row: ClientReturnRow) => string) => [...new Set(rows.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    return { deliverer: unique((row) => row.deliverer), creator: unique((row) => row.createdBy), agent: unique((row) => row.agent), client: unique((row) => row.client), zone: unique((row) => row.zone) }
  }, [rows])
  const setDraft = (key: keyof Filters) => (value: string) => setDraftFilters((current) => ({ ...current, [key]: value }))

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return rows
      .filter((row) => !filters.deliverer || row.deliverer === filters.deliverer)
      .filter((row) => !filters.creator || row.createdBy === filters.creator)
      .filter((row) => !filters.agent || row.agent === filters.agent)
      .filter((row) => !filters.client || row.client === filters.client)
      .filter((row) => !filters.zone || row.zone === filters.zone)
      .filter((row) => !filters.status || t(STATUS_LABEL[row.status]) === filters.status)
      .filter((row) => !filters.orderNo || String(row.orderId ?? "").includes(filters.orderNo))
      .filter((row) => !((filters.begin && row.returnDate < filters.begin) || (filters.end && row.returnDate > filters.end)))
      .filter((row) => !term || `${row.id} ${row.client} ${row.warehouse} ${row.deliverer} ${row.agent} ${row.orderId ?? ""} ${row.comment}`.toLowerCase().includes(term))
  }, [rows, query, filters, t])
  const paging = usePaging(visible.length)
  const pageRows = visible.slice(paging.start, paging.end)

  // The band lists SUM / Euro / USD like the reference; any other currency follows.
  const bandTotals = useMemo(() => {
    const sums = new Map<string, number>([["SUM", 0], ["Euro", 0], ["USD", 0]])
    for (const entry of totals) {
      const code = /^eur/i.test(entry.currency) ? "Euro" : entry.currency
      sums.set(code, (sums.get(code) ?? 0) + entry.amount)
    }
    return [...sums]
  }, [totals])

  function flash(tone: "ok" | "error", text: string) {
    setNotice({ tone, text })
    window.setTimeout(() => setNotice(null), 4000)
  }

  function open(id: number | null) {
    setSelectedId(id)
    router.push(id ? `/analytics/returns/${id}${window.location.search}` : `/analytics/returns${window.location.search}`)
  }

  async function acceptIds(ids: number[]) {
    if (!ids.length) {
      setSelectMode(true)
      flash("error", t("Выберите хотя бы один возврат !"))
      return
    }
    const result = await call<ClientReturnRow[]>("/api/client-returns/accept", { method: "POST", body: { ids } })
    if (!result.ok) return flash("error", t(result.error))
    setChecked([])
    flash("ok", `${t("Принято на склад")}: ${result.body.length}`)
    await load()
  }

  function exportRows() {
    downloadExcelTable("Возвраты", [
      [t("№"), t("Клиент"), t("Склад"), t("Заказ"), t("Дата возврата"), t("Статус"), t("Сумма возврата"), t("Валюта"), t("Комментарий")],
      ...visible.map((row) => [String(row.id), row.client, row.warehouse, row.orderId ? String(row.orderId) : "", row.returnDate, t(STATUS_LABEL[row.status]), String(row.amount), row.currency, row.comment]),
    ])
  }

  return (
    <RefPage>
      <RefHeader title={t("Возвраты")}>
        <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => (setInitialOrderId(undefined), setAddOpen(true))} exact />
      </RefHeader>
      <RefCard>
        <div className="bg-white pb-[2px]">
          <RefTabs
            labels={[...TABS]}
            value={tab}
            onChange={(value) => {
              setTab(value as (typeof TABS)[number])
              setChecked([])
              paging.setPage(1)
            }}
          />
        </div>
        <RefBand compact>
          <span>
            {t("Возвраты")}: {bandTotals.map(([code, amount]) => `${formatNumber(amount, code === "Euro" ? 2 : 3)} ${code}`).join(" , ")}
          </span>
        </RefBand>
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <RefFilterPanel
              onClose={() => setFilterOpen(false)}
              onApply={() => {
                setFilters(draftFilters)
                paging.setPage(1)
                setFilterOpen(false)
              }}
            >
              <div className="grid grid-cols-4 gap-x-[30px] px-5">
                <FilterSelect label={t("Филиалы")} value="" options={[]} onChange={() => {}} />
                <FilterText label={t("№ Заказа")} value={draftFilters.orderNo} onChange={setDraft("orderNo")} />
                <FilterSelect label={t("Продукт")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Бренд")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Доставщик")} value={draftFilters.deliverer} options={options.deliverer} onChange={setDraft("deliverer")} />
                <FilterSelect label={t("Организация")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Тип оплаты (транзакции)")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Статус")} value={draftFilters.status} options={Object.values(STATUS_LABEL).map((label) => t(label))} onChange={setDraft("status")} />
                <FilterSelect label={t("Тип возврата")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Возврат создал")} value={draftFilters.creator} options={options.creator} onChange={setDraft("creator")} />
                <FilterSelect label={t("Тип оплаты")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Финансовый счет")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Ответственный агент")} value={draftFilters.agent} options={options.agent} onChange={setDraft("agent")} />
                <FilterSelect label={t("Клиент")} value={draftFilters.client} options={options.client} onChange={setDraft("client")} />
                <FilterSelect label={t("Тип клиента")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Зона")} value={draftFilters.zone} options={options.zone} onChange={setDraft("zone")} />
                <FilterSelect label={t("Склад")} value={draftFilters.warehouse} options={warehouses} onChange={setDraft("warehouse")} />
                <FilterSelect label={t("Вид возврата")} value="" options={[]} onChange={() => {}} />
                <FilterText label={t("Код")} value="" onChange={() => {}} />
                <FilterDate label={t("Период создания")} begin={draftFilters.begin} end={draftFilters.end} words onChange={(begin, end) => setDraftFilters((current) => ({ ...current, begin, end }))} />
              </div>
            </RefFilterPanel>
          }
          query={query}
          onQuery={(value) => {
            setQuery(value)
            paging.setPage(1)
          }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={visible.length ? paging.start + 1 : 0}
          to={paging.end}
          total={visible.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
          icons={
            <span className="-mr-[9px] flex">
              <RefIconButton path={RI.checklist} label={t("Выбрать из списка")} color="#5d6474" active={selectMode} onClick={() => setSelectMode((value) => !value)} />
              <RefIconButton path={RI.download} label={t("Скачать Excel")} color="#333" onClick={exportRows} />
            </span>
          }
          extra={<RefButton green label={t("Принять на склад")} onClick={() => void acceptIds(checked.length ? checked : selectedId && rows.find((row) => row.id === selectedId)?.status === "pending" ? [selectedId] : [])} />}
        />
        <RefTable
          cols="59.3px 241.2px 133.2px 133.2px 154.8px 165.6px 165.6px 165.6px 165.6px"
          heads={[t("№"), t("Клиент"), t("Склад"), t("Доставщик"), t("Дата возврата"), t("Создал"), t("Ответственный агент"), t("Комментарий"), <span key="sum-head" className="block text-right font-semibold">{t("Сумма возврата")}</span>]}
          rows={pageRows}
          hideBody={selectedId !== null}
          rowKey={(row) => row.id}
          onRowClick={(row) => open(row.id)}
          empty={loading ? "" : t("Ничего не найдено")}
          render={(row) => [
            <span key="id" className="flex items-center gap-2">
              {selectMode && row.status === "pending" && (
                <input
                  type="checkbox"
                  checked={checked.includes(row.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => setChecked((current) => (current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]))}
                />
              )}
              {row.id}
            </span>,
            <>
              {row.client}
              <br />
              <span className="text-[#4f71dc]">{row.zone}</span>
            </>,
            <>
              {row.warehouse || t("Не указан")}
              <br />
              <span className="text-[#4f71dc]">{row.orderId ? `${t("Заказ №")}${row.orderId}` : ""}</span>
            </>,
            row.deliverer || t("Не указано"),
            <>
              {displayDay(row.returnDate)}
              <br />
              <span className="text-[#4f71dc]">{displayMoment(row.acceptedAt)}</span>
            </>,
            row.createdBy || "—",
            row.agent || t("Не указано"),
            row.comment || "-",
            <span key="sum" className="flex items-center justify-between">
              <span className="mr-[15px] block flex-1 text-right">
                {money(row.amount)} {row.currency}
                <br />
                <span className={STATUS_COLOR[row.status]}>{t(STATUS_LABEL[row.status])}</span>
              </span>
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="#4f71dc" strokeWidth="2" /><text x="12" y="17" textAnchor="middle" fontSize="13" fontWeight="700" fill="#4f71dc">$</text></svg>
            </span>,
          ]}
        />
      </RefCard>
      {selectedId !== null && (
        <Detail
          id={selectedId}
          warehouses={warehouses}
          close={() => open(null)}
          onChanged={(message) => {
            if (message) flash("ok", message)
            void load()
          }}
          onError={(message) => flash("error", message)}
        />
      )}
      {notice && <div className={`fixed bottom-6 left-1/2 z-[1500] -translate-x-1/2 rounded-[2px] px-6 py-3 text-[14px] text-white shadow-lg ${notice.tone === "error" ? "bg-[#c62828]" : "bg-[#323232]"}`}>{notice.text}</div>}
      {addOpen && (
        <AddReturnDialog
          initialOrderId={initialOrderId}
          onClose={() => {
            setAddOpen(false)
            if (pathname) router.replace(pathname)
          }}
          onCreated={(created) => {
            setAddOpen(false)
            flash("ok", `${t("Возврат оформлен")}: №${created.id}`)
            setTab(created.status === "accepted" ? "Принятые" : "Надо принять")
            setSelectedId(created.id)
            void load()
          }}
        />
      )}
    </RefPage>
  )
}

function Detail({
  id,
  warehouses,
  close,
  onChanged,
  onError,
}: {
  id: number
  warehouses: string[]
  close: () => void
  onChanged: (message?: string) => void
  onError: (message: string) => void
}) {
  const { t } = useLanguage()
  const [row, setRow] = useState<ClientReturnRow | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [edit, setEdit] = useState({ warehouse: "", returnDate: "", comment: "" })
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<"items" | "series" | "logs" | "photos">("items")

  const load = useCallback(async () => {
    const result = await call<ClientReturnRow>(`/api/client-returns/${id}`)
    if (result.ok) setRow(result.body)
    else onError(t(result.error))
  }, [id, onError, t])

  useEffect(() => {
    void load()
  }, [load])

  if (!row) return null
  const pending = row.status === "pending"
  const items = row.items ?? []
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0)
  const unit = items[0]?.unit ?? ""
  const line = (label: string, value: string, link = false) => (
    <div className="flex justify-between gap-3 py-[2px] leading-[21px]">
      <span className="shrink-0">{label}</span>
      <b className={`text-right ${link ? "text-[#4f71dc]" : ""}`}>{value}</b>
    </div>
  )

  async function act(path: "accept" | "cancel", message: string) {
    setBusy(true)
    const result = await call<ClientReturnRow>(`/api/client-returns/${id}/${path}`, { method: "POST" })
    setBusy(false)
    if (!result.ok) return onError(t(result.error))
    setRow({ ...result.body })
    onChanged(message)
  }

  async function saveEdit() {
    setBusy(true)
    const result = await call<ClientReturnRow>(`/api/client-returns/${id}`, { method: "PUT", body: edit })
    setBusy(false)
    if (!result.ok) return onError(t(result.error))
    setRow(result.body)
    setEditOpen(false)
    onChanged(t("Изменения сохранены"))
  }

  async function cancelReturn() {
    if (!(await askDelete(`№ ${id}`))) return
    await act("cancel", t("Возврат отменен"))
  }

  return (
    <section className="-mx-[15px] mt-[20px] bg-white font-sans text-[13px] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
      <div className="flex h-[64px] items-center justify-between border-b border-[#efefef] px-[30px]">
        <h2 className="text-[18px] font-semibold leading-none">
          {t("Возврат")} №{row.id}
        </h2>
        <div className="flex items-center gap-[10px]">
          {tab === "series" && (
            <>
              <RefButton icon={RI.edit} label={t("Изменит серии")} exact />
              <RefButton icon={RI.clock} label={t("Авто распределение по сериям")} exact />
            </>
          )}
          {pending && (
            <RefButton
              icon={RI.edit}
              label={t("Изменить")}
              disabled={busy}
              onClick={() => {
                setEdit({ warehouse: row.warehouse, returnDate: row.returnDate, comment: row.comment })
                setEditOpen(true)
              }}
              exact
            />
          )}
          {pending && <RefButton icon={RI.checklist} green label={t("Принять на склад")} disabled={busy} onClick={() => void act("accept", t("Принято на склад"))} exact />}
          <span className="flex">
            <RefIconButton path={RI.print} label={t("Распечатать")} color="#5d6474" onClick={() => window.print()} />
            {pending && <RefIconButton path={RI.trash} label={t("Отменить запрос")} color="#5d6474" onClick={() => void cancelReturn()} />}
          </span>
          <button type="button" onClick={close} aria-label={t("Закрыть")} className="sr-only">
            ×
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[347px_minmax(0,1fr)]">
        <aside className="border-r border-[#efefef] px-[30px] py-[16px]">
          {row.orderId ? <div className="py-[2px] font-bold leading-[21px] text-[#4f71dc]">{t("Заказ")} №{row.orderId}</div> : null}
          {line(t("Добавил") + ":", row.createdBy || "—")}
          {line(t("Клиент") + ":", row.client, true)}
          {line(t("Зона") + ":", row.zone || t("Не указано"))}
          {line(t("Дата возврата") + ":", displayDay(row.returnDate))}
          {line(t("Доставщик") + ":", row.deliverer || t("Не указано"))}
          {line(t("Ответственный агент") + ":", row.agent || t("Не указано"))}
          {line(t("Комментарий") + ":", row.comment || "—")}
          <hr className="my-[14px] border-[#efefef]" />
          <b className="block pb-[6px] leading-[21px]">{t("СКЛАД")}</b>
          {line(t("Склад") + ":", row.warehouse || t("Не указан"))}
          {line(t("Принял") + ":", row.acceptedAt ? `${row.acceptedBy || "—"}, ${displayMoment(row.acceptedAt)}` : t("Не принят"))}
          <div className="flex justify-between py-[2px] leading-[21px]">
            <span>{t("Статус")}:</span>
            <b className={STATUS_COLOR[row.status]}>{t(STATUS_LABEL[row.status])}</b>
          </div>
        </aside>
        <div className="min-w-0 px-[30px] pb-[30px]">
          <div className="flex h-[49px] items-end border-b border-[#efefef]">
            {([["items", "Список товаров"], ["series", "Серии"], ["logs", "Логи"], ["photos", "Фотоотчеты"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`h-[41px] min-w-[112px] border-b-[2px] px-[6px] text-center text-[13px] font-medium ${tab === key ? "border-[#4f71dc]" : "border-transparent"}`}>
                {t(label)}
              </button>
            ))}
          </div>
          {tab === "items" && (
            <div className="mt-[22px]">
              <div className="grid grid-cols-[91px_90px_165px_180px_180px_181px_180px] border-b border-dotted border-[#c7ced4] pb-[12px] font-medium">
                <span>{t("Заказ")}</span>
                <span>{t("№")}</span>
                <span>{t("Товар")}</span>
                <span className="text-right">{t("Количество")}</span>
                <span className="text-right">{t("Блок")}</span>
                <span className="text-right">{`${t("Цена")} (${row.currency})`}</span>
                <span className="text-right">{`${t("Сумма")} (${row.currency})`}</span>
              </div>
              {items.length === 0 ? (
                <div className="py-10 text-center text-[#888]">{t("Нет данных")}</div>
              ) : (
                items.map((item, index) => (
                  <div key={item.id} className="grid grid-cols-[91px_90px_165px_180px_180px_181px_180px] items-center border-b border-dotted border-[#c7ced4] py-[12px]">
                    <span className="font-medium text-[#0a9ddb]">{row.orderId ?? ""}</span>
                    <span className="flex items-center gap-[10px]">{index + 1}</span>
                    <span className="block text-[14px]">{item.productName}</span>
                    <span className="text-right">
                      {formatNumber(item.quantity)} {item.unit}
                    </span>
                    <span className="text-right">0</span>
                    <span className="text-right">{formatNumber(item.price)}</span>
                    <span className="text-right">{formatNumber(item.total)}</span>
                  </div>
                ))
              )}
              {items.length > 0 && (
                <div className="grid grid-cols-[91px_90px_165px_180px_180px_181px_180px] pt-[16px] font-bold">
                  <span>{t("Итого:")}</span>
                  <span />
                  <span />
                  <span className="text-right">
                    {formatNumber(quantity)}
                    {unit}
                  </span>
                  <span />
                  <span />
                  <span className="text-right">{formatNumber(row.amount)}</span>
                </div>
              )}
            </div>
          )}
          {tab === "series" || tab === "photos" ? (
            <div className="flex flex-col items-center pt-[40px] text-[#777]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/robot-empty.png" alt="" className="w-[120px]" />
              <p className="mt-[20px]">{t("По вашему запросу ничего не найдено")}</p>
            </div>
          ) : null}
          {tab === "logs" && (
            <div className="mt-[20px] flex items-center justify-between rounded-[6px] bg-[#f4f5f7] px-[20px] py-[14px] text-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
              <span className="flex items-center gap-[14px]">
                <span>
                  {t("Возврат")}: <b className="rounded-full border border-[#48a34b] px-[10px] py-[2px] text-[#48a34b]">{t("Создан")}</b>
                </span>
                <span>
                  {t("Статус")}: <b className={STATUS_COLOR[row.status]}>{t(STATUS_LABEL[row.status])}</b>
                </span>
              </span>
              <span className="flex items-center gap-[24px]">
                <span>
                  {t("Кем")}: {row.createdBy || "—"}
                </span>
                <span>
                  {t("Когда")}: {displayMoment(row.createdAt)}
                </span>
                <span>
                  {t("Сумма")}: {money(row.amount)} {row.currency}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void saveEdit()
            }}
            className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">{t("Изменить возврат")}</h3>
              <button type="button" onClick={() => setEditOpen(false)} aria-label={t("Закрыть")}>
                ×
              </button>
            </div>
            <label className="mb-4 block text-[13px] font-medium text-slate-500">
              {t("Склад")}
              <select value={edit.warehouse} onChange={(event) => setEdit({ ...edit, warehouse: event.target.value })} className="mt-1 block w-full border-b border-slate-200 bg-transparent py-1 text-[15px] font-semibold text-slate-900 outline-none">
                {(edit.warehouse && !warehouses.includes(edit.warehouse) ? [edit.warehouse, ...warehouses] : warehouses).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="mb-4 block text-[13px] font-medium text-slate-500">
              {t("Дата возврата")}
              <input type="date" value={edit.returnDate} onChange={(event) => setEdit({ ...edit, returnDate: event.target.value })} className="mt-1 block w-full border-b border-slate-200 bg-transparent py-1 text-[15px] font-semibold text-slate-900 outline-none" />
            </label>
            <label className="mb-5 block text-[13px] font-medium text-slate-500">
              {t("Комментарий")}
              <input value={edit.comment} onChange={(event) => setEdit({ ...edit, comment: event.target.value })} className="mt-1 block w-full border-b border-slate-200 bg-transparent py-1 text-[15px] font-semibold text-slate-900 outline-none" />
            </label>
            <button type="submit" disabled={busy} className="w-full rounded-md bg-[#4f71dc] py-3 font-semibold text-white disabled:opacity-50">
              {t("Сохранить")}
            </button>
          </form>
        </div>
      )}
    </section>
  )
}
