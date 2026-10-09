"use client"

import { AlertTriangle, Clock3, EyeOff, Filter, Map, Plus, Search, ShoppingBag, Truck, X } from "lucide-react"
import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

import { statuses, type Order } from "./orders-data"

export function OrdersView() {
  const router = useRouter()
  const { t } = useLanguage()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState("Активные")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Order | null>(null)
  const [checkedIds, setCheckedIds] = useState<number[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [zoneFilter, setZoneFilter] = useState("Все зоны")
  const [notice, setNotice] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [bulkPayOpen, setBulkPayOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const zones = useMemo(() => Array.from(new Set(orders.map((row) => row.zone).filter(Boolean))), [orders])

  const visible = useMemo(
    () =>
      orders
        .filter((row) => `${row.id} ${row.client} ${row.agent}`.toLowerCase().includes(query.toLowerCase()))
        .filter((row) => zoneFilter === "Все зоны" || row.zone === zoneFilter),
    [orders, query, zoneFilter],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/orders")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить заказы")
        return (await response.json()) as Order[]
      })
      .then((data) => {
        if (cancelled) return
        setOrders(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Не удалось загрузить заказы с сервера"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function flash(text: string) {
    setNotice(text)
    window.setTimeout(() => setNotice(""), 2200)
  }

  function toggleChecked(id: number) {
    setCheckedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  async function passToDelivery() {
    if (!checkedIds.length) {
      flash(t("Выберите заказы для передачи"))
      return
    }
    const ids = [...checkedIds]
    setOrders((current) => current.map((row) => (ids.includes(row.id) ? { ...row, status: "В пути" } : row)))
    setCheckedIds([])
    flash(`${ids.length} ${t("заказ(ов) передано в доставку")}`)
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/orders/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "В пути" }),
          }),
        ),
      )
    } catch {
      flash(t("Не удалось сохранить часть изменений на сервере"))
    }
  }

  async function updateOrder(id: number, patch: Partial<Order>) {
    setOrders((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
    setSelected((current) => (current && current.id === id ? { ...current, ...patch } : current))
    try {
      const response = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error("update failed")
      const updated = (await response.json()) as Order
      setOrders((current) => current.map((row) => (row.id === id ? updated : row)))
      setSelected((current) => (current && current.id === id ? updated : current))
    } catch {
      flash(t("Не удалось сохранить изменения на сервере"))
    }
  }

  async function refreshOrder(id: number) {
    try {
      const response = await fetch(`/api/orders/${id}`)
      if (!response.ok) return
      const updated = (await response.json()) as Order
      setOrders((current) => current.map((row) => (row.id === id ? updated : row)))
      setSelected((current) => (current && current.id === id ? updated : current))
    } catch {
      // best-effort refresh; the items tab already reflects the latest state
    }
  }

  async function addOrder(client: string) {
    setAddOpen(false)
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: client || t("Новый клиент") }),
      })
      if (!response.ok) throw new Error("create failed")
      const created = (await response.json()) as Order
      setOrders((current) => [created, ...current])
      flash(t("Заказ добавлен"))
    } catch {
      flash(t("Не удалось создать заказ"))
    }
  }

  function importFromExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    void (async () => {
      const rows = await readExcelRows(file)
      const parsed = rows
        .filter(([client]) => client && !/^(клиент|client)$/i.test(client))
        .map(([client, amount]) => ({ client, amount: amount || "0 SUM" }))
      if (!parsed.length) return
      try {
        const created = await Promise.all(
          parsed.map((row) =>
            fetch("/api/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(row),
            }).then((response) => response.json() as Promise<Order>),
          ),
        )
        setOrders((current) => [...created, ...current])
        flash(`${t("Импортировано заказов:")} ${created.length}`)
      } catch {
        flash(t("Не удалось импортировать заказы"))
      }
    })()
  }

  return (
    <main className="min-h-screen bg-slate-100 pb-8 text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-10 py-4">
        <h1 className="flex items-center gap-3 text-[26px] font-bold text-slate-600">
          <FavoritesButton className="flex items-center gap-2 text-[#5271df]" />
          <span className="font-normal">|</span> {t("Заказы")} <AlertTriangle className="ml-4 fill-slate-500 text-slate-500" /><Clock3 /><ShoppingBag />
        </h1>
        <div className="flex flex-wrap gap-3">
          <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={importFromExcel} className="hidden" />
          <Button icon={<Map />} text={t("Показать на карте")} onClick={() => router.push("/tracking")} />
          <Button text={t("▣  Групповая оплата")} onClick={() => setBulkPayOpen(true)} />
          <Button text={t("▥  Импортировать")} onClick={() => importInputRef.current?.click()} />
          <button type="button" onClick={() => setAddOpen(true)} className="rounded-md bg-[#70cf84] px-5 py-2.5 font-semibold text-white">
            <Plus className="mr-2 inline h-5" />{t("Добавить")}
          </button>
        </div>
      </div>

      {notice && (
        <div className="mx-9 mt-3 flex items-center justify-between rounded bg-[#e9f8ed] px-4 py-3 text-sm text-[#278549]">
          {notice}
          <button type="button" onClick={() => setNotice("")} aria-label={t("Закрыть уведомление")}><X size={18} /></button>
        </div>
      )}

      <section className="mx-9 mt-1 bg-white shadow">
        <div className="grid grid-cols-4">
          <Tabs labels={["Активные", "Доставляется", "Доставленные", "Все"]} value={tab} onChange={setTab} />
        </div>
        <div className="grid grid-cols-3 bg-[#586ce8] px-2 py-2 text-white font-semibold">
          <span>{t("Заказы: 302 722 200 SUM , 938,18 USD")}</span>
          <span className="text-center">{t("Возвраты: 0 SUM , 0 USD")}</span>
          <span className="text-right">{t("Факт: 302 722 200 SUM , 938,18 USD")}</span>
        </div>
        <div className="relative flex flex-wrap items-center gap-5 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="rounded bg-[#5271df] px-4 py-2 text-white">
            <Filter className="mr-2 inline h-4" />{t("Фильтр: 1 элемента")}
          </button>
          {filterOpen && (
            <div className="absolute left-5 top-full z-20 mt-2 w-64 border border-slate-200 bg-white p-4 shadow-xl">
              <label className="block text-xs font-medium text-slate-500">
                {t("Зона")}
                <select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)} className="mt-1 block w-full border-b border-slate-300 bg-white py-2 text-sm outline-none">
                  <option value="Все зоны">{t("Все зоны")}</option>
                  {zones.map((zone) => (
                    <option key={zone}>{zone}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => setFilterOpen(false)} className="mt-4 w-full rounded bg-[#5271df] py-2 text-sm font-semibold text-white">{t("Применить")}</button>
            </div>
          )}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Поиск")} className="ml-3 w-80 border-b border-slate-300 px-2 py-2 outline-none" />
          <Search className="-ml-12 text-slate-400" />
          <span className="ml-auto">25　 1 - {visible.length} {t("из")} {orders.length}　 ◀ ▶　 <EyeOff className="inline" /></span>
          <button type="button" onClick={passToDelivery} className="rounded bg-[#70cf84] px-4 py-2 font-semibold text-white">
            <Truck className="mr-2 inline h-5" />{t("Передать")}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1600px] text-left">
            <thead className="bg-[#626b7e] text-white">
              <tr>{["▦", "№", "Клиент", "Тип", "Дата создания", "Доставщик", "Дата доставки", "Агент", "Сумма заказа", "Баланс", "Статус"].map((head) => <th key={head} className="px-4 py-4">{t(head)}</th>)}</tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-16 text-center text-slate-500">{t("Загрузка заказов...")}</td></tr>
              ) : loadError ? (
                <tr><td colSpan={11} className="px-4 py-16 text-center text-red-600">{loadError}</td></tr>
              ) : visible.map((row) => (
                <tr onClick={() => setSelected(row)} key={row.id} className="cursor-pointer border-b-2 border-dotted border-slate-200 hover:bg-blue-50">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={checkedIds.includes(row.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleChecked(row.id)} />
                  </td>
                  <td className="px-4">{row.id}</td>
                  <td className="px-4 py-3">{row.client}<br /><span>{t("Зона:")} {row.zone || t("Не указано")}</span></td>
                  <td className="px-4">{row.type}<br /><b>{row.product}</b></td>
                  <td className="px-4">{row.created}</td>
                  <td className="px-4">Admin Ritm<br /><span className="text-[#5271df]">{t("Не указано")}</span></td>
                  <td className="px-4">{row.delivery}</td>
                  <td className="px-4">{row.agent}<br /><span className="text-[#5271df]">{t("0 кг.")}</span></td>
                  <td className="px-4">{row.amount}</td>
                  <td className={`px-4 font-medium ${row.negative ? "text-red-400" : "text-green-600"}`}>{row.balance}</td>
                  <td className="px-4 text-center">
                    <AlertTriangle className="inline h-5 text-slate-400" />　<span className="rounded border border-red-400 px-1 text-red-400">$</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <OrderDetail order={selected} close={() => setSelected(null)} onUpdate={updateOrder} refreshOrder={refreshOrder} router={router} />
      )}

      {addOpen && (
        <AddOrderModal onClose={() => setAddOpen(false)} onSave={addOrder} />
      )}

      {bulkPayOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">{t("Групповая оплата")}</h3>
              <button type="button" onClick={() => setBulkPayOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-5 text-sm text-slate-500">{t("Выбрано заказов:")} {checkedIds.length || t("0 (отметьте заказы в таблице)")}</p>
            <button
              type="button"
              onClick={() => {
                if (checkedIds.length) flash(`${t("Оплата принята по")} ${checkedIds.length} ${t("заказ(ам)")}`)
                setBulkPayOpen(false)
                setCheckedIds([])
              }}
              disabled={!checkedIds.length}
              className="w-full rounded-md bg-[#70cf84] py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("Оплатить")}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

function Tabs({ labels, value, onChange }: { labels: string[]; value: string; onChange: (v: string) => void }) {
  const { t } = useLanguage()
  return (
    <>
      {labels.map((label) => (
        <button key={label} onClick={() => onChange(label)} className={`py-4 text-center ${value === label ? "border-b-4 border-[#586ce8]" : ""}`}>
          {t(label)}
        </button>
      ))}
    </>
  )
}

function Field({ label, value, valueClassName }: { label: string; value: ReactNode; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-slate-500">{label}</span>
      <b className={`text-right ${valueClassName ?? ""}`}>{value}</b>
    </div>
  )
}

function Button({ text, icon, onClick }: { text: string; icon?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md bg-[#5271df] px-5 py-2.5 font-semibold text-white">
      {icon && <span className="mr-2 inline-block align-middle">{icon}</span>}
      {text}
    </button>
  )
}

function AddOrderModal({ onClose, onSave }: { onClose: () => void; onSave: (client: string) => void }) {
  const [client, setClient] = useState("")
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSave(client.trim())
        }}
        className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold">{t("Добавить заказ")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
        </div>
        <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
          {t("Клиент")}
          <input autoFocus value={client} onChange={(event) => setClient(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
        </label>
        <button type="submit" className="w-full rounded-md bg-[#70cf84] py-3 font-semibold text-white">{t("Создать")}</button>
      </form>
    </div>
  )
}

function OrderDetail({
  order,
  close,
  onUpdate,
  refreshOrder,
  router,
}: {
  order: Order
  close: () => void
  onUpdate: (id: number, patch: Partial<Order>) => void
  refreshOrder: (id: number) => void
  router: ReturnType<typeof useRouter>
}) {
  const { t } = useLanguage()
  const [editOpen, setEditOpen] = useState(false)
  const [editClient, setEditClient] = useState(order.client)
  const [editPaymentDate, setEditPaymentDate] = useState(order.paymentDate ?? "")
  const [editPaymentType, setEditPaymentType] = useState(order.paymentType ?? "")
  const [editOrganization, setEditOrganization] = useState(order.organization ?? "")
  const [organizations, setOrganizations] = useState<string[]>([])
  const [discountOpen, setDiscountOpen] = useState(false)
  const [discountValue, setDiscountValue] = useState("")
  const [tab, setTab] = useState("Список товаров")
  const detailTabs = ["Список товаров", "Серии", "Возврат", "Задействованные акции", "Логи"]

  useEffect(() => {
    if (!editOpen) return
    let cancelled = false
    fetch("/api/organizations")
      .then((response) => (response.ok ? (response.json() as Promise<Array<{ name: string }>>) : []))
      .then((rows) => {
        if (!cancelled) setOrganizations(rows.map((row) => row.name).filter(Boolean))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [editOpen])

  function cycleStatus() {
    const index = statuses.indexOf(order.status)
    onUpdate(order.id, { status: statuses[(index + 1) % statuses.length] })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/45 p-4 py-8" onClick={close}>
    <section onClick={(event) => event.stopPropagation()} className="w-full max-w-6xl bg-white shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <h2 className="text-2xl">{t("Заказ №")}{order.id}</h2>
        <div className="flex flex-wrap gap-3">
          <Button text={t("✎  Изменить статус")} onClick={cycleStatus} />
          <Button text={t("✎  Изменить")} onClick={() => setEditOpen(true)} />
          <Button text={t("⌁  Скидка")} onClick={() => setDiscountOpen(true)} />
          <Button text={t("↩  Возврат")} onClick={() => router.push("/analytics/returns")} />
          <Button text={t("▣  Распечатать")} onClick={() => window.print()} />
          <button onClick={close} aria-label={t("Закрыть")}><X /></button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-3 sm:divide-x">
        <div className="flex flex-col gap-2">
          <Field label={t("Клиент:")} value={order.client} valueClassName="text-[#5271df]" />
          <Field label={t("Транспорт:")} value={t("Не указан")} />
          <Field label={t("Филиал:")} value={order.zone || "ddr"} />
          <Field label={t("Склад:")} value="toshkent" />
          <Field label={t("Договор:")} value={t("Не указан")} />
          <Field label={t("Счет фактуры:")} value={t("Не активный")} valueClassName="text-orange-400" />
          <Field label={t("Номер счет фактура:")} value={t("Не указано")} />
          <Field label={t("Дата счет фактуры:")} value={t("Не указано")} />
        </div>
        <div className="flex flex-col gap-2 sm:px-5">
          <Field label={t("Прайс-лист:")} value="donalik" />
          <Field label={t("Организация:")} value={order.organization || t("Не указано")} />
          <Field label={t("Дата окончательной оплаты:")} value={order.paymentDate ? order.paymentDate.split("-").reverse().join(".") : t("Не указано")} />
          <Field label={t("Тип оплаты:")} value={order.paymentType === "bank" ? t("Перечисление") : order.paymentType === "cash" ? t("Наличные") : t("Не указано")} />
          <Field label={t("Общая стоимость")} value={order.amount} />
          {order.discount && <Field label={t("Скидка")} value={order.discount} valueClassName="text-[#278549]" />}
          <Field label={t("Оплачено:")} value="0 SUM" />
          <Field label={t("Остаток:")} value={order.balance} valueClassName={order.negative ? "text-red-400" : "text-slate-700"} />
          <Field label={t("Оперативный долг клиента:")} value={order.negative ? order.balance : "0 SUM"} valueClassName="text-red-400" />
          <Field label={t("Фактический долг клиента:")} value="0 SUM" valueClassName="text-[#278549]" />
        </div>
        <div className="flex flex-col gap-2 sm:pl-5">
          <Field label={t("Создал:")} value={order.agent} />
          <Field label={t("Доставщик:")} value={order.agent} />
          <Field label={t("Экспедитор:")} value={t("Не указано")} />
          <Field label={t("Дата создания:")} value={order.created} />
          <Field label={t("Дата реализации:")} value={order.status === "Доставлено" ? order.delivery : t("Не реализовано")} />
          <Field label={t("Текущий статус:")} value={t(order.status)} valueClassName="text-orange-400" />
          <Field label={t("Тип передачи:")} value={t("Доставка")} />
          <Field label={t("Дата доставки:")} value={order.delivery} />
          <Field label={t("Тип сделки:")} value={t("Консигнация")} />
        </div>
      </div>
      <div className="border-t">
        <nav className="flex flex-wrap gap-6 border-b px-5 text-sm font-medium text-slate-500">
          {detailTabs.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setTab(label)}
              className={`border-b-2 py-3 ${tab === label ? "border-[#5271df] text-[#5271df]" : "border-transparent hover:text-slate-700"}`}
            >
              {t(label)}
            </button>
          ))}
        </nav>
        {tab === "Список товаров" ? (
          <OrderItemsTab orderId={order.id} onChange={() => refreshOrder(order.id)} />
        ) : (
          <p className="p-10 text-center text-slate-400">{t("Нет данных")}</p>
        )}
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onUpdate(order.id, {
                client: editClient.trim() || order.client,
                paymentDate: editPaymentDate,
                paymentType: editPaymentType,
                organization: editOrganization,
              })
              setEditOpen(false)
            }}
            className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">{t("Изменить заказ")}</h3>
              <button type="button" onClick={() => setEditOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              {t("Клиент")}
              <input autoFocus value={editClient} onChange={(event) => setEditClient(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
            </label>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              {t("Дата оплаты")}
              <input type="date" value={editPaymentDate} onChange={(event) => setEditPaymentDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] text-slate-900 outline-none" />
            </label>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              {t("Тип оплаты")}
              <select value={editPaymentType} onChange={(event) => setEditPaymentType(event.target.value)} className="mt-1 block w-full bg-white text-[16px] text-slate-900 outline-none">
                <option value="">{t("Не указано")}</option>
                <option value="cash">{t("Наличные")}</option>
                <option value="bank">{t("Перечисление")}</option>
              </select>
            </label>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              {t("Организация")}
              <select value={editOrganization} onChange={(event) => setEditOrganization(event.target.value)} className="mt-1 block w-full bg-white text-[16px] text-slate-900 outline-none">
                <option value="">{t("Не указано")}</option>
                {[...new Set([...organizations, editOrganization].filter(Boolean))].map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <button type="submit" className="w-full rounded-md bg-[#5271df] py-3 font-semibold text-white">{t("Сохранить")}</button>
          </form>
        </div>
      )}

      {discountOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (discountValue.trim()) onUpdate(order.id, { discount: `${discountValue.trim()}%` })
              setDiscountOpen(false)
              setDiscountValue("")
            }}
            className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">{t("Скидка")}</h3>
              <button type="button" onClick={() => setDiscountOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              {t("Скидка, %")}
              <input autoFocus type="number" min="0" max="100" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
            </label>
            <button type="submit" className="w-full rounded-md bg-[#5271df] py-3 font-semibold text-white">{t("Применить")}</button>
          </form>
        </div>
      )}
    </section>
    </div>
  )
}

type OrderLineItem = {
  id: number
  productName: string
  unit: string
  quantity: number
  unitPrice: number
  currency: string
  lineTotal: number
}

function OrderItemsTab({ orderId, onChange }: { orderId: number; onChange: () => void }) {
  const { t } = useLanguage()
  const [items, setItems] = useState<OrderLineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [productName, setProductName] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [unit, setUnit] = useState("шт.")
  const [unitPrice, setUnitPrice] = useState("")
  const [error, setError] = useState("")

  function load() {
    setLoading(true)
    fetch(`/api/orders/${orderId}/items`)
      .then(async (response) => (response.ok ? ((await response.json()) as OrderLineItem[]) : []))
      .then(setItems)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  async function addItem() {
    setError("")
    const parsedQuantity = Number(quantity)
    const parsedPrice = Number(unitPrice)
    if (!productName.trim()) {
      setError(t("Наименование товара обязательно"))
      return
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0 || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError(t("Проверьте количество и цену"))
      return
    }
    const response = await fetch(`/api/orders/${orderId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productName: productName.trim(), unit: unit.trim() || "шт.", quantity: parsedQuantity, unitPrice: parsedPrice }),
    })
    if (!response.ok) {
      setError(t("Не удалось добавить товар"))
      return
    }
    setProductName("")
    setQuantity("1")
    setUnitPrice("")
    setAddOpen(false)
    load()
    onChange()
  }

  async function removeItem(itemId: number) {
    const response = await fetch(`/api/orders/${orderId}/items/${itemId}`, { method: "DELETE" })
    if (response.ok) {
      load()
      onChange()
    }
  }

  return (
    <div>
      <table className="w-full border-t">
        <thead className="bg-slate-100">
          <tr>
            <th className="p-3">№</th>
            <th>{t("Товар")}</th>
            <th>{t("Количество")}</th>
            <th>{t("Цена")}</th>
            <th>{t("Сумма")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6} className="p-6 text-center text-slate-400">{t("Загрузка...")}</td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={6} className="p-6 text-center text-slate-400">{t("Товары не добавлены")}</td></tr>
          ) : (
            items.map((item, index) => (
              <tr key={item.id} className="border-t text-center">
                <td className="p-3">{index + 1}</td>
                <td>{item.productName}</td>
                <td>{item.quantity} {item.unit}</td>
                <td>{item.unitPrice.toLocaleString("ru-RU")} {item.currency}</td>
                <td>{Math.round(item.lineTotal).toLocaleString("ru-RU")} {item.currency}</td>
                <td>
                  <button type="button" onClick={() => removeItem(item.id)} className="text-red-500 hover:text-red-700" aria-label={t("Удалить")}>
                    <X className="mx-auto h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="border-t p-4">
        {addOpen ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-500">
              {t("Товар")}
              <input value={productName} onChange={(event) => setProductName(event.target.value)} className="mt-1 block w-48 rounded border px-2 py-1.5 text-sm" autoFocus />
            </label>
            <label className="text-xs text-slate-500">
              {t("Количество")}
              <input type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 block w-24 rounded border px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              {t("Ед. измерения")}
              <input value={unit} onChange={(event) => setUnit(event.target.value)} className="mt-1 block w-20 rounded border px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              {t("Цена")}
              <input type="number" min="0" step="any" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} className="mt-1 block w-28 rounded border px-2 py-1.5 text-sm" />
            </label>
            <button type="button" onClick={addItem} className="rounded bg-[#5271df] px-4 py-1.5 text-sm font-semibold text-white">{t("Добавить")}</button>
            <button type="button" onClick={() => setAddOpen(false)} className="rounded border px-4 py-1.5 text-sm">{t("Отмена")}</button>
            {error && <span className="text-xs text-red-500">{error}</span>}
          </div>
        ) : (
          <button type="button" onClick={() => setAddOpen(true)} className="flex items-center gap-1 text-sm font-medium text-[#5271df]">
            <Plus className="h-4 w-4" /> {t("Добавить товар")}
          </button>
        )}
      </div>
    </div>
  )
}
