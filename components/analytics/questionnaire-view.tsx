"use client"

import { FormEvent, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Download, Filter, Pencil, PlusCircle, Search, Trash2, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"

type Survey = {
  id: number
  name: string
  createdAt: string
  active: boolean
  organization: string
  storeType: string
  comment: string
}

const organizations = ["Linko", "Time3 Distribution", "energetik"]
const storeTypes = ["Не указано", "horeca", "market", "market100", "market101"]

const initial: Survey[] = [
  { id: 20, name: "distr", createdAt: "07 янв. 2026, 13:07", active: true, organization: "Linko", storeType: "market", comment: "Опрос по дистрибуции товаров в новых точках." },
  { id: 13, name: "oprosnik taski", createdAt: "30 сент. 2025, 16:09", active: true, organization: "Time3 Distribution", storeType: "Не указано", comment: "" },
  { id: 3, name: "so'rovnoma 1", createdAt: "08 февр. 2025, 23:06", active: true, organization: "energetik", storeType: "Не указано", comment: "gorilla, fanta, kabi energetiklarimiz uchun so'rovnoma otkazommiza" },
  { id: 19, name: "narxlar royxat", createdAt: "04 янв. 2026, 17:09", active: true, organization: "Linko", storeType: "market100", comment: "Нархлар рўйхатини текшириш учун сўровнома." },
  { id: 18, name: "ebferbfhjbf1", createdAt: "29 дек. 2025, 14:13", active: true, organization: "Time3 Distribution", storeType: "Не указано", comment: "" },
  { id: 15, name: "salom GG", createdAt: "10 дек. 2025, 10:51", active: true, organization: "Linko", storeType: "market101", comment: "Тестовый опросник." },
  { id: 12, name: "филиал so'rovnomasi", createdAt: "14 авг. 2025, 10:20", active: true, organization: "Linko", storeType: "market", comment: "Опрос по работе филиалов." },
  { id: 11, name: "test yangi", createdAt: "02 июл. 2025, 09:15", active: true, organization: "energetik", storeType: "horeca", comment: "" },
  { id: 10, name: "mijozlar fikri", createdAt: "18 июн. 2025, 12:40", active: true, organization: "Time3 Distribution", storeType: "market", comment: "Мижозлар фикрини ўрганиш учун сўровнома." },
  { id: 9, name: "Клиент | Обратная связь", createdAt: "27 мая 2025, 16:05", active: true, organization: "Linko", storeType: "Не указано", comment: "Форма обратной связи для клиентов после доставки." },
  { id: 7, name: "qayta test", createdAt: "11 мар. 2025, 10:02", active: true, organization: "Time3 Distribution", storeType: "market100", comment: "" },
  { id: 6, name: "demo oprosnik", createdAt: "20 февр. 2025, 14:55", active: true, organization: "energetik", storeType: "Не указано", comment: "Демо версия опросника для обучения агентов." },
  { id: 5, name: "Агент | Функции", createdAt: "29 апр. 2025, 14:41", active: true, organization: "Linko", storeType: "market", comment: "Опрос о функциональности мобильного приложения агента." },
  { id: 4, name: "sdas", createdAt: "25 апр. 2025, 15:30", active: true, organization: "Time3 Distribution", storeType: "Не указано", comment: "" },
  { id: 1, name: "тест опрос", createdAt: "12 нояб. 2024, 11:48", active: true, organization: "Linko", storeType: "market", comment: "Первый тестовый опрос в системе." },
  { id: 21, name: "наблюдатель", createdAt: "30 янв. 2026, 17:25", active: false, organization: "Linko", storeType: "Не указано", comment: "Опрос отключён после завершения периода наблюдения." },
  { id: 17, name: "Sorovnoma", createdAt: "21 дек. 2025, 23:52", active: false, organization: "Time3 Distribution", storeType: "market", comment: "" },
  { id: 16, name: "oprosnik11", createdAt: "19 дек. 2025, 12:26", active: false, organization: "energetik", storeType: "Не указано", comment: "" },
  { id: 14, name: "test_dilmurod_opros", createdAt: "20 нояб. 2025, 12:33", active: false, organization: "Linko", storeType: "horeca", comment: "Тестовый опрос, отключён по завершении проверки." },
  { id: 8, name: "ll", createdAt: "16 сент. 2025, 11:30", active: false, organization: "Time3 Distribution", storeType: "Не указано", comment: "" },
  { id: 2, name: ";kl;", createdAt: "08 февр. 2025, 23:03", active: false, organization: "Linko", storeType: "Не указано", comment: "" },
]

type Tab = "active" | "inactive" | "all"

function emptyDraft(): Omit<Survey, "id"> {
  return { name: "", createdAt: "", active: true, organization: organizations[0], storeType: storeTypes[0], comment: "" }
}

function now() {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(".", "")
}

export function QuestionnaireView() {
  const [surveys, setSurveys] = useState(initial)
  const [tab, setTab] = useState<Tab>("active")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [organizationFilter, setOrganizationFilter] = useState("Все организации")
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [favorite, setFavorite] = useState(false)

  const filtered = useMemo(() => {
    return surveys
      .filter((survey) => (tab === "active" ? survey.active : tab === "inactive" ? !survey.active : true))
      .filter((survey) => organizationFilter === "Все организации" || survey.organization === organizationFilter)
      .filter((survey) => survey.name.toLowerCase().includes(query.toLowerCase()))
  }, [surveys, tab, organizationFilter, query])

  const counts = useMemo(
    () => ({
      active: surveys.filter((survey) => survey.active).length,
      inactive: surveys.filter((survey) => !survey.active).length,
      all: surveys.length,
    }),
    [surveys],
  )

  const detail = selected !== null ? surveys.find((survey) => survey.id === selected) ?? null : null

  function openCreate() {
    setDraft(emptyDraft())
    setEditing("new")
  }

  function openEdit(survey: Survey) {
    setDraft({ name: survey.name, createdAt: survey.createdAt, active: survey.active, organization: survey.organization, storeType: survey.storeType, comment: survey.comment })
    setEditing(survey.id)
  }

  function remove(id: number) {
    setSurveys((list) => list.filter((survey) => survey.id !== id))
    setSelected((current) => (current === id ? null : current))
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    if (editing === "new") {
      const id = Math.max(0, ...surveys.map((survey) => survey.id)) + 1
      setSurveys((list) => [{ id, ...draft, name: draft.name.trim(), createdAt: now() }, ...list])
    } else if (editing !== null) {
      setSurveys((list) => list.map((survey) => (survey.id === editing ? { ...survey, ...draft, name: draft.name.trim() } : survey)))
    }
    setEditing(null)
  }

  function downloadSurvey(survey: Survey) {
    downloadExcelTable(`oprosnik-${survey.id}.xls`, [
      ["№", "Название", "Дата создания", "Статус", "Организация", "Тип магазина", "Комментарий"],
      [survey.id, survey.name, survey.createdAt, survey.active ? "Активный" : "Отключен", survey.organization, survey.storeType, survey.comment],
    ])
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "active", label: "Активные", count: counts.active },
    { key: "inactive", label: "Не активные", count: counts.inactive },
    { key: "all", label: "Все", count: counts.all },
  ]

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-600">
          <button type="button" onClick={() => setFavorite((value) => !value)} className="text-[#4f70e7]">
            {favorite ? "★ Избранные" : "☆ Избранные"}
          </button>{" "}
          <span className="mx-2 text-slate-400">|</span> Опросник
        </h1>
        <button type="button" onClick={openCreate} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95">
          <PlusCircle className="mr-2 inline h-5 w-5" />
          Добавить
        </button>
      </header>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex border-b border-slate-200 text-center">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`flex-1 border-b-2 py-4 text-[15px] font-medium ${tab === item.key ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-600 hover:text-slate-800"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-3 font-semibold text-white hover:brightness-95">
            <Filter className="h-4 w-4" />
            Показать фильтр
          </button>
          <label className="relative w-64">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-3 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-3 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            1 - {filtered.length} из {filtered.length}
          </span>
          <ChevronLeft className="h-5 w-5 text-slate-300" />
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-end gap-4 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <label className="text-sm font-medium text-slate-600">
              Организация
              <select value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)} className="mt-1 block w-56 border-0 border-b border-slate-300 bg-white px-0 py-2 outline-none focus:border-[#4f70e7]">
                <option>Все организации</option>
                {organizations.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setFilterOpen(false)} className="rounded bg-[#626b7e] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              Применить
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                <th className="px-9 py-5">№</th>
                <th className="px-5 py-5">Название</th>
                <th className="px-5 py-5">Дата создания</th>
                <th className="px-5 py-5">Статус</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((survey) => (
                <tr key={survey.id} className={`border-b border-dashed border-slate-300 hover:bg-slate-50 ${selected === survey.id ? "bg-slate-50" : ""}`}>
                  <td className="px-12 py-5">{survey.id}</td>
                  <td className="px-5 py-5">
                    <button type="button" onClick={() => setSelected((current) => (current === survey.id ? null : survey.id))} className="text-left text-[#4f70e7] hover:underline">
                      {survey.name}
                    </button>
                  </td>
                  <td className="px-5 py-5">{survey.createdAt}</td>
                  <td className="px-5 py-5">
                    <span className={survey.active ? "text-[#6ccd8b]" : "text-slate-400"}>{survey.active ? "Активный" : "Отключен"}</span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {detail && (
          <div className="border-t border-slate-200 p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">
                № {detail.id} - {detail.name}
              </h2>
              <div className="flex items-center gap-4 text-slate-500">
                <button type="button" onClick={() => downloadSurvey(detail)} aria-label="Скачать" className="hover:text-[#4f70e7]">
                  <Download className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => openEdit(detail)} aria-label="Изменить" className="hover:text-[#4f70e7]">
                  <Pencil className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => remove(detail.id)} aria-label="Удалить" className="hover:text-red-500">
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="mt-5 space-y-2 border-t border-slate-100 pt-5 text-[15px]">
              <p>
                <span className="text-slate-500">Дата создания</span> <b className="ml-2">{detail.createdAt}</b>
              </p>
              <p>
                <span className="text-slate-500">Организация</span> <b className="ml-2">{detail.organization}</b>
              </p>
              <p>
                <span className="text-slate-500">Тип магазина</span> <b className="ml-2">{detail.storeType}</b>
              </p>
            </div>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="font-bold text-slate-800">Комментарий:</p>
              <p className="mt-1 text-slate-700">{detail.comment || "—"}</p>
            </div>
          </div>
        )}
      </section>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Добавить опросник" : "Изменить опросник"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-4 p-8">
              <label className="block border-b pb-2">
                Название
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-3 block w-full outline-none" />
              </label>
              <label className="block border-b pb-2">
                Организация
                <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-3 block w-full bg-white outline-none">
                  {organizations.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="block border-b pb-2">
                Тип магазина
                <select value={draft.storeType} onChange={(event) => setDraft((value) => ({ ...value, storeType: event.target.value }))} className="mt-3 block w-full bg-white outline-none">
                  {storeTypes.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="block border-b pb-2">
                Комментарий
                <textarea value={draft.comment} onChange={(event) => setDraft((value) => ({ ...value, comment: event.target.value }))} rows={3} className="mt-3 block w-full resize-none outline-none" />
              </label>
              <label className="flex items-center gap-3 font-medium">
                <input type="checkbox" checked={draft.active} onChange={(event) => setDraft((value) => ({ ...value, active: event.target.checked }))} className="h-5 w-5 accent-[#4f70e7]" />
                Активный
              </label>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95">
                Сохранить
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  )
}
