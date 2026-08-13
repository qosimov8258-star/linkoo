"use client"

import { AlertTriangle, Clock3, EyeOff, Filter, Map, Plus, Search, ShoppingBag, Truck, X } from "lucide-react"
import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { statuses, type Order } from "./orders-data"

export function OrdersView() {
  const router = useRouter()
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
        if (!cancelled) setLoadError("Не удалось загрузить заказы с сервера")
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
      flash("Выберите заказы для передачи")
      return
    }
    const ids = [...checkedIds]
    setOrders((current) => current.map((row) => (ids.includes(row.id) ? { ...row, status: "В пути" } : row)))
    setCheckedIds([])
    flash(`${ids.length} заказ(ов) передано в доставку`)
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
      flash("Не удалось сохранить часть изменений на сервере")
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
      flash("Не удалось сохранить изменения на сервере")
    }
  }

  async function addOrder(client: string) {
    setAddOpen(false)
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: client || "Новый клиент" }),
      })
      if (!response.ok) throw new Error("create failed")
      const created = (await response.json()) as Order
      setOrders((current) => [created, ...current])
      flash("Заказ добавлен")
    } catch {
      flash("Не удалось создать заказ")
    }
  }

  function importFromExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const lines = String(reader.result ?? "").split(/\r?\n/).filter(Boolean)
      const parsed = lines
        .map((line) => line.split(/[;,\t]/).map((cell) => cell.trim()))
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
        flash(`Импортировано заказов: ${created.length}`)
      } catch {
        flash("Не удалось импортировать заказы")
      }
    }
    reader.readAsText(file)
  }

  return (
    <main className="min-h-screen bg-slate-100 pb-8 text-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-10 py-4">
        <h1 className="flex items-center gap-3 text-[26px] font-bold text-slate-600">
          <span className="text-[#5271df]">★ Избранные</span>
          <span className="font-normal">|</span> Заказы <AlertTriangle className="ml-4 fill-slate-500 text-slate-500" /><Clock3 /><ShoppingBag />
        </h1>
        <div className="flex flex-wrap gap-3">
          <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={importFromExcel} className="hidden" />
          <Button icon={<Map />} text="Показать на карте" onClick={() => router.push("/tracking")} />
          <Button text="▣  Групповая оплата" onClick={() => setBulkPayOpen(true)} />
          <Button text="▥  Импортировать" onClick={() => importInputRef.current?.click()} />
          <button type="button" onClick={() => setAddOpen(true)} className="rounded-md bg-[#70cf84] px-5 py-2.5 font-semibold text-white">
            <Plus className="mr-2 inline h-5" />Добавить
          </button>
        </div>
      </div>

      {notice && (
        <div className="mx-9 mt-3 flex items-center justify-between rounded bg-[#e9f8ed] px-4 py-3 text-sm text-[#278549]">
          {notice}
          <button type="button" onClick={() => setNotice("")} aria-label="Закрыть уведомление"><X size={18} /></button>
        </div>
      )}

      <section className="mx-9 mt-1 bg-white shadow">
        <div className="grid grid-cols-4">
          <Tabs labels={["Активные", "Доставляется", "Доставленные", "Все"]} value={tab} onChange={setTab} />
        </div>
        <div className="grid grid-cols-3 bg-[#586ce8] px-2 py-2 text-white font-semibold">
          <span>Заказы: 302 722 200 SUM , 938,18 USD</span>
          <span className="text-center">Возвраты: 0 SUM , 0 USD</span>
          <span className="text-right">Факт: 302 722 200 SUM , 938,18 USD</span>
        </div>
        <div className="relative flex flex-wrap items-center gap-5 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="rounded bg-[#5271df] px-4 py-2 text-white">
            <Filter className="mr-2 inline h-4" />Фильтр: 1 элемента
          </button>
          {filterOpen && (
            <div className="absolute left-5 top-full z-20 mt-2 w-64 border border-slate-200 bg-white p-4 shadow-xl">
              <label className="block text-xs font-medium text-slate-500">
                Зона
                <select value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)} className="mt-1 block w-full border-b border-slate-300 bg-white py-2 text-sm outline-none">
                  <option>Все зоны</option>
                  {zones.map((zone) => (
                    <option key={zone}>{zone}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => setFilterOpen(false)} className="mt-4 w-full rounded bg-[#5271df] py-2 text-sm font-semibold text-white">Применить</button>
            </div>
          )}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск" className="ml-3 w-80 border-b border-slate-300 px-2 py-2 outline-none" />
          <Search className="-ml-12 text-slate-400" />
          <span className="ml-auto">25　 1 - {visible.length} из {orders.length}　 ◀ ▶　 <EyeOff className="inline" /></span>
          <button type="button" onClick={passToDelivery} className="rounded bg-[#70cf84] px-4 py-2 font-semibold text-white">
            <Truck className="mr-2 inline h-5" />Передать
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1600px] text-left">
            <thead className="bg-[#626b7e] text-white">
              <tr>{["▦", "№", "Клиент", "Тип", "Дата создания", "Доставщик", "Дата доставки", "Агент", "Сумма заказа", "Баланс", "Статус"].map((head) => <th key={head} className="px-4 py-4">{head}</th>)}</tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-16 text-center text-slate-500">Загрузка заказов...</td></tr>
              ) : loadError ? (
                <tr><td colSpan={11} className="px-4 py-16 text-center text-red-600">{loadError}</td></tr>
              ) : visible.map((row) => (
                <tr onClick={() => setSelected(row)} key={row.id} className="cursor-pointer border-b-2 border-dotted border-slate-200 hover:bg-blue-50">
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={checkedIds.includes(row.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleChecked(row.id)} />
                  </td>
                  <td className="px-4">{row.id}</td>
                  <td className="px-4 py-3">{row.client}<br /><span>Зона: {row.zone || "Не указано"}</span></td>
                  <td className="px-4">{row.type}<br /><b>{row.product}</b></td>
                  <td className="px-4">{row.created}</td>
                  <td className="px-4">Admin Ritm<br /><span className="text-[#5271df]">Не указано</span></td>
                  <td className="px-4">{row.delivery}</td>
                  <td className="px-4">{row.agent}<br /><span className="text-[#5271df]">0 кг.</span></td>
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

      {selected && <OrderDetail order={selected} close={() => setSelected(null)} onUpdate={updateOrder} router={router} />}

      {addOpen && (
        <AddOrderModal onClose={() => setAddOpen(false)} onSave={addOrder} />
      )}

      {bulkPayOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">Групповая оплата</h3>
              <button type="button" onClick={() => setBulkPayOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <p className="mb-5 text-sm text-slate-500">Выбрано заказов: {checkedIds.length || "0 (отметьте заказы в таблице)"}</p>
            <button
              type="button"
              onClick={() => {
                if (checkedIds.length) flash(`Оплата принята по ${checkedIds.length} заказ(ам)`)
                setBulkPayOpen(false)
                setCheckedIds([])
              }}
              disabled={!checkedIds.length}
              className="w-full rounded-md bg-[#70cf84] py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Оплатить
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

function Tabs({ labels, value, onChange }: { labels: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <>
      {labels.map((label) => (
        <button key={label} onClick={() => onChange(label)} className={`py-4 text-center ${value === label ? "border-b-4 border-[#586ce8]" : ""}`}>
          {label}
        </button>
      ))}
    </>
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
          <h3 className="text-lg font-bold">Добавить заказ</h3>
          <button type="button" onClick={onClose} aria-label="Закрыть"><X className="h-5 w-5" /></button>
        </div>
        <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
          Клиент
          <input autoFocus value={client} onChange={(event) => setClient(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
        </label>
        <button type="submit" className="w-full rounded-md bg-[#70cf84] py-3 font-semibold text-white">Создать</button>
      </form>
    </div>
  )
}

function OrderDetail({
  order,
  close,
  onUpdate,
  router,
}: {
  order: Order
  close: () => void
  onUpdate: (id: number, patch: Partial<Order>) => void
  router: ReturnType<typeof useRouter>
}) {
  const [editOpen, setEditOpen] = useState(false)
  const [editClient, setEditClient] = useState(order.client)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [discountValue, setDiscountValue] = useState("")

  function cycleStatus() {
    const index = statuses.indexOf(order.status)
    onUpdate(order.id, { status: statuses[(index + 1) % statuses.length] })
  }

  return (
    <section className="mx-4 mt-6 bg-white shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
        <h2 className="text-2xl">Заказ №{order.id}</h2>
        <div className="flex flex-wrap gap-3">
          <Button text="✎  Изменить статус" onClick={cycleStatus} />
          <Button text="✎  Изменить" onClick={() => setEditOpen(true)} />
          <Button text="⌁  Скидка" onClick={() => setDiscountOpen(true)} />
          <Button text="↩  Возврат" onClick={() => router.push("/analytics/returns")} />
          <Button text="▣  Распечатать" onClick={() => window.print()} />
          <button onClick={close} aria-label="Закрыть"><X /></button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 p-5 leading-8 sm:grid-cols-3 sm:divide-x">
        <div>
          Клиент: <b className="float-right text-[#5271df]">{order.client}</b><br />
          Транспорт: <b className="float-right">Не указан</b><br />
          Филиал: <b className="float-right">ddr</b><br />
          Склад: <b className="float-right">toshkent</b><br />
          Договор: <b className="float-right">Не указан</b>
        </div>
        <div className="sm:px-5">
          Прайс-лист: <b className="float-right">donalik</b><br />
          Организация: <b className="float-right">energetik</b><br />
          Тип оплаты: <b className="float-right">Наличные</b><br />
          Общая стоимость <b className="float-right">50 000 SUM</b><br />
          {order.discount && (
            <>
              Скидка <b className="float-right text-[#278549]">{order.discount}</b><br />
            </>
          )}
          Остаток: <b className="float-right text-red-400">50 000 SUM</b>
        </div>
        <div className="sm:pl-5">
          Создал: <b className="float-right">{order.agent}</b><br />
          Доставщик: <b className="float-right">{order.agent}</b><br />
          Экспедитор: <b className="float-right">Не указано</b><br />
          Дата создания <b className="float-right">03 февр. 2026</b><br />
          Текущий статус: <b className="float-right text-orange-400">{order.status}</b>
        </div>
      </div>
      <div className="border-t p-5">
        <h3 className="mb-3 text-center text-lg">Список товаров</h3>
        <table className="w-full border">
          <thead className="bg-slate-100">
            <tr><th className="p-3">№</th><th>Товар</th><th>Количество</th><th>Цена SUM</th><th>Сумма SUM</th></tr>
          </thead>
          <tbody>
            <tr><td className="p-4">1</td><td>energetik 1 l<br /><span className="text-[#5271df]">123321</span></td><td>5 кг</td><td>10 000</td><td>50 000</td></tr>
          </tbody>
        </table>
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onUpdate(order.id, { client: editClient.trim() || order.client })
              setEditOpen(false)
            }}
            className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-bold">Изменить заказ</h3>
              <button type="button" onClick={() => setEditOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              Клиент
              <input autoFocus value={editClient} onChange={(event) => setEditClient(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
            </label>
            <button type="submit" className="w-full rounded-md bg-[#5271df] py-3 font-semibold text-white">Сохранить</button>
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
              <h3 className="text-lg font-bold">Скидка</h3>
              <button type="button" onClick={() => setDiscountOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
              Скидка, %
              <input autoFocus type="number" min="0" max="100" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none" />
            </label>
            <button type="submit" className="w-full rounded-md bg-[#5271df] py-3 font-semibold text-white">Применить</button>
          </form>
        </div>
      )}
    </section>
  )
}
