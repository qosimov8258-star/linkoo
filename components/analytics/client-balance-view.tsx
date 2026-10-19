"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronsRight, CreditCard, List, X } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportAmount, ReportBalanceBoxes, ReportBalanceToolbar, ReportCheckboxField, ReportFilterPanel, ReportGridTable, ReportInputField, ReportPage, ReportPager, ReportRangeField, ReportSelectField, ReportTopRow, type BalanceTone } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { downloadExcelTable } from "@/lib/excel-export"

type Money = { sum: number; usd: number; eur: number }
type Client = {
  id: number
  name: string
  taxId?: string
  type: string
  opening: Money
}

type ApiClient = { id: number; name: string; inn?: string; type: string; balance?: number; balanceLines?: string[] }

const parseLine = (line: string) => {
  const match = line.trim().match(/^(-?[\d\s]+(?:,\d+)?)\s+(SUM|USD|Euro)$/)
  if (!match) return null
  return { value: Number(match[1].replace(/\s/g, "").replace(",", ".")), currency: match[2] }
}

function toClient(row: ApiClient): Client {
  const opening: Money = { sum: 0, usd: 0, eur: 0 }
  if (row.balanceLines?.length) {
    for (const line of row.balanceLines) {
      const parsed = parseLine(line)
      if (!parsed) continue
      if (parsed.currency === "SUM") opening.sum = parsed.value
      else if (parsed.currency === "USD") opening.usd = parsed.value
      else opening.eur = parsed.value
    }
  } else if (row.balance) opening.sum = row.balance
  return { id: row.id, name: row.name, taxId: row.inn || undefined, type: row.type, opening }
}

const groups = ["Баланс на начало периода", "Продано", "Возврат", "Оплачено", "Прочие приходы", "Прочие расходы", "Баланс на конец периода"] as const

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

export function ClientBalanceView() {
  const { t } = useLanguage()
  const [dateBasis, setDateBasis] = useState<"transaction" | "realization">("transaction")
  const [filterOpen, setFilterOpen] = useState(false)
  const [groupPaymentOpen, setGroupPaymentOpen] = useState(false)
  const [splitByCurrency, setSplitByCurrency] = useState(false)
  const [byType, setByType] = useState(false)
  const [typeFilter, setTypeFilter] = useState("")
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const tableRef = useRef<HTMLDivElement>(null)

  const [branch, setBranch] = useState("")
  const [zone, setZone] = useState("")
  const [lastVisit, setLastVisit] = useState("")
  const [organization, setOrganization] = useState("")
  const [agentClients, setAgentClients] = useState("")
  const [supplier, setSupplier] = useState("")
  const [balanceType, setBalanceType] = useState("")
  const [responsibleSupplier, setResponsibleSupplier] = useState("")
  const [responsibleCollector, setResponsibleCollector] = useState("")
  const [sinceOrderFrom, setSinceOrderFrom] = useState("")
  const [sinceOrderTo, setSinceOrderTo] = useState("")
  const [sincePaymentFrom, setSincePaymentFrom] = useState("")
  const [sincePaymentTo, setSincePaymentTo] = useState("")
  const [sinceRefusalFrom, setSinceRefusalFrom] = useState("")
  const [sinceRefusalTo, setSinceRefusalTo] = useState("")
  const [sinceVisitFrom, setSinceVisitFrom] = useState("")
  const [sinceVisitTo, setSinceVisitTo] = useState("")
  const [onlyRealized, setOnlyRealized] = useState(false)
  const [onlyDelivered, setOnlyDelivered] = useState(false)
  const [onlyInvoiced, setOnlyInvoiced] = useState(false)
  const [excludeClosed, setExcludeClosed] = useState(false)

  const today = useMemo(() => new Date(), [])
  const defaultFrom = useMemo(() => new Date(today.getFullYear(), today.getMonth(), 1), [today])
  const [transFrom, setTransFrom] = useState("")
  const [transTo, setTransTo] = useState("")
  const [clientFrom, setClientFrom] = useState("")
  const [clientTo, setClientTo] = useState("")
  const [appliedFrom, setAppliedFrom] = useState(() => formatDate(defaultFrom))
  const [appliedTo, setAppliedTo] = useState(() => formatDate(today))

  const filterCount = appliedFrom && appliedTo ? 1 : 0

  const [clients, setClients] = useState<Client[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/clients")
      .then(async (response) => (response.ok ? ((await response.json()) as ApiClient[]) : []))
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setClients(rows.map(toClient).sort((a, b) => b.id - a.id))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const TOTAL_CLIENTS = clients.length
  const FIXED_TOTALS = useMemo(() => ({ opening: clients.reduce((acc, client) => ({ eur: acc.eur + client.opening.eur, sum: acc.sum + client.opening.sum, usd: acc.usd + client.opening.usd }), { eur: 0, sum: 0, usd: 0 }) }), [clients])
  const typeAggregates = useMemo(() => {
    const map = new Map<string, Money>()
    for (const client of clients) {
      const current = map.get(client.type) ?? { sum: 0, usd: 0, eur: 0 }
      map.set(client.type, { sum: current.sum + client.opening.sum, usd: current.usd + client.opening.usd, eur: current.eur + client.opening.eur })
    }
    return [...map.entries()].map(([type, balance]) => ({ type, balance }))
  }, [clients])
  const types = [...new Set(clients.map((client) => client.type))]

  const filteredClients = useMemo(
    () => clients.filter((client) => typeFilter === "" || client.type === typeFilter),
    [clients, typeFilter],
  )

  const maxPage = Math.max(1, Math.ceil(filteredClients.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visibleClients = filteredClients.slice((safePage - 1) * pageSize, safePage * pageSize)

  const allSelected = visibleClients.length > 0 && visibleClients.every((client) => selected.has(client.id))
  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current)
      if (allSelected) visibleClients.forEach((client) => next.delete(client.id))
      else visibleClients.forEach((client) => next.add(client.id))
      return next
    })
  }
  const toggleOne = (id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyFilter = () => {
    if (transFrom) setAppliedFrom(formatDate(new Date(transFrom)))
    if (transTo) setAppliedTo(formatDate(new Date(transTo)))
    setPage(1)
    setFilterOpen(false)
  }

  const scrollTableToEnd = () => {
    tableRef.current?.scrollTo({ left: tableRef.current.scrollWidth, behavior: "smooth" })
  }

  const drillIntoType = (type: string) => {
    setByType(false)
    setTypeFilter(type)
    setPage(1)
  }

  const downloadAll = () => {
    const header = [t("Клиент"), t("Тип"), ...groups.flatMap((group) => [`${t(group)} SUM`, `${t(group)} USD`, `${t(group)} Euro`])]
    const body = filteredClients.map((client) => {
      const cells = groups.flatMap((group) =>
        group === "Баланс на начало периода" || group === "Баланс на конец периода"
          ? [client.opening.sum, client.opening.usd, client.opening.eur]
          : [0, 0, 0],
      )
      return [client.name, client.type, ...cells]
    })
    downloadExcelTable("client-balance.xls", [header, ...body])
  }

  const eur = (value: number): { text: string; tone: BalanceTone } => ({ text: `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)}`, tone: value > 0 ? "plus" : value < 0 ? "minus" : "default" })
  const withUnit = (value: number, unit: string) => { const line = eur(value); return { ...line, text: `${line.text} ${unit}` } }
  const zeros = [{ text: "0 Euro" }, { text: "0 SUM" }, { text: "0 USD" }]
  const openingLines = [withUnit(FIXED_TOTALS.opening.eur, "Euro"), withUnit(FIXED_TOTALS.opening.sum, "SUM"), withUnit(FIXED_TOTALS.opening.usd, "USD")]
  const cur = ["SUM", "USD", "Euro"]
  const triple = (m: Money) => [m.sum, m.usd, m.eur].map((value, index) => <ReportAmount key={index} value={value} />)
  const rangeLabel = byType
    ? `1 - ${typeAggregates.length} ${t("из")} ${typeAggregates.length}`
    : `${filteredClients.length ? (safePage - 1) * pageSize + 1 : 0} - ${Math.min(safePage * pageSize, filteredClients.length)} ${t("из")} ${typeFilter === "" ? TOTAL_CLIENTS : filteredClients.length}`

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]">
        <RefHeader title={t("Баланс клиентов")}>
          <div className="flex overflow-hidden rounded-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {([["transaction", "По дате создание транзакции"], ["realization", "По дате реализации"]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setDateBasis(key)} className={`flex h-[30px] items-center gap-2 px-[30px] text-[13px] font-medium transition-colors ${dateBasis === key ? "bg-[#71ce87] text-white" : "bg-white text-black"}`}>
                <Info className="h-4 w-4" /> {t(label)}
              </button>
            ))}
          </div>
        </RefHeader>
      </div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[21px]">
        <div className="relative px-[30px]">
          <ReportTopRow filterLabel={`${t("Фильтр")} / ${filterCount}`} scope={`${appliedFrom} - ${appliedTo} ${t("Во всей организации")}`} onFilter={() => setFilterOpen(true)} onDownload={downloadAll} />
          <button onClick={() => setGroupPaymentOpen(true)} className="absolute right-[147px] top-0 flex h-[34px] items-center rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95"><CreditCard className="mr-2 h-[18px] w-[18px]" /> {t("Групповая оплата")}</button>
        </div>
        <div className="mt-[15px]">
          <ReportBalanceBoxes
            className="mx-[30px]"
            columns={[
              { blocks: [{ title: t("Баланс на начало периода"), lines: openingLines }, { title: t("Продажи"), lines: zeros }] },
              { blocks: [{ title: t("Возврат"), lines: zeros }, { title: t("Оплачено"), lines: zeros }] },
              { blocks: [{ title: t("Прочие приходы"), lines: zeros }, { title: t("Прочие расходы"), lines: zeros }] },
              { right: true, blocks: [{ title: t("Баланс на конец периода"), lines: openingLines }] },
            ]}
          />
        </div>

        <ReportBalanceToolbar
          search=""
          onSearch={() => undefined}
          left={
            <div className="flex">
              <button onClick={() => setSplitByCurrency((value) => !value)} className={`h-[30px] rounded-l-[3px] border px-4 text-[13px] uppercase ${splitByCurrency ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#4f71dc] bg-[#4f71dc] text-white"}`}>{t("Разбить по валютам")}</button>
              <button onClick={() => { setByType((value) => !value); setTypeFilter(""); setPage(1) }} className={`h-[30px] rounded-r-[3px] border px-4 text-[13px] uppercase ${byType ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e0e0e0] bg-white text-black"}`}>{t("Показать по типам клиентов")}</button>
            </div>
          }
          pager={
            <div className="flex items-center gap-[20px]">
              <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={rangeLabel} canPrev={!byType && safePage > 1} canNext={!byType && safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
              <button aria-label={t("Полный экран")} onClick={() => document.documentElement.requestFullscreen?.()}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg></button>
            </div>
          }
        >
          <span className="absolute left-[600px] text-[13px] font-semibold">{byType ? t("Тип клиента") : t("Клиент")}</span>
        </ReportBalanceToolbar>

        <div ref={tableRef} className="relative">
          <ReportGridTable
            minWidth={2600}
            colWidths={["220px", "30px", ...Array.from({ length: 21 }, () => "")]}
            groups={[{ title: "", span: 2 }, ...groups.map((group) => ({ title: t(group), span: 3 }))]}
            heads={[byType ? t("Тип клиента") : t("Клиент"), byType ? "" : <input key="all" type="checkbox" checked={allSelected} onChange={toggleAll} className="h-[14px] w-[14px] accent-[#444]" />, ...groups.flatMap(() => cur)]}
            emptyText={t("Нет данных")}
            rows={
              byType
                ? typeAggregates.map((row) => [
                    <button key="t" onClick={() => drillIntoType(row.type)} className="flex items-center gap-2 text-left hover:text-[#4f71dc]">{row.type} <List className="h-4 w-4 text-[#4f71dc]" /></button>,
                    "",
                    ...triple(row.balance),
                    ...Array.from({ length: 15 }, () => 0),
                  ])
                : visibleClients.map((client) => [
                    <div key="n"><div>{client.name}</div>{client.taxId && <div className="text-[12px] text-[#555]">({client.taxId})</div>}</div>,
                    <input key="c" type="checkbox" checked={selected.has(client.id)} onChange={() => toggleOne(client.id)} className="h-[14px] w-[14px] accent-[#444]" />,
                    ...triple(client.opening),
                    ...Array.from({ length: 15 }, () => 0),
                  ])
            }
          />
          <button aria-label={t("Прокрутить таблицу вправо")} onClick={scrollTableToEnd} className="fixed right-0 top-1/2 z-10 flex h-14 w-9 -translate-y-1/2 items-center justify-center rounded-l-full bg-[#bdbdbd]/80 text-[#2f3a87] shadow-lg">
            <ChevronsRight className="h-5 w-5" />
          </button>
        </div>
      </section>

      {filterOpen && (
        <ReportFilterPanel onClose={() => setFilterOpen(false)} onApply={applyFilter}>
          <ReportRangeField label={t("Период создания транзакции")} from={transFrom || toIso(defaultFrom)} to={transTo || toIso(today)} onFrom={setTransFrom} onTo={setTransTo} />
          <ReportSelectField label="Филиалы" value={branch} onChange={setBranch} options={["Центральный", "Ташкент", "Фаргона"]} />
          <ReportSelectField label="Зона" value={zone} onChange={setZone} options={["Розничный", "Рабочий", "Не рабочий зона"]} />
          <ReportSelectField label="Последнее посещение" value={lastVisit} onChange={setLastVisit} options={["Сегодня", "Неделя", "Месяц"]} />
          <ReportRangeField label={t("Период создания клиента")} from={clientFrom || toIso(defaultFrom)} to={clientTo || toIso(today)} onFrom={setClientFrom} onTo={setClientTo} />
          <ReportInputField label="Прошло дней с последнего заказа (от)" value={sinceOrderFrom} onChange={setSinceOrderFrom} />
          <ReportInputField label="Прошло дней с последнего заказа (до)" value={sinceOrderTo} onChange={setSinceOrderTo} />
          <ReportInputField label="Прошло дней с последней оплаты (от)" value={sincePaymentFrom} onChange={setSincePaymentFrom} />
          <ReportInputField label="Прошло дней с последней оплаты (до)" value={sincePaymentTo} onChange={setSincePaymentTo} />
          <ReportInputField label="Прошло дней с последнего отказа (от)" value={sinceRefusalFrom} onChange={setSinceRefusalFrom} />
          <ReportInputField label="Прошло дней с последнего отказа (до)" value={sinceRefusalTo} onChange={setSinceRefusalTo} />
          <ReportInputField label="Прошло дней с последнего визита (от)" value={sinceVisitFrom} onChange={setSinceVisitFrom} />
          <ReportInputField label="Прошло дней с последнего визита (до)" value={sinceVisitTo} onChange={setSinceVisitTo} />
          <ReportSelectField label="Организация" value={organization} onChange={setOrganization} options={["Linko"]} />
          <ReportSelectField label="Тип клиента" value={typeFilter} onChange={(value) => { setTypeFilter(value); setByType(false); setPage(1) }} options={types} />
          <ReportSelectField label="Клиенты агента" value={agentClients} onChange={setAgentClients} options={["Admin Ritm", "Temur Raupov", "Samandar Abdurahmonov"]} />
          <ReportSelectField label="Доставщик" value={supplier} onChange={setSupplier} options={["Собственная доставка", "Партнёр"]} />
          <ReportSelectField label="Тип баланса" value={balanceType} onChange={setBalanceType} options={["Дебитор", "Кредитор", "Нулевой"]} />
          <ReportSelectField label="Ответственные доставщики" value={responsibleSupplier} onChange={setResponsibleSupplier} options={["Admin Ritm", "Шохрух Туляганов"]} />
          <ReportSelectField label="Ответственный инкасатор" value={responsibleCollector} onChange={setResponsibleCollector} options={["Admin Ritm", "Тп 2 Алиса"]} />
          <ReportCheckboxField label="Учитывать только реализованных заказов" checked={onlyRealized} onChange={setOnlyRealized} />
          <ReportCheckboxField label="Только доставленные заказы" checked={onlyDelivered} onChange={setOnlyDelivered} />
          <ReportCheckboxField label="Только оплаты с счет фактурой" checked={onlyInvoiced} onChange={setOnlyInvoiced} />
          <ReportCheckboxField label="Исключить закрытие магазины" checked={excludeClosed} onChange={setExcludeClosed} />
        </ReportFilterPanel>
      )}

      {groupPaymentOpen && (
        <GroupPaymentModal count={selected.size} clientIds={Array.from(selected)} onClose={() => setGroupPaymentOpen(false)} />
      )}
    </ReportPage>
  )
}

function Info({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="8" r="1" fill="currentColor" />
    </svg>
  )
}

function GroupPaymentModal({ count, clientIds, onClose }: { count: number; clientIds: number[]; onClose: () => void }) {
  const { t } = useLanguage()
  const [currency, setCurrency] = useState<"sum" | "usd" | "eur">("sum")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)

  async function save() {
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      window.alert(t("Укажите сумму оплаты"))
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/client-bulk-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientIds, currency, amount: numericAmount, paymentDate: date, comment }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось сохранить оплату"))
        return
      }
      onClose()
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[600px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-xl font-bold uppercase tracking-wide">{t("Групповая оплата")}</h2>
          <button aria-label={t("Закрыть")} onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-7 px-8 py-7">
          <p className="text-sm text-[#586174]">{t("Будет применено к")} {count || "0"} {count === 1 ? t("клиенту") : t("клиентам")}</p>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            {t("Валюта")}
            <select value={currency} onChange={(event) => setCurrency(event.target.value as "sum" | "usd" | "eur")} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
              <option value="sum">SUM</option>
              <option value="usd">USD</option>
              <option value="eur">Euro</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            {t("Сумма")}
            <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            {t("Дата создания")}
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            <input placeholder={t("Оставить комментарий...")} value={comment} onChange={(event) => setComment(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] outline-none placeholder:text-[#586174]" />
          </label>
        </div>
        <footer className="flex justify-end border-t px-8 py-5">
          <button onClick={save} disabled={saving} className="font-bold uppercase tracking-wide text-[#4f71dc] disabled:opacity-60">{saving ? t("Сохранение...") : t("Сохранить")}</button>
        </footer>
      </div>
    </div>
  )
}

function toIso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function formatDate(date: Date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}
