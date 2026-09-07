"use client"

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import {
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
  PlusCircle,
  Minus,
  Info,
  MapPin,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"

import { clientTabs, type Client } from "./clients-data"

const LocationPicker = dynamic(() => import("./location-picker").then((m) => m.LocationPicker), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[460px] w-full max-w-2xl items-center justify-center rounded bg-white text-sm text-slate-400">
        Загрузка карты...
      </div>
    </div>
  ),
})

const pageSizes = [10, 25, 50, 100]

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "название": "name", "наименование": "name", "имя": "name", "клиент": "name", "name": "name",
  "телефон": "phone", "тел": "phone", "phone": "phone",
  "инн": "inn", "inn": "inn",
  "тип": "type", "type": "type",
  "зона": "zone", "zone": "zone",
  "агент зоны": "zoneAgent", "zone agent": "zoneAgent",
  "агент": "agent", "agent": "agent",
  "доставщик": "deliverer", "deliverer": "deliverer",
  "инкассатор": "collector", "collector": "collector",
  "баланс": "balance", "balance": "balance",
}

type Notice = {
  tone: "info" | "success"
  message: string
}

type ActionMenu = "header" | "table" | null
type ModalMode = "add" | "edit" | null
type ViewMode = "comfortable" | "compact"

type ClientForm = {
  name: string
  phones: string[]
  inn: string
  type: string
  zone: string
  zoneAgent: string
  agent: string
  deliverer: string
  collector: string
  balance: string
  tab: Client["tab"]
  branch: string
  salesChannel: string
  realizationBy: string
  address: string
  landmark: string
  locationLat: number | null
  locationLng: number | null
  telegramLocationLink: string
  code: string
  contactPerson: string
  note: string
  autoDelivery: boolean
  unlimitedDebt: boolean
}

type ClientTextField = Exclude<
  keyof ClientForm,
  "tab" | "phones" | "locationLat" | "locationLng" | "autoDelivery" | "unlimitedDebt"
>

const emptyClientForm: ClientForm = {
  name: "",
  phones: [""],
  inn: "",
  type: "",
  zone: "",
  zoneAgent: "Не указано",
  agent: "Не указано",
  deliverer: "Не указано",
  collector: "Не указано",
  balance: "",
  tab: "all",
  branch: "",
  salesChannel: "",
  realizationBy: "",
  address: "",
  landmark: "",
  locationLat: null,
  locationLng: null,
  telegramLocationLink: "",
  code: "",
  contactPerson: "",
  note: "",
  autoDelivery: false,
  unlimitedDebt: false,
}

function formatBalance(value: number) {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} SUM`
}

function formFromClient(client: Client): ClientForm {
  const phones = client.phone
    ? client.phone.split(",").map((phone) => phone.trim()).filter(Boolean)
    : []
  return {
    name: client.name,
    phones: phones.length ? phones : [""],
    inn: client.inn ?? "",
    type: client.type,
    zone: client.zone,
    zoneAgent: client.zoneAgent,
    agent: client.agent,
    deliverer: client.deliverer,
    collector: client.collector,
    balance: client.balance == null ? "" : String(client.balance),
    tab: client.tab,
    branch: client.branch ?? "",
    salesChannel: client.salesChannel ?? "",
    realizationBy: client.realizationBy ?? "",
    address: client.address ?? "",
    landmark: client.landmark ?? "",
    locationLat: client.locationLat ?? null,
    locationLng: client.locationLng ?? null,
    telegramLocationLink: client.telegramLocationLink ?? "",
    code: client.code ?? "",
    contactPerson: client.contactPerson ?? "",
    note: client.note ?? "",
    autoDelivery: client.autoDelivery ?? false,
    unlimitedDebt: client.unlimitedDebt ?? false,
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
  const { t } = useLanguage()
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
  const [modalMode, setModalMode] = useState<ModalMode>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ClientForm>(emptyClientForm)
  const [formError, setFormError] = useState("")
  const [routeAssigned, setRouteAssigned] = useState<Set<number>>(() => new Set())
  const [detailClient, setDetailClient] = useState<Client | null>(null)
  const promotionInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importingClients, setImportingClients] = useState(false)

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
        if (!cancelled) setLoadError(t("Не удалось загрузить клиентов с сервера"))
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
    setNotice({ tone: "info", message: t("Фильтры и поиск сброшены") })
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

  function updatePhone(index: number, value: string) {
    setForm((current) => ({ ...current, phones: current.phones.map((entry, i) => (i === index ? value : entry)) }))
    setFormError("")
  }

  function addPhone() {
    setForm((current) => ({ ...current, phones: [...current.phones, ""] }))
  }

  function removePhone(index: number) {
    setForm((current) => ({ ...current, phones: current.phones.filter((_, i) => i !== index) }))
  }

  function updateFormToggle(field: "autoDelivery" | "unlimitedDebt", value: boolean) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function setFormLocation(lat: number | null, lng: number | null) {
    setForm((current) => ({ ...current, locationLat: lat, locationLng: lng }))
  }

  const [saving, setSaving] = useState(false)

  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = form.name.trim()
    const phone = form.phones.map((entry) => entry.trim()).filter(Boolean).join(", ")
    const type = form.type.trim()
    const zone = form.zone.trim()
    const address = form.address.trim()
    const landmark = form.landmark.trim()
    if (!name || !phone || !type || !zone) {
      setFormError(t("Заполните название, телефон, тип и зону"))
      return
    }
    if (modalMode === "add" && (!address || !landmark)) {
      setFormError(t("Заполните адрес и ориентир"))
      return
    }

    const parsedBalance = form.balance.trim() === "" ? undefined : Number(form.balance.replace(/\s/g, ""))
    if (parsedBalance !== undefined && !Number.isFinite(parsedBalance)) {
      setFormError(t("Баланс должен быть числом"))
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
      branch: form.branch.trim() || undefined,
      salesChannel: form.salesChannel.trim() || undefined,
      realizationBy: form.realizationBy.trim() || undefined,
      address,
      landmark,
      locationLat: form.locationLat ?? undefined,
      locationLng: form.locationLng ?? undefined,
      telegramLocationLink: form.telegramLocationLink.trim() || undefined,
      code: form.code.trim() || undefined,
      contactPerson: form.contactPerson.trim() || undefined,
      note: form.note.trim() || undefined,
      autoDelivery: form.autoDelivery,
      unlimitedDebt: form.unlimitedDebt,
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
        setNotice({ tone: "success", message: `${t("Клиент")} «${name}» ${t("добавлен")}` })
      } else if (editingId !== null) {
        const response = await fetch(`/api/clients/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        })
        if (!response.ok) throw new Error("update failed")
        const updated = (await response.json()) as Client
        setClients((current) => current.map((client) => (client.id === editingId ? updated : client)))
        setNotice({ tone: "success", message: `${t("Клиент")} «${name}» ${t("обновлён")}` })
      }
      setModalMode(null)
    } catch {
      setFormError(t("Не удалось сохранить клиента, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  function chooseFile(file: File | undefined, subject: string) {
    if (!file) return
    setNotice({
      tone: "info",
      message: `${t(subject)} ${t("пока не поддерживается для файла")} «${file.name}»`,
    })
  }

  async function importClientsFromExcel(file: File | undefined) {
    if (!file || importingClients) return
    setImportingClients(true)
    setNotice({ tone: "info", message: t("Импортируем клиентов…") })
    try {
      const rows = await readExcelRows(file)
      if (!rows.length) {
        setNotice({ tone: "info", message: t("Не удалось найти клиентов для импорта в выбранном файле") })
        return
      }

      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: Record<string, string>[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.phone = row[1] ?? ""
          record.type = row[2] ?? ""
          record.zone = row[3] ?? ""
        }
        if (!record.name || /^(название|наименование|имя|клиент|name)$/i.test(record.name)) continue
        parsed.push(record)
      }

      if (!parsed.length) {
        setNotice({ tone: "info", message: t("Не удалось найти клиентов для импорта в выбранном файле") })
        return
      }

      const created: Client[] = []
      let failed = 0
      for (const record of parsed) {
        try {
          const response = await fetch("/api/clients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: record.name,
              phone: record.phone || "-",
              inn: record.inn || undefined,
              type: record.type || "Не указано",
              zone: record.zone || "Не указано",
              zoneAgent: record.zoneAgent,
              agent: record.agent,
              deliverer: record.deliverer,
              collector: record.collector,
              balance: record.balance ? Number(record.balance.replace(/\s/g, "")) : undefined,
              tab: "all",
            }),
          })
          if (response.ok) created.push((await response.json()) as Client)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setClients((current) => [...created, ...current])
      setNotice({
        tone: failed ? "info" : "success",
        message: failed
          ? `${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`
          : `${t("Импортировано клиентов")}: ${created.length}`,
      })
    } finally {
      setImportingClients(false)
    }
  }

  function refreshFromExcel() {
    if (importingClients) return
    importInputRef.current?.click()
  }

  function exportClients(rows: Client[]) {
    if (rows.length === 0) return
    downloadCsv(rows)
    setNotice({ tone: "success", message: `${t("Экспортировано клиентов")}: ${rows.length}` })
    setActionMenu(null)
  }

  function assignRoute() {
    if (selectedClients.length === 0) return
    setRouteAssigned((current) => new Set([...current, ...selectedClients.map((client) => client.id)]))
    setNotice({
      tone: "success",
      message: `${t("Маршрут установлен для")} ${selectedClients.length} ${t("клиент(ов)")}`,
    })
  }

  return (
    <div className="px-4 pb-10">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-link" />
          <span className="text-slate-300">|</span>
          <span className="text-2xl font-bold text-slate-700">{t("Клиенты")}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <HeaderButton
            icon={BarChart3}
            label={t("Импортировать акции")}
            onClick={() => promotionInputRef.current?.click()}
          />
          <HeaderButton
            icon={ListFilter}
            label={t("Показать на карте")}
            onClick={() => router.push("/tracking?view=clients")}
          />
          <HeaderButton
            icon={Import}
            label={importingClients ? t("Импорт…") : t("Импортировать")}
            onClick={() => importInputRef.current?.click()}
            disabled={importingClients}
          />
          <HeaderButton
            icon={RefreshCw}
            label={importingClients ? t("Импорт…") : t("Обновить с excel")}
            onClick={refreshFromExcel}
            disabled={importingClients}
            iconClassName={importingClients ? "animate-spin" : undefined}
          />
          <button
            type="button"
            onClick={openAddModal}
            className="flex items-center gap-2 rounded-md bg-brand-green px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark"
          >
            <Plus className="h-4 w-4" strokeWidth={3} />
            {t("Добавить")}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setPageSizeOpen(false)
                setActionMenu((current) => (current === "header" ? null : "header"))
              }}
              aria-label={t("Дополнительные действия с клиентами")}
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
                    {t("Экспортировать CSV")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={resetFilters}
                    disabled={activeTab === "all" && query === "" && activeFilterCount === 0}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t("Сбросить фильтры")}
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
          void importClientsFromExcel(event.currentTarget.files?.[0])
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
            <RefreshCw className={`h-5 w-5 shrink-0 ${importingClients ? "animate-spin" : ""}`} />
          )}
          <span className="flex-1">{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label={t("Закрыть уведомление")}
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
              {t(tab.label)}
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
            {filtersOpen ? t("Скрыть фильтр") : t("Показать фильтр")}
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
              placeholder={t("Поиск")}
              className="w-full rounded-md border border-slate-200 bg-white py-2.5 pl-4 pr-10 text-sm outline-none transition-colors focus:border-brand-blue"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("")
                  setPage(1)
                }}
                aria-label={t("Очистить поиск")}
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
              aria-label={t("Количество строк на странице")}
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
              {rangeStart} - {rangeEnd} {t("из")} {total}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label={t("Предыдущая страница")}
              className="rounded-full p-1 text-brand-blue transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              aria-label={t("Следующая страница")}
              className="rounded-full p-1 text-brand-blue transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </div>

          <button
            type="button"
            onClick={toggleAll}
            disabled={pageRows.length === 0}
            aria-label={allSelected ? t("Снять выделение со страницы") : t("Выбрать строки на странице")}
            aria-pressed={allSelected}
            title={allSelected ? t("Снять выделение со страницы") : t("Выбрать строки на странице")}
            className={`rounded-md p-2 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 ${
              allSelected ? "bg-blue-50 text-link" : "text-slate-500"
            }`}
          >
            <ListChecks className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode((mode) => (mode === "comfortable" ? "compact" : "comfortable"))}
            aria-label={viewMode === "compact" ? t("Включить обычный вид") : t("Включить компактный вид")}
            aria-pressed={viewMode === "compact"}
            title={viewMode === "compact" ? t("Обычный вид") : t("Компактный вид")}
            className={`rounded-md p-2 transition-colors hover:bg-slate-100 ${
              viewMode === "compact" ? "bg-blue-50 text-link" : "text-slate-500"
            }`}
          >
            <AlignJustify className="h-5 w-5" />
          </button>

          {selectedClients.length > 0 && (
            <span className="whitespace-nowrap text-sm font-medium text-link">{t("Выбрано")}: {selectedClients.length}</span>
          )}

          <button
            type="button"
            onClick={openEditModal}
            disabled={selectedClients.length !== 1}
            className="flex items-center gap-2 rounded-md bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Pencil className="h-4 w-4" />
            {t("Изменить")}
          </button>
          <button
            type="button"
            onClick={assignRoute}
            disabled={selectedClients.length === 0}
            className="flex items-center gap-2 rounded-md bg-brand-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            <TrendingUp className="h-4 w-4" />
            {t("Уст. маршрут")}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setPageSizeOpen(false)
                setActionMenu((current) => (current === "table" ? null : "table"))
              }}
              aria-label={t("Дополнительные действия таблицы")}
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
                    {selectedClients.length > 0 ? t("Экспортировать выбранные") : t("Экспортировать результат")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSelected([])
                      setActionMenu(null)
                      setNotice({ tone: "info", message: t("Выделение снято") })
                    }}
                    disabled={selectedClients.length === 0}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <X className="h-4 w-4" />
                    {t("Снять выделение")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {filtersOpen && (
          <div className="grid gap-3 border-t border-slate-100 bg-slate-50 px-4 py-4 sm:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] sm:items-end">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              {t("Тип клиента")}
              <select
                value={typeFilter}
                onChange={(event) => {
                  setTypeFilter(event.target.value)
                  setPage(1)
                }}
                className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none transition-colors focus:border-brand-blue"
              >
                <option value="all">{t("Все типы")}</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              {t("Зона")}
              <select
                value={zoneFilter}
                onChange={(event) => {
                  setZoneFilter(event.target.value)
                  setPage(1)
                }}
                className="rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal outline-none transition-colors focus:border-brand-blue"
              >
                <option value="all">{t("Все зоны")}</option>
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
              {t("Сбросить")}
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
                    aria-label={t("Выбрать все")}
                  />
                </th>
                <th className="px-4 py-4 text-sm font-semibold">{t("Название")}</th>
                <th className="px-4 py-4 text-sm font-semibold">{t("Тел. номер")}</th>
                <th className="px-4 py-4 text-sm font-semibold">{t("Информация")}</th>
                <th className="px-4 py-4 text-sm font-semibold">{t("Тип")}</th>
                <th className="px-4 py-4 text-sm font-semibold">{t("Зона")}</th>
                <th className="px-4 py-4 text-sm font-semibold">{t("Ответственный агент")}</th>
                <th className="px-4 py-4 text-sm font-semibold">{t("Ответственный доставщик")}</th>
                <th className="px-4 py-4 text-sm font-semibold">{t("Ответственный инкассатор")}</th>
                <th className="px-4 py-4 text-sm font-semibold">{t("Баланс")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-16 text-center text-slate-500">
                    {t("Загрузка клиентов...")}
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
                    {t("По вашему запросу ничего не найдено")}
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
          zoneOptions={zoneOptions}
          onTextChange={updateFormField}
          onTabChange={(tab) => {
            setForm((current) => ({ ...current, tab }))
            setFormError("")
          }}
          onPhoneChange={updatePhone}
          onPhoneAdd={addPhone}
          onPhoneRemove={removePhone}
          onToggleChange={updateFormToggle}
          onLocationChange={setFormLocation}
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

type OptionItem = { name: string }

function ClientModal({
  mode,
  form,
  error,
  saving,
  zoneOptions,
  onTextChange,
  onTabChange,
  onPhoneChange,
  onPhoneAdd,
  onPhoneRemove,
  onToggleChange,
  onLocationChange,
  onClose,
  onSubmit,
}: {
  mode: Exclude<ModalMode, null>
  form: ClientForm
  error: string
  saving: boolean
  zoneOptions: string[]
  onTextChange: (field: ClientTextField, value: string) => void
  onTabChange: (tab: Client["tab"]) => void
  onPhoneChange: (index: number, value: string) => void
  onPhoneAdd: () => void
  onPhoneRemove: (index: number) => void
  onToggleChange: (field: "autoDelivery" | "unlimitedDebt", value: boolean) => void
  onLocationChange: (lat: number | null, lng: number | null) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const { t } = useLanguage()
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  const [typeOptions, setTypeOptions] = useState<string[]>([])
  const [addTypeOpen, setAddTypeOpen] = useState(false)
  const [newTypeName, setNewTypeName] = useState("")
  const [savingType, setSavingType] = useState(false)
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      const [branchesRes, typesRes] = await Promise.all([
        fetch("/api/branches").catch(() => null),
        fetch("/api/client-types").catch(() => null),
      ])
      if (cancelled) return
      if (branchesRes?.ok) setBranchOptions(((await branchesRes.json()) as OptionItem[]).map((item) => item.name))
      if (typesRes?.ok) setTypeOptions(((await typesRes.json()) as OptionItem[]).map((item) => item.name))
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  // The client's current branch/type might not be in the fetched list (deleted
  // elsewhere, or entered before that directory existed) — keep it selectable
  // so saving the form never silently drops the existing value.
  const branchSelectOptions = form.branch && !branchOptions.includes(form.branch) ? [form.branch, ...branchOptions] : branchOptions
  const typeSelectOptions = form.type && !typeOptions.includes(form.type) ? [form.type, ...typeOptions] : typeOptions

  async function saveNewType(event: FormEvent) {
    event.preventDefault()
    const trimmed = newTypeName.trim()
    if (!trimmed) return
    setSavingType(true)
    try {
      const response = await fetch("/api/client-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      if (response.ok) {
        setTypeOptions((current) => (current.includes(trimmed) ? current : [...current, trimmed]))
        onTextChange("type", trimmed)
        setNewTypeName("")
        setAddTypeOpen(false)
      }
    } finally {
      setSavingType(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-modal-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b p-6">
          <b id="client-modal-title" className="uppercase">
            {mode === "add" ? t("Добавление клиента") : t("Изменить клиента")}
          </b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
            {/* Left column */}
            <div className="space-y-6">
              <section className="space-y-4">
                <SectionTitle>{t("Общая информация")}</SectionTitle>
                <FieldInput label={t("Наименование")} required autoFocus value={form.name} onChange={(value) => onTextChange("name", value)} />

                <div className="flex items-end gap-2">
                  <FieldSelect
                    label={t("Тип клиента")}
                    required
                    value={form.type}
                    onChange={(value) => onTextChange("type", value)}
                    options={typeSelectOptions}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    title={t("Добавить тип клиента")}
                    onClick={() => setAddTypeOpen(true)}
                    className="mb-2 shrink-0 text-[#5fb583] hover:text-[#4a9d6d]"
                  >
                    <PlusCircle className="h-5 w-5" />
                  </button>
                </div>

                <FieldInput
                  label={t("Зона")}
                  required
                  value={form.zone}
                  onChange={(value) => onTextChange("zone", value)}
                  listId="client-zone-options"
                  listOptions={zoneOptions}
                />

                <FieldSelect label={t("Филиал")} value={form.branch} onChange={(value) => onTextChange("branch", value)} options={branchSelectOptions} placeholder={t("Не указано")} />
                <FieldInput label={t("Канал продаж")} value={form.salesChannel} onChange={(value) => onTextChange("salesChannel", value)} />
                <FieldInput label={t("Реализация по")} value={form.realizationBy} onChange={(value) => onTextChange("realizationBy", value)} />
                <FieldInput label={t("ИНН")} value={form.inn} onChange={(value) => onTextChange("inn", value)} />
              </section>

              <section className="space-y-4 border-t border-dashed border-slate-200 pt-6">
                <SectionTitle>{t("Ответственные лица")}</SectionTitle>
                <FieldInput label={t("Агент зоны")} value={form.zoneAgent} onChange={(value) => onTextChange("zoneAgent", value)} />
                <FieldInput label={t("Ответственный агент")} value={form.agent} onChange={(value) => onTextChange("agent", value)} />
                <FieldInput label={t("Ответственный доставщик")} value={form.deliverer} onChange={(value) => onTextChange("deliverer", value)} />
                <FieldInput label={t("Ответственный инкассатор")} value={form.collector} onChange={(value) => onTextChange("collector", value)} />
              </section>

              <section className="space-y-4 border-t border-dashed border-slate-200 pt-6">
                <SectionTitle>{t("Баланс и статус")}</SectionTitle>
                <FieldInput label={t("Баланс")} type="number" value={form.balance} onChange={(value) => onTextChange("balance", value)} />
                <FieldSelect
                  label={t("Статус")}
                  value={form.tab}
                  onChange={(value) => onTabChange(value as Client["tab"])}
                  options={clientTabs.map((tab) => tab.id)}
                  optionLabels={Object.fromEntries(clientTabs.map((tab) => [tab.id, t(tab.label)]))}
                />
              </section>
            </div>

            {/* Right column */}
            <div className="space-y-6">
              <section className="space-y-4">
                <SectionTitle>{t("Адрес и местоположение")}</SectionTitle>
                <FieldInput label={t("Адрес")} required={mode === "add"} value={form.address} onChange={(value) => onTextChange("address", value)} />
                <FieldInput label={t("Ориентир")} required={mode === "add"} value={form.landmark} onChange={(value) => onTextChange("landmark", value)} />

                <div>
                  <button
                    type="button"
                    onClick={() => setLocationPickerOpen(true)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[#4f70e7] hover:underline"
                  >
                    <MapPin className="h-4 w-4" />
                    {t("отметить местоположение на карте")}
                  </button>
                  {form.locationLat != null && form.locationLng != null && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                      {t("Координаты")}: {form.locationLat.toFixed(6)}, {form.locationLng.toFixed(6)}
                      <button
                        type="button"
                        title={t("Убрать точку")}
                        onClick={() => onLocationChange(null, null)}
                        className="text-rose-400 hover:text-rose-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <FieldInput
                  label={t("Ссылка локации из телеграм")}
                  value={form.telegramLocationLink}
                  onChange={(value) => onTextChange("telegramLocationLink", value)}
                  info={t("Ссылка на геолокацию, отправленную клиентом в Telegram")}
                />
              </section>

              <section className="space-y-4 border-t border-dashed border-slate-200 pt-6">
                <SectionTitle>{t("Контактные данные")}</SectionTitle>
                <FieldInput label={t("Код")} value={form.code} onChange={(value) => onTextChange("code", value)} />

                <div className="space-y-2">
                  <span className="font-medium text-slate-700">
                    {t("Номер телефона")} <span className="text-red-500">*</span>
                  </span>
                  {form.phones.map((phone, index) => (
                    <div key={index} className="flex items-center gap-2 border-b border-slate-200 pb-2">
                      <input
                        type="tel"
                        value={phone}
                        required={index === 0}
                        autoFocus={index === 0 && mode === "add"}
                        onChange={(event) => onPhoneChange(index, event.target.value)}
                        className="block w-full outline-none"
                      />
                      {index === form.phones.length - 1 ? (
                        <button type="button" title={t("Добавить номер")} onClick={onPhoneAdd} className="shrink-0 text-[#5fb583] hover:text-[#4a9d6d]">
                          <PlusCircle className="h-5 w-5" />
                        </button>
                      ) : (
                        <button type="button" title={t("Удалить номер")} onClick={() => onPhoneRemove(index)} className="shrink-0 text-rose-400 hover:text-rose-600">
                          <Minus className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <FieldInput label={t("Контактное лицо")} value={form.contactPerson} onChange={(value) => onTextChange("contactPerson", value)} />
                <FieldInput label={t("Заметка")} textarea value={form.note} onChange={(value) => onTextChange("note", value)} />
              </section>

              <section className="space-y-3 border-t border-dashed border-slate-200 pt-6">
                <SectionTitle>{t("Настройки клиента")}</SectionTitle>
                <ToggleRow label={t("Автоматическая доставка")} checked={form.autoDelivery} onChange={(value) => onToggleChange("autoDelivery", value)} />
                <ToggleRow label={t("Неограниченный долг")} checked={form.unlimitedDebt} onChange={(value) => onToggleChange("unlimitedDebt", value)} />
              </section>
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t p-5">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            {t("Отмена")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-[#6ccd8b] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? t("Сохранение...") : mode === "add" ? t("Добавить") : t("Сохранить")}
          </button>
        </footer>
      </form>

      {addTypeOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => event.stopPropagation()}>
          <form onSubmit={saveNewType} className="w-full max-w-sm rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">{t("Добавить тип клиента")}</b>
              <button type="button" onClick={() => setAddTypeOpen(false)} aria-label={t("Закрыть")}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="block border-b border-slate-200 pb-2 text-sm font-medium">
              {t("Наименование")} <span className="text-red-500">*</span>
              <input autoFocus value={newTypeName} onChange={(event) => setNewTypeName(event.target.value)} className="mt-2 block w-full outline-none" />
            </label>
            <div className="mt-5 flex justify-end">
              <button type="submit" disabled={savingType} className="rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {savingType ? t("Сохранение...") : t("Сохранить")}
              </button>
            </div>
          </form>
        </div>
      )}

      {locationPickerOpen && (
        <LocationPicker
          initialLat={form.locationLat ?? undefined}
          initialLng={form.locationLng ?? undefined}
          onCancel={() => setLocationPickerOpen(false)}
          onConfirm={(lat, lng) => {
            onLocationChange(lat, lng)
            setLocationPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-bold text-[#4f70e7]">{children}</h3>
}

function FieldInput({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  autoFocus = false,
  textarea = false,
  info,
  listId,
  listOptions,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "tel" | "number"
  required?: boolean
  autoFocus?: boolean
  textarea?: boolean
  info?: string
  listId?: string
  listOptions?: string[]
}) {
  return (
    <label className="block border-b border-slate-200 pb-2 font-medium text-slate-700">
      <span className="inline-flex items-center gap-1">
        {label}
        {required && <span className="text-red-500">*</span>}
        {info && (
          <span title={info}>
            <Info className="h-3.5 w-3.5 text-slate-400" />
          </span>
        )}
      </span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={2}
          className="mt-2 block w-full resize-none outline-none"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          autoFocus={autoFocus}
          step={type === "number" ? "any" : undefined}
          list={listId}
          className="mt-2 block w-full outline-none"
        />
      )}
      {listId && listOptions && (
        <datalist id={listId}>
          {listOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </label>
  )
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  optionLabels,
  required = false,
  placeholder = "Выберите...",
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  optionLabels?: Record<string, string>
  required?: boolean
  placeholder?: string
  className?: string
}) {
  return (
    <label className={`block border-b border-slate-200 pb-2 font-medium text-slate-700 ${className ?? ""}`}>
      {label}
      {required && <span className="ml-1 text-red-500">*</span>}
      <select
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 block w-full bg-white outline-none"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded bg-slate-50 p-3">
      <span className="font-medium text-slate-800">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-[#4f70e7]" : "bg-slate-300"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </label>
  )
}

function ClientDetail({ client, onClose }: { client: Client; onClose: () => void }) {
  const router = useRouter()
  const { t } = useLanguage()
  const [tab, setTab] = useState("АКТИВНОСТЬ")
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentDone, setPaymentDone] = useState(false)
  const primaryPhone = client.phone.split(",")[0]?.trim() ?? ""
  const hasPhone = primaryPhone !== "" && primaryPhone !== "-"
  return (
    <>
      <button
        type="button"
        aria-label={t("Закрыть карточку клиента")}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/20"
      />
      <aside className="fixed right-0 top-0 z-50 h-full w-[min(725px,62vw)] overflow-y-auto bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-6 py-5">
          <strong>
            <span className="mr-3 inline-block h-5 w-5 rounded-full bg-green-400" />
            {client.name.toUpperCase()}
          </strong>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        <nav className="flex border-b">
          {["АКТИВНОСТЬ", "ЗАДАЧИ", "КЛИЕНТ", "ОТЧЕТЫ", "ОТКАЗЫ"].map((item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`px-5 py-4 ${tab === item ? "border-b-2 border-link text-link" : ""}`}
            >
              {t(item)}
            </button>
          ))}
        </nav>
        <section className="grid grid-cols-2 gap-x-12 px-6 py-6 text-[16px]">
          <Metric label={t("Фактические продажи (30 дней)")} value="0 SUM" />
          <Metric label={t("Прошло дней с последнего заказа")} value="135" red />
          <Metric label={t("Сумма продаж за период (30 дней)")} value="0 SUM" />
          <Metric label={t("Прошло дней с последнего визита")} value="19" red />
          <Metric label={t("Сумма возврата с заказов за период (30 дней)")} value="0 SUM" />
          <Metric label={t("Комментарий отказа")} value={t("Не указан")} />
        </section>
        <div className="flex flex-wrap gap-3 px-6">
          <button
            type="button"
            disabled={!hasPhone}
            onClick={() => hasPhone && (window.location.href = `tel:${primaryPhone}`)}
            className="rounded bg-[#6ccd8b] px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("☎ Позвонить")}
          </button>
          <button
            type="button"
            onClick={() => router.push("/analytics/sales")}
            className="rounded bg-link px-4 py-2 font-semibold text-white"
          >
            {t("◉ Заказать")}
          </button>
          <button
            type="button"
            onClick={() => setTab("ОТКАЗЫ")}
            className="rounded bg-[#ff806f] px-4 py-2 font-semibold text-white"
          >
            {t("⊖ Отказ")}
          </button>
          <button
            type="button"
            onClick={() => setPaymentOpen(true)}
            className="rounded bg-[#6ccd8b] px-4 py-2 font-semibold text-white"
          >
            {t("▣ Добавить оплату")}
          </button>
        </div>
        {paymentOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
            <form
              onSubmit={async (event) => {
                event.preventDefault()
                try {
                  const response = await fetch("/api/client-payments", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      clientId: client.id,
                      clientName: client.name,
                      amount: Number(paymentAmount),
                      comment: "",
                      paymentDate: new Date().toISOString().slice(0, 10),
                    }),
                  })
                  if (response.ok) {
                    setPaymentDone(true)
                    setPaymentOpen(false)
                    setPaymentAmount("")
                    window.setTimeout(() => setPaymentDone(false), 2000)
                  }
                } catch {}
              }}
              className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
            >
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-lg font-bold">{t("Добавить оплату")}</h3>
                <button type="button" onClick={() => setPaymentOpen(false)} aria-label={t("Закрыть")}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <label className="mb-5 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
                {t("Сумма")}
                <input
                  autoFocus
                  type="number"
                  min="0"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none"
                />
              </label>
              <button type="submit" className="w-full rounded-md bg-[#6ccd8b] py-3 font-semibold text-white">
                {t("Добавить")}
              </button>
            </form>
          </div>
        )}
        {paymentDone && (
          <div className="fixed bottom-6 right-6 z-[60] rounded-md bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">
            {t("Оплата добавлена ✓")}
          </div>
        )}
        <section className="px-6 py-6">
          <h3 className="mb-5 text-xl font-bold">{t("Агенты магазина")}</h3>
          <div className="border-b border-dashed pb-5">
            {t("Агент")} <span className="ml-28">{t("Комментарий")}</span>
            <span className="ml-20">{t("Прайс лист")}</span>
          </div>
          <h3 className="mb-5 mt-10 text-xl font-bold">{t("Маршруты")}</h3>
          <div className="border-b border-dashed pb-5">
            Admin Ritm <span className="ml-24">{t("Раз в неделю")}</span>
            <span className="ml-14 rounded bg-slate-100 px-3 py-2">{t("Пн Вт Ср Чт Пт")}</span>
          </div>
          <h3 className="mb-5 mt-10 text-xl font-bold">{t("Баланс")}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded bg-slate-100 p-5">
              {t("Баланс на начало периода")}
              <br />
              <b className="text-red-400">-20 000 SUM</b>
            </div>
            <div className="rounded bg-slate-100 p-5">
              {t("Возврат")}
              <br />
              <b className="text-green-500">20 000 SUM</b>
            </div>
          </div>
        </section>
      </aside>
    </>
  )
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
  const { t } = useLanguage()
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
          aria-label={`${t("Выбрать")} ${client.name}`}
        />
      </td>
      <td className={`px-4 ${verticalPadding} text-[15px] font-medium text-slate-800`}><button type="button" onClick={onOpen} className="text-left hover:text-link">{client.name}</button></td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>{client.phone}</td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>
        {client.inn ? (
          <span>
            {t("ИНН")}: <span className="font-semibold text-slate-900">{client.inn}</span>
          </span>
        ) : (
          ""
        )}
      </td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>{client.type}</td>
      <td className={`px-4 ${verticalPadding} text-[15px] text-slate-700`}>
        <div>{client.zone}</div>
        <div className="text-link">{client.zoneAgent}</div>
        {routed && <div className="mt-1 text-xs font-semibold text-brand-green">{t("Маршрут установлен")}</div>}
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
