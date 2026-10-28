"use client"

import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, X } from "lucide-react"
import { RI, RefHeader } from "@/components/ref/list-kit"
import { ReportEmpty, ReportPage } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"

function inputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function currentMonthStart() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth(), 1))
}

function currentMonthEnd() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth() + 1, 0))
}

const SHORT_MONTHS = ["Янв.", "Февр.", "Март", "Апр.", "Май", "Июнь", "Июль", "Авг.", "Сент.", "Окт.", "Нояб.", "Дек."]

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return `${day} ${SHORT_MONTHS[month - 1]} ${year}`
}

export function PhotoReportReviewView() {
  const { t } = useLanguage()
  const today = useMemo(() => inputDate(new Date()), [])
  const stripRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLFormElement>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const [activeEmployee, setActiveEmployee] = useState("Все")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(currentMonthStart)
  const [draftTo, setDraftTo] = useState(currentMonthEnd)
  const [range, setRange] = useState({ from: today, to: today })
  const [draftClientType, setDraftClientType] = useState("")
  const [draftEquipment, setDraftEquipment] = useState("")
  const [clientType, setClientType] = useState("")
  const [equipment, setEquipment] = useState("")
  const [scrolled, setScrolled] = useState(false)
  const [employeeNames, setEmployeeNames] = useState<string[]>([])

  // surveys-repo and survey-plans-repo (the only survey-related tables in
  // this app) carry no photo/attachment fields at all, so there is no real
  // photo-report data to show here — see report notes. Only the employee
  // strip below is wired to real staff.
  useEffect(() => {
    let cancelled = false
    // Like the reference, the strip lists the active members of the agents plan in the plan's own order; while the plan
    // is not loaded it falls back to every employee by name.
    Promise.all([
      fetch("/api/employees").then((response) => (response.ok ? (response.json() as Promise<{ id: number; name: string }[]>) : [])),
      fetch("/api/agent-plan-members").then((response) => (response.ok ? (response.json() as Promise<{ employeeId: number; active: boolean; position: number }[]>) : [])),
    ])
      .then(([employees, members]) => {
        if (cancelled) return
        const nameById = new Map(employees.map((employee) => [employee.id, employee.name]))
        const planned = members
          .filter((member) => member.active && nameById.get(member.employeeId))
          .sort((a, b) => (a.position < 0 ? 1e6 + a.employeeId : a.position) - (b.position < 0 ? 1e6 + b.employeeId : b.position))
          .map((member) => nameById.get(member.employeeId) as string)
        setEmployeeNames(planned.length > 0 ? planned : employees.map((employee) => employee.name).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru")))
      })
      .catch(() => {
        if (!cancelled) setEmployeeNames([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!filtersOpen) return

    function closeFilter(event: MouseEvent) {
      const target = event.target as Node
      if (
        filterRef.current &&
        !filterRef.current.contains(target) &&
        !filterButtonRef.current?.contains(target)
      ) {
        setFiltersOpen(false)
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setFiltersOpen(false)
    }

    document.addEventListener("mousedown", closeFilter)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", closeFilter)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [filtersOpen])

  function scrollEmployees(direction: number) {
    stripRef.current?.scrollBy({ left: direction * 700, behavior: "smooth" })
  }

  function applyFilters(event: FormEvent) {
    event.preventDefault()
    if (draftFrom <= draftTo) {
      setRange({ from: draftFrom, to: draftTo })
      setClientType(draftClientType)
      setEquipment(draftEquipment)
      setFiltersOpen(false)
    }
  }

  return (
    <ReportPage>
      <header className="relative pl-[28px] pr-[38px]">
        <RefHeader title={t("Активность")}>
          <strong className="mr-[10px] text-[13px] font-bold text-[#4f71dc]">
            {t(`${formatDate(range.from)} - ${formatDate(range.to)}`)}
          </strong>
          <button
            type="button"
            ref={filterButtonRef}
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
            className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 pr-4 text-[13px] font-semibold text-white hover:brightness-95"
          >
            <svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.filter} /></svg>
            {t("Показать фильтр")}
          </button>
        </RefHeader>

        {filtersOpen && (
          <form
            ref={filterRef}
            onSubmit={applyFilters}
            className="absolute right-5 top-[calc(100%-4px)] z-50 w-[min(376px,calc(100vw-32px))] rounded-sm bg-white px-6 py-6 shadow-[0_7px_18px_rgba(15,23,42,0.35)] sm:right-10"
          >
            <div className="mb-7 flex items-center justify-between">
              <h2 className="text-xl font-normal text-slate-500">{t("Фильтр")}</h2>
              <button type="button" onClick={() => setFiltersOpen(false)} aria-label={t("Закрыть фильтр")} className="rounded-full border-2 border-slate-400 p-0.5 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" strokeWidth={3} />
              </button>
            </div>

            <fieldset>
              <legend className="text-sm font-semibold">{t("Дата")}</legend>
              <div className="mt-2 grid grid-cols-2 gap-3 border-b border-slate-300 pb-2">
                <input aria-label={t("Дата от")} type="date" value={draftFrom} max={draftTo} onChange={(event) => setDraftFrom(event.target.value)} className="min-w-0 border-0 bg-transparent text-sm outline-none" />
                <input aria-label={t("Дата до")} type="date" value={draftTo} min={draftFrom} onChange={(event) => setDraftTo(event.target.value)} className="min-w-0 border-0 bg-transparent text-sm outline-none" />
              </div>
            </fieldset>

            <label className="relative mt-12 block border-b border-slate-300 pb-2 text-base font-semibold">
              <span className="sr-only">{t("Тип клиента")}</span>
              <select
                value={draftClientType}
                onChange={(event) => setDraftClientType(event.target.value)}
                className="w-full appearance-none border-0 bg-white py-1 pr-8 text-base font-semibold outline-none"
              >
                <option value="">{t("Тип клиента")}</option>
                {["horeca", "market", "market100", "market101", "market102", "market103", "optom", "retail"].map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1 top-1 h-5 w-5 text-slate-400" />
            </label>

            <label className="relative mt-12 block border-b border-slate-300 pb-2 text-base font-semibold">
              <span className="sr-only">{t("Магазин с оборудованием")}</span>
              <select
                value={draftEquipment}
                onChange={(event) => setDraftEquipment(event.target.value)}
                className="w-full appearance-none border-0 bg-white py-1 pr-8 text-base font-semibold outline-none"
              >
                <option value="">{t("Магазин с оборудованием")}</option>
                <option value="yes">{t("Да")}</option>
                <option value="no">{t("Нет")}</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-1 top-1 h-5 w-5 text-slate-400" />
            </label>

            <button type="submit" disabled={draftFrom > draftTo} className="mt-7 rounded-md bg-slate-500 px-5 py-3 font-medium uppercase text-white shadow-md hover:bg-slate-600 disabled:opacity-50">
              {t("Применить")}
            </button>
          </form>
        )}
      </header>

      <section className="relative h-[67px] bg-white">
        <div ref={stripRef} onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 0)} className="flex h-full overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveEmployee("Все")}
            className={`flex shrink-0 items-center gap-[7px] px-[15px] text-left ${activeEmployee === "Все" ? "bg-[#f2f5f8]" : ""}`}
          >
            <span className="flex h-[35px] w-[35px] items-center justify-center rounded-full bg-[#a8adb7] text-white">
              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-white" aria-hidden><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" /></svg>
            </span>
            <span className="text-[13px] font-semibold leading-[18px]">{t("Все")}<span className="block font-normal">0</span></span>
          </button>
          {employeeNames.map((name, index) => (
            <button
              key={`${name}-${index}`}
              type="button"
              onClick={() => setActiveEmployee(name)}
              className={`flex shrink-0 flex-col justify-center border-l border-[#efefef] px-[10px] text-center ${activeEmployee === name ? "bg-[#f2f5f8]" : ""}`}
            >
              <strong className="block whitespace-nowrap text-[13px] font-semibold leading-[18px]" title={name}>{name}</strong>
              <span className="mt-[2px] block h-[18px] min-w-[85px] bg-[#5c6df3] text-[13px] leading-[18px] text-white">0</span>
              <span className="mt-[2px] block text-[13px] leading-[18px] text-[#666]">0 SUM</span>
            </button>
          ))}
        </div>
        {scrolled && (
          <button type="button" onClick={() => scrollEmployees(-1)} aria-label={t("Предыдущие сотрудники")} className="absolute left-0 top-0 z-20 flex h-full w-10 items-center justify-center bg-black/25 text-white hover:bg-black/40">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <button type="button" onClick={() => scrollEmployees(1)} aria-label={t("Следующие сотрудники")} className="absolute right-0 top-[1px] z-20 flex h-[65px] w-[40px] items-center justify-center rounded-l-full bg-[#a8a8a8]/80 text-[15px] font-bold text-[#2f3a87]">
          »
        </button>
      </section>

      <ReportEmpty
        className="pb-10 pt-[65px]"
        text={activeEmployee === "Все" ? undefined : `${activeEmployee}: фотоотчеты не найдены...`}
      />
      {(clientType || equipment) && (
        <p className="pb-6 text-center text-[13px] text-[#8c8c8c]">
          {clientType && `Тип клиента: ${clientType}`}
          {clientType && equipment && " · "}
          {equipment && `Оборудование: ${equipment === "yes" ? "Да" : "Нет"}`}
        </p>
      )}
    </ReportPage>
  )
}
