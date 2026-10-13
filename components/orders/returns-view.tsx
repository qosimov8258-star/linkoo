"use client"

import { X } from "lucide-react"
import { RI, RefBand, RefButton, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefTabs, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { useMemo, useState } from "react"
import { useLanguage } from "@/lib/i18n/language-context"

type ReturnRow = {
  id: number
  client: string
  zone: string
  warehouse: string
  organization: string
  deliverer: string
  date: string
  acceptedDate?: string
  creator: string
  accepted?: boolean
  amount: string
  agent: string
  comment?: string
}

const warehouses = ["05,08,2025(1)", "Andijon skladi", "Suhrob sklad", "toshkent", "123 test"]

const initial: ReturnRow[] = [
  { id: 222, client: "ЧЛ Ибраева Мадина", zone: "", warehouse: "Andijon skladi", organization: "NEW ORG", deliverer: "Admin Ritm", date: "17 июля 2026, 08:24", creator: "Admin Ritm", agent: "Хайрулло Доставщик", amount: "10 000 SUM" },
  { id: 220, client: "klient 1", zone: "chilonzor", warehouse: "Andijon skladi", organization: "NEW ORG", deliverer: "Quvonchbek Admin", date: "16 мая 2026, 09:47", acceptedDate: "06 июня 2026, 11:20", creator: "Admin Ritm", agent: "Samandar Abdurahmonov", amount: "11 000 SUM", accepted: true },
  { id: 219, client: "Бахт маркет", zone: "", warehouse: "05,08,2025(1)", organization: "Lalaku", deliverer: "Admin Ritm", date: "11 мая 2026, 09:44", acceptedDate: "09 мая 2026, 09:45", creator: "Admin Ritm", agent: "MrJakhon Ziyayev", amount: "66 SUM", accepted: true },
  { id: 218, client: "loe messi", zone: "spark", warehouse: "Andijon skladi", organization: "energetik", deliverer: "N/A", date: "07 мая 2026, 13:09", creator: "Admin Ritm", agent: "Admin Ritm", amount: "1,6 USD" },
  { id: 217, client: "new klient707", zone: "", warehouse: "toshkent", organization: "energetik", deliverer: "Temur Raupov", date: "28 мар. 2026, 17:28", creator: "Admin Ritm", agent: "Temur Raupov", amount: "86 910 120 SUM" },
  { id: 216, client: "marketsavdo1", zone: "spark", warehouse: "Suhrob sklad", organization: "Lalaku", deliverer: "MrJakhon Ziyayev", date: "04 мар. 2026, 19:08", creator: "Admin Ritm", agent: "MrJakhon Ziyayev", amount: "360 000 SUM", comment: "тест" },
  { id: 210, client: "Asu market", zone: "", warehouse: "Suhrob sklad", organization: "Lalaku", deliverer: "Admin Ritm", date: "20 янв. 2026, 17:22", acceptedDate: "23 янв. 2026, 16:08", creator: "Admin Ritm", agent: "Temur Raupov", amount: "6 000 SUM", accepted: true },
  { id: 205, client: "mustafo", zone: "spark", warehouse: "toshkent", organization: "energetik", deliverer: "Admin Ritm", date: "11 янв. 2026, 19:47", acceptedDate: "11 янв. 2026, 19:48", creator: "Admin Ritm", agent: "Admin Ritm", amount: "646 750 SUM", accepted: true },
]

function parseAmount(amount: string): { value: number; currency: string } {
  const match = amount.trim().match(/^([\d\s.,]+)\s*(SUM|USD|Euro|EUR)$/i)
  if (!match) return { value: 0, currency: "SUM" }
  const value = Number(match[1].replace(/\s/g, "").replace(",", ".")) || 0
  const currency = match[2].toUpperCase() === "EUR" ? "Euro" : match[2].toUpperCase() === "USD" ? "USD" : "SUM"
  return { value, currency }
}

function formatTotal(value: number): string {
  const [whole, fraction] = value.toFixed(3).replace(/\.?0+$/, "").split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return fraction ? `${grouped},${fraction}` : grouped
}

export function ReturnsView() {
  const { t } = useLanguage()
  const [rows, setRows] = useState(initial)
  const [tab, setTab] = useState("Все")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<ReturnRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [warehouseFilter, setWarehouseFilter] = useState("Все склады")
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<number[]>([])

  const visible = useMemo(
    () =>
      rows
        .filter((row) => tab === "Все" || (tab === "Принятые" ? row.accepted : !row.accepted))
        .filter((row) => warehouseFilter === "Все склады" || row.warehouse === warehouseFilter)
        .filter((row) => `${row.id} ${row.client}`.toLowerCase().includes(query.toLowerCase())),
    [rows, tab, query, warehouseFilter],
  )
  const paging = usePaging(visible.length)
  const pageRows = visible.slice(paging.start, paging.end)

  const totals = useMemo(() => {
    const sums: Record<string, number> = { SUM: 0, Euro: 0, USD: 0 }
    for (const row of visible) {
      const { value, currency } = parseAmount(row.amount)
      sums[currency] = (sums[currency] ?? 0) + value
    }
    return sums
  }, [visible])

  function addReturn(client: string) {
    const id = Math.max(0, ...rows.map((row) => row.id)) + 1
    const row: ReturnRow = { id, client: client || "Новый клиент", zone: "", warehouse: warehouses[0], organization: "—", deliverer: "Admin Ritm", date: "06 авг. 2026, 12:00", creator: "Admin Ritm", amount: "0 SUM", agent: "Admin Ritm" }
    setRows((current) => [row, ...current])
    setAddOpen(false)
  }

  function updateClient(id: number, client: string) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, client } : row)))
    setSelected((current) => (current && current.id === id ? { ...current, client } : current))
  }

  function cancelReturn(id: number) {
    setRows((current) => current.filter((row) => row.id !== id))
    setSelected(null)
  }

  function acceptChecked() {
    const ids = checked.length ? checked : selected ? [selected.id] : []
    if (!ids.length) {
      setSelectMode(true)
      return
    }
    setRows((current) => current.map((row) => (ids.includes(row.id) ? { ...row, accepted: true, acceptedDate: row.acceptedDate ?? "06 авг. 2026, 12:00" } : row)))
    setChecked([])
  }

  return (
    <RefPage>
      <RefHeader title={t("Возвраты")}>
        <RefButton icon={RI.add} green label={t("Добавить")} onClick={() => setAddOpen(true)} />
      </RefHeader>
      <RefCard>
        <RefTabs labels={["Надо принять", "Принятые", "Все"]} value={tab} onChange={(value) => { setTab(value); paging.setPage(1) }} />
        <RefBand>
          <span>
            {t("Возвраты")} : {formatTotal(totals.SUM)} SUM , {formatTotal(totals.Euro)} Euro , {formatTotal(totals.USD)} USD
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
                  <option value="Все склады">{t("Все склады")}</option>
                  {warehouses.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => setFilterOpen(false)} className="mt-4 h-[30px] w-full rounded-[5px] bg-[#4f71dc] text-[13px] font-semibold text-white">{t("Применить")}</button>
            </div>
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
              <RefIconButton path={RI.checklist} label={t("Выбрать")} color="#5d6474" active={selectMode} onClick={() => setSelectMode((value) => !value)} />
              <RefIconButton path={RI.download} label={t("Экспортировать")} onClick={() => window.print()} />
            </>
          }
          extra={<RefButton green label={t("Принять на склад")} onClick={acceptChecked} />}
        />
        <RefTable
          cols="minmax(0,50fr) minmax(0,170fr) minmax(0,130fr) minmax(0,110fr) minmax(0,145fr) minmax(0,90fr) minmax(0,130fr) minmax(0,100fr) minmax(0,125fr) minmax(0,40fr)"
          heads={[t("№"), t("От кого"), t("Склад"), t("Доставщик"), t("Дата возврата"), t("Создал"), t("Ответственный агент"), t("Комментарий"), t("Сумма возврата"), ""]}
          rows={pageRows}
          rowKey={(row) => row.id}
          onRowClick={(row) => setSelected(selected?.id === row.id ? null : row)}
          rowClass={(row) => (selected?.id === row.id ? "bg-[#e8efff]" : "")}
          empty={t("Ничего не найдено")}
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
            <>{t(row.client)}<br /><span className="text-[#4f71dc]">{row.zone}</span></>,
            <>{row.warehouse}<br /><span className="text-[#4f71dc]">{row.organization}</span></>,
            row.deliverer,
            <>{t(row.date)}<br /><span className="text-[#4f71dc]">{row.acceptedDate ?? ""}</span></>,
            row.creator,
            row.agent,
            row.comment ?? "-",
            <span key="sum" className="block text-right">{row.amount}<br /><span className={row.accepted ? "text-[#48a34b]" : "text-[#f0ad4e]"}>{t(row.accepted ? "Принят" : "Ожидает")}</span></span>,
            <span key="icon" className="inline-flex h-5 w-5 items-center justify-center rounded border border-[#4f71dc] text-[11px] text-[#4f71dc]">$</span>,
          ]}
        />
      </RefCard>
      {selected && <Detail row={selected} close={() => setSelected(null)} onEdit={updateClient} onCancelRequest={cancelReturn} />}
      {addOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/[0.54] p-4">
          <form onSubmit={(event) => { event.preventDefault(); addReturn((new FormData(event.currentTarget).get("client") as string)?.trim()) }} className="w-full max-w-[500px] bg-white font-sans text-[13px] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#efefef] px-[30px] py-5">
              <h3 className="text-[13px] font-bold uppercase">{t("Добавить возврат")}</h3>
              <button type="button" onClick={() => setAddOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <label className="m-[30px] block border-b border-[#e0e0e0] pb-2 text-[10px] font-bold">
              {t("Клиент")}
              <input autoFocus name="client" className="mt-1 block w-full bg-transparent text-[13px] font-semibold outline-none" />
            </label>
            <div className="flex justify-end border-t border-[#efefef] px-[30px] py-4">
              <button type="submit" className="text-[13px] font-semibold uppercase text-[#0a9ddb]">{t("Создать")}</button>
            </div>
          </form>
        </div>
      )}
    </RefPage>
  )
}

function Detail({ row, close, onEdit, onCancelRequest }: { row: ReturnRow; close: () => void; onEdit: (id: number, client: string) => void; onCancelRequest: (id: number) => void }) {
  const { t } = useLanguage()
  const [editOpen, setEditOpen] = useState(false)
  const [editClient, setEditClient] = useState(row.client)

  return (
    <section className="mt-5 bg-white font-sans text-[13px] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
      <div className="flex h-[65px] items-center justify-between border-b border-[#efefef] px-[30px]">
        <h2 className="text-[18px] font-semibold">{t("Возврат №")}{row.id}</h2>
        <div className="flex gap-3">
          <button type="button" onClick={() => setEditOpen(true)} className="h-[30px] rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white">✎　{t("Изменить")}</button>
          <button type="button" onClick={() => onCancelRequest(row.id)} className="h-[30px] rounded-[5px] bg-[#fa8072] px-4 text-[13px] font-semibold text-white">⊖　{t("Отменить запрос")}</button>
          <button onClick={close} aria-label={t("Закрыть")}><X /></button>
        </div>
      </div>
      <div className="grid grid-cols-[435px_1fr]">
        <aside className="border-r border-[#efefef] p-[30px] leading-[25px]">
          {t("Возврат №")}{row.id}<br />
          {t("Добавил")}: <b className="float-right">{row.creator}</b><br />
          {t("Клиент")}: <b className="float-right text-[#4f71dc]">{t(row.client)}</b><br />
          {t("Зона")}: <b className="float-right">{row.zone || t("Не указано")}</b><br />
          {t("Дата возврата")}: <b className="float-right">{row.acceptedDate ?? row.date}</b><br />
          {t("Доставщик")}: <b className="float-right">{row.deliverer}</b><br />
          {t("Ответственный агент")}: <b className="float-right">{row.agent}</b>
          <hr className="my-5" />
          <b>{t("СКЛАД")}</b><br />
          {t("Склад")}: <b className="float-right">{row.warehouse}</b><br />
          {t("Статус")}: <b className={`float-right ${row.accepted ? "text-[#48a34b]" : "text-[#f0ad4e]"}`}>{t(row.accepted ? "Принят" : "Ожидает")}</b>
        </aside>
        <div className="p-[30px]">
          <div className="mb-5 flex justify-around border-b pb-4">
            <span className="border-b-2 border-[#4f71dc] pb-4">{t("Список товаров")}</span>
            <span>{t("Серии")}</span>
            <span>{t("Логи")}</span>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-dotted"><th className="p-3 text-left">{t("Заказ")}</th><th>{t("№")}</th><th className="text-left">{t("Товар")}</th><th>{t("Количество")}</th><th>{t("Блок")}</th><th>{t("Цена (SUM)")}</th><th>{t("Сумма (SUM)")}</th></tr></thead>
            <tbody>
              <tr><td className="p-4 text-[#4f71dc]">1423</td><td>1</td><td>Cola 0.35<br />{t("Заказ: 1423 от 08 янв.")}</td><td>{t("10 шт")}</td><td>{t("1 блок")}</td><td>4 477,5</td><td>44 775</td></tr>
              <tr className="border-t"><td className="p-4 font-bold">{t("Итого:")}</td><td /><td /><td className="font-bold">{t("10шт")}</td><td /><td /><td className="font-bold">44 775</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onEdit(row.id, editClient.trim() || row.client)
              setEditOpen(false)
            }}
            className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">{t("Изменить возврат")}</h3>
              <button type="button" onClick={() => setEditOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              {t("Клиент")}
              <input autoFocus value={editClient} onChange={(event) => setEditClient(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
            </label>
            <button type="submit" className="w-full rounded-md bg-[#4f71dc] py-3 font-semibold text-white">{t("Сохранить")}</button>
          </form>
        </div>
      )}
    </section>
  )
}
