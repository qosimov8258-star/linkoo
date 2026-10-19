"use client"

import { useMemo, useState } from "react"
import { Settings, X } from "lucide-react"
import { RI, RefHeader } from "@/components/ref/list-kit"
import { ReportBalanceToolbar, ReportCheckboxField, ReportFilterPanel, ReportGridTable, ReportInputField, ReportPage, ReportPager, ReportSelectField, ReportTopRow } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

type DebtRow = {
  id: number
  client: string
  daysPassed: number
  orderAmount: number
  orderCurrency: "SUM" | "USD"
  debt: number
  dueDate: string
  agent: string
  totalDebtSum: number
  totalDebtUsd: number
  totalDebtEur: number
  courier: string
  realizationDate: string
  deliveryDate: string
  createdAt: string
}

const rows: DebtRow[] = []

type ClientDebtProfile = {
  id: number
  client: string
  overSum: number
  overUsd: number
  phone: string
  address: string
  landmark: string
  agent: string
  type: string
}

const clientProfiles: ClientDebtProfile[] = []

const TOTAL_ORDERS = 0
const TOTAL_CLIENTS = 0

const number = (value: number, maxFraction = 3) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: maxFraction }).format(value)

function AmountCell({ value, fraction = 3 }: { value: number; fraction?: number }) {
  if (value === 0) return <span>0</span>
  return <span className="font-semibold text-[#e5484d]">{number(value, fraction)}</span>
}

export function ClientDebtsView() {
  const { t } = useLanguage()
  const [view, setView] = useState<"clients" | "orders">("orders")
  const [search, setSearch] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [needsRecalc, setNeedsRecalc] = useState(0)
  const [filterOpen, setFilterOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)

  const [p1, setP1] = useState(7)
  const [p2, setP2] = useState(30)
  const [p3, setP3] = useState(120)
  const [p1Draft, setP1Draft] = useState("7")
  const [p2Draft, setP2Draft] = useState("30")
  const [p3Draft, setP3Draft] = useState("120")

  const [branch, setBranch] = useState("")
  const [organization, setOrganization] = useState("")
  const [orderCreator, setOrderCreator] = useState("")
  const [courierFilter, setCourierFilter] = useState("")
  const [clientType, setClientType] = useState("")
  const [confirmStatus, setConfirmStatus] = useState("")
  const [zone, setZone] = useState("")
  const [orderStatus, setOrderStatus] = useState("")
  const [transactionType, setTransactionType] = useState("")
  const [paymentType, setPaymentType] = useState("")
  const [hasDebtPeriod, setHasDebtPeriod] = useState("")
  const [daysFrom, setDaysFrom] = useState("")
  const [daysTo, setDaysTo] = useState("")
  const [onlyNeedsRecalc, setOnlyNeedsRecalc] = useState(false)

  const filteredOrders = useMemo(
    () => rows.filter((row) => row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [search],
  )

  const filteredClients = useMemo(
    () => clientProfiles.filter((row) => row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))),
    [search],
  )

  const visibleCount = view === "orders" ? filteredOrders.length : filteredClients.length
  const maxPage = Math.max(1, Math.ceil(visibleCount / pageSize))
  const safePage = Math.min(page, maxPage)
  const visibleOrders = filteredOrders.slice((safePage - 1) * pageSize, safePage * pageSize)
  const visibleClients = filteredClients.slice((safePage - 1) * pageSize, safePage * pageSize)
  const isDefaultView = !search.trim()
  const ordersTotalLabel = isDefaultView ? TOTAL_ORDERS : filteredOrders.length
  const clientsTotalLabel = isDefaultView ? TOTAL_CLIENTS : filteredClients.length

  const toggleOne = (id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const savePeriods = () => {
    const first = Number(p1Draft) || p1
    const second = Number(p2Draft) || p2
    const third = Number(p3Draft) || p3
    setP1(first)
    setP2(second)
    setP3(third)
    setPeriodOpen(false)
  }

  const downloadAll = () => {
    if (view === "orders") {
      const header = [t("Заказ №"), t("Клиент"), t("Прошло дней"), t("Сумма заказа"), t("Долг"), t("Срок оплаты"), t("Агент"), t("Общий долг SUM"), t("Общий долг USD"), t("Общий долг Euro"), t("Доставщик"), t("Дата реализации"), t("Дата доставки"), t("Дата создания")]
      const body = filteredOrders.map((row) => [row.id, row.client, row.daysPassed, `${number(row.orderAmount, row.orderAmount % 1 ? 2 : 0)} ${row.orderCurrency}`, number(row.debt, row.debt % 1 ? 2 : 0), row.dueDate, row.agent, number(row.totalDebtSum, 2), number(row.totalDebtUsd, 3), number(row.totalDebtEur), row.courier, row.realizationDate, row.deliveryDate, row.createdAt])
      downloadExcelTable("client-debts-orders", [header, ...body])
    } else {
      const header = [t("Клиент"), `${t("Прошло до")} ${p1} ${t("дней SUM")}`, "USD", `${t("С")} ${p1} ${t("дней - До")} ${p2} SUM`, "USD", `${t("С")} ${p2} ${t("дней - До")} ${p3} SUM`, "USD", `${t("Больше")} ${p3} ${t("дней SUM")}`, "USD", t("Итого SUM"), "USD", t("Тел"), t("Адрес"), t("Ориентир"), t("Ответственный агент"), t("Тип")]
      const body = filteredClients.map((row) => [row.client, 0, 0, 0, 0, 0, 0, number(row.overSum, 2), number(row.overUsd, 3), number(row.overSum, 2), number(row.overUsd, 3), row.phone, row.address, row.landmark, row.agent, row.type])
      downloadExcelTable("client-debts-clients", [header, ...body])
    }
  }

  const stat = (label: string, lines: { text: string; tone: "red" | "orange" }[], progress = true) => (
    <div>
      <p className="text-[13px] leading-[17px]">{label}</p>
      {lines.map((line, index) => (
        <p key={index} className={`text-[15px] font-semibold leading-[19px] ${line.tone === "red" ? "text-[#f0605a]" : "text-[#ff7a2f]"}`}>{line.text}</p>
      ))}
      {progress && <p className="mt-[1px] text-[13px] leading-[17px]"><span className="text-[15px] text-[#1ea1f2]">0</span> / <span className="text-[15px] text-[#1ea1f2]">0</span> {t("Заказов обработано")}</p>}
    </div>
  )
  const heads = ["Заказ №", "", "Клиент", "Прошло дней", "Сумма заказа", "Долг", "Срок оплаты", "Агент", "Общий долг (SUM)", "Общий долг (USD)", "Общий долг (Euro)", "Доставщик", "Дата реализации", "Дата доставки", "Дата создания"]
  const clientHeadGroups = [{ title: "", span: 1 }, ...[`${t("Прошло до")} ${p1} ${t("дней")}`, `${t("С")} ${p1} ${t("дней - До")} ${p2}`, `${t("С")} ${p2} ${t("дней - До")} ${p3}`, `${t("Больше")} ${p3} ${t("дней")}`, t("Итого")].map((title) => ({ title, span: 3 })), { title: t("Дополнительная информация"), span: 5 }]

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={t("Долги с заказов")} /></div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[21px]">
        <div className="relative px-[30px]">
          <ReportTopRow filterLabel={t("Фильтр")} scope={t("Во всей организации")} onFilter={() => setFilterOpen(true)} onDownload={downloadAll} />
          <div className="absolute right-[147px] top-0 flex gap-[10px]">
            <button className="flex h-[34px] items-center rounded-[5px] bg-[#4f71dc] pl-[14px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95"><svg viewBox="0 0 24 24" className="mr-[9px] h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.filter} /></svg>{t("Показать на карте")}</button>
            <button onClick={() => { setP1Draft(String(p1)); setP2Draft(String(p2)); setP3Draft(String(p3)); setPeriodOpen(true) }} className="flex h-[34px] items-center rounded-[5px] bg-[#4f71dc] pl-[14px] pr-[16px] text-[13px] font-semibold text-white hover:brightness-95"><Settings className="mr-[9px] h-[18px] w-[18px]" />{t("Настроить период")}</button>
          </div>
        </div>

        <div className="mt-[13px] grid grid-cols-1 gap-x-[20px] px-[30px] sm:grid-cols-2 lg:grid-cols-5">
          {stat(`${t("Прошло до")} ${p1} ${t("дней")}`, [])}
          {stat(`${t("С")} ${p1} ${t("дней - До")} ${p2}`, [])}
          {stat(`${t("С")} ${p2} ${t("дней - До")} ${p3}`, [{ text: "0 SUM", tone: "red" }, { text: "0 USD", tone: "orange" }])}
          {stat(`${t("Больше")} ${p3} ${t("дней")}`, [{ text: "0 Euro", tone: "red" }, { text: "0 SUM", tone: "red" }, { text: "0 USD", tone: "red" }], false)}
          {stat(t("Общий долг"), [{ text: "0 Euro", tone: "red" }, { text: "0 SUM", tone: "red" }, { text: "0 USD", tone: "red" }])}
        </div>

        {needsRecalc > 0 && (
          <div className="mx-[30px] mt-[14px] flex items-center justify-between border-l-[3px] border-[#e5484d] bg-[#fdecee] px-[10px] py-[14px] text-[13px] font-semibold text-[#b5121b]">
            <p>{t("Требуется перерасчет долгов клиентов")}: <span className="text-[#1ea1f2]">{needsRecalc}</span> {t("шт. Долги этих клиентов исключены из итогов")}</p>
            <button onClick={() => setNeedsRecalc(0)} className="h-[30px] rounded-[3px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white">{t("Пересчитать")}</button>
          </div>
        )}

        <ReportBalanceToolbar
          search={search}
          onSearch={(value) => { setSearch(value); setPage(1) }}
          searchLeft={690}
          left={
            <div className="flex items-center gap-[100px]">
              <span className="text-[13px] font-semibold">{t("Статистика по должникам")}</span>
              <div className="flex">
                <button onClick={() => { setView("clients"); setPage(1) }} className={`h-[30px] rounded-l-[3px] border px-4 text-[13px] uppercase ${view === "clients" ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e0e0e0] bg-white text-black"}`}>{t("Клиенты")}</button>
                <button onClick={() => { setView("orders"); setPage(1) }} className={`h-[30px] rounded-r-[3px] border px-4 text-[13px] uppercase ${view === "orders" ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e0e0e0] bg-white text-black"}`}>{t("Заказы")}</button>
              </div>
            </div>
          }
          pager={
            <div className="flex items-center gap-[20px]">
              <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={`${visibleCount ? (safePage - 1) * pageSize + 1 : 0} - ${Math.min(safePage * pageSize, visibleCount)} ${t("из")} ${view === "orders" ? ordersTotalLabel : clientsTotalLabel}`} canPrev={safePage > 1} canNext={safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
              <button aria-label={t("Полный экран")} onClick={() => document.documentElement.requestFullscreen?.()}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg></button>
            </div>
          }
        />

        {view === "orders" ? (
          <ReportGridTable
            minWidth={1900}
            emptyText={t("Нет данных")}
            heads={heads.map((head, index) => index === 1 ? <input key="all" type="checkbox" className="h-[14px] w-[14px] accent-[#444]" aria-label="all" /> : t(head))}
            rows={visibleOrders.map((row) => [
              row.id,
              <input key="c" type="checkbox" checked={selected.has(row.id)} onChange={() => toggleOne(row.id)} className="h-[14px] w-[14px] accent-[#444]" />,
              <span key="cl" className="text-[#4f71dc]">{row.client}</span>,
              row.daysPassed,
              `${number(row.orderAmount, row.orderAmount % 1 ? 2 : 0)} ${row.orderCurrency}`,
              <span key="d" className="font-semibold text-[#f0605a]">{number(row.debt, row.debt % 1 ? 2 : 0)}</span>,
              <span key="due" className="text-[#4f71dc]">{row.dueDate}</span>,
              row.agent,
              <span key="s" className="font-semibold text-[#f0605a]">{number(row.totalDebtSum, 2)}</span>,
              <span key="u" className="font-semibold text-[#f0605a]">{number(row.totalDebtUsd, 3)}</span>,
              <span key="e" className="font-semibold text-[#f0605a]">{number(row.totalDebtEur)}</span>,
              row.courier,
              row.realizationDate,
              row.deliveryDate,
              row.createdAt,
            ])}
          />
        ) : (
          <ReportGridTable
            minWidth={2100}
            emptyText={t("Нет данных")}
            groups={clientHeadGroups}
            heads={[t("Клиенты"), ...Array.from({ length: 5 }).flatMap(() => ["SUM", "USD", "Euro"]), t("Тел"), t("Адрес"), t("Ориентир"), t("Ответственный агент"), t("Тип")]}
            rows={visibleClients.map((row) => [
              row.client,
              0, 0, 0, 0, 0, 0, 0, 0, 0,
              <AmountCell key="a" value={row.overSum} fraction={2} />,
              <AmountCell key="b" value={row.overUsd} fraction={3} />,
              0,
              <AmountCell key="c" value={row.overSum} fraction={2} />,
              <AmountCell key="d" value={row.overUsd} fraction={3} />,
              0,
              row.phone, row.address, row.landmark, row.agent, row.type,
            ])}
          />
        )}
      </section>

      {periodOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={() => setPeriodOpen(false)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[500px] max-w-[92vw] rounded-md bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-lg font-bold uppercase tracking-wide">{t("Настроить период")}</h2>
              <button aria-label={t("Закрыть")} onClick={() => setPeriodOpen(false)}><X className="h-6 w-6 text-slate-500" /></button>
            </header>
            <div className="space-y-7 px-8 py-7">
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                {t("Первый период")}
                <input type="number" min={1} value={p1Draft} onChange={(event) => setP1Draft(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                {t("Второй период")}
                <input type="number" min={1} value={p2Draft} onChange={(event) => setP2Draft(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
              <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
                {t("Третий период")}
                <input type="number" min={1} value={p3Draft} onChange={(event) => setP3Draft(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
              </label>
            </div>
            <footer className="flex justify-end border-t px-8 py-5">
              <button onClick={savePeriods} className="rounded-md bg-[#6fcf97] px-6 py-3 font-semibold text-white hover:bg-[#5fbf87]">{t("Сохранить")}</button>
            </footer>
          </div>
        </div>
      )}

      {filterOpen && (
        <ReportFilterPanel onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)}>
          <ReportSelectField label="Филиалы" value={branch} onChange={setBranch} options={["Самарканд", "Ташкент", "Наманган"]} />
          <ReportSelectField label="Организация" value={organization} onChange={setOrganization} options={["Linko"]} />
          <ReportSelectField label="Заказ оформил" value={orderCreator} onChange={setOrderCreator} options={["Admin Ritm", "Тп 1 Исмоилов Гани", "Тп 2 Алиса"]} />
          <ReportSelectField label="Доставщик" value={courierFilter} onChange={setCourierFilter} options={["Admin Ritm", "Quvonchbek Admin", "Хайрулло Доставщик"]} />
          <ReportSelectField label="Тип клиента" value={clientType} onChange={setClientType} options={["Оптовый", "Розничный", "Розница"]} />
          <ReportSelectField label="Статус подтверждения клиента" value={confirmStatus} onChange={setConfirmStatus} options={["Подтвержден", "Не подтвержден"]} />
          <ReportSelectField label="Зона" value={zone} onChange={setZone} options={["Розничный", "Рабочий", "Не рабочий зона"]} />
          <ReportSelectField label="Статус заказа" value={orderStatus} onChange={setOrderStatus} options={["Доставлен", "В пути", "Отменен"]} />
          <ReportSelectField label="Тип оплаты (транзакции)" value={transactionType} onChange={setTransactionType} options={["Наличными", "Перечислением"]} />
          <ReportSelectField label="Тип оплаты" value={paymentType} onChange={setPaymentType} options={["SUM", "USD", "Euro"]} />
          <ReportSelectField label="Есть задолженность за период" value={hasDebtPeriod} onChange={setHasDebtPeriod} options={["Да", "Нет"]} />
          <ReportInputField label="Прошло дней с последней оплаты (от)" value={daysFrom} onChange={setDaysFrom} />
          <ReportInputField label="Прошло дней с последней оплаты (до)" value={daysTo} onChange={setDaysTo} />
          <ReportCheckboxField label="Требуется перерасчет" checked={onlyNeedsRecalc} onChange={setOnlyNeedsRecalc} />
        </ReportFilterPanel>
      )}
    </ReportPage>
  )
}
