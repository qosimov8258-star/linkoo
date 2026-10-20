"use client"

import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import { RI, RefButton, RefHeader } from "@/components/ref/list-kit"
import { ReportMultiChipField, ReportPage, ReportRangeField, ReportSelectField, formatShortReportDate } from "@/components/ref/report-kit"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { ORDER_STATUSES } from "@/components/orders/orders-data"
import { useLanguage } from "@/lib/i18n/language-context"

type PeriodData = { stores: number; storePercent: number; sum: number; sumPercent: number; dynamic?: number }
type ClassificationRow = { name: string; periods: [PeriodData, PeriodData, PeriodData] }
type Period = { from: string; to: string }
type ClientRow = { id?: number; name: string; zone?: string; agent?: string; branch?: string; type?: string }
type OrderRow = { client: string; clientId?: number | null; created: string; amount: string; type: string; status?: string }

const GEAR = "M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"

type ClassRow = { name: string; amount: number }

const DEFAULT_CLASSES: ClassRow[] = [
  { name: "< 1 млн", amount: 1_000_000 },
  { name: "1-2 млн", amount: 2_000_000 },
  { name: "2-3 млн", amount: 3_000_000 },
  { name: "3-5 млн", amount: 5_000_000 },
  { name: "5-10 млн", amount: 10_000_000 },
  { name: "10-20 млн", amount: 20_000_000 },
]

function bucketNames(classes: ClassRow[]) {
  const last = classes[classes.length - 1]
  return ["Нет заказа", ...classes.map((row) => row.name), `> ${last ? last.amount / 1_000_000 : 0} млн`]
}

function bucketOf(total: number, classes: ClassRow[]) {
  if (total <= 0) return 0
  const index = classes.findIndex((row) => total < row.amount)
  return index === -1 ? classes.length + 1 : index + 1
}

function isoDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Same tolerant parsing as the other order reports: ISO date or "06 сент. 14:23" (no year).
function orderDate(value: string): Date | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  const ru = value.match(/(\d{1,2})\s+([а-яё]+)\.?/i)
  if (!ru) return null
  const names = ["янв", "февр", "мар", "апр", "мая", "июня", "июля", "авг", "сент", "окт", "нояб", "дек"]
  const month = names.indexOf(ru[2].toLowerCase())
  if (month < 0) return null
  const year = value.match(/(\d{4})/)
  return new Date(year ? Number(year[1]) : new Date().getFullYear(), month, Number(ru[1]))
}

function defaultPeriods(): [Period, Period, Period] {
  const now = new Date()
  return [2, 1, 0].map((back) => {
    const start = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - back + 1, 0)
    return { from: isoDate(start), to: isoDate(end) }
  }) as [Period, Period, Period]
}

// Fixed choices; zone / brand / product type / agent / branch / client type come
// from the factory's own directories (never another tenant's names).
const FIXED_SELECTS = {
  status: [...ORDER_STATUSES] as string[],
  dateBy: ["Доставки", "Заказы", "Оплаты"],
  closing: ["Незакрыто", "Закрыто", "Все"],
}
type SelectKey = "zone" | "status" | "brand" | "productType" | "agent" | "branch" | "clientType" | "dateBy" | "closing"
const same = (a: string | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase()
const DEFAULT_STATUSES = ["В пути", "Доставлено"]
const labels: Record<SelectKey, string> = { zone: "Зона", status: "Статус", brand: "Бренд", productType: "Тип товара", agent: "Ответственный агент магазина", branch: "Филиалы", clientType: "Тип клиента", dateBy: "По дате", closing: "Статус закрытия" }

export function ClientDynamicsView() {
  const { t } = useLanguage()
  const zones = useDirectoryNames("zones")
  const brands = useDirectoryNames("brands")
  const productTypes = useDirectoryNames("productTypes")
  const agents = useDirectoryNames("employees")
  const branches = useDirectoryNames("branches")
  const clientTypes = useDirectoryNames("clientTypes")
  const selects: Record<SelectKey, string[]> = { ...FIXED_SELECTS, zone: zones, brand: brands, productType: productTypes, agent: agents, branch: branches, clientType: clientTypes }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [classes, setClasses] = useState<ClassRow[]>(DEFAULT_CLASSES)
  const [periods, setPeriods] = useState<[Period, Period, Period]>(defaultPeriods)
  const [filters, setFilters] = useState<Record<SelectKey, string>>({ zone: "", status: "", brand: "", productType: "", agent: "", branch: "", clientType: "", dateBy: "Доставки", closing: "Незакрыто" })
  const [statuses, setStatuses] = useState<string[]>(DEFAULT_STATUSES)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [applied, setApplied] = useState(periods)
  // The filters in force (set by «Фильтр», like the periods).
  const [appliedFilters, setAppliedFilters] = useState(() => ({ ...filters, statuses: DEFAULT_STATUSES }))
  const periodLabels = useMemo(() => applied.map(periodLabel), [applied])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      // balances=0: this report needs no per-order client balances.
      fetch("/api/clients?balances=0").then((response) => (response.ok ? (response.json() as Promise<ClientRow[]>) : [])),
      fetch("/api/orders?balances=0").then((response) => (response.ok ? (response.json() as Promise<OrderRow[]>) : [])),
    ])
      .then(([clientRows, orderRows]) => {
        if (cancelled) return
        setClients(clientRows)
        setOrders(orderRows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Every store lands in one bucket per period by the sum of its (non-return) orders in that period.
  // Stores of the chosen zone / responsible agent / branch / client type.
  const shownClients = useMemo(
    () =>
      clients.filter(
        (client) =>
          (!appliedFilters.zone || same(client.zone, appliedFilters.zone)) &&
          (!appliedFilters.agent || same(client.agent, appliedFilters.agent)) &&
          (!appliedFilters.branch || same(client.branch, appliedFilters.branch)) &&
          (!appliedFilters.clientType || same(client.type, appliedFilters.clientType)),
      ),
    [clients, appliedFilters],
  )
  const rows = useMemo<ClassificationRow[]>(() => {
    // Orders belong to a store by client id (contract 6), by name only for legacy rows.
    const clientKey = (client: ClientRow) => (client.id != null ? `id:${client.id}` : `name:${client.name}`)
    const byName = new Map(clients.map((client) => [client.name, clientKey(client)]))
    const keyOf = (order: OrderRow) => (order.clientId != null ? `id:${order.clientId}` : (byName.get(order.client) ?? `name:${order.client}`))
    const perPeriod = applied.map((period) => {
      const totals = new Map<string, number>()
      for (const order of orders) {
        if (order.type === "Возврат") continue
        if (appliedFilters.statuses.length && !appliedFilters.statuses.includes(order.status ?? "")) continue
        const date = orderDate(order.created)
        if (!date || isoDate(date) < period.from || isoDate(date) > period.to) continue
        const key = keyOf(order)
        totals.set(key, (totals.get(key) ?? 0) + (Number.parseFloat(order.amount.replace(/[^\d.,-]/g, "").replace(",", ".")) || 0))
      }
      const buckets = bucketNames(classes).map(() => ({ stores: 0, sum: 0 }))
      for (const client of shownClients) {
        const total = totals.get(clientKey(client)) ?? 0
        const bucket = buckets[bucketOf(total, classes)]
        bucket.stores += 1
        bucket.sum += total
      }
      const storeTotal = shownClients.length || 1
      const sumTotal = buckets.reduce((sum, bucket) => sum + bucket.sum, 0) || 1
      return buckets.map((bucket) => ({
        stores: bucket.stores,
        storePercent: Math.round((bucket.stores / storeTotal) * 100),
        sum: bucket.sum,
        sumPercent: Math.round((bucket.sum / sumTotal) * 100),
      }))
    })
    return bucketNames(classes).map((name, index) => {
      const dynamic = (current: number, previous: number) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0)
      return {
        name,
        periods: [
          perPeriod[0][index],
          { ...perPeriod[1][index], dynamic: dynamic(perPeriod[1][index].stores, perPeriod[0][index].stores) },
          { ...perPeriod[2][index], dynamic: dynamic(perPeriod[2][index].stores, perPeriod[1][index].stores) },
        ],
      }
    })
  }, [applied, appliedFilters, classes, clients, shownClients, orders])

  function download() {
    const header = ["Классификация", ...periodLabels.flatMap((label) => [`${label} магазинов`, "%", "Сумма заказа", "%", "Динамика`"])].join(";")
    const body = rows.map((row) => [row.name, ...row.periods.flatMap((item) => [item.stores, item.storePercent, item.sum, item.sumPercent, item.dynamic ?? ""])].join(";"))
    const url = URL.createObjectURL(new Blob([`\uFEFF${[header, ...body].join("\n")}`], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "client-dynamics.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  const setPeriod = (index: number, patch: Partial<Period>) => setPeriods((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)) as [Period, Period, Period])
  const th = "border border-[#ddd] px-1 py-[10px] text-center text-[12px] font-semibold leading-4 text-[#47494b]"

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]">
        <RefHeader title={t("Классификация и динамика клиентов")}>
          <RefButton icon={RI.chart} green label={t("Скачать")} onClick={download} />
          <RefButton icon={GEAR} label={t("Настроить классификацию")} onClick={() => setSettingsOpen(true)} />
        </RefHeader>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          setApplied(periods)
          setAppliedFilters({ ...filters, statuses })
        }}
        className="mx-7 bg-white px-[20px] pb-[11px] pt-[10px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
      >
        <h2 className="text-[14px] leading-[18px] text-[#666]">{t("Фильтр")}</h2>
        <div className="mt-[6px] grid gap-x-[10px] gap-y-[13px] md:grid-cols-2 xl:grid-cols-4">
          {(["zone", "status", "brand", "productType", "agent", "branch", "clientType", "dateBy"] as SelectKey[]).map((key) =>
            key === "status" ? (
              <ReportMultiChipField key={key} label={labels[key]} values={statuses} options={selects.status} onChange={setStatuses} />
            ) : (
            <ReportSelectField key={key} label={labels[key]} value={filters[key]} options={selects[key]} onChange={(value) => setFilters((current) => ({ ...current, [key]: value }))} clearable={key !== "dateBy"} />
            ),
          )}
          {periods.map((period, index) => (
            <ReportRangeField className="mt-[9px]" key={index} label={["Первый период", "Второй период", "Третий период"][index]} from={period.from} to={period.to} onFrom={(value) => setPeriod(index, { from: value })} onTo={(value) => setPeriod(index, { to: value })} />
          ))}
          <ReportSelectField label={labels.closing} value={filters.closing} options={selects.closing} onChange={(value) => setFilters((current) => ({ ...current, closing: value }))} />
        </div>
        <button type="submit" className="mt-[14px] h-9 w-[88px] rounded-[3px] bg-[#5d6474] text-[13px] font-semibold uppercase text-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] hover:brightness-110">{t("Фильтр")}</button>
      </form>

      <section className="mx-7 mt-[10px] overflow-x-auto bg-white">
        <table className="w-full min-w-[1200px] table-fixed border-collapse text-[13px]">
          <colgroup>
            {[152, 137, 80, 115, 81, 114, 68, 95, 79, 83, 108, 64, 90, 90, 87].map((width, index) => <col key={index} style={{ width: `${(width / 1443) * 100}%` }} />)}
          </colgroup>
          <thead>
            <tr><th rowSpan={2} className={th}>{t("Классификация")}</th>{periodLabels.map((label, index) => <th key={label} colSpan={index === 0 ? 4 : 5} className={`${th} ${index ? "border-l-2 border-l-black" : ""}`}>{label}</th>)}</tr>
            <tr>{periodLabels.flatMap((_, period) => ["Колв. магазинов", "%", "Сумма заказа", "%", ...(period ? ["Динамика"] : [])].map((title, index) => <th key={`${period}-${index}`} className={`${th} ${period && index === 0 ? "border-l-2 border-l-black" : ""}`}>{t(title)}</th>))}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="h-[57px]">
                <td className="border border-[#ddd] px-[6px]">{t(row.name)}</td>
                {row.periods.flatMap((data, period) => [
                  <td key={`${period}-stores`} className={`border border-[#ddd] px-[6px] text-right font-semibold text-[#4f71dc] ${period ? "border-l-2 border-l-black" : ""}`}>{format(data.stores)}</td>,
                  <td key={`${period}-sp`} className="border border-[#ddd] px-[6px] text-right">{data.storePercent} %</td>,
                  <td key={`${period}-sum`} className="border border-[#ddd] px-[6px] text-right">{format(Math.round(data.sum))}</td>,
                  <td key={`${period}-sump`} className="border border-[#ddd] px-[6px] text-right">{data.sumPercent} %</td>,
                  ...(period ? [<td key={`${period}-dynamic`} className="border border-[#ddd] p-[6px] text-center"><Dynamic value={data.dynamic ?? 0} spaced={period === 1} /></td>] : []),
                ])}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {settingsOpen && <ClassificationSettings classes={classes} onSave={(next) => { setClasses(next); setSettingsOpen(false) }} onClose={() => setSettingsOpen(false)} />}
    </ReportPage>
  )
}

function Dynamic({ value, spaced }: { value: number; spaced?: boolean }) {
  const positive = value > 0
  return <span className={`inline-block w-full rounded-[3px] py-[8px] text-[13px] font-semibold ${positive ? "bg-[#dff5e3] text-[#35b653]" : "bg-[#fde2e2] text-[#f25555]"}`}>{positive ? "▲" : "▼"} {format(value)}{spaced ? " %" : "%"}</span>
}
function ClassificationSettings({ classes, onSave, onClose }: { classes: ClassRow[]; onSave: (rows: ClassRow[]) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState(classes)
  const [draftName, setDraftName] = useState("")
  const [draftAmount, setDraftAmount] = useState("")
  const fmt = (value: number) => (value ? value.toLocaleString("ru-RU") : "")
  const float = "absolute left-0 top-0 text-[10px] font-bold leading-3"
  return (
    <div className="fixed inset-0 z-[90] bg-black/[0.54]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" className="fixed bottom-[48px] left-1/2 top-[80px] flex w-[500px] max-w-full -translate-x-1/2 flex-col bg-white text-[13px] text-[#333] shadow-[0_10px_30px_rgba(0,0,0,0.3)]">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
          <b className="uppercase">{t("Настройки")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-6 w-6" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-[30px] pb-[20px]">
          {rows.map((row, index) => (
            <div key={index} className="relative grid h-[102px] grid-cols-[215px_1fr] gap-x-[10px] pt-[60px]">
              <label className="relative block h-[36px] border-b border-[#e8e8e8]">
                <span className={`${float} -top-[18px]`}>{t("Название")}</span>
                <input value={row.name} onChange={(event) => setRows((current) => current.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))} className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent font-semibold outline-none" />
              </label>
              <label className="relative block h-[36px] border-b border-[#e8e8e8]">
                <span className={`${float} -top-[18px]`}>{t("Сумма закупа до")} <span className="text-[#e57373]">*</span></span>
                <input
                  value={fmt(row.amount)}
                  onChange={(event) => {
                    const amount = Number(event.target.value.replace(/\D/g, "")) || 0
                    setRows((current) => current.map((item, i) => (i === index ? { ...item, amount } : item)))
                  }}
                  className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent font-semibold outline-none"
                />
              </label>
              <button type="button" aria-label={t("Удалить")} onClick={() => setRows((current) => current.filter((_, i) => i !== index))} className="absolute right-0 top-[20px] flex h-[40px] w-[40px] items-center justify-center rounded-[3px] bg-[#e57373]">
                <span className="h-[2px] w-[14px] bg-white" />
              </button>
            </div>
          ))}
          <div className="mt-[20px] grid grid-cols-[215px_1fr] gap-x-[10px]">
            <label className="relative block h-[50px] border-b border-[#e8e8e8]">
              <span className={`absolute left-0 font-semibold ${draftName ? "top-0 text-[10px]" : "top-[28px] text-[13px]"}`}>{t("Название")}</span>
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent font-semibold outline-none" />
            </label>
            <input value={draftAmount} onChange={(event) => setDraftAmount(event.target.value.replace(/\D/g, ""))} placeholder="20 000 000" className="h-[52px] bg-[#f2f5f8] px-[12px] outline-none placeholder:text-[#999]" />
          </div>
          <button
            type="button"
            onClick={() => {
              const amount = Number(draftAmount)
              if (!draftName.trim() || !amount) return
              setRows((current) => [...current, { name: draftName.trim(), amount }].sort((a, b) => a.amount - b.amount))
              setDraftName("")
              setDraftAmount("")
            }}
            className="mt-[20px] h-[35px] w-full rounded-[3px] bg-[#4f71dc] font-semibold text-white hover:brightness-95"
          >
            {t("Добавить")}
          </button>
        </div>
        <footer className="flex h-[57px] shrink-0 items-center justify-end gap-[20px] border-t border-[#efefef] pr-[10px]">
          <button type="button" onClick={() => setRows(DEFAULT_CLASSES)} className="h-[35px] rounded-[3px] bg-[#71ce87] px-[16px] font-bold uppercase text-white hover:brightness-95">{t("Восстановить")}</button>
          <button type="button" onClick={() => onSave(rows)} className="h-[35px] rounded-[3px] bg-[#71ce87] px-[16px] font-bold uppercase text-white hover:brightness-95">{t("Сохранить")}</button>
        </footer>
      </section>
    </div>
  )
}
function periodLabel(period: Period) { return `${formatShortReportDate(period.from)} - ${formatShortReportDate(period.to)}` }
function format(value: number) { return value.toLocaleString("ru-RU") }
