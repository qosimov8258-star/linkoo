"use client"

import Image from "next/image"
import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ListFilter, Star, UserRound, X } from "lucide-react"

const employeeNames = `
05.08.2025 (1)
xodim1 1
Zaynillo Sadullayev
Salohiddin Agent Tashkent
Islom Toirjonov
Maykl Jekson
Аббос Доставщик
Admin Ritm
Bexruz Abdulazizov
Samandar Abdurahmonov
doston zavsklad Zavzalov
beyn kim
agent2 2
agent 007
Анвар Комилов
krugagentbek agentov
старший агент склада Apple
ali aliyev
bobur axmadov
Bahodir Axmedov
Азизхон Супервайзер
Aziz Karimov
Temurbek Sharipov
beyn kim
ismoil boboyorov
universal dostavshik
Bahriddun tolaganov
deliver man
Dilmurod Madjidov
доставщик доставщик
Doston agentov agentov
asadbek rasulov
krugdoshtavshikbek dostavshikov
doston supreviser supreviserov
doston2cola agent agentov
doston dostavka Dostavshikov
Salohiddin Dastavchik Tashkent
Feruz Ibragimov
Feruz2 Bobokulov
feruz bobokulov Bobokulov
Fozil Agent
Максим Валерьевич
Аброр Билолов
Сотрудник Илхомжон Жураев
Islom Yuldashev
Javohir Sindarov
Karim Karimov
Ares are
Quvonchbek op
onec onec
Otabek Komiljonov
Oybek Valiyev
Quvonchbek Admin
AboMuslim Raximov
Salohiddin Agent Farg'ona
Salohiddin Dastavchik Farg'ona
Salohiddin Kassir Farg'ona
Salohiddin Kassir Tashkent
Salohiddin Operator Fargona
Salohiddin Operator Tashkent
Salohiddin Supervisor Farg'ona
Salohiddin Supervisor Tashkent
Salohiddin Zasklad Farg'ona
Salohiddin Zavsklad Tashkent
Sardor Rajabov
Shaxriyor Xusanov
Sherzod Gulyamov
Shodiyor Mahmudov
Shohista Muxamedova
супервайзер супервайзер
test1 asdsa
testUser testUser
agent TIMUR 007
test Test
van.agent2 2
Vahit ATASH
vansel agent test
xodim2 1
xodim3 1
Shaxriyor Xusanov
zav.sklad 007 qwerty
завсклада завсклада
Хайрулло Доставщик
`.trim().split("\n")

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
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(currentMonthStart)
  const [draftTo, setDraftTo] = useState(currentMonthEnd)
  const [range, setRange] = useState({ from: today, to: today })
  const [draftClientType, setDraftClientType] = useState("")
  const [draftEquipment, setDraftEquipment] = useState("")
  const [clientType, setClientType] = useState("")
  const [equipment, setEquipment] = useState("")

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

  useEffect(() => {
    if (!favoritesOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setFavoritesOpen(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [favoritesOpen])

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
          <button
            ref={filterButtonRef}
            type="button"
            onClick={() => setFavoritesOpen(true)}
            className="flex items-center gap-2 text-[#5470e8]"
          >
            <Star className={`h-6 w-6 ${favorite ? "fill-amber-400 text-amber-400" : "fill-slate-600 text-slate-600"}`} />
            Избранные
          </button>
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

      {favoritesOpen && (
        <>
          <button type="button" aria-label="Закрыть избранное" onClick={() => setFavoritesOpen(false)} className="fixed inset-0 z-[90] cursor-default bg-black/55" />
          <aside role="dialog" aria-modal="true" aria-labelledby="photo-favorites-title" className="fixed bottom-0 left-0 top-0 z-[100] w-[min(418px,calc(100vw-28px))] border-r-[10px] border-sky-500 bg-white shadow-2xl animate-in slide-in-from-left-full duration-200">
            <header className="flex items-center justify-between border-b border-slate-200 px-9 py-7">
              <h2 id="photo-favorites-title" className="text-xl font-medium">Избранные</h2>
              <button type="button" onClick={() => setFavoritesOpen(false)} aria-label="Закрыть" className="rounded p-1 hover:bg-slate-100"><X className="h-7 w-7" /></button>
            </header>
            <nav>
              {["Клиенты", "Заказы", "Виджеты", "Ограничение продуктов", "Продукты"].map((item) => (
                <button key={item} type="button" onClick={() => { setFavorite(true); setFavoritesOpen(false) }} className="flex w-full items-center justify-between border-b border-slate-200 px-6 py-3.5 text-left text-[17px] font-medium hover:bg-slate-50">
                  {item}<ChevronRight className="h-5 w-5 text-slate-500" />
                </button>
              ))}
            </nav>
          </aside>
        </>
      )}
    </main>
  )
}
