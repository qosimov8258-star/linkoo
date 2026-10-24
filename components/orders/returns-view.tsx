"use client"

import { downloadExcelTable } from "@/lib/excel-export"
import { askDelete } from "@/lib/ask-confirm"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { FilterDate, FilterSelect, FilterText, RI, RefBand, RefButton, RefCard, RefFilterPanel, RefHeader, RefIconButton, RefPage, RefTable, RefTabs, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { useRefRecords } from "@/lib/use-ref-records"

import { toInputDate } from "./add-order-dialog"
import { AddReturnDialog, type ReturnDraft } from "./add-return-dialog"

export type ReturnRow = {
  id: number
  client: string
  zone: string
  warehouse: string
  organization: string
  deliverer: string
  date: string
  acceptedDate?: string | null
  creator: string
  accepted?: boolean
  amount: string
  agent: string
  comment?: string
}

type ReturnItem = { n: number; orderId: number; orderProduct: number; orderDate: string; name: string; unit: string; amount: number; price: number; bonus: boolean }
type ReturnDetail = {
  id: number
  error?: boolean
  order?: number
  financialAccount?: string
  branch?: string
  organization?: string
  payment?: string
  stock?: string
  acceptedTime?: string | null
  finishedTime?: string | null
  acceptedBy?: string
  currency?: string
  items?: ReturnItem[]
  /** Items of a return created here (not in the reference snapshot). */
  localItems?: ReturnItem[]
}

type Tab = "Надо принять" | "Принятые" | "Все"

type Filters = { warehouse: string; deliverer: string; organization: string; creator: string; agent: string; client: string; zone: string; status: string; orderNo: string; begin: string; end: string }
const EMPTY_FILTERS: Filters = { warehouse: "", deliverer: "", organization: "", creator: "", agent: "", client: "", zone: "", status: "", orderNo: "", begin: "", end: "" }

// moment's Russian short months, as the reference prints them ("04 мар. 2026", "17 июля 2026").
const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const MONTH_PREFIX = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function formatMoment(date: Date, withTime = true) {
  const base = `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
  return withTime ? `${base}, ${pad(date.getHours())}:${pad(date.getMinutes())}` : base
}

function formatIso(value?: string | null, withTime = true) {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : formatMoment(date, withTime)
}

/** "17 июля 2026, 08:24" -> "2026-07-17" (the date input of the form). */
function displayToInputDate(text: string) {
  const match = text.trim().toLowerCase().match(/^(\d{1,2})\s+([а-я]+)\.?\s+(\d{4})/)
  if (!match) return undefined
  const month = MONTH_PREFIX.findIndex((prefix) => match[2].startsWith(prefix))
  return month < 0 ? undefined : `${match[3]}-${pad(month + 1)}-${match[1].padStart(2, "0")}`
}

function parseAmount(amount: string): { value: number; currency: string } {
  const match = amount.trim().match(/^([\d\s .,]+)\s*(SUM|USD|Euro|EUR)$/i)
  if (!match) return { value: 0, currency: "SUM" }
  const value = Number(match[1].replace(/[\s ]/g, "").replace(",", ".")) || 0
  const currency = match[2].toUpperCase().startsWith("EUR") ? "Euro" : match[2].toUpperCase() === "USD" ? "USD" : "SUM"
  return { value, currency }
}

function formatNumber(value: number, maxFraction = 3) {
  const [whole, fraction] = value.toFixed(maxFraction).replace(/\.?0+$/, "").split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return fraction ? `${grouped},${fraction}` : grouped
}

export function ReturnsView({ initialId }: { initialId?: number } = {}) {
  const { t } = useLanguage()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { rows, loading, create, update, remove } = useRefRecords<ReturnRow>("return")
  const [tab, setTab] = useState<Tab>("Все")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(initialId ?? null)
  const [addOpen, setAddOpen] = useState(searchParams.get("openCreateDialog") === "true")
  // "Частичный возврат" from an order card opens /analytics/returns?o=<orderId>&openCreateDialog=true: prefill the form from that order.
  const orderParam = searchParams.get("o")
  const [prefill, setPrefill] = useState<Partial<ReturnDraft> | null>(null)
  const [prefillLoading, setPrefillLoading] = useState(Boolean(orderParam))
  useEffect(() => {
    if (!orderParam) return
    let cancelled = false
    void (async () => {
      try {
        const [order, items] = await Promise.all([
          fetch(`/api/orders/${orderParam}`).then((response) => (response.ok ? response.json() : null)),
          fetch(`/api/orders/${orderParam}/items`).then((response) => (response.ok ? response.json() : [])),
        ])
        if (cancelled || !order) return
        const lines = (Array.isArray(items) ? items : []) as { productName: string; quantity: number; returnQuantity?: number; unitPrice: number }[]
        setPrefill({
          mode: "client",
          date: toInputDate(new Date()),
          client: order.client ?? "",
          warehouse: order.stockName ?? "",
          deliverer: order.deliveryMan ?? "",
          agent: order.agent ?? "",
          order: String(order.id),
          items: lines.map((line) => ({ name: line.productName, qty: Math.max(0, line.quantity - (line.returnQuantity ?? 0)), price: line.unitPrice })).filter((line) => line.qty > 0),
        })
      } catch {
        // the form simply opens empty
      } finally {
        if (!cancelled) setPrefillLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orderParam])
  const [editOpen, setEditOpen] = useState(searchParams.get("openUpdateDialog") === "true")
  const [filterOpen, setFilterOpen] = useState(false)
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selectMode, setSelectMode] = useState(searchParams.get("showCheckboxes") === "true")
  const [checked, setChecked] = useState<number[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const options = useMemo(() => {
    const unique = (pick: (row: ReturnRow) => string) => [...new Set(rows.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    return { warehouse: unique((row) => row.warehouse), deliverer: unique((row) => row.deliverer), organization: unique((row) => row.organization), creator: unique((row) => row.creator), agent: unique((row) => row.agent), client: unique((row) => row.client), zone: unique((row) => row.zone) }
  }, [rows])
  const setDraft = (key: keyof Filters) => (value: string) => setDraftFilters((current) => ({ ...current, [key]: value }))
  const visible = useMemo(
    () =>
      rows
        .filter((row) => tab === "Все" || (tab === "Принятые" ? row.accepted : !row.accepted))
        .filter((row) => !filters.warehouse || row.warehouse === filters.warehouse)
        .filter((row) => !filters.deliverer || row.deliverer === filters.deliverer)
        .filter((row) => !filters.organization || row.organization === filters.organization)
        .filter((row) => !filters.creator || row.creator === filters.creator)
        .filter((row) => !filters.agent || row.agent === filters.agent)
        .filter((row) => !filters.client || row.client === filters.client)
        .filter((row) => !filters.zone || row.zone === filters.zone)
        .filter((row) => !filters.status || (filters.status === "Принят" ? row.accepted : !row.accepted))
        .filter((row) => !filters.orderNo || String(row.id).includes(filters.orderNo))
        .filter((row) => {
          const iso = displayToInputDate(row.date)
          return !((filters.begin && iso && iso < filters.begin) || (filters.end && iso && iso > filters.end))
        })
        .filter((row) => `${row.id} ${row.client} ${row.warehouse} ${row.deliverer} ${row.agent}`.toLowerCase().includes(query.toLowerCase())),
    [rows, tab, query, filters],
  )
  const paging = usePaging(visible.length)
  const pageRows = visible.slice(paging.start, paging.end)
  const selected = rows.find((row) => row.id === selectedId) ?? null

  const totals = useMemo(() => {
    const sums: Record<string, number> = { SUM: 0, Euro: 0, USD: 0 }
    for (const row of visible) {
      const { value, currency } = parseAmount(row.amount)
      sums[currency] = (sums[currency] ?? 0) + value
    }
    return sums
  }, [visible])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  function open(id: number | null) {
    setSelectedId(id)
    router.push(id ? `/analytics/returns/${id}${window.location.search}` : `/analytics/returns${window.location.search}`)
  }

  async function submitCreate(draft: ReturnDraft) {
    const created = await create({
      client: draft.client,
      zone: "",
      warehouse: draft.warehouse,
      organization: "",
      deliverer: draft.deliverer,
      date: formatMoment(new Date(`${draft.date}T${pad(new Date().getHours())}:${pad(new Date().getMinutes())}:00`)),
      acceptedDate: null,
      creator: "Admin Ritm",
      accepted: false,
      amount: `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(draft.items?.reduce((sum, item) => sum + item.qty * item.price, 0) ?? 0)} SUM`,
      agent: draft.agent,
      comment: draft.comment,
    } as Omit<ReturnRow, "id">)
    if (created && draft.items?.length) {
      await fetch("/api/ref-records/return-detail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: created.id,
          currency: "SUM",
          stock: draft.warehouse,
          items: draft.items.map((item, index) => ({ n: index + 1, orderId: draft.order ? Number(draft.order) : 0, orderProduct: 0, orderDate: "", name: item.name, unit: "", amount: item.qty, price: item.price, bonus: false })),
        }),
      }).catch(() => {})
    }
    // A return made for a concrete order also goes through the order's return service, so the order totals update.
    if (created && draft.order && draft.items?.length) {
      // Mark the returned quantity on the order lines first (like the card's quick/full return), then register the return document.
      const current = (await fetch(`/api/orders/${draft.order}/items`).then((result) => (result.ok ? result.json() : [])).catch(() => [])) as { id: number; productName: string; unit?: string; quantity: number; unitPrice: number; discountPercent?: number; currency?: string; returnQuantity?: number }[]
      const remaining = new Map<number, number>()
      for (const item of draft.items) {
        let left = item.qty
        for (const line of current.filter((row) => row.productName === item.name)) {
          const room = line.quantity - (line.returnQuantity ?? 0) - (remaining.get(line.id) ?? 0)
          const take = Math.min(room, left)
          if (take > 0) {
            remaining.set(line.id, (remaining.get(line.id) ?? 0) + take)
            left -= take
          }
        }
      }
      await Promise.all(
        current
          .filter((line) => remaining.has(line.id))
          .map((line) =>
            fetch(`/api/orders/${draft.order}/items/${line.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ productName: line.productName, unit: line.unit, quantity: line.quantity, unitPrice: line.unitPrice, discountPercent: line.discountPercent, currency: line.currency, returnQuantity: (line.returnQuantity ?? 0) + (remaining.get(line.id) ?? 0) }),
            }).catch(() => null),
          ),
      )
      const response = await fetch(`/api/orders/${draft.order}/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: draft.comment, lines: draft.items.map((item) => ({ productName: item.name, quantity: item.qty, unitPrice: item.price })) }),
      }).catch(() => null)
      if (response && !response.ok) {
        const error = (await response.json().catch(() => null)) as { error?: string } | null
        setNotice(error?.error ?? t("Не удалось обновить заказ"))
      }
    }
    setAddOpen(false)
    if (created) open(created.id)
  }

  async function submitEdit(draft: ReturnDraft) {
    if (!selected) return
    await update(selected.id, {
      client: draft.client || selected.client,
      warehouse: draft.warehouse || selected.warehouse,
      deliverer: draft.deliverer || selected.deliverer,
      agent: draft.agent,
      comment: draft.comment,
    })
    setEditOpen(false)
  }

  async function accept(ids: number[]) {
    if (!ids.length) {
      setSelectMode(true)
      setNotice(t("Выберите хотя бы один возврат !"))
      return
    }
    const now = formatMoment(new Date())
    await Promise.all(ids.filter((id) => !rows.find((row) => row.id === id)?.accepted).map((id) => update(id, { accepted: true, acceptedDate: now })))
    setChecked([])
  }

  async function cancel(id: number) {
    if (!(await askDelete(`№ ${id}`))) return
    if (await remove(id)) {
      setSelectedId(null)
      router.push("/analytics/returns")
    }
  }

  return (
    <RefPage>
      <RefHeader title={t("Возвраты")}>
        <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => setAddOpen(true)} exact />
      </RefHeader>
      <RefCard>
        <div className="bg-white pb-[2px]"><RefTabs labels={["Надо принять", "Принятые", "Все"]} value={tab} onChange={(value) => { setTab(value as Tab); paging.setPage(1) }} /></div>
        <RefBand compact>
          <span>
            {t("Возвраты")}: {formatNumber(totals.SUM)} SUM , {formatNumber(totals.Euro, 2)} Euro , {formatNumber(totals.USD)} USD
          </span>
        </RefBand>
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <RefFilterPanel onClose={() => setFilterOpen(false)} onApply={() => { setFilters(draftFilters); paging.setPage(1); setFilterOpen(false) }}>
              <div className="grid grid-cols-4 gap-x-[30px] px-5">
                <FilterSelect label={t("Филиалы")} value="" options={[]} onChange={() => {}} />
                <FilterText label={t("№ Заказа")} value={draftFilters.orderNo} onChange={setDraft("orderNo")} />
                <FilterSelect label={t("Продукт")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Бренд")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Доставщик")} value={draftFilters.deliverer} options={options.deliverer} onChange={setDraft("deliverer")} />
                <FilterSelect label={t("Организация")} value={draftFilters.organization} options={options.organization} onChange={setDraft("organization")} />
                <FilterSelect label={t("Тип оплаты (транзакции)")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Статус")} value={draftFilters.status} options={["Ожидает", "Принят"]} onChange={setDraft("status")} />
                <FilterSelect label={t("Тип возврата")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Возврат создал")} value={draftFilters.creator} options={options.creator} onChange={setDraft("creator")} />
                <FilterSelect label={t("Тип оплаты")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Финансовый счет")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Ответственный агент")} value={draftFilters.agent} options={options.agent} onChange={setDraft("agent")} />
                <FilterSelect label={t("Клиент")} value={draftFilters.client} options={options.client} onChange={setDraft("client")} />
                <FilterSelect label={t("Тип клиента")} value="" options={[]} onChange={() => {}} />
                <FilterSelect label={t("Зона")} value={draftFilters.zone} options={options.zone} onChange={setDraft("zone")} />
                <FilterSelect label={t("Склад")} value={draftFilters.warehouse} options={options.warehouse} onChange={setDraft("warehouse")} />
                <FilterSelect label={t("Вид возврата")} value="" options={[]} onChange={() => {}} />
                <FilterText label={t("Код")} value="" onChange={() => {}} />
                <FilterDate label={t("Период создания")} begin={draftFilters.begin} end={draftFilters.end} words onChange={(begin, end) => setDraftFilters((current) => ({ ...current, begin, end }))} />
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
          icons={
            <>
              <span className="-mr-[9px] flex">
                <RefIconButton path={RI.checklist} label={t("Выбрать из списка")} color="#5d6474" active={selectMode} onClick={() => setSelectMode((value) => !value)} />
                <RefIconButton path={RI.download} label={t("Скачать Excel")} color="#333" onClick={() => exportCsv(visible)} />
              </span>
            </>
          }
          extra={<RefButton green label={t("Принять на склад")} onClick={() => void accept(checked)} />}
        />
        <RefTable
          cols="59.3px 241.2px 133.2px 133.2px 154.8px 165.6px 165.6px 165.6px 165.6px"
          heads={[t("№"), t("Клиент"), t("Склад"), t("Доставщик"), t("Дата возврата"), t("Создал"), t("Ответственный агент"), t("Комментарий"), <span key="sum-head" className="block text-right font-semibold">{t("Сумма возврата")}</span>]}
          rows={pageRows}
          hideBody={Boolean(selected)}
          rowKey={(row) => row.id}
          onRowClick={(row) => open(row.id)}
          empty={loading ? "" : t("Ничего не найдено")}
          render={(row) => [
            <span key="id" className="flex items-center gap-2">
              {selectMode && (
                <input
                  type="checkbox"
                  checked={checked.includes(row.id)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => setChecked((current) => (current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]))}
                />
              )}
              {row.id}
            </span>,
            <>{row.client}<br /><span className="text-[#4f71dc]">{row.zone}</span></>,
            <>{row.warehouse}<br /><span className="text-[#4f71dc]">{row.organization}</span></>,
            row.deliverer,
            <>{row.date}<br /><span className="text-[#4f71dc]">{row.acceptedDate ?? ""}</span></>,
            row.creator,
            row.agent,
            row.comment || "-",
            <span key="sum" className="flex items-center justify-between">
              <span className="mr-[15px] block flex-1 text-right">{row.amount}<br /><span className={row.accepted ? "text-[#48a34b]" : "text-[#f0ad4e]"}>{t(row.accepted ? "Принят" : "Ожидает")}</span></span>
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="#4f71dc" strokeWidth="2" /><text x="12" y="17" textAnchor="middle" fontSize="13" fontWeight="700" fill="#4f71dc">$</text></svg>
            </span>,
          ]}
        />
      </RefCard>
      {selected && (
        <Detail
          row={selected}
          onEdit={() => setEditOpen(true)}
          onAccept={() => void accept([selected.id])}
          onDelete={() => void cancel(selected.id)}
          onClose={() => open(null)}
        />
      )}
      {notice && <div className="fixed bottom-6 left-1/2 z-[1500] -translate-x-1/2 rounded-[2px] bg-[#323232] px-6 py-3 text-[14px] text-white shadow-lg">{notice}</div>}
      {addOpen && !prefillLoading && <AddReturnDialog key={prefill ? "prefilled" : "blank"} initial={prefill ?? undefined} onClose={() => { setAddOpen(false); if (pathname) router.replace(pathname) }} onSubmit={(draft) => void submitCreate(draft)} />}
      {editOpen && selected && (
        <AddReturnDialog
          editId={selected.id}
          totalLabel={selected.amount}
          initial={{ mode: "orders", date: displayToInputDate(selected.date), client: selected.client, warehouse: selected.warehouse, deliverer: selected.deliverer, agent: selected.agent, comment: selected.comment ?? "" }}
          onClose={() => setEditOpen(false)}
          onSubmit={(draft) => void submitEdit(draft)}
        />
      )}
    </RefPage>
  )
}

function exportCsv(rows: ReturnRow[]) {
  const head = ["№", "Клиент", "Склад", "Доставщик", "Дата возврата", "Создал", "Ответственный агент", "Комментарий", "Сумма возврата"]
  const body = rows.map((row) => [row.id, row.client, row.warehouse, row.deliverer, row.date, row.creator, row.agent, row.comment ?? "", row.amount])
  downloadExcelTable("Возвраты", [head, ...body])
}

function Detail({ row, onEdit, onAccept, onDelete, onClose }: { row: ReturnRow; onEdit: () => void; onAccept: () => void; onDelete: () => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [detail, setDetail] = useState<ReturnDetail | null>(null)
  const [tab, setTab] = useState<"items" | "series" | "logs" | "photos">("items")

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    void fetch(`/api/ref-records/return-detail/${row.id}`, { cache: "no-store" }).then(async (response) => {
      if (cancelled) return
      setDetail(response.ok ? ((await response.json()) as ReturnDetail) : { id: row.id })
    })
    return () => {
      cancelled = true
    }
  }, [row.id])

  const items = detail?.items ?? []
  const currency = parseAmount(row.amount).currency
  const total = items.reduce((sum, item) => sum + item.amount * item.price, 0)
  const quantity = items.reduce((sum, item) => sum + item.amount, 0)
  const unit = items[0]?.unit ?? ""
  const line = (label: string, value: string, link = false) => (
    <div className="flex justify-between gap-3 py-[2px] leading-[21px]">
      <span className="shrink-0">{label}</span>
      <b className={`text-right ${link ? "text-[#4f71dc]" : ""}`}>{value}</b>
    </div>
  )

  return (
    <section className="-mx-[15px] mt-[20px] bg-white font-sans text-[13px] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
      <div className="flex h-[64px] items-center justify-between border-b border-[#efefef] px-[30px]">
        <h2 className="text-[18px] font-semibold leading-none">{t("Возврат")} №{row.id}</h2>
        <div className="flex items-center gap-[10px]">
          {tab === "series" && (
            <>
              <RefButton icon={RI.edit} label={t("Изменит серии")} exact />
              <RefButton icon={RI.clock} label={t("Авто распределение по сериям")} exact />
            </>
          )}
          <RefButton icon={RI.edit} label={t("Изменить")} onClick={onEdit} exact />
          {!row.accepted && <RefButton icon={RI.checklist} green label={t("Принять на склад")} onClick={onAccept} exact />}
          <span className="flex">
            <RefIconButton path={RI.print} label={t("Распечатать")} color="#5d6474" onClick={() => window.print()} />
            <RefIconButton path={RI.trash} label={t("Удалить")} color="#5d6474" onClick={onDelete} />
          </span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="sr-only">×</button>
        </div>
      </div>
      <div className="grid grid-cols-[347px_minmax(0,1fr)]">
        <aside className="border-r border-[#efefef] px-[30px] py-[16px]">
          {detail?.order ? <div className="py-[2px] font-bold leading-[21px] text-[#4f71dc]">{t("Заказ")} №{detail.order}</div> : null}
          {line(t("Добавил") + ":", row.creator)}
          {line(t("Клиент") + ":", row.client, true)}
          {line(t("Финансовый счет") + ":", detail?.financialAccount || row.client)}
          {line(t("Зона") + ":", row.zone || t("Не указано"))}
          {line(t("Дата возврата") + ":", row.date)}
          {line(t("Доставщик") + ":", row.deliverer)}
          {line(t("Ответственный агент") + ":", row.agent)}
          {line(t("Организация") + ":", detail?.organization || row.organization)}
          {line(t("Филиал") + ":", detail?.branch ?? "")}
          {line(t("Тип оплаты") + ":", detail?.payment ?? "")}
          <hr className="my-[14px] border-[#efefef]" />
          <b className="block pb-[6px] leading-[21px]">{t("СКЛАД")}</b>
          {line(t("Склад") + ":", row.warehouse)}
          {line(t("Начало приемки") + ":", detail?.acceptedTime ? formatIso(detail.acceptedTime) : t("Не установлено"))}
          {line(t("Конец приемки") + ":", detail?.finishedTime ? formatIso(detail.finishedTime) : t("Не установлен"))}
          {line(t("Принял") + ":", detail?.acceptedBy || t("Не принят"))}
          <div className="flex justify-between py-[2px] leading-[21px]">
            <span>{t("Статус")}:</span>
            <b className={row.accepted ? "text-[#48a34b]" : "text-[#f0ad4e]"}>{t(row.accepted ? "Принят" : "Ожидает")}</b>
          </div>
        </aside>
        <div className="min-w-0 px-[30px] pb-[30px]">
          <div className="flex h-[49px] items-end border-b border-[#efefef]">
            {([["items", "Список товаров"], ["series", "Серии"], ["logs", "Логи"], ["photos", "Фотоотчеты"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`h-[41px] min-w-[112px] border-b-[2px] px-[6px] text-center text-[13px] font-medium ${tab === key ? "border-[#4f71dc]" : "border-transparent"}`}>{t(label)}</button>
            ))}
          </div>
          {tab === "items" && (
            <div className="mt-[22px]">
              <div className="grid grid-cols-[91px_90px_165px_180px_180px_181px_180px] border-b border-dotted border-[#c7ced4] pb-[12px] font-medium">
                <span>{t("Заказ")}</span><span>{t("№")}</span><span>{t("Товар")}</span>
                <span className="text-right">{t("Количество")}</span><span className="text-right">{t("Блок")}</span>
                <span className="text-right">{`${t("Цена")} (${currency})`}</span><span className="text-right">{`${t("Сумма")} (${currency})`}</span>
              </div>
              {detail === null ? null : items.length === 0 ? (
                <div className="py-10 text-center text-[#888]">{detail.error ? t("Не удалось загрузить данные возврата") : t("Нет данных")}</div>
              ) : (
                items.map((item) => (
                  <div key={item.n} className="grid grid-cols-[91px_90px_165px_180px_180px_181px_180px] items-center border-b border-dotted border-[#c7ced4] py-[12px]">
                    <span className="font-medium text-[#0a9ddb]">{item.orderId}</span>
                    <span className="flex items-center gap-[10px]">{item.n}</span>
                    <span>
                      <span className="block text-[14px]">{item.name}</span>
                      <span className="block text-[12px]">{t("Заказ")}: {item.orderId} {t("от")} {formatIso(item.orderDate, false)} ({item.orderProduct})</span>
                    </span>
                    <span className="text-right">{formatNumber(item.amount)} {item.unit}</span>
                    <span className="text-right">0</span>
                    <span className="text-right">{formatNumber(item.price)}</span>
                    <span className="text-right">{formatNumber(item.amount * item.price)}</span>
                  </div>
                ))
              )}
              {items.length > 0 && (
                <div className="grid grid-cols-[91px_90px_165px_180px_180px_181px_180px] pt-[16px] font-bold">
                  <span>{t("Итого:")}</span><span /><span />
                  <span className="text-right">{formatNumber(quantity)}{unit}</span><span /><span />
                  <span className="text-right">{formatNumber(total)}</span>
                </div>
              )}
            </div>
          )}
          {tab === "series" || tab === "photos" ? (
            <div className="flex flex-col items-center pt-[40px] text-[#777]">
              <img src="/robot-empty.png" alt="" className="w-[120px]" />
              <p className="mt-[20px]">{t("По вашему запросу ничего не найдено")}</p>
            </div>
          ) : null}
          {tab === "logs" && (
            <div className="mt-[20px] flex items-center justify-between rounded-[6px] bg-[#f4f5f7] px-[20px] py-[14px] text-[12px] shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
              <span className="flex items-center gap-[14px]">
                <span>{t("Возврат")}: <b className="rounded-full border border-[#48a34b] px-[10px] py-[2px] text-[#48a34b]">{t("Создан")}</b></span>
                <span>{t("Статус")}: <b className={row.accepted ? "text-[#48a34b]" : "text-[#f0ad4e]"}>{t(row.accepted ? "Принят" : "Ожидает")}</b></span>
              </span>
              <span className="flex items-center gap-[24px]">
                <span>{t("Кем")}: {row.creator}</span><span>{t("Когда")}: {row.date}</span><span>{t("Сумма")}: {row.amount}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
