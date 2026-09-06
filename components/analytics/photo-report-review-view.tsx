"use client"

import Image from "next/image"
import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ListFilter, UserRound, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`))
}

export function PhotoReportReviewView() {
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
  const [employeeNames, setEmployeeNames] = useState<string[]>([])

  // surveys-repo and survey-plans-repo (the only survey-related tables in
  // this app) carry no photo/attachment fields at all, so there is no real
  // photo-report data to show here — see report notes. Only the employee
  // strip below is wired to real staff.
  useEffect(() => {
    let cancelled = false
    fetch("/api/employees")
      .then((response) => (response.ok ? (response.json() as Promise<{ name: string }[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setEmployeeNames(data.map((employee) => employee.name).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru")))
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
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="relative flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-10">
        <div className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
          <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
          <span className="text-slate-500">|</span>
          <h1 className="text-slate-600">Активность</h1>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <strong className="text-[#5470e8]">
            {formatDate(range.from)} - {formatDate(range.to)}
          </strong>
          <button
            type="button"
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
            className="inline-flex items-center gap-3 rounded-md bg-[#5470e8] px-5 py-2.5 font-semibold text-white hover:brightness-95"
          >
            <ListFilter className="h-5 w-5" />
            Показать фильтр
          </button>
        </div>

        {filtersOpen && (
          <form
            ref={filterRef}
            onSubmit={applyFilters}
            className="absolute right-5 top-[calc(100%-4px)] z-50 w-[min(376px,calc(100vw-32px))] rounded-sm bg-white px-6 py-6 shadow-[0_7px_18px_rgba(15,23,42,0.35)] sm:right-10"
          >
            <div className="mb-7 flex items-center justify-between">
              <h2 className="text-xl font-normal text-slate-500">Фильтр</h2>
              <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Закрыть фильтр" className="rounded-full border-2 border-slate-400 p-0.5 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" strokeWidth={3} />
              </button>
            </div>

            <fieldset>
              <legend className="text-sm font-semibold">Дата</legend>
              <div className="mt-2 grid grid-cols-2 gap-3 border-b border-slate-300 pb-2">
                <input aria-label="Дата от" type="date" value={draftFrom} max={draftTo} onChange={(event) => setDraftFrom(event.target.value)} className="min-w-0 border-0 bg-transparent text-sm outline-none" />
                <input aria-label="Дата до" type="date" value={draftTo} min={draftFrom} onChange={(event) => setDraftTo(event.target.value)} className="min-w-0 border-0 bg-transparent text-sm outline-none" />
              </div>
            </fieldset>

            <label className="relative mt-12 block border-b border-slate-300 pb-2 text-base font-semibold">
              <span className="sr-only">Тип клиента</span>
              <select
                value={draftClientType}
                onChange={(event) => setDraftClientType(event.target.value)}
                className="w-full appearance-none border-0 bg-white py-1 pr-8 text-base font-semibold outline-none"
              >
                <option value="">Тип клиента</option>
                {["horeca", "market", "market100", "market101", "market102", "market103", "optom", "retail"].map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1 top-1 h-5 w-5 text-slate-400" />
            </label>

            <label className="relative mt-12 block border-b border-slate-300 pb-2 text-base font-semibold">
              <span className="sr-only">Магазин с оборудованием</span>
              <select
                value={draftEquipment}
                onChange={(event) => setDraftEquipment(event.target.value)}
                className="w-full appearance-none border-0 bg-white py-1 pr-8 text-base font-semibold outline-none"
              >
                <option value="">Магазин с оборудованием</option>
                <option value="yes">Да</option>
                <option value="no">Нет</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-1 top-1 h-5 w-5 text-slate-400" />
            </label>

            <button type="submit" disabled={draftFrom > draftTo} className="mt-7 rounded-md bg-slate-500 px-5 py-3 font-medium uppercase text-white shadow-md hover:bg-slate-600 disabled:opacity-50">
              Применить
            </button>
          </form>
        )}
      </header>

      <section className="relative border-b border-slate-200 bg-white">
        <button type="button" onClick={() => scrollEmployees(-1)} aria-label="Предыдущие сотрудники" className="absolute left-0 top-0 z-20 flex h-full w-10 items-center justify-center bg-black/25 text-white hover:bg-black/40">
          <ChevronLeft className="h-7 w-7" />
        </button>
        <div ref={stripRef} className="flex overflow-x-auto px-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveEmployee("Все")}
            className={`flex w-[118px] shrink-0 items-center gap-3 px-5 py-4 text-left ${activeEmployee === "Все" ? "bg-slate-100" : "hover:bg-slate-50"}`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-400 text-white">
              <UserRound className="h-6 w-6 fill-white" />
            </span>
            <span><strong className="block text-base">Все</strong><span className="text-slate-500">0</span></span>
          </button>
          {employeeNames.map((name, index) => (
            <button
              key={`${name}-${index}`}
              type="button"
              onClick={() => setActiveEmployee(name)}
              className={`w-[190px] shrink-0 border-l border-slate-200 px-4 py-2 text-left ${activeEmployee === name ? "bg-slate-100" : "hover:bg-slate-50"}`}
            >
              <strong className="block truncate" title={name}>{name}</strong>
              <span className="mt-1 block bg-[#5c6df3] text-center text-white">0</span>
              <span className="block text-center text-slate-500">0 SUM</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => scrollEmployees(1)} aria-label="Следующие сотрудники" className="absolute right-0 top-0 z-20 flex h-full w-14 items-center justify-center rounded-l-full bg-black/25 text-white hover:bg-black/40">
          <ChevronRight className="h-8 w-8" />
        </button>
      </section>

      <section className="flex min-h-[530px] flex-col items-center justify-center px-5 py-16">
        <Image src="/robot-mascot.png" alt="Робот-помощник" width={150} height={150} priority className="h-36 w-36 object-contain" />
        <p className="mt-7 text-lg text-slate-400">
          {activeEmployee === "Все"
            ? "По вашему запросу ничего не найдено..."
            : `${activeEmployee}: фотоотчеты не найдены...`}
        </p>
        {(clientType || equipment) && (
          <p className="mt-2 text-sm text-slate-400">
            {clientType && `Тип клиента: ${clientType}`}
            {clientType && equipment && " · "}
            {equipment && `Оборудование: ${equipment === "yes" ? "Да" : "Нет"}`}
          </p>
        )}
      </section>

    </main>
  )
}
