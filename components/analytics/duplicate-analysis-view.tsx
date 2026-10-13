"use client"

import { FormEvent, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Link2, Search, Trash2, X } from "lucide-react"

type DuplicateGroup = {
  id: number
  inn: string
  phone: string
  clients: string[]
}

const initialGroups: DuplicateGroup[] = []

const sidebar = [
  ["Персонал", "Подписки", "Сотрудники", "Смены", "Должности", "Права доступа", "Транспорт", "Сессия"],
  ["Финансы", "Валюты", "Кассы", "Категории приходов", "Категории расходов"],
  ["Продукты", "Типы продуктов", "Измерения", "Бренд", "Атрибуты", "Значение атрибута", "Продукты конкурентов"],
  ["Клиенты", "Типы клиентов", "Атрибуты", "Значение атрибута", "Категория магазина"],
  ["Конструкторы", "Конструктор документов", "Дашборды", "Настройка EXCEL заказов"],
  ["Поставщики", "Категории поставщиков"],
  ["Склад", "Склады", "Настройка чека", "Тип ячейки", "Ячейки"],
  ["Разное", "Прайс-листы", "Тип отказа", "Филиалы", "Оборудования", "Организация", "Объединение", "Ограничение времени", "Закрытия дня/месяца", "Интеграция", "Уведомления"],
]

const sidebarLinks: Record<string, string> = {
  "Персонал:Сотрудники": "/analytics/employees",
  "Персонал:Смены": "/analytics/shifts",
  "Персонал:Должности": "/analytics/positions",
  "Персонал:Права доступа": "/analytics/access-rights",
  "Финансы:Кассы": "/analytics/cashboxes",
  "Финансы:Категории приходов": "/analytics/income-categories",
  "Финансы:Категории расходов": "/analytics/expense-categories",
  "Продукты:Типы продуктов": "/analytics/product-types",
  "Продукты:Измерения": "/analytics/units-of-measure",
  "Продукты:Бренд": "/analytics/brands",
  "Клиенты:Типы клиентов": "/clients/client-types",
  "Клиенты:Атрибуты": "/clients/attributes",
  "Клиенты:Значение атрибута": "/clients/attribute-values",
  "Поставщики:Категории поставщиков": "/analytics/supplier-categories",
  "Склад:Склады": "/analytics/warehouses",
  "Разное:Прайс-листы": "/analytics/price-lists",
  "Разное:Тип отказа": "/analytics/refusal-types",
  "Разное:Объединение": "/analytics/duplicate-analysis",
  "Разное:Филиалы": "/analytics/branches",
  "Разное:Организация": "/analytics/organization",
  "Разное:Ограничение времени": "/analytics/time-restrictions",
  "Разное:Интеграция": "/settings/integrations",
  "Разное:Уведомления": "/settings/notifications",
}

export function DuplicateAnalysisView() {
  const router = useRouter()
  const [mode, setMode] = useState<"inn" | "phone">("inn")
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState(initialGroups)
  const [selected, setSelected] = useState<string[]>([])
  const [mergeOpen, setMergeOpen] = useState(false)
  const [primary, setPrimary] = useState("")
  const [message, setMessage] = useState("")
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null)
  const [clientPickerOpen, setClientPickerOpen] = useState(true)
  const [addKey, setAddKey] = useState("")

  const availableToAdd = useMemo(
    () =>
      groups
        .flatMap((group) => group.clients.map((client, index) => ({ key: `${group.id}:${index}`, client })))
        .filter(({ key }) => !selected.includes(key)),
    [groups, selected],
  )

  const survivorOptions: string[] = []

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru")
    if (!normalized) return groups
    return groups.filter((group) =>
      [group.inn, group.phone, ...group.clients].some((value) =>
        value.toLocaleLowerCase("ru").includes(normalized),
      ),
    )
  }, [groups, query])

  function toggleClient(key: string) {
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    )
  }

  function openMerge() {
    if (selected.length < 2) {
      const group = filtered[0]
      if (!group || group.clients.length < 2) {
        setMessage("Для объединения необходимо выбрать минимум двух клиентов.")
        return
      }
      const fallbackSelection = group.clients.slice(0, 2).map((_, index) => `${group.id}:${index}`)
      setSelected(fallbackSelection)
      setPrimary(survivorOptions[0] ?? "")
      setActiveGroupId(group.id)
      setClientPickerOpen(true)
      setMergeOpen(true)
      return
    }
    setPrimary(survivorOptions[0] ?? "")
    setActiveGroupId(Number(selected[0].split(":")[0]))
    setClientPickerOpen(true)
    setMergeOpen(true)
  }

  function openGroupMerge(group: DuplicateGroup) {
    const groupSelection = group.clients.map((_, index) => `${group.id}:${index}`)
    setSelected(groupSelection)
    setPrimary(survivorOptions[0] ?? "")
    setActiveGroupId(group.id)
    setClientPickerOpen(true)
    setMergeOpen(true)
  }

  function merge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setGroups((current) => current.filter((group) => group.id !== activeGroupId))
    setMergeOpen(false)
    setSelected([])
    setMessage(`${selected.length} клиента успешно объединены.`)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-white text-slate-800">
      <div className="flex min-h-[calc(100vh-4rem)]">
        <aside className="hidden h-[calc(100vh-4rem)] w-[280px] shrink-0 overflow-y-auto bg-slate-100 px-9 py-7 lg:block">
          {sidebar.map(([title, ...items]) => (
            <section key={title} className="mb-8">
              <h2 className="mb-2 text-[16px] font-bold">{title}</h2>
              <ul className="space-y-2 pl-8 text-[15px]">
                {items.map((item) => {
                  const href = sidebarLinks[`${title}:${item}`]
                  return (
                    <li key={`${title}-${item}`}>
                      <button
                        type="button"
                        onClick={() => href && router.push(href)}
                        className={`text-left leading-5 transition-colors hover:text-brand-blue ${
                          item === "Объединение" ? "text-brand-blue" : ""
                        }`}
                      >
                        {item}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </aside>

        <section className="min-w-0 flex-1">
          <div className="sticky top-0 z-40 bg-white shadow-sm">
            <div className="flex justify-end px-8 py-3">
              <button
                type="button"
                onClick={openMerge}
                className="inline-flex items-center gap-2 rounded-md bg-[#506fe0] px-5 py-2.5 font-semibold text-white shadow-sm hover:bg-[#425fc9]"
              >
                <Link2 className="h-5 w-5" />
                Объединить
              </button>
            </div>
            <div className="grid grid-cols-2 border-b border-slate-200">
              {(["inn", "phone"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setMode(tab)
                    setSelected([])
                  }}
                  className={`border-b-4 px-4 py-3 text-[17px] transition-colors ${
                    mode === tab ? "border-[#6178e8] text-slate-900" : "border-transparent hover:bg-slate-50"
                  }`}
                >
                  {tab === "inn" ? "По ИНН" : "По номеру телефона"}
                </button>
              ))}
            </div>
            <label className="relative block w-full max-w-[410px] px-5 py-3">
              <span className="sr-only">Поиск</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск"
                className="w-full border-b border-slate-300 bg-transparent py-2 pr-10 outline-none focus:border-brand-blue"
              />
              <Search className="absolute right-7 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            </label>
          </div>

          {message && (
            <div className="mx-6 mt-4 flex items-center justify-between rounded-md bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              {message}
              <button type="button" onClick={() => setMessage("")} aria-label="Закрыть сообщение">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] border-collapse text-[16px]">
              <thead className="bg-[#5d6474] text-left text-white">
                <tr>
                  <th className="w-[14%] px-12 py-5">№</th>
                  <th className="w-[19%] px-6 py-5">Наименование</th>
                  <th className="px-6 py-5">Клиенты</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((group) => (
                  <tr key={group.id} className="group relative border-b border-dashed border-slate-300 hover:bg-slate-50">
                    <td className="px-12 py-4 align-middle">{group.id}</td>
                    <td className="px-6 py-4 align-middle">{mode === "inn" ? group.inn : group.phone}</td>
                    <td className="relative space-y-1 px-6 py-2 pr-48">
                      {group.clients.map((client, index) => {
                        const key = `${group.id}:${index}`
                        const isSelected = selected.includes(key)
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleClient(key)}
                            aria-pressed={isSelected}
                            className={`flex max-w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-brand-blue transition-colors ${
                              isSelected ? "bg-blue-100 ring-2 ring-brand-blue" : "bg-slate-100 hover:bg-blue-50"
                            }`}
                          >
                            <span>{index + 1}. {client}</span>
                            {isSelected && <Check className="h-4 w-4 shrink-0" />}
                          </button>
                        )
                      })}
                      <button
                        type="button"
                        onClick={() => openGroupMerge(group)}
                        className="absolute right-8 top-1/2 hidden -translate-y-1/2 items-center gap-2 rounded-md bg-[#506fe0] px-5 py-2.5 font-semibold text-white shadow-md group-hover:inline-flex focus:inline-flex"
                      >
                        <Link2 className="h-4 w-4" />
                        Объединить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="py-20 text-center text-slate-400">По вашему запросу ничего не найдено.</div>
            )}
          </div>
        </section>
      </div>

      {mergeOpen && (
        <div className="fixed inset-0 z-[70] bg-white" role="dialog" aria-modal="true" aria-labelledby="merge-title">
          <form onSubmit={merge} className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b px-9 py-6">
              <h2 id="merge-title" className="text-[17px] font-bold uppercase">Объединение клиентов</h2>
              <button type="button" onClick={() => setMergeOpen(false)} aria-label="Закрыть" className="text-slate-500 hover:text-slate-900">
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="border-b px-3 py-6 text-[17px] font-semibold text-slate-500">
              <p>Все данные выбранных клиентов будут переписаны на имя клиента:</p>
              <p className="text-red-500">Объединённые клиенты нельзя восстановить !</p>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-1 divide-x lg:grid-cols-2">
              <section className="overflow-y-auto p-3">
                <h3 className="mb-8 text-2xl font-bold">Клиенты которые будут удалены</h3>
                <div className="mb-10 flex items-end gap-4">
                  <label className="min-w-0 flex-1">
                    <span className="mb-2 block text-sm">Клиент</span>
                    <select value={addKey} onChange={(event) => setAddKey(event.target.value)} className="w-full border-b border-slate-300 bg-white py-2 outline-none">
                      <option value="">Выберите клиента</option>
                      {availableToAdd.map(({ key, client }) => (
                        <option key={key} value={key}>{client}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!addKey}
                    onClick={() => {
                      if (!addKey) return
                      setSelected((current) => [...current, addKey])
                      setAddKey("")
                    }}
                    className="px-5 py-2 font-medium text-brand-blue disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ДОБАВИТЬ
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_155px_1fr_42px] gap-4 px-2 text-sm font-semibold">
                  <span>Наименование</span><span>Телефон</span><span>Адрес</span><span />
                </div>
                {selected.map((key) => {
                  const [id, index] = key.split(":").map(Number)
                  const client = groups.find((group) => group.id === id)?.clients[index] ?? key
                  return (
                    <div key={key} className="mt-4 grid grid-cols-[1fr_155px_1fr_42px] items-center gap-4 border-b py-3 text-sm">
                      <span>{client}</span>
                      <span>Не указан</span>
                      <span>Не указано</span>
                      <button
                        type="button"
                        aria-label={`Удалить ${client}`}
                        onClick={() => setSelected((current) => current.filter((item) => item !== key))}
                        className="text-slate-500 hover:text-red-500"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  )
                })}
              </section>
              <section className="relative overflow-y-auto p-3">
                <h3 className="mb-3 text-2xl font-bold">Клиент который остается</h3>
                <label className="block text-sm">
                  Клиент
                  <button
                    type="button"
                    onClick={() => setClientPickerOpen((current) => !current)}
                    className="mt-2 flex w-full items-center justify-between border-b border-slate-300 py-2 text-left"
                  >
                    <span>{primary}</span>
                    <span className="text-slate-400">{clientPickerOpen ? "▲" : "▼"}</span>
                  </button>
                </label>
                {clientPickerOpen && (
                  <div className="absolute left-3 right-3 top-28 z-10 max-h-64 overflow-y-auto border bg-white py-1 shadow-xl">
                    {survivorOptions.map((client) => (
                      <button
                        key={client}
                        type="button"
                        onClick={() => {
                          setPrimary(client)
                          setClientPickerOpen(false)
                        }}
                        className="block w-full px-3 py-2.5 text-left text-[15px] text-slate-600 hover:bg-blue-50"
                      >
                        {client}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
            <div className="flex justify-end border-t px-7 py-5">
              <button type="submit" disabled={!primary || selected.length === 0} className="font-semibold text-[#00a4e8] disabled:opacity-40">ОБЪЕДИНИТЬ</button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
