"use client"

import Link from "next/link"
import type { FormEvent } from "react"
import { useEffect, useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  GitMerge,
  MapPinned,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  Star,
  Tags,
  Trash2,
  Users,
  WalletCards,
  X,
} from "lucide-react"

import type { ClientModule, ClientModuleKind } from "@/lib/clients-catalog"
import { cn } from "@/lib/utils"

type ModuleRowStatus = "active" | "attention" | "inactive"

type ModuleRow = {
  id: number
  name: string
  category: string
  detail: string
  value: string
  status: ModuleRowStatus
  statusLabel: string
  updatedAt: string
}

type RowDraft = Omit<ModuleRow, "id" | "updatedAt">
type StatusFilter = ModuleRowStatus | "all"
type ModalMode = "add" | "edit" | null

const statusOptions: Array<{
  value: ModuleRowStatus
  label: string
  filterLabel: string
}> = [
  { value: "active", label: "Активно", filterLabel: "Активные" },
  { value: "attention", label: "Требует внимания", filterLabel: "Требуют внимания" },
  { value: "inactive", label: "Неактивно", filterLabel: "Неактивные" },
]

const defaultStatusLabels: Record<ModuleRowStatus, string> = {
  active: "Активно",
  attention: "Требует внимания",
  inactive: "Неактивно",
}

const statusStyles: Record<ModuleRowStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  attention: "bg-amber-50 text-amber-700 ring-amber-600/20",
  inactive: "bg-slate-100 text-slate-600 ring-slate-500/20",
}

const kindLabels: Record<ClientModuleKind, string> = {
  list: "Клиентская база",
  report: "Аналитический отчёт",
  ledger: "Финансовый реестр",
  directory: "Справочник",
  operations: "Операционное управление",
}

const kindAccents: Record<ClientModuleKind, string> = {
  list: "from-sky-500/20 to-blue-500/5",
  report: "from-violet-500/25 to-blue-500/5",
  ledger: "from-emerald-500/20 to-cyan-500/5",
  directory: "from-amber-500/20 to-orange-500/5",
  operations: "from-sky-500/20 to-indigo-500/5",
}

const moduleIcons: Record<string, LucideIcon> = {
  "client-dynamics": BarChart3,
  "financial-accounts": WalletCards,
  "telegram-users": MessageCircle,
  restrictions: ShieldAlert,
  territory: MapPinned,
  "territory-coverage": Activity,
  routes: Route,
  "duplicate-analysis": GitMerge,
  "client-types": Users,
  attributes: Tags,
  "attribute-values": BookOpen,
}

const emptyDraft: RowDraft = {
  name: "",
  category: "",
  detail: "",
  value: "",
  status: "active",
  statusLabel: "Активно",
}

const inputClassName =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10"

const seedRows: Record<string, ModuleRow[]> = {
  "client-dynamics": [
    {
      id: 1,
      name: "Ключевые клиенты",
      category: "Сегмент A",
      detail: "Покупки каждый месяц · средний чек выше 8 млн SUM",
      value: "128",
      status: "active",
      statusLabel: "Рост +12%",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "Активные клиенты",
      category: "Сегмент B",
      detail: "Последняя покупка не более 30 дней назад",
      value: "486",
      status: "active",
      statusLabel: "Стабильно",
      updatedAt: "25.07.2026",
    },
    {
      id: 3,
      name: "Клиенты риска",
      category: "Сегмент C",
      detail: "Частота заказов снизилась более чем на 25%",
      value: "74",
      status: "attention",
      statusLabel: "Снижение −18%",
      updatedAt: "24.07.2026",
    },
    {
      id: 4,
      name: "Неактивные клиенты",
      category: "Сегмент D",
      detail: "Нет покупок более 90 дней",
      value: "39",
      status: "inactive",
      statusLabel: "Без активности",
      updatedAt: "23.07.2026",
    },
  ],
  "financial-accounts": [
    {
      id: 1,
      name: "ACC-100245 · Baraka Trade",
      category: "Дебиторский",
      detail: "Основной торговый счёт · лимит 250 000 000 SUM",
      value: "184 250 000 SUM",
      status: "active",
      statusLabel: "В норме",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "ACC-100318 · Aziz Market",
      category: "Авансовый",
      detail: "Доступный остаток для новых заказов",
      value: "42 800 000 SUM",
      status: "active",
      statusLabel: "Доступен",
      updatedAt: "25.07.2026",
    },
    {
      id: 3,
      name: "ACC-100411 · Fayz Retail",
      category: "Кредитный",
      detail: "Просрочен платёж по накладной № 8471",
      value: "−18 460 000 SUM",
      status: "attention",
      statusLabel: "Просрочен",
      updatedAt: "24.07.2026",
    },
    {
      id: 4,
      name: "ACC-100096 · Orient Shop",
      category: "Дебиторский",
      detail: "Счёт закрыт после сверки взаиморасчётов",
      value: "0 SUM",
      status: "inactive",
      statusLabel: "Закрыт",
      updatedAt: "18.07.2026",
    },
  ],
  "telegram-users": [
    {
      id: 1,
      name: "@aziz_market",
      category: "Владелец",
      detail: "Aziz Market · +998 95 060 33 32",
      value: "48",
      status: "active",
      statusLabel: "Онлайн",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "@baraka_operator",
      category: "Оператор",
      detail: "Baraka Trade · уведомления о заказах включены",
      value: "31",
      status: "active",
      statusLabel: "Активен",
      updatedAt: "25.07.2026",
    },
    {
      id: 3,
      name: "@fayz_owner",
      category: "Владелец",
      detail: "Fayz Retail · требуется повторная авторизация",
      value: "7",
      status: "attention",
      statusLabel: "Сессия истекает",
      updatedAt: "24.07.2026",
    },
    {
      id: 4,
      name: "@orient_cashier",
      category: "Кассир",
      detail: "Orient Shop · бот заблокирован пользователем",
      value: "0",
      status: "inactive",
      statusLabel: "Отключён",
      updatedAt: "19.07.2026",
    },
  ],
  restrictions: [
    {
      id: 1,
      name: "Baraka Trade",
      category: "Кредитный лимит",
      detail: "Блокировать заказ при превышении установленного лимита",
      value: "250 000 000 SUM",
      status: "active",
      statusLabel: "Применяется",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "Fayz Retail",
      category: "Просроченная задолженность",
      detail: "Разрешение от финансового контролёра обязательно",
      value: "18 460 000 SUM",
      status: "attention",
      statusLabel: "На проверке",
      updatedAt: "24.07.2026",
    },
    {
      id: 3,
      name: "Samarkand Market",
      category: "Товарная группа",
      detail: "Временно запрещена отгрузка охлаждённой продукции",
      value: "12 SKU",
      status: "active",
      statusLabel: "Применяется",
      updatedAt: "23.07.2026",
    },
    {
      id: 4,
      name: "Orient Shop",
      category: "Маршрут",
      detail: "Ограничение снято после изменения адреса",
      value: "Без лимита",
      status: "inactive",
      statusLabel: "Снято",
      updatedAt: "18.07.2026",
    },
  ],
  territory: [
    {
      id: 1,
      name: "Ташкент · Юнусабад",
      category: "Ташкент",
      detail: "Команда «Север» · супервайзер Дилшод Каримов",
      value: "186",
      status: "active",
      statusLabel: "Активна",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "Ташкент · Чиланзар",
      category: "Ташкент",
      detail: "Команда «Запад» · супервайзер Азиза Рахимова",
      value: "214",
      status: "active",
      statusLabel: "Активна",
      updatedAt: "25.07.2026",
    },
    {
      id: 3,
      name: "Самарканд · Центр",
      category: "Самарканд",
      detail: "Требуется назначить второго полевого агента",
      value: "121",
      status: "attention",
      statusLabel: "Неполная команда",
      updatedAt: "24.07.2026",
    },
    {
      id: 4,
      name: "Фергана · Промзона",
      category: "Фергана",
      detail: "Территория временно исключена из планирования",
      value: "43",
      status: "inactive",
      statusLabel: "Приостановлена",
      updatedAt: "20.07.2026",
    },
  ],
  "territory-coverage": [
    {
      id: 1,
      name: "Юнусабад",
      category: "Ташкент",
      detail: "186 из 198 доступных торговых точек",
      value: "94%",
      status: "active",
      statusLabel: "Цель выполнена",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "Чиланзар",
      category: "Ташкент",
      detail: "214 из 231 доступной торговой точки",
      value: "93%",
      status: "active",
      statusLabel: "Цель выполнена",
      updatedAt: "25.07.2026",
    },
    {
      id: 3,
      name: "Самарканд · Центр",
      category: "Самарканд",
      detail: "121 из 158 доступных торговых точек",
      value: "77%",
      status: "attention",
      statusLabel: "Ниже цели",
      updatedAt: "24.07.2026",
    },
    {
      id: 4,
      name: "Фергана · Промзона",
      category: "Фергана",
      detail: "43 из 96 доступных торговых точек",
      value: "45%",
      status: "inactive",
      statusLabel: "Не обслуживается",
      updatedAt: "20.07.2026",
    },
  ],
  routes: [
    {
      id: 1,
      name: "TASH-YUN-01",
      category: "Шохрух Туляганов",
      detail: "Пн / Ср / Пт · 34 закреплённых клиента",
      value: "28",
      status: "active",
      statusLabel: "В пути",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "TASH-CHIL-04",
      category: "Азиз Абдуллаев",
      detail: "Вт / Чт / Сб · 29 закреплённых клиентов",
      value: "29",
      status: "active",
      statusLabel: "По плану",
      updatedAt: "25.07.2026",
    },
    {
      id: 3,
      name: "SAM-CEN-02",
      category: "Бекзод Хамидов",
      detail: "Пн / Вт / Чт · две точки без координат",
      value: "17",
      status: "attention",
      statusLabel: "Есть отклонения",
      updatedAt: "24.07.2026",
    },
    {
      id: 4,
      name: "FER-PRM-01",
      category: "Не назначен",
      detail: "Маршрут сохранён без активного расписания",
      value: "0",
      status: "inactive",
      statusLabel: "Приостановлен",
      updatedAt: "20.07.2026",
    },
  ],
  "duplicate-analysis": [
    {
      id: 1,
      name: "Aziz Market ↔ Aziz market",
      category: "Телефон и координаты",
      detail: "+998 95 060 33 32 · расстояние между точками 4 м",
      value: "99%",
      status: "attention",
      statusLabel: "На проверке",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "Baraka Trade ↔ BARAKA",
      category: "ИНН",
      detail: "Одинаковый ИНН и ответственный владелец",
      value: "100%",
      status: "active",
      statusLabel: "Объединено",
      updatedAt: "25.07.2026",
    },
    {
      id: 3,
      name: "Fayz Retail ↔ Fayz Mini",
      category: "Адрес",
      detail: "Совпадает адрес, различаются номера телефонов",
      value: "82%",
      status: "attention",
      statusLabel: "Нужна сверка",
      updatedAt: "24.07.2026",
    },
    {
      id: 4,
      name: "Orient Shop ↔ Orient Market",
      category: "Название",
      detail: "Разные владельцы и координаты торговых точек",
      value: "41%",
      status: "inactive",
      statusLabel: "Не является дублем",
      updatedAt: "23.07.2026",
    },
  ],
  "client-types": [
    {
      id: 1,
      name: "Розница",
      category: "Традиционная торговля",
      detail: "Магазины у дома и небольшие торговые точки",
      value: "842",
      status: "active",
      statusLabel: "Используется",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "Мини-маркет",
      category: "Современная торговля",
      detail: "Точки самообслуживания площадью до 300 м²",
      value: "326",
      status: "active",
      statusLabel: "Используется",
      updatedAt: "24.07.2026",
    },
    {
      id: 3,
      name: "HoReCa",
      category: "Общественное питание",
      detail: "Рестораны, кафе, гостиницы и кейтеринг",
      value: "118",
      status: "attention",
      statusLabel: "Нужна классификация",
      updatedAt: "23.07.2026",
    },
    {
      id: 4,
      name: "Киоск",
      category: "Традиционная торговля",
      detail: "Архивный тип для закрытых форматов точек",
      value: "14",
      status: "inactive",
      statusLabel: "Архив",
      updatedAt: "18.07.2026",
    },
  ],
  attributes: [
    {
      id: 1,
      name: "Формат торговой точки",
      category: "Список",
      detail: "Обязательное поле · показывать в карточке и фильтрах",
      value: "8",
      status: "active",
      statusLabel: "Опубликован",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "Площадь торгового зала",
      category: "Число",
      detail: "Единица измерения: м² · диапазон от 1 до 10 000",
      value: "1 146",
      status: "active",
      statusLabel: "Опубликован",
      updatedAt: "24.07.2026",
    },
    {
      id: 3,
      name: "Предпочтительное время визита",
      category: "Время",
      detail: "Поле доступно агентам при планировании маршрута",
      value: "419",
      status: "attention",
      statusLabel: "Черновик",
      updatedAt: "23.07.2026",
    },
    {
      id: 4,
      name: "Старый код клиента",
      category: "Текст",
      detail: "Устаревшее поле после завершения миграции",
      value: "73",
      status: "inactive",
      statusLabel: "Архив",
      updatedAt: "17.07.2026",
    },
  ],
  "attribute-values": [
    {
      id: 1,
      name: "Мини-маркет",
      category: "Формат торговой точки",
      detail: "Порядок сортировки: 10 · цвет метки: синий",
      value: "326",
      status: "active",
      statusLabel: "Доступно",
      updatedAt: "25.07.2026",
    },
    {
      id: 2,
      name: "Магазин у дома",
      category: "Формат торговой точки",
      detail: "Порядок сортировки: 20 · цвет метки: зелёный",
      value: "517",
      status: "active",
      statusLabel: "Доступно",
      updatedAt: "24.07.2026",
    },
    {
      id: 3,
      name: "После 15:00",
      category: "Предпочтительное время визита",
      detail: "Значение ожидает публикации администратором",
      value: "46",
      status: "attention",
      statusLabel: "Черновик",
      updatedAt: "23.07.2026",
    },
    {
      id: 4,
      name: "Павильон старого образца",
      category: "Формат торговой точки",
      detail: "Значение больше нельзя назначать новым клиентам",
      value: "19",
      status: "inactive",
      statusLabel: "Архив",
      updatedAt: "18.07.2026",
    },
  ],
}

function cloneSeedRows(slug: string) {
  return (seedRows[slug] ?? []).map((row) => ({ ...row }))
}

function csvCell(value: string | number) {
  return '"' + String(value).replace(/"/g, '""') + '"'
}

function todayLabel() {
  return new Intl.DateTimeFormat("ru-RU").format(new Date())
}

export function ClientModuleView({ clientModule }: { clientModule: ClientModule }) {
  const [rows, setRows] = useState<ModuleRow[]>(() => cloneSeedRows(clientModule.slug))
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [favorite, setFavorite] = useState(false)
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<RowDraft>(emptyDraft)
  const [formError, setFormError] = useState("")
  const [deleteIds, setDeleteIds] = useState<number[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setRows(cloneSeedRows(clientModule.slug))
    setQuery("")
    setStatusFilter("all")
    setSelectedIds([])
    setModalMode(null)
    setEditingId(null)
    setDeleteIds([])
  }, [clientModule.slug])

  useEffect(() => {
    try {
      setFavorite(window.localStorage.getItem("clients-favorite:" + clientModule.slug) === "true")
    } catch {
      setFavorite(false)
    }
  }, [clientModule.slug])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!modalMode && deleteIds.length === 0) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      setModalMode(null)
      setDeleteIds([])
    }

    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [deleteIds.length, modalMode])

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU")

    return rows.filter((row) => {
      const matchesStatus = statusFilter === "all" || row.status === statusFilter
      const matchesQuery =
        normalizedQuery === "" ||
        [row.name, row.category, row.detail, row.value, row.statusLabel]
          .join(" ")
          .toLocaleLowerCase("ru-RU")
          .includes(normalizedQuery)

      return matchesStatus && matchesQuery
    })
  }, [query, rows, statusFilter])

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id)),
    [rows, selectedIds],
  )
  const activeCount = rows.filter((row) => row.status === "active").length
  const attentionCount = rows.filter((row) => row.status === "attention").length
  const visibleIds = filteredRows.map((row) => row.id)
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))
  const ModuleIcon = moduleIcons[clientModule.slug] ?? FileText

  function toggleFavorite() {
    const next = !favorite
    setFavorite(next)
    try {
      window.localStorage.setItem("clients-favorite:" + clientModule.slug, String(next))
    } catch {
      // The visual state still works when browser storage is unavailable.
    }
    setNotice(next ? "Раздел добавлен в избранное" : "Раздел удалён из избранного")
  }

  function toggleVisibleRows() {
    if (allVisibleSelected) {
      setSelectedIds((current) => current.filter((id) => !visibleIds.includes(id)))
      return
    }

    setSelectedIds((current) => Array.from(new Set([...current, ...visibleIds])))
  }

  function toggleRow(id: number) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id],
    )
  }

  function openAddModal() {
    setDraft({ ...emptyDraft })
    setEditingId(null)
    setFormError("")
    setModalMode("add")
  }

  function openEditModal(row: ModuleRow) {
    setDraft({
      name: row.name,
      category: row.category,
      detail: row.detail,
      value: row.value,
      status: row.status,
      statusLabel: row.statusLabel,
    })
    setEditingId(row.id)
    setFormError("")
    setModalMode("edit")
  }

  function editSelectedRow() {
    if (selectedRows.length !== 1) return
    openEditModal(selectedRows[0])
  }

  function closeEditor() {
    setModalMode(null)
    setEditingId(null)
    setFormError("")
  }

  function saveRow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cleanDraft = {
      ...draft,
      name: draft.name.trim(),
      category: draft.category.trim(),
      detail: draft.detail.trim(),
      value: draft.value.trim(),
      statusLabel: draft.statusLabel.trim(),
    }

    if (
      !cleanDraft.name ||
      !cleanDraft.category ||
      !cleanDraft.detail ||
      !cleanDraft.value ||
      !cleanDraft.statusLabel
    ) {
      setFormError("Заполните все обязательные поля.")
      return
    }

    if (modalMode === "edit" && editingId !== null) {
      setRows((current) =>
        current.map((row) =>
          row.id === editingId ? { ...row, ...cleanDraft, updatedAt: todayLabel() } : row,
        ),
      )
      setNotice("Запись успешно обновлена")
    } else {
      const nextId = rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1
      setRows((current) => [
        { id: nextId, ...cleanDraft, updatedAt: todayLabel() },
        ...current,
      ])
      setNotice("Новая запись добавлена")
    }

    closeEditor()
  }

  function askToDelete(ids: number[]) {
    if (ids.length === 0) return
    setDeleteIds(ids)
  }

  function confirmDelete() {
    const count = deleteIds.length
    setRows((current) => current.filter((row) => !deleteIds.includes(row.id)))
    setSelectedIds((current) => current.filter((id) => !deleteIds.includes(id)))
    setDeleteIds([])
    setNotice(count === 1 ? "Запись удалена" : "Удалено записей: " + count)
  }

  function resetFilters() {
    setQuery("")
    setStatusFilter("all")
  }

  function downloadCsv() {
    const exportRows = selectedRows.length > 0 ? selectedRows : filteredRows
    if (exportRows.length === 0) {
      setNotice("Нет записей для экспорта")
      return
    }

    const csvRows = [
      ["Название", clientModule.categoryLabel, "Описание", clientModule.valueLabel, "Статус", "Обновлено"],
      ...exportRows.map((row) => [
        row.name,
        row.category,
        row.detail,
        row.value,
        row.statusLabel,
        row.updatedAt,
      ]),
    ]
    const csv = csvRows.map((row) => row.map(csvCell).join(";")).join("\r\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = clientModule.slug + "-" + new Date().toISOString().slice(0, 10) + ".csv"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setNotice("CSV подготовлен: " + exportRows.length + " записей")
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <Link
          href="/clients"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-blue transition-colors hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
        >
          <ArrowLeft className="h-4 w-4" />
          Назад к клиентам
        </Link>

        <section className="relative mb-5 overflow-hidden rounded-2xl bg-navy px-5 py-6 text-white shadow-sm sm:px-7">
          <div
            className={cn(
              "pointer-events-none absolute inset-0 bg-gradient-to-r",
              kindAccents[clientModule.kind],
            )}
          />
          <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-start gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                <ModuleIcon className="h-7 w-7 text-brand-sky" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-brand-sky">
                  {kindLabels[clientModule.kind]}
                </p>
                <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{clientModule.label}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-white/70">
                  {clientModule.description}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={toggleFavorite}
              aria-label={favorite ? "Удалить из избранного" : "Добавить в избранное"}
              aria-pressed={favorite}
              className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold ring-1 ring-white/15 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Star className={cn("h-4 w-4 text-amber-300", favorite && "fill-current")} />
              {favorite ? "В избранном" : "В избранное"}
            </button>
          </div>
        </section>

        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={FileText}
            label="Всего записей"
            value={String(rows.length)}
            color="bg-blue-50 text-brand-blue"
          />
          <MetricCard
            icon={CheckCircle2}
            label="Активные"
            value={String(activeCount)}
            color="bg-emerald-50 text-emerald-600"
          />
          <MetricCard
            icon={ShieldAlert}
            label="Требуют внимания"
            value={String(attentionCount)}
            color="bg-amber-50 text-amber-600"
          />
          <MetricCard
            icon={Users}
            label="Выбрано"
            value={String(selectedIds.length)}
            color="bg-violet-50 text-violet-600"
          />
        </section>

        {notice && (
          <div
            role="status"
            className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {notice}
            </span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="rounded p-1 hover:bg-emerald-100"
              aria-label="Закрыть уведомление"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4 sm:p-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row">
                <label className="relative min-w-0 flex-1 xl:max-w-md">
                  <span className="sr-only">Поиск</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Поиск по всем полям"
                    className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10"
                  />
                </label>

                <label className="min-w-52">
                  <span className="sr-only">Фильтр по статусу</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10"
                  >
                    <option value="all">Все статусы</option>
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.filterLabel}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={resetFilters}
                  disabled={!query && statusFilter === "all"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshCw className="h-4 w-4" />
                  Сбросить
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={downloadCsv}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-blue/40 hover:bg-blue-50 hover:text-brand-blue"
                >
                  <Download className="h-4 w-4" />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={editSelectedRow}
                  disabled={selectedRows.length !== 1}
                  title={
                    selectedRows.length === 1
                      ? "Изменить выбранную запись"
                      : "Выберите одну запись"
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Pencil className="h-4 w-4" />
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={() => askToDelete(selectedIds)}
                  disabled={selectedIds.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3.5 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить
                </button>
                <button
                  type="button"
                  onClick={openAddModal}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  Добавить
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                Показано {filteredRows.length} из {rows.length}
                {selectedIds.length > 0 && " · выбрано " + selectedIds.length}
              </span>
              <span>
                CSV экспортирует {selectedRows.length > 0 ? "выбранные записи" : "текущую выборку"}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-left">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="w-12 px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleVisibleRows}
                      aria-label="Выбрать все показанные записи"
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-blue"
                    />
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Название
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {clientModule.categoryLabel}
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Описание
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {clientModule.valueLabel}
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Статус
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Обновлено
                  </th>
                  <th className="w-24 px-4 py-3.5 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-16 text-center">
                      <Search className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                      <p className="font-semibold text-slate-700">Ничего не найдено</p>
                      <p className="mt-1 text-sm text-slate-400">
                        Измените поисковый запрос или сбросьте фильтры.
                      </p>
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-4 text-sm font-semibold text-brand-blue hover:text-blue-700"
                      >
                        Сбросить фильтры
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const selected = selectedIds.includes(row.id)

                    return (
                      <tr
                        key={row.id}
                        className={cn(
                          "border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50/80",
                          selected && "bg-blue-50/60",
                        )}
                      >
                        <td className="px-4 py-4 align-top">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRow(row.id)}
                            aria-label={"Выбрать " + row.name}
                            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-blue"
                          />
                        </td>
                        <td className="px-4 py-4 align-top">
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="max-w-64 text-left text-sm font-bold text-slate-800 transition-colors hover:text-brand-blue"
                          >
                            {row.name}
                          </button>
                        </td>
                        <td className="px-4 py-4 align-top text-sm font-medium text-slate-600">
                          {row.category}
                        </td>
                        <td className="max-w-sm px-4 py-4 align-top text-sm leading-5 text-slate-500">
                          {row.detail}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 align-top text-sm font-bold text-slate-700">
                          {row.value}
                        </td>
                        <td className="px-4 py-4 align-top">
                          <span
                            className={cn(
                              "inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset",
                              statusStyles[row.status],
                            )}
                          >
                            {row.statusLabel}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 align-top text-sm text-slate-500">
                          {row.updatedAt}
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          <div className="inline-flex items-center">
                            <button
                              type="button"
                              onClick={() => openEditModal(row)}
                              aria-label={"Изменить " + row.name}
                              className="rounded-md p-2 text-slate-400 transition-colors hover:bg-blue-50 hover:text-brand-blue"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => askToDelete([row.id])}
                              aria-label={"Удалить " + row.name}
                              className="rounded-md p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {modalMode && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor()
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-module-editor-title"
            className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
              <div>
                <h2 id="client-module-editor-title" className="text-xl font-bold text-slate-800">
                  {modalMode === "add" ? "Добавить запись" : "Изменить запись"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{clientModule.label}</p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                aria-label="Закрыть"
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveRow}>
              <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
                <FormField label="Название">
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    className={inputClassName}
                    placeholder="Введите название"
                  />
                </FormField>

                <FormField label={clientModule.categoryLabel}>
                  <input
                    value={draft.category}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, category: event.target.value }))
                    }
                    className={inputClassName}
                    placeholder={"Введите: " + clientModule.categoryLabel.toLocaleLowerCase("ru-RU")}
                  />
                </FormField>

                <FormField label={clientModule.valueLabel}>
                  <input
                    value={draft.value}
                    onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
                    className={inputClassName}
                    placeholder="Введите значение"
                  />
                </FormField>

                <FormField label="Системный статус">
                  <select
                    value={draft.status}
                    onChange={(event) => {
                      const status = event.target.value as ModuleRowStatus
                      setDraft((current) => ({
                        ...current,
                        status,
                        statusLabel: defaultStatusLabels[status],
                      }))
                    }}
                    className={inputClassName}
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Отображаемый статус">
                  <input
                    value={draft.statusLabel}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, statusLabel: event.target.value }))
                    }
                    className={inputClassName}
                    placeholder="Например: В норме"
                  />
                </FormField>

                <div className="sm:col-span-2">
                  <FormField label="Описание">
                    <textarea
                      value={draft.detail}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, detail: event.target.value }))
                      }
                      rows={3}
                      className={cn(inputClassName, "resize-y")}
                      placeholder="Добавьте подробное описание"
                    />
                  </FormField>
                </div>

                {formError && (
                  <p role="alert" className="sm:col-span-2 text-sm font-medium text-red-600">
                    {formError}
                  </p>
                )}
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95"
                >
                  {modalMode === "add" ? "Добавить" : "Сохранить изменения"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {deleteIds.length > 0 && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDeleteIds([])
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-client-module-title"
            aria-describedby="delete-client-module-description"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <Trash2 className="h-5 w-5" />
            </span>
            <h2 id="delete-client-module-title" className="text-xl font-bold text-slate-800">
              Удалить {deleteIds.length === 1 ? "запись" : "записи"}?
            </h2>
            <p id="delete-client-module-description" className="mt-2 text-sm leading-6 text-slate-500">
              {deleteIds.length === 1
                ? "Выбранная запись будет удалена из текущего раздела."
                : "Будет удалено записей: " + deleteIds.length + "."}
              {" "}Это действие нельзя отменить.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteIds([])}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                autoFocus
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              >
                Удалить
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: LucideIcon
  label: string
  value: string
  color: string
}) {
  return (
    <article className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", color)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-slate-500">{label}</span>
        <strong className="mt-0.5 block text-xl text-slate-800">{value}</strong>
      </span>
    </article>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label}
      <span className="ml-1 text-red-500" aria-hidden="true">
        *
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  )
}
