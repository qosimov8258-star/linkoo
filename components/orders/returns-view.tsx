"use client"

import { X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { RI, RefBand, RefButton, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefTabs, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { useDirectoryNames } from "@/components/clients/use-directory"
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

const TABS = ["Надо принять", "Принятые", "Отмененные", "Все"] as const
const TAB_QUERY: Record<(typeof TABS)[number], string> = { "Надо принять": "pending", Принятые: "accepted", Отмененные: "cancelled", Все: "all" }
const STATUS_LABEL: Record<ClientReturnRow["status"], string> = { pending: "Ожидает", accepted: "Принят", cancelled: "Отменен" }
const STATUS_COLOR: Record<ClientReturnRow["status"], string> = { pending: "text-[#f0ad4e]", accepted: "text-[#48a34b]", cancelled: "text-[#e57373]" }
const SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]

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

export function ReturnsView() {
  const { t } = useLanguage()
  const warehouses = useDirectoryNames("warehouses")
  const [rows, setRows] = useState<ClientReturnRow[]>([])
  const [totals, setTotals] = useState<Array<{ currency: string; amount: number }>>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<(typeof TABS)[number]>("Надо принять")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [initialOrderId, setInitialOrderId] = useState<number | undefined>()
  const [filterOpen, setFilterOpen] = useState(false)
  const [warehouseFilter, setWarehouseFilter] = useState("")
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<number[]>([])
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ tab: TAB_QUERY[tab] })
    if (warehouseFilter) params.set("warehouse", warehouseFilter)
    const result = await call<{ rows: ClientReturnRow[]; totals: Array<{ currency: string; amount: number }> }>(`/api/client-returns?${params}`)
    if (result.ok) {
      setRows(result.body.rows)
      setTotals(result.body.totals)
    } else {
      setNotice({ tone: "error", text: t(result.error) })
    }
    setLoading(false)
  }, [tab, warehouseFilter, t])

  useEffect(() => {
    void load()
  }, [load])

  // Deep links: ?o=<order>&openCreateDialog=true (from an order card), ?r=<return>.
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

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return rows.filter((row) => !term || `${row.id} ${row.client} ${row.orderId ?? ""} ${row.comment}`.toLowerCase().includes(term))
  }, [rows, query])
  const paging = usePaging(visible.length)
  const pageRows = visible.slice(paging.start, paging.end)

  function flash(tone: "ok" | "error", text: string) {
    setNotice({ tone, text })
    window.setTimeout(() => setNotice(null), 4000)
  }

  async function acceptIds(ids: number[]) {
    if (!ids.length) {
      setSelectMode(true)
      flash("error", t("Отметьте возвраты в таблице"))
      return
    }
    const result = await call<ClientReturnRow[]>("/api/client-returns/accept", { method: "POST", body: { ids } })
    if (!result.ok) return flash("error", t(result.error))
    setChecked([])
    flash("ok", `${t("Принято на склад")}: ${result.body.length}`)
    await load()
  }

  function exportRows() {
    downloadExcelTable("client-returns", [
      [t("№"), t("Клиент"), t("Склад"), t("Заказ"), t("Дата возврата"), t("Статус"), t("Сумма возврата"), t("Валюта"), t("Комментарий")],
      ...visible.map((row) => [String(row.id), row.client, row.warehouse, row.orderId ? String(row.orderId) : "", row.returnDate, t(STATUS_LABEL[row.status]), String(row.amount), row.currency, row.comment]),
    ])
  }

  return (
    <RefPage>
      <RefHeader title={t("Возвраты")}>
        <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => (setInitialOrderId(undefined), setAddOpen(true))} />
      </RefHeader>
      {notice && (
        <div className={`mb-3 flex items-center justify-between rounded px-4 py-3 text-sm ${notice.tone === "ok" ? "bg-[#e9f8ed] text-[#278549]" : "bg-[#fdecea] text-[#c62828]"}`}>
          {notice.text}
          <button type="button" onClick={() => setNotice(null)} aria-label={t("Закрыть уведомление")}>
            <X size={18} />
          </button>
        </div>
      )}
      <RefCard>
        <RefTabs
          labels={[...TABS]}
          value={tab}
          onChange={(value) => {
            setTab(value as (typeof TABS)[number])
            setChecked([])
            paging.setPage(1)
          }}
        />
        <RefBand>
          <span>
            {t("Возвраты")}: {totals.length ? totals.map((entry) => `${money(entry.amount)} ${entry.currency}`).join(" , ") : "0"}
          </span>
        </RefBand>
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <div className="w-64 border border-slate-200 bg-white p-4 shadow-xl">
              <label className="block text-[10px] font-bold">
                {t("Склад")}
                <select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} className="mt-1 block w-full border-b border-[#e0e0e0] bg-white py-2 text-[13px] outline-none">
                  <option value="">{t("Все склады")}</option>
                  {warehouses.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => setFilterOpen(false)} className="mt-4 h-[30px] w-full rounded-[5px] bg-[#4f71dc] text-[13px] font-semibold text-white">
                {t("Применить")}
              </button>
            </div>
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
            <>
              <RefIconButton path={RI.checklist} label={t("Выбрать")} color="#5d6474" active={selectMode} onClick={() => setSelectMode((value) => !value)} />
              <RefIconButton path={RI.download} label={t("Экспортировать")} onClick={exportRows} />
            </>
          }
          extra={<RefButton green label={t("Принять на склад")} onClick={() => acceptIds(checked.length ? checked : selectedId && rows.find((row) => row.id === selectedId)?.status === "pending" ? [selectedId] : [])} />}
        />
        <RefTable
          cols="minmax(0,50fr) minmax(0,170fr) minmax(0,150fr) minmax(0,110fr) minmax(0,145fr) minmax(0,90fr) minmax(0,130fr) minmax(0,100fr) minmax(0,125fr)"
          heads={[t("№"), t("Клиент"), t("Склад"), t("Доставщик"), t("Дата возврата"), t("Создал"), t("Ответственный агент"), t("Комментарий"), t("Сумма возврата")]}
          rows={pageRows}
          rowKey={(row) => row.id}
          onRowClick={(row) => setSelectedId(selectedId === row.id ? null : row.id)}
          rowClass={(row) => (selectedId === row.id ? "bg-[#e8efff]" : "")}
          empty={loading ? t("Загрузка...") : t("Ничего не найдено")}
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
            <span key="sum" className="block text-right">
              {money(row.amount)} {row.currency}
              <br />
              <span className={STATUS_COLOR[row.status]}>{t(STATUS_LABEL[row.status])}</span>
            </span>,
          ]}
        />
      </RefCard>
      {selectedId !== null && (
        <Detail
          id={selectedId}
          warehouses={warehouses}
          close={() => setSelectedId(null)}
          onChanged={(message) => {
            if (message) flash("ok", message)
            void load()
          }}
          onError={(message) => flash("error", message)}
        />
      )}
      {addOpen && (
        <AddReturnDialog
          initialOrderId={initialOrderId}
          onClose={() => setAddOpen(false)}
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

  return (
    <section className="mt-5 bg-white font-sans text-[13px] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
      <div className="flex h-[65px] items-center justify-between border-b border-[#efefef] px-[30px]">
        <h2 className="text-[18px] font-semibold">
          {t("Возврат №")}
          {row.id}
        </h2>
        <div className="flex gap-3">
          {pending && (
            <>
              <RefButton green label={t("Принять на склад")} disabled={busy} onClick={() => act("accept", t("Принято на склад"))} />
              <RefButton
                label={`✎　${t("Изменить")}`}
                disabled={busy}
                onClick={() => {
                  setEdit({ warehouse: row.warehouse, returnDate: row.returnDate, comment: row.comment })
                  setEditOpen(true)
                }}
              />
              <RefButton red label={`⊖　${t("Отменить запрос")}`} disabled={busy} onClick={() => act("cancel", t("Возврат отменен"))} />
            </>
          )}
          <button type="button" onClick={close} aria-label={t("Закрыть")}>
            <X />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[435px_1fr]">
        <aside className="border-r border-[#efefef] p-[30px] leading-[25px]">
          {t("Добавил")}: <b className="float-right">{row.createdBy || "—"}</b>
          <br />
          {t("Клиент")}: <b className="float-right text-[#4f71dc]">{row.client}</b>
          <br />
          {t("Зона")}: <b className="float-right">{row.zone || t("Не указано")}</b>
          <br />
          {t("Заказ")}: <b className="float-right">{row.orderId ? `№${row.orderId}` : t("Не указан")}</b>
          <br />
          {t("Дата возврата")}: <b className="float-right">{displayDay(row.returnDate)}</b>
          <br />
          {t("Доставщик")}: <b className="float-right">{row.deliverer || t("Не указано")}</b>
          <br />
          {t("Ответственный агент")}: <b className="float-right">{row.agent || t("Не указано")}</b>
          <br />
          {t("Комментарий")}: <b className="float-right">{row.comment || "—"}</b>
          <hr className="my-5" />
          <b>{t("СКЛАД")}</b>
          <br />
          {t("Склад")}: <b className="float-right">{row.warehouse || t("Не указан")}</b>
          <br />
          {t("Статус")}: <b className={`float-right ${STATUS_COLOR[row.status]}`}>{t(STATUS_LABEL[row.status])}</b>
          <br />
          {row.acceptedAt && (
            <>
              {t("Принял")}: <b className="float-right">{`${row.acceptedBy || "—"}, ${displayMoment(row.acceptedAt)}`}</b>
            </>
          )}
        </aside>
        <div className="p-[30px]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dotted">
                <th className="p-3 text-left">№</th>
                <th className="text-left">{t("Товар")}</th>
                <th>{t("Количество")}</th>
                <th>{`${t("Цена")} (${row.currency})`}</th>
                <th>{`${t("Сумма")} (${row.currency})`}</th>
              </tr>
            </thead>
            <tbody>
              {(row.items ?? []).map((item, index) => (
                <tr key={item.id} className="border-b border-dotted border-[#eee]">
                  <td className="p-3">{index + 1}</td>
                  <td>{item.productName}</td>
                  <td className="text-center">
                    {money(item.quantity)} {item.unit}
                  </td>
                  <td className="text-center">{money(item.price)}</td>
                  <td className="text-center">{money(item.total)}</td>
                </tr>
              ))}
              <tr className="border-t">
                <td className="p-4 font-bold">{t("Итого:")}</td>
                <td />
                <td className="text-center font-bold">{money((row.items ?? []).reduce((sum, item) => sum + item.quantity, 0))}</td>
                <td />
                <td className="text-center font-bold">
                  {money(row.amount)} {row.currency}
                </td>
              </tr>
            </tbody>
          </table>
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
                <X className="h-5 w-5" />
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
