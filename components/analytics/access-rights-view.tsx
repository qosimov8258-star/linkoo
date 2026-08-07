"use client"

import { ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from "lucide-react"
import { FormEvent, useMemo, useState } from "react"

type Role = { id: number; name: string; capabilities: string[] }

const capabilityPool = [
  "Завсклад", "Агент | Функции", "Доставщик", "Кассир | Функции", "Доставщик | Функции", "долг", "agent 2",
  "Супервайзер | Функции", "Супервайзер", "Инкассатор", "Зав.Склад | Функции", "Мерчендайзер", "video",
  "Мерчендайзер | Функции", "Кассир", "поставщик", "Инкассатор | Функции", "Доступ Сотрудник торговой точки",
  "Доступ технолог", "Агент + Доставщик функции", "Агент | Функции авто доставки", "Shagi vizita",
  "Видеть всех клиентов", "Только своих клиентов", "Доступ Оператор", "Расходы на персонал", "Доступ админ",
  "авто доставки", "Redmi", "Доступ вансел агент", "Склад управления", "All", "Proizvodstva", "Агент |vazifasi",
  "testucun atribut", "Ishchi", "mobil online", "Доступ Директора",
]

const extraRoleNames = [
  "Агент юг", "Агент север", "Доставщик экспресс", "Супервайзер запад", "Тест роль 1", "Тест роль 2", "Демо агент",
  "Складской оператор", "Финансовый менеджер", "Аналитик продаж", "Региональный директор", "Мерчендайзер юг",
  "Курьер", "Кассир 2", "Экспедитор", "Логист", "Инспектор", "Контролер качества", "HR менеджер",
  "IT администратор", "Маркетолог", "Продукт менеджер", "Территориальный агент", "Мобильный кассир",
  "Приемщик товара", "Комплектовщик", "Водитель доставки", "Оператор call-центра", "Юрист", "Бухгалтер", "Стажер",
]

function generateRoles(): Role[] {
  const seed: [string, string[]][] = [
    ["Агент", ["Завсклад", "Агент | Функции"]],
    ["Доставщик", ["Доставщик", "Кассир | Функции", "Доставщик | Функции", "долг"]],
    ["Супервайзер", ["agent 2", "Супервайзер | Функции", "Супервайзер"]],
    ["Инкассатор", ["Инкассатор", "Завсклад", "Зав.Склад | Функции"]],
    ["Мерчендайзер", ["Мерчендайзер", "video", "Мерчендайзер | Функции"]],
    ["Кассир", ["Кассир | Функции", "Кассир", "Агент | Функции"]],
    ["Зав. склад", ["Завсклад", "Супервайзер | Функции", "Агент | Функции", "Супервайзер", "поставщик"]],
    [
      "Супер-Админ",
      [
        "Доставщик", "Инкассатор", "Мерчендайзер", "Инкассатор | Функции", "Завсклад", "Кассир | Функции",
        "Доступ Сотрудник торговой точки", "Доступ технолог", "Агент + Доставщик функции", "Агент | Функции авто доставки",
        "Shagi vizita", "video", "Видеть всех клиентов", "Только своих клиентов", "Доступ Оператор", "Расходы на персонал",
        "agent 2", "Доступ админ", "авто доставки", "Redmi", "Доставщик | Функции", "Кассир", "Зав.Склад | Функции",
        "Доступ вансел агент", "Склад управления", "All", "Proizvodstva", "Супервайзер | Функции", "Агент |vazifasi",
        "Агент | Функции", "Супервайзер", "Мерчендайзер | Функции",
      ],
    ],
    ["Сотрудник торговой точки", ["Завсклад", "Доступ Сотрудник торговой точки", "agent 2", "Кассир"]],
    ["Оператор", ["Доставщик", "Доступ Оператор", "agent 2"]],
    ["Админ", ["Доставщик", "Инкассатор", "Мерчендайзер", "Завсклад", "agent 2", "Кассир", "All", "Агент | Функции", "Супервайзер"]],
    ["Вансел агент", ["Доставщик", "Завсклад", "agent 2", "Кассир", "Доступ вансел агент"]],
    ["Агент + Доставщик", ["Доставщик", "Агент + Доставщик функции", "agent 2", "Кассир"]],
    ["CEO", ["Агент | Функции"]],
    ["Технолог", ["Завсклад", "Доступ технолог"]],
    ["Agent Shgi vizita", ["Shagi vizita", "Видеть всех клиентов", "Расходы на персонал", "agent 2", "Агент | Функции"]],
    ["Склад управления", ["Завсклад", "Склад управления"]],
    ["Агент универсал", ["Агент | Функции авто доставки", "agent 2", "авто доставки", "Агент | Функции"]],
    ["umumiy xodim", ["Доставщик", "Доставщик | Функции", "Супервайзер | Функции", "Агент | Функции"]],
    ["Proizvodstva", ["Завсклад", "Proizvodstva"]],
    ["alohida agent", ["agent 2", "Склад управления", "Агент | Функции"]],
    ["yangi agent", ["testucun atribut", "agent 2", "Ishchi"]],
    ["поставщик", ["Инкассатор | Функции", "Завсклад", "Кассир | Функции", "Доступ Оператор", "Кассир", "All", "поставщик", "mobil online"]],
    ["Права доступ Директора", ["Доставщик", "Инкассатор", "agent 2", "Доступ Директора", "Супервайзер"]],
    ["BURN", ["Доставщик", "Мерчендайзер", "agent 2", "Кассир", "Супервайзер | Функции", "Агент | Функции", "Супервайзер", "Мерчендайзер | Функции"]],
  ]

  const rows: Role[] = seed.map(([name, capabilities], index) => ({ id: index + 1, name, capabilities }))
  let index = 0
  while (rows.length < 56) {
    const name = extraRoleNames[index % extraRoleNames.length]
    const count = 2 + (index % 4)
    const capabilities = Array.from({ length: count }, (_, offset) => capabilityPool[(index * 3 + offset) % capabilityPool.length])
    rows.push({ id: rows.length + 1, name: `${name}${index >= extraRoleNames.length ? ` ${Math.floor(index / extraRoleNames.length) + 1}` : ""}`, capabilities: Array.from(new Set(capabilities)) })
    index += 1
  }
  return rows
}

const seedRoles = generateRoles()

function emptyDraft() {
  return { name: "", capabilities: [] as string[] }
}

export function AccessRightsView() {
  const [roles, setRoles] = useState(seedRoles)
  const [capabilities, setCapabilities] = useState(capabilityPool)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Role | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [capabilityModalOpen, setCapabilityModalOpen] = useState(false)
  const [capabilityName, setCapabilityName] = useState("")
  const pageSize = 25

  const filtered = useMemo(() => roles.filter((role) => role.name.toLowerCase().includes(query.toLowerCase())), [roles, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setDraft(emptyDraft())
    setEditing("new")
  }

  function openEdit(role: Role) {
    setDraft({ name: role.name, capabilities: [...role.capabilities] })
    setEditing(role)
  }

  function toggleCapability(item: string) {
    setDraft((current) => ({ ...current, capabilities: current.capabilities.includes(item) ? current.capabilities.filter((value) => value !== item) : [...current.capabilities, item] }))
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    if (editing !== "new" && editing) {
      setRoles((list) => list.map((role) => (role.id === editing.id ? { ...role, name: draft.name.trim(), capabilities: draft.capabilities } : role)))
    } else {
      const id = Math.max(0, ...roles.map((role) => role.id)) + 1
      setRoles((list) => [{ id, name: draft.name.trim(), capabilities: draft.capabilities }, ...list])
    }
    setEditing(null)
  }

  function remove(id: number) {
    setRoles((list) => list.filter((role) => role.id !== id))
  }

  function saveCapability(event: FormEvent) {
    event.preventDefault()
    if (!capabilityName.trim() || capabilities.includes(capabilityName.trim())) return
    setCapabilities((current) => [...current, capabilityName.trim()])
    setCapabilityName("")
    setCapabilityModalOpen(false)
  }

  return (
    <main className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-6 px-5 py-4">
        <button type="button" onClick={openCreate} className="text-[16px] text-[#4f70e7] hover:underline">
          + создать права доступа
        </button>
        <button type="button" onClick={() => setCapabilityModalOpen(true)} className="text-[16px] text-[#4f70e7] hover:underline">
          + создать возможности
        </button>
        <label className="relative ml-4 w-64">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
          <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
        </label>
        <span className="ml-auto text-slate-500">25</span>
        <span className="text-slate-500">
          {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
        </span>
        <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
          <ChevronLeft className="h-5 w-5 text-slate-400" />
        </button>
        <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </button>
      </div>

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="w-64 px-5 py-4 font-semibold text-slate-800">Права доступа</th>
            <th className="px-5 py-4 font-semibold text-slate-800">Возможности</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {visible.map((role) => (
            <tr key={role.id} className="group border-b border-dashed border-slate-200 align-top hover:bg-slate-50">
              <td className="whitespace-nowrap px-5 py-5 font-medium text-slate-800">{role.name}</td>
              <td className="px-5 py-5">
                <div className="flex flex-wrap gap-3">
                  {role.capabilities.map((item, index) => (
                    <span key={`${item}-${index}`} className="rounded bg-slate-100 px-4 py-2 text-sm text-slate-700">
                      {item}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-5 py-5">
                <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                  <button type="button" onClick={() => openEdit(role)} aria-label="Изменить">
                    <Pencil className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => remove(role.id)} aria-label="Удалить">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={3} className="px-5 py-10 text-center text-slate-400">
                Ничего не найдено
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Создать права доступа" : "Изменить права доступа"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-8">
              <label className="mb-6 block border-b border-slate-200 pb-2 font-medium">
                Наименование <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <p className="mb-3 font-medium text-slate-700">Возможности</p>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {capabilities.map((item) => (
                  <label key={item} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.capabilities.includes(item)} onChange={() => toggleCapability(item)} />
                    <span className="truncate">{item}</span>
                  </label>
                ))}
              </div>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95">
                Сохранить
              </button>
            </footer>
          </form>
        </div>
      )}

      {capabilityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={saveCapability} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex justify-between">
              <h2 className="text-xl font-bold">Создать возможность</h2>
              <button type="button" onClick={() => setCapabilityModalOpen(false)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <label className="mb-2 block font-medium">
              Наименование <span className="text-red-500">*</span>
            </label>
            <input autoFocus value={capabilityName} onChange={(event) => setCapabilityName(event.target.value)} className="mb-4 w-full border-b border-slate-300 py-2 outline-none focus:border-[#4f70e7]" />
            <div className="mt-6 flex justify-end">
              <button type="submit" className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold uppercase text-white hover:brightness-95">
                Сохранить
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
