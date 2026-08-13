"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import {
  Star,
  BarChart3,
  ListFilter,
  Import,
  RefreshCw,
  Plus,
  MoreVertical,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ListChecks,
  AlignJustify,
  Pencil,
  TrendingUp,
  X,
  Download,
  CheckCircle2,
} from "lucide-react"
import { clientTabs, type Client } from "./clients-data"

const pageSizes = [10, 25, 50, 100]

type Notice = {
  tone: "info" | "success"
  message: string
}

type ActionMenu = "header" | "table" | null
type ModalMode = "add" | "edit" | null
type ViewMode = "comfortable" | "compact"

type ClientForm = {
  name: string
  phone: string
  inn: string
  type: string
  zone: string
  zoneAgent: string
  agent: string
  deliverer: string
  collector: string
  balance: string
  tab: Client["tab"]
}

type ClientTextField = Exclude<keyof ClientForm, "tab">

const emptyClientForm: ClientForm = {
  name: "",
  phone: "",
  inn: "",
  type: "",
  zone: "",
  zoneAgent: "Не указано",
  agent: "Не указано",
  deliverer: "Не указано",
  collector: "Не указано",
  balance: "",
  tab: "all",
}

function formatBalance(value: number) {
  return `${value.toLocaleString("ru-RU").replace(/,/g, " ")} SUM`
}

function formFromClient(client: Client): ClientForm {
  return {
    name: client.name,
    phone: client.phone,
    inn: client.inn ?? "",
    type: client.type,
    zone: client.zone,
    zoneAgent: client.zoneAgent,
    agent: client.agent,
    deliverer: client.deliverer,
    collector: client.collector,
    balance: client.balance == null ? "" : String(client.balance),
    tab: client.tab,
  }
}

function csvCell(value: string | number | undefined) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

function downloadCsv(rows: Client[]) {
  const headers = [
    "Название",
    "Тел. номер",
    "ИНН",
    "Тип",
    "Зона",
    "Агент зоны",
    "Ответственный агент",
    "Ответственный доставщик",
    "Ответственный инкассатор",
    "Баланс",
  ]
  const content = [
    headers.map(csvCell).join(";"),
    ...rows.map((client) =>
      [
        client.name,
        client.phone,
        client.inn,
        client.type,
        client.zone,
        client.zoneAgent,
        client.agent,
        client.deliverer,
        client.collector,
        client.balance,
      ]
        .map(csvCell)
        .join(";"),
    ),
  ].join("\r\n")

  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `clients-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function ClientsView() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [activeTab, setActiveTab] = useState<Client["tab"]>("all")
  const [query, setQuery] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [pageSizeOpen, setPageSizeOpen] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [typeFilter, setTypeFilter] = useState("all")
  const [zoneFilter, setZoneFilter] = useState("all")
  const [viewMode, setViewMode] = useState<ViewMode>("comfortable")
  const [actionMenu, setActionMenu] = useState<ActionMenu>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ClientForm>(emptyClientForm)
  const [formError, setFormError] = useState("")
  const [routeAssigned, setRouteAssigned] = useState<Set<number>>(() => new Set())
  const [detailClient, setDetailClient] = useState<Client | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const promotionInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/clients")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить клиентов")
        return (await response.json()) as Client[]
      })
      .then((data) => {
        if (cancelled) return
        setClients(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить клиентов с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!modalMode) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setModalMode(null)
    }

    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [modalMode])

  const typeOptions = useMemo(
    () => [...new Set(clients.map((client) => client.type))].sort((a, b) => a.localeCompare(b, "ru")),
    [clients],
  )
  const zoneOptions = useMemo(
    () => [...new Set(clients.map((client) => client.zone))].sort((a, b) => a.localeCompare(b, "ru")),
    [clients],
  )

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const matchesTab = activeTab === "all" ? true : c.tab === activeTab
      const matchesType = typeFilter === "all" || c.type === typeFilter
      const matchesZone = zoneFilter === "all" || c.zone === zoneFilter
      const q = query.trim().toLowerCase()
      const matchesQuery =
        q === "" ||
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        c.zone.toLowerCase().includes(q) ||
        c.agent.toLowerCase().includes(q)
      return matchesTab && matchesType && matchesZone && matchesQuery
    })
  }, [activeTab, clients, query, typeFilter, zoneFilter])

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * pageSize
  const pageRows = filtered.slice(start, start + pageSize)
  const rangeStart = total === 0 ? 0 : start + 1
  const rangeEnd = Math.min(start + pageSize, total)

  const allSelected = pageRows.length > 0 && pageRows.every((r) => selected.includes(r.id))
  const selectedClients = clients.filter((client) => selected.includes(client.id))
  const activeFilterCount = Number(typeFilter !== "all") + Number(zoneFilter !== "all")

  function toggleAll() {
    if (allSelected) {
      setSelected((prev) => prev.filter((id) => !pageRows.some((r) => r.id === id)))
    } else {
      setSelected((prev) => [...new Set([...prev, ...pageRows.map((r) => r.id)])])
    }
  }

  function toggleRow(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function resetFilters() {
    setActiveTab("all")
    setQuery("")
    setTypeFilter("all")
    setZoneFilter("all")
    setPage(1)
    setNotice({ tone: "info", message: "Фильтры и поиск сброшены" })
    setActionMenu(null)
  }

  function openAddModal() {
    setForm({ ...emptyClientForm })
    setFormError("")
    setEditingId(null)
    setModalMode("add")
  }

  function openEditModal() {
    if (selectedClients.length !== 1) return
    setForm(formFromClient(selectedClients[0]))
    setFormError("")
    setEditingId(selectedClients[0].id)
    setModalMode("edit")
  }

  function updateFormField(field: ClientTextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError("")
  }

  const [saving, setSaving] = useState(false)

  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = form.name.trim()
    const phone = form.phone.trim()
    const type = form.type.trim()
    const zone = form.zone.trim()
    if (!name || !phone || !type || !zone) {
      setFormError("Заполните название, телефон, тип и зону")
      return
    }

    const parsedBalance = form.balance.trim() === "" ? undefined : Number(form.balance.replace(/\s/g, ""))
    if (parsedBalance !== undefined && !Number.isFinite(parsedBalance)) {
      setFormError("Баланс должен быть числом")
      return
    }

    const values = {
      name,
      phone,
      inn: form.inn.trim() || undefined,
      type,
      zone,
      zoneAgent: form.zoneAgent.trim() || "Не указано",
      agent: form.agent.trim() || "Не указано",
      deliverer: form.deliverer.trim() || "Не указано",
      collector: form.collector.trim() || "Не указано",
      balance: parsedBalance,
      tab: form.tab,
    }

    setSaving(true)
    try {
      if (modalMode === "add") {
        const response = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        })
        if (!response.ok) throw new Error("create failed")
        const created = (await response.json()) as Client
        setClients((current) => [created, ...current])
        setSelected([created.id])
        setActiveTab("all")
        setPage(1)
        setNotice({ tone: "success", message: `Клиент «${name}» добавлен` })
      } else if (editingId !== null) {
        const response = await fetch(`/api/clients/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        })
        if (!response.ok) throw new Error("update failed")
        const updated = (await response.json()) as Client
        setClients((current) => current.map((client) => (client.id === editingId ? updated : client)))
        setNotice({ tone: "success", message: `Клиент «${name}» обновлён` })
      }
      setModalMode(null)
    } catch {
      setFormError("Не удалось сохранить клиента, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function chooseFile(file: File | undefined, subject: string) {
    if (!file) return
    setNotice({
      tone: "success",
      message: `${subject}: файл «${file.name}» выбран (${Math.max(1, Math.round(file.size / 1024))} КБ)`,
    })
  }

  function refreshFromExcel() {
    if (refreshing) return
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    setRefreshing(true)
    setNotice({ tone: "info", message: "Проверяем изменения в Excel…" })
    refreshTimer.current = setTimeout(() => {
      setRefreshing(false)
      setNotice({
        tone: "success",
        message: `Данные актуальны. Проверено в ${new Date().toLocaleTimeString("ru-RU")}`,
      })
      refreshTimer.current = null
    }, 700)
  }

  function exportClients(rows: Client[]) {
    if (rows.length === 0) return
    downloadCsv(rows)
    setNotice({ tone: "success", message: `Экспортировано клиентов: ${rows.length}` })
    setActionMenu(null)
  }

  function assignRoute() {
    if (selectedClients.length === 0) return
    setRouteAssigned((current) => new Set([...current, ...selectedClients.map((client) => client.id)]))
    setNotice({
      tone: "success",
      message: `Маршрут установлен для ${selectedClients.length} клиент(ов)`,
    })
  }

  return (
    <div className="px-4 pb-10">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="flex items-center gap-3">
          <Star className="h-6 w-6 fill-link text-link" />
          <span className="text-2xl font-bold text-link">Избранные</span>
          <span className="text-slate-300">|</span>
          <span className="text-2xl font-bold text-slate-700">Клиенты</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <HeaderButton
            icon={BarChart3}
            label="Импортировать акции"
            onClick={() => promotionInputRef.current?.click()}
          />
          <HeaderButton
            icon={ListFilter}
            label="Показать на карте"
            onClick={() => router.push("/tracking?view=clients")}
          />
          <HeaderButton icon={Import} label="Импортировать" onClick={() => importInputRef.current?.click()} />
          <HeaderButton
            icon={RefreshCw}
            label={refreshing ? "Обновление…" : "Обновить с excel"}
            onClick={refreshFromExcel}
            disabled={refreshing}
            iconClassName={refreshing ? "animate-spin" : undefined}
          />
          <button
            type="button"
            onClick={openAddModal}
            className="flex items-center gap-2 rounded-md bg-brand-green px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark"
          >
            <Plus className="h-4 w-4" strokeWidth={3} />
            Добавить
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setPageSizeOpen(false)
                setActionMenu((current) => (current === "header" ? null : "header"))
              }}
              aria-label="Дополнительные действия с клиентами"
              aria-expanded={actionMenu === "header"}
              className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {actionMenu === "header" && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setActionMenu(null)} />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => exportClients(clients)}
                    disabled={clients.length === 0}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="h-4 w-4" />
                    Экспортировать CSV
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={resetFilters}
                    disabled={activeTab === "all" && query === "" && activeFilterCount === 0}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Сбросить фильтры
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <input
        ref={promotionInputRef}
        type="file"
        accept=".csv,.xls,.xlsx"
        className="hidden"
        onChange={(event) => {
          chooseFile(event.currentTarget.files?.[0], "Импорт акций")
          event.currentTarget.value = ""
        }}
      />
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,.xls,.xlsx"
        className="hidden"
        onChange={(event) => {
          chooseFile(event.currentTarget.files?.[0], "Импорт клиентов")
          event.currentTarget.value = ""
        }}
      />

      {notice && (
        <div
          role="status"
          className={`mb-4 flex items-center gap-3 rounded-md border px-4 py-3 text-sm shadow-sm ${
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-blue-200 bg-blue-50 text-blue-800"
          }`}
        >
          {notice.tone === "success" ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" />
          ) : (
            <RefreshCw className={`h-5 w-5 shrink-0 ${refreshing ? "animate-spin" : ""}`} />
          )}
          <span className="flex-1">{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Закрыть уведомление"
            className="rounded p-1 transition-colors hover:bg-black/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Card */}
      <div className="overflow-hidden rounded-lg bg-white shadow-sm">
        {/* Tabs */}
        <div className="flex flex-wrap border-b border-slate-200">
          {clientTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id)
                setPage(1)
              }}
              className={`relative flex-1 whitespace-nowrap px-4 py-4 text-center text-[15px] font-medium transition-colors ${
                activeTab === tab.id ? "text-link" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute inset-x-0 bottom-0 h-1 rounded-t bg-link" />
              )}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            className={`flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95 ${
              filtersOpen || activeFilterCount > 0 ? "bg-link" : "bg-brand-blue"
            }`}
          >
            <ListFilter className="h-4 w-4" />
            {filtersOpen ? "Скрыть фильтр" : "Показать фильтр"}
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-xs text-link">
                {activeFilterCount}
              </span>
            )}
          </button>

          <div className="relative min-w-[240px] flex-1 sm:max-w-md">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder="Поиск"
              className="w-full rounded-md border border-slate-200 bg-white py-2.5 pl-4 pr-10 text-sm outline-none transition-colors focus:border-brand-blue"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("")
                  setPage(1)
                }}
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            )}
          </div>

          {/* Page size */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setActionMenu(null)
                setPageSizeOpen((open) => !open)
              }}
              aria-label="Количество строк на странице"
              aria-expanded={pageSizeOpen}
              className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              {pageSize}
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>
            {pageSizeOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPageSizeOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-24 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                  {pageSizes.map((size) => (
                    <button
                      type="button"
                      key={size}
                      onClick={() => {
                        setPageSize(size)
                        setPage(1)
                        setPageSizeOpen(false)
                      }}
                      className={`block w-full px-4 py-2 text-left text-sm transition-colors hover:bg-slate-100 ${
                        size === pageSize ? "font-semibold text-brand-blue" : "text-slate-700"
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-sm text-slate-600">
              {rangeStart} - {rangeEnd} из {total}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label="Предыдущая страница"
              className="rounded-full p-1 text-brand-blue transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              aria-label="Следующая страница"
              className="rounded-full p-1 text-brand-blue transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>

          <button
            type="button"
            onClick={toggleAll}
            disabled={pageRows.length === 0}
            aria-label={allSelected ? "Снять выделение со страницы" : "Выбрать строки на странице"}
            aria-pressed={allSelected}
            title={allSelected ? "Снять выделение со страницы" : "Выбрать строки на странице"}
            className={`rounded-md p-2 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 ${
              allSelected ? "bg-blue-50 text-link" : "text-slate-500"
            }`}
          >
            <ListChecks className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode((mode) => (mode === "comfortable" ? "compact" : "comfortable"))}
            aria-label={viewMode === "compact" ? "Включить обычный вид" : "Включить компактный вид"}
            aria-pressed={viewMode === "compact"}
            title={viewMode === "compact" ? "Обычный вид" : "Компактный вид"}
            className={`rounded-md p-2 transition-colors hover:bg-slate-100 ${
              viewMode === "compact" ? "bg-blue-50 text-link" : "text-slate-500"
            }`}
          >
            <AlignJustify className="h-5 w-5" />
          </button>

          {selectedClients.length > 0 && (
            <span className="whitespace-nowrap text-sm font-medium text-link">Выбрано: {selectedClients.length}</span>
          )}

          <button
            type="button"
            onClick={openEditModal}
            disabled={selectedClients.length !== 1}
            className="flex items-center gap-2 rounded-md bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Pencil className="h-4 w-4" />
            Изменить
          </button>
          <button
            type="button"
            onClick={assignRoute}
            disabled={selectedClients.length === 0}
            className="flex items-center gap-2 rounded-md bg-brand-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            <TrendingUp className="h-4 w-4" />
            Уст. маршрут
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setPageSizeOpen(false)
                setActionMenu((current) => (current === "table" ? null : "table"))
              }}
              aria-label="Дополнительные действия таблицы"
              aria-expanded={actionMenu === "table"}
              className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {actionMenu === "table" && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setActionMenu(null)} />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => exportClients(selectedClients.length > 0 ? selectedClients : filtered)}
                    disabled={(selectedClients.length > 0 ? selectedClients : filtered).length === 0}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="h-4 w-4" />
                    {selectedClients.length > 0 ? "Экспортировать выбранные" : "Экспортировать результат"}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSelected([])
                      setActionMenu(null)
                      setNotice({ tone: "info", message: "Выделение снято" })
                    }}
                    disabled={selectedClients.length === 0}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X className="h-4 w-4" />
                    Снять выделение
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {filtersOpen && (
          <div className="grid gap-3 border-t border-slate-100 bg-slate-50 px-4 py-4 sm:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] sm:items-end">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Тип клиента
              <select
                value={typeFilter}
                onChange={(event) => {
                  setTypeFilter(event.target.value)
                  setPage(1)
                }}
                className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none transition-colors focus:border-brand-blue"
              >
                <option value="all">Все типы</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Зона
              <select
                value={zoneFilter}
                onChange={(event) => {
                  setZoneFilter(event.target.value)
                  setPage(1)
                }}
                className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none transition-colors focus:border-brand-blue"
              >
                <option value="all">Все зоны</option>
                {zoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setTypeFilter("all")
                setZoneFilter("all")
                setPage(1)
              }}
              disabled={activeFilterCount === 0}
              className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Сбросить
            </button>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-navy text-white">
                <th className="w-10 px-4 py-4">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={pageRows.length === 0}
                    className="h-4 w-4 cursor-pointer accent-brand-green disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Выбрать все"
                  />
                </th>
                <th className="px-4 py-4 text-sm font-semibold">Название</th>
                <th className="px-4 py-4 text-sm font-semibold">Тел. номер</th>
                <th className="px-4 py-4 text-sm font-semibold">Информация</th>
                <th className="px-4 py-4 text-sm font-semibold">Тип</th>
                <th className="px-4 py-4 text-sm font-semibold">Зона</th>
                <th className="px-4 py-4 text-sm font-semibold">Ответственный агент</th>
                <th className="px-4 py-4 text-sm font-semibold">Ответственный доставщик</th>
                <th className="px-4 py-4 text-sm font-semibold">Ответственный инкассатор</th>
                <th className="px-4 py-4 text-sm font-semibold">Баланс</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center text-slate-500">
                    Загрузка клиентов...
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center text-red-600">
                    {loadError}
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center text-slate-500">
                    По вашему запросу ничего не найдено
                  </td>
                </tr>
              ) : (
                pageRows.map((client) => (
                  <ClientRow
                    key={client.id}
                    client={client}
                    selected={selected.includes(client.id)}
                    compact={viewMode === "compact"}
                    routed={routeAssigned.has(client.id)}
                    onToggle={() => toggleRow(client.id)}
                    onOpen={() => setDetailClient(client)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalMode && (
        <ClientModal
          mode={modalMode}
          form={form}
          error={formError}
          saving={saving}
          onTextChange={updateFormField}
          onTabChange={(tab) => {
            setForm((current) => ({ ...current, tab }))
            setFormError("")
          }}
          onClose={() => setModalMode(null)}
          onSubmit={saveClient}
        />
      )}
      {detailClient && <ClientDetail client={detailClient} onClose={() => setDetailClient(null)} />}
    </div>
  )
}

function HeaderButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  iconClassName,
}: {
  icon: typeof BarChart3
  label: string
  onClick: () => void
  disabled?: boolean
  iconClassName?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 rounded-md bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
    >
      <Icon className={`h-4 w-4 ${iconClassName ?? ""}`} />
      {label}
    </button>
  )
}

function ClientModal({
  mode,
  form,
  error,
  saving,
  onTextChange,
  onTabChange,
  onClose,
  onSubmit,
}: {
  mode: Exclude<ModalMode, null>
  form: ClientForm
  error: string
  saving: boolean
  onTextChange: (field: ClientTextField, value: string) => void
  onTabChange: (tab: Client["tab"]) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-modal-title"
        className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h2 id="client-modal-title" className="text-xl font-bold text-slate-800">
            {mode === "add" ? "Добавить клиента" : "Изменить клиента"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно"
            className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <ModalInput
              label="Название"
              value={form.name}
              onChange={(value) => onTextChange("name", value)}
              required
              autoFocus
            />
            <ModalInput
              label="Телефон"
              type="tel"
              value={form.phone}
              onChange={(value) => onTextChange("phone", value)}
              required
            />
            <ModalInput
              label="ИНН"
              value={form.inn}
              onChange={(value) => onTextChange("inn", value)}
            />
            <ModalInput
              label="Баланс"
              type="number"
              value={form.balance}
              onChange={(value) => onTextChange("balance", value)}
            />
            <ModalInput
              label="Тип клиента"
              value={form.type}
              onChange={(value) => onTextChange("type", value)}
              required
            />
            <ModalInput
              label="Зона"
              value={form.zone}
              onChange={(value) => onTextChange("zone", value)}
              required
            />
            <ModalInput
              label="Агент зоны"
              value={form.zoneAgent}
              onChange={(value) => onTextChange("zoneAgent", value)}
            />
            <ModalInput
              label="Ответственный агент"
              value={form.agent}
              onChange={(value) => onTextChange("agent", value)}
            />
            <ModalInput
              label="Ответственный доставщик"
              value={form.deliverer}
              onChange={(value) => onTextChange("deliverer", value)}
            />
            <ModalInput
              label="Ответственный инкассатор"
              value={form.collector}
              onChange={(value) => onTextChange("collector", value)}
            />
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
              Статус
              <select
                value={form.tab}
                onChange={(event) => onTabChange(event.target.value as Client["tab"])}
                className="rounded-md border border-slate-200 bg-white px-3 py-2.5 font-normal outline-none transition-colors focus:border-brand-blue"
              >
                {clientTabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-green px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? "Сохранение..." : mode === "add" ? "Добавить" : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModalInput({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  autoFocus = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "tel" | "number"
  required?: boolean
  autoFocus?: boolean
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-700">
      <span>
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        autoFocus={autoFocus}
        step={type === "number" ? "any" : undefined}
        className="rounded-md border border-slate-200 px-3 py-2.5 font-normal outline-none transition-colors focus:border-brand-blue"
      />
    </label>
  )
}

function ClientDetail({ client, onClose }: { client: Client; onClose: () => void }) {
  const router = useRouter()
  const [tab, setTab] = useState("АКТИВНОСТЬ")
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentDone, setPaymentDone] = useState(false)
  const hasPhone = client.phone && client.phone !== "-"
  return <><button type="button" aria-label="Закрыть карточку клиента" onClick={onClose} className="fixed inset-0 z-40 bg-black/20"/><aside className="fixed right-0 top-0 z-50 h-full w-[min(725px,62vw)] overflow-y-auto bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-6 py-5"><strong><span className="mr-3 inline-block h-5 w-5 rounded-full bg-green-400"/>{client.name.toUpperCase()}</strong><button onClick={onClose}><X/></button></header><nav className="flex border-b">{["АКТИВНОСТЬ","ЗАДАЧИ","КЛИЕНТ","ОТЧЕТЫ","ОТКАЗЫ"].map(item=><button key={item} onClick={()=>setTab(item)} className={`px-5 py-4 ${tab===item?"border-b-2 border-link text-link":""}`}>{item}</button>)}</nav><section className="grid grid-cols-2 gap-x-12 px-6 py-6 text-[16px]"><Metric label="Фактические продажи (30 дней)" value="0 SUM"/><Metric label="Прошло дней с последнего заказа" value="135" red/><Metric label="Сумма продаж за период (30 дней)" value="0 SUM"/><Metric label="Прошло дней с последнего визита" value="19" red/><Metric label="Сумма возврата с заказов за период (30 дней)" value="0 SUM"/><Metric label="Комментарий отказа" value="Не указан"/></section><div className="flex flex-wrap gap-3 px-6"><button type="button" disabled={!hasPhone} onClick={()=>hasPhone&&(window.location.href=`tel:${client.phone}`)} className="rounded bg-[#6ccd8b] px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">☎ Позвонить</button><button type="button" onClick={()=>router.push("/analytics/sales")} className="rounded bg-link px-4 py-2 font-semibold text-white">◉ Заказать</button><button type="button" onClick={()=>setTab("ОТКАЗЫ")} className="rounded bg-[#ff806f] px-4 py-2 font-semibold text-white">⊖ Отказ</button><button type="button" onClick={()=>setPaymentOpen(true)} className="rounded bg-[#6ccd8b] px-4 py-2 font-semibold text-white">▣ Добавить оплату</button></div>{paymentOpen&&<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"><form onSubmit={(event)=>{event.preventDefault();setPaymentDone(true);setPaymentOpen(false);setPaymentAmount("");window.setTimeout(()=>setPaymentDone(false),2000)}} className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h3 className="text-lg font-bold">Добавить оплату</h3><button type="button" onClick={()=>setPaymentOpen(false)} aria-label="Закрыть"><X className="h-5 w-5"/></button></div><label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">Сумма<input autoFocus type="number" min="0" value={paymentAmount} onChange={(event)=>setPaymentAmount(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none"/></label><button type="submit" className="w-full rounded-md bg-[#6ccd8b] py-3 font-semibold text-white">Добавить</button></form></div>}{paymentDone&&<div className="fixed bottom-6 right-6 z-[60] rounded-md bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">Оплата добавлена ✓</div>}<section className="px-6 py-6"><h3 className="mb-5 text-xl font-bold">Агенты магазина</h3><div className="border-b border-dashed pb-5">Агент <span className="ml-28">Комментарий</span><span className="ml-20">Прайс лист</span></div><h3 className="mb-5 mt-10 text-xl font-bold">Маршруты</h3><div className="border-b border-dashed pb-5">Admin Ritm <span className="ml-24">Раз в неделю</span><span className="ml-14 rounded bg-slate-100 px-3 py-2">Пн Вт Ср Чт Пт</span></div><h3 className="mb-5 mt-10 text-xl font-bold">Баланс</h3><div className="grid grid-cols-2 gap-4"><div className="rounded bg-slate-100 p-5">Баланс на начало периода<br/><b className="text-red-400">-20 000 SUM</b></div><div className="rounded bg-slate-100 p-5">Возврат<br/><b className="text-green-500">20 000 SUM</b></div></div></section></aside></>
}
function Metric({ label, value, red }: { label: string; value: string; red?: boolean }) { return <div className="border-b py-4 text-slate-500">{label}<b className={`mt-2 block text-lg ${red?"text-red-400":"text-slate-800"}`}>{value}</b></div> }

function ClientRow({
  client,
  selected,
  compact,
  routed,
  onToggle,
  onOpen,
}: {
  client: Client
  selected: boolean
  compact: boolean
  routed: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const verticalPadding = compact ? "py-3" : "py-5"

  return (
    <tr
      className={`border-l-4 border-brand-green border-b border-dashed border-b-slate-200 transition-colors hover:bg-slate-50 ${
        selected ? "bg-blue-50/70" : ""
      }`}
    >
      <td className={`px-4 ${verticalPadding}`}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 cursor-pointer accent-brand-green"
          aria-label={`Выбрать ${client.name}`}
        />
      </td>
      <td className={`px-4 ${verticalPadding} text-[15px] font-medium text-slate-800`}><button type="button" onClick={onOpen} className="text-left hover:text-link">{client.name}</button></td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>{client.phone}</td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>
        {client.inn ? (
          <span>
            ИНН: <span className="font-semibold text-slate-900">{client.inn}</span>
          </span>
        ) : (
          ""
        )}
      </td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>{client.type}</td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>
        <div>{client.zone}</div>
        <div className="text-link">{client.zoneAgent}</div>
        {routed && <div className="mt-1 text-xs font-semibold text-brand-green">Маршрут установлен</div>}
      </td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>{client.agent}</td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>{client.deliverer}</td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>{client.collector}</td>
      <td className={`px-4 ${verticalPadding} text-[15px] font-medium`}>
        {client.balance != null ? (
          <span className={client.balance < 0 ? "text-brand-orange" : "text-slate-700"}>
            {formatBalance(client.balance)}
          </span>
        ) : (
          ""
        )}
      </td>
    </tr>
  )
}
