"use client"

import Image from "next/image"
import { useEffect, useMemo, useState } from "react"

import { FilterDate, FilterSelect, RI, RefButton, RefFilterPanel, RefHeader, RefPage } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate } from "@/lib/ref-date"

type AgentCell = { name: string; done: number; sales: number }
type EmployeeRow = { id?: number; name?: string; firstName?: string; lastName?: string; first_name?: string; last_name?: string; active?: boolean }

const equipmentStores = ["С оборудованием", "Без оборудования"]

const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const monthStart = () => {
  const today = new Date()
  return isoDay(new Date(today.getFullYear(), today.getMonth(), 1))
}
const monthEnd = () => {
  const today = new Date()
  return isoDay(new Date(today.getFullYear(), today.getMonth() + 1, 0))
}
// "23 Окт. 2026": the reference capitalises the month of the period caption.
const caption = (value: string) => {
  const text = refDate(value)
  return text.replace(/^(\d+ )(.)/, (_all, day: string, first: string) => `${day}${first.toUpperCase()}`)
}

export function ActivityView() {
  const { t } = useLanguage()
  const today = useMemo(() => isoDay(new Date()), [])
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [draftFrom, setDraftFrom] = useState(monthStart)
  const [draftTo, setDraftTo] = useState(monthEnd)
  const [clientType, setClientType] = useState("")
  const [clientTypes, setClientTypes] = useState<string[]>([])
  const [equipmentStore, setEquipmentStore] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [cells, setCells] = useState<AgentCell[]>([])

  // The strip lists the reference's agent plan (its active members, in the reference's order) with the done visits and the
  // sales of the chosen period.
  useEffect(() => {
    let cancelled = false
    const json = async <T,>(url: string): Promise<T> => {
      const response = await fetch(url)
      return (response.ok ? await response.json() : []) as T
    }
    Promise.all([
      json<EmployeeRow[]>("/api/employees"),
      json<Array<{ employeeId: number; active: boolean; position?: number }>>("/api/agent-plan-members").catch(() => []),
      json<{ agents?: Array<{ name: string; visited: number; sales: number }> }>(`/api/agent-visits?view=stats&begin=${from}&end=${to}`).catch(() => ({ agents: [] })),
    ])
      .then(([employees, members, stats]) => {
        if (cancelled || !Array.isArray(employees)) return
        const plan = Array.isArray(members) && members.length ? new Map(members.filter((member) => member.active).map((member) => [member.employeeId, member.position ?? -1])) : null
        const byName = new Map((stats.agents ?? []).map((row) => [row.name, row]))
        setCells(
          employees
            .filter((row) => (plan ? plan.has(Number(row.id)) : row.active !== false))
            .map((row, index) => ({
              name: [row.firstName ?? row.first_name, row.lastName ?? row.last_name].filter(Boolean).join(" ") || row.name || "",
              order: plan && (plan.get(Number(row.id)) ?? -1) >= 0 ? (plan.get(Number(row.id)) as number) : 1000 + index,
            }))
            .filter((row) => row.name)
            .sort((a, b) => a.order - b.order)
            .map((row) => ({ name: row.name, done: byName.get(row.name)?.visited ?? 0, sales: byName.get(row.name)?.sales ?? 0 })),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [from, to])

  useEffect(() => {
    if (!filterOpen || clientTypes.length) return
    fetch("/api/client-types")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Array<{ name?: string }>) => setClientTypes([...new Set(data.map((item) => item.name ?? "").filter(Boolean))]))
      .catch(() => {})
  }, [filterOpen, clientTypes.length])

  function applyFilters() {
    setFrom(draftFrom)
    setTo(draftTo)
    setFilterOpen(false)
  }

  const total = cells.reduce((sum, cell) => sum + cell.done, 0)

  return (
    <RefPage>
      <div className="relative">
        <RefHeader title={t("Активность")}>
          <div className="mr-[8px] flex items-center">
            <strong className="mr-[15px] text-[13px] font-bold text-[#4f71dc]">
              {caption(from)} - {caption(to)}
            </strong>
            <RefButton exact icon={RI.filter} label={t("Показать фильтр")} onClick={() => setFilterOpen((open) => !open)} />
          </div>
        </RefHeader>
        {filterOpen && (
          <div className="absolute right-[37px] top-[70px] z-30" style={{ width: 300 }}>
            <RefFilterPanel narrow className="!w-[300px]" onClose={() => setFilterOpen(false)} onApply={applyFilters} applyClassName="mt-[22px]">
              <FilterDate label={t("Дата")} words begin={draftFrom} end={draftTo} onChange={(begin, end) => { setDraftFrom(begin); setDraftTo(end) }} />
              <FilterSelect label={t("Тип клиента")} value={clientType} onChange={setClientType} options={clientTypes} />
              <FilterSelect label={t("Магазин с оборудованием")} value={equipmentStore} onChange={setEquipmentStore} options={equipmentStores.map((item) => t(item))} />
            </RefFilterPanel>
          </div>
        )}
      </div>

      <div className="-mx-7 flex h-[66px] overflow-x-auto bg-white text-[13px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={() => setSelectedAgent(null)} className="flex w-[94px] shrink-0 items-center pl-[16px] text-left">
          <span className="flex h-[35px] w-[35px] shrink-0 items-center justify-center rounded-full bg-[#9aa6b3]">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
          </span>
          <span className="ml-[5px] block">
            <span className="block h-[18px] font-semibold leading-[18px] text-[#333]">{t("Все")}</span>
            <span className="block h-[18px] leading-[18px] text-[#666]">{total}</span>
          </span>
        </button>
        {cells.map((cell, cellIndex) => (
          <button
            key={`${cell.name}-${cellIndex}`}
            type="button"
            onClick={() => setSelectedAgent(cell.name)}
            className={`shrink-0 whitespace-nowrap border-l border-[#efefef] pl-[15px] pr-[15px] pt-[6px] text-center ${selectedAgent === cell.name ? "bg-[#f7f9fc]" : ""}`}
          >
            <span className="block h-[18px] font-semibold leading-[18px] text-[#333]">{cell.name}</span>
            <span className="block h-[18px] bg-[#4f71dc] leading-[18px] text-white">{cell.done}</span>
            <span className="block h-[18px] leading-[18px] text-[#666]">{cell.sales.toLocaleString("ru-RU")} SUM</span>
          </button>
        ))}
      </div>

      <section className="flex flex-col items-center gap-3 pt-[76px]">
        <Image src="/robot-empty.png" alt={t("Робот-помощник")} width={150} height={150} priority className="h-36 w-36 object-contain" />
        <p className="text-[13px] text-[#666]">{t("По вашему запросу ничего не найдено...")}</p>
      </section>
    </RefPage>
  )
}
