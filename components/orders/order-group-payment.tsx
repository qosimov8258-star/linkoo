"use client"

import { X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import type { Order } from "./orders-data"
import { RefDate, RefSelect } from "./order-ref-fields"

type Cashbox = { id: number; name: string; currency: string }
type Named = { id: number; name: string }

/** The reference's "magnet" icon: puts the order's remaining amount into the cell / the whole column. */
const MAGNET =
  "M960.288 60.176V31.168c0-17.68-14.32-32-32-32H703.664c-17.68 0-32 14.32-32 32v130.656c0 .048.032.096.032.144v397.52c0 96.32-54.336 174.656-150.656 174.656s-168.656-78.336-168.656-174.656V60.176h-.095V31.168c0-17.68-14.32-32-32-32H95.665c-17.68 0-32 14.32-32 32v130.656c0 .656.335 1.2.368 1.84V574.16c0 248.912 198.784 450.656 447.664 450.656S960.353 823.072 960.353 574.16V60.176zm-64 2.992v128.336H736.032V63.168h160.256zm-608 0v128.336H128.032V63.168h160.256zM511.68 960.832c-213.216 0-383.663-173.472-383.663-386.655V255.505h160.336v303.984c0 131.808 100.848 238.655 232.655 238.655S735.68 691.296 735.68 559.489V255.505h160.656v318.672c0 213.184-171.424 386.655-384.656 386.655z"

const BOX_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const BOX_CHECKED = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

const todayIso = () => {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
const longDate = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number)
  return year && month && day ? `${day} ${MONTHS[month - 1]} ${year} г.` : ""
}
const formatNumber = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
const currencyOf = (order: Order) => order.amount.trim().split(/\s+/).pop() || "SUM"
const dueOf = (order: Order) => Math.max(0, order.orderBalance ?? order.totalPrice ?? 0)

/**
 * "ГРУППОВАЯ ОПЛАТА" of the ticked orders: payment date / branch / responsible staff on top, then one row per order with an
 * amount input for every cashbox. Each filled cell is paid through POST /api/cash/orders/[id]/pay (one customer payment per cell).
 */
export function OrderGroupPayment({ orders, onClose, onSaved }: { orders: Order[]; onClose: () => void; onSaved: (payments: number) => void }) {
  const { t } = useLanguage()
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [branches, setBranches] = useState<Named[]>([])
  const [employees, setEmployees] = useState<Named[]>([])
  const [date, setDate] = useState(todayIso)
  const [branch, setBranch] = useState("")
  const [responsible, setResponsible] = useState("")
  const [verified, setVerified] = useState(true)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [comments, setComments] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const load = <T,>(url: string, set: (rows: T[]) => void) =>
      fetch(url)
        .then(async (response) => (response.ok ? ((await response.json()) as T[]) : []))
        .then(set)
        .catch(() => set([]))
    load<Cashbox>("/api/cashboxes?sort=created", setCashboxes)
    load<Named>("/api/branches?sort=created", (all) => {
      const rows = all.filter((row, index) => all.findIndex((other) => other.name === row.name) === index)
      setBranches(rows)
      // the reference preselects the first branch of its list
      setBranch((current) => current || rows[0]?.name || "")
    })
    load<{ id: number; name?: string; firstName?: string; lastName?: string }>("/api/employees", (rows) =>
      setEmployees(rows.map((row) => ({ id: row.id, name: row.name || `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() }))),
    )
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const key = (orderId: number, cashboxId: number) => `${orderId}:${cashboxId}`
  const paid = useMemo(() => Object.values(amounts).reduce((sum, value) => sum + (Number(value) || 0), 0), [amounts])
  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>()
    for (const order of orders) byCurrency.set(currencyOf(order), (byCurrency.get(currencyOf(order)) ?? 0) + (order.totalPrice ?? 0))
    return [...byCurrency.values()]
  }, [orders])

  const fill = (orderId: number, cashboxId: number, due: number) => setAmounts((current) => ({ ...current, [key(orderId, cashboxId)]: String(due) }))

  async function save() {
    const cells = orders.flatMap((order) =>
      cashboxes
        .map((cashbox) => ({ order, cashbox, amount: Number(amounts[key(order.id, cashbox.id)]) || 0 }))
        .filter((cell) => cell.amount > 0),
    )
    if (!cells.length) return setError(t("Укажите сумму оплаты"))
    setSaving(true)
    setError("")
    let done = 0
    try {
      for (const cell of cells) {
        const response = await fetch(`/api/cash/orders/${cell.order.id}/pay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date,
            cashboxId: cell.cashbox.id,
            branch: branch || undefined,
            amount: cell.amount,
            comment: comments[cell.order.id] || undefined,
            isVerified: verified,
            responsibleId: responsible ? Number(responsible) : undefined,
          }),
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error || t("Не удалось сохранить изменения на сервере"))
        }
        done += 1
      }
      onSaved(done)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Не удалось сохранить изменения на сервере"))
      if (done) onSaved(done)
    } finally {
      setSaving(false)
    }
  }

  const th = "whitespace-nowrap p-[10px] text-left align-middle text-[13px] font-bold text-[#333]"
  const td = "p-[10px] align-middle text-[13px] font-semibold text-[#333]"
  return (
    <div data-order-overlay className="fixed inset-0 z-[1200] flex flex-col bg-white font-sans text-[13px] text-[#333]">
      <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[15px]">
        <h3 className="text-[13px] font-bold uppercase text-[#333]">{t("Групповая оплата")}</h3>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
          <X className="h-6 w-6 text-[#333]" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[30px] pb-[20px] pt-[6px]">
        <RefDate className="mb-[29px]" height={42} label={t("Дата оплаты")} value={date} display={longDate(date)} onChange={setDate} />
        <RefSelect
          className="mb-[20px] !h-[49px]"
          label={t("Филиал")}
          value={branch}
          options={branches.map((item) => ({ value: item.name, label: item.name }))}
          onChange={setBranch}
          onClear={() => setBranch("")}
        />
        <RefSelect
          className="!h-[48px]"
          alwaysFloat
          label={t("Ответственный персонал")}
          value={responsible}
          options={employees.map((item) => ({ value: String(item.id), label: item.name }))}
          onChange={setResponsible}
          onClear={() => setResponsible("")}
        />
        <label className="ml-[2px] mt-[16px] flex h-5 cursor-pointer items-center text-[13px] font-semibold text-black">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden>
            <path d={verified ? BOX_CHECKED : BOX_EMPTY} fill={verified ? "#5d6474" : "#666"} />
          </svg>
          <input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} className="sr-only" />
          <span className="pl-[6px]">{t("Подтвержденный приход (Я получил деньги)")}</span>
        </label>
        <div className="mt-[23px] w-full overflow-x-auto">
          <table className="border-collapse">
            <thead>
              <tr className="h-[60px]">
                <th className={th}>{t("Заказ")}</th>
                <th className={th}>{t("Клиент")}</th>
                <th className={th}>{t("Доставщик")}</th>
                <th className={th}>{t("Сумма заказа")}</th>
                {cashboxes.map((cashbox) => (
                  <th key={cashbox.id} className={th}>
                    <div className="flex items-center justify-end">
                      {cashbox.name} ({cashbox.currency})
                      <button
                        type="button"
                        aria-label={t("Заполнить остаток")}
                        onClick={() => orders.forEach((order) => fill(order.id, cashbox.id, dueOf(order)))}
                        className="flex h-10 w-10 items-center justify-center"
                      >
                        <svg viewBox="0 0 1024 1024" className="h-4 w-4" style={{ fill: "#333" }}><path d={MAGNET} /></svg>
                      </button>
                    </div>
                  </th>
                ))}
                <th className={th}>{t("Комментарий")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="h-[72px]">
                  <td className={td}>{order.id}</td>
                  <td className={`${td} min-w-[76px] max-w-[120px]`}>{order.marketName || order.client}</td>
                  <td className={`${td} whitespace-nowrap`}>{order.deliveryMan || "—"}</td>
                  <td className={`${td} whitespace-nowrap`}>{order.amount}</td>
                  {cashboxes.map((cashbox) => (
                    <td key={cashbox.id} className={td}>
                      <div className="flex items-center justify-end">
                        <div className="relative h-[45px] flex-1">
                          <input
                            value={amounts[key(order.id, cashbox.id)] ?? ""}
                            inputMode="decimal"
                            onChange={(event) => setAmounts((current) => ({ ...current, [key(order.id, cashbox.id)]: event.target.value.replace(/[^\d.]/g, "") }))}
                            className="h-[45px] w-full min-w-[55px] bg-transparent pt-[12px] text-right text-[13px] font-semibold text-black outline-none"
                          />
                          <hr className="absolute inset-x-0 bottom-0 m-0 h-px border-0 bg-[#808080]/60" />
                        </div>
                        <button type="button" aria-label={t("Заполнить остаток")} onClick={() => fill(order.id, cashbox.id, dueOf(order))} className="flex h-10 w-10 shrink-0 items-center justify-center">
                          <svg viewBox="0 0 1024 1024" className="h-4 w-4" style={{ fill: "#333" }}><path d={MAGNET} /></svg>
                        </button>
                      </div>
                    </td>
                  ))}
                  <td className={td}>
                    <div className="relative h-[45px] w-[97px]">
                      <input
                        value={comments[order.id] ?? ""}
                        onChange={(event) => setComments((current) => ({ ...current, [order.id]: event.target.value }))}
                        className="h-[45px] w-full bg-transparent pt-[12px] text-[13px] font-semibold text-black outline-none"
                      />
                      <hr className="absolute inset-x-0 bottom-0 m-0 h-px border-0 bg-[#808080]/60" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex h-[57px] shrink-0 items-center border-t border-[#efefef] pl-[10px] pr-[2px]">
        <span className="text-[14px] text-black">
          {t("Общая сумма:")} <span className="text-[16px] font-semibold text-[#129fdd]">{totals.map(formatNumber).join(" , ")}</span>
          <span className="ml-[10px]">,</span>
        </span>
        <span className="ml-[20px] text-[14px] text-black">
          {t("Сумма к оплате:")} <span className="text-[16px] font-semibold text-[#129fdd]">{formatNumber(paid)}</span>
        </span>
        {error && <span className="ml-6 text-[#e57373]">{error}</span>}
        <button type="button" disabled={saving} onClick={save} className="ml-auto h-9 min-w-[88px] disabled:opacity-40">
          <span className="inline-block px-[16px] py-[9px] text-[13px] font-semibold uppercase leading-[18px] text-[#129fdd]">{t("Сохранить")}</span>
        </button>
      </div>
    </div>
  )
}
