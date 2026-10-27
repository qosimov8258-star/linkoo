"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { compareText, RefImportDialog } from "@/components/ref/list-kit"
import dynamic from "next/dynamic"
import {
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  CheckCircle2,
  PlusCircle,
  Minus,
  Info,
  MapPin,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

import { AddOrderDialog } from "@/components/orders/add-order-dialog"

import { clientTabs, type Client } from "./clients-data"
import { invalidateDirectory, useDirectoryNames } from "./use-directory"
import { MultiEditDialog, type MultiEditExtras, type MultiEditPatch } from "./multi-edit-dialog"
import { applyClientFilters, ClientsFilterPanel, emptyClientFilters, type ClientFilters } from "./clients-filter-panel"

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
  attributes: Record<string, string>
}

type ClientTextField = Exclude<
  keyof ClientForm,
  "tab" | "phones" | "locationLat" | "locationLng" | "autoDelivery" | "unlimitedDebt" | "attributes"
>

const emptyClientForm: ClientForm = {
  name: "",
  phones: [""],
  inn: "",
  type: "",
  zone: "",
  zoneAgent: "",
  agent: "",
  deliverer: "",
  collector: "",
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
  attributes: {},
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
    attributes: client.attributes ?? {},
  }
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
  const [filters, setFilters] = useState<ClientFilters>(emptyClientFilters)
  const [importDialog, setImportDialog] = useState<"import" | "promotion" | "excel" | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [multiEditOpen, setMultiEditOpen] = useState(false)
  const [columns, setColumns] = useState<Record<ColumnKey, boolean>>(DEFAULT_COLUMNS)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [problemSub, setProblemSub] = useState<"inn" | "territory" | "route" | "all">("all")
  const [selectMode, setSelectMode] = useState(true)
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
    try {
      const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY)
      if (raw) setColumns({ ...DEFAULT_COLUMNS, ...(JSON.parse(raw) as Record<ColumnKey, boolean>) })
    } catch {}
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

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const matchesTab =
        activeTab === "all"
          ? true
          : activeTab === "problem"
            ? problemSub === "inn"
              ? !/^\d{9}$/.test((c.inn ?? "").trim())
              : problemSub === "territory"
                ? !c.zone || c.zone === "Не указано"
                : problemSub === "route"
                  ? !c.inRoute
                  : Boolean(c.isProblem)
            : c.tab === activeTab
      const matchesFilters = applyClientFilters(c, filters)
      const q = query.trim().toLowerCase()
      const matchesQuery =
        q === "" ||
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) ||
        c.zone.toLowerCase().includes(q) ||
        c.agent.toLowerCase().includes(q)
      return matchesTab && matchesFilters && matchesQuery
    })
  }, [activeTab, problemSub, clients, query, filters])

  const [sort, setSort] = useState<{ head: string; desc: boolean } | null>(null)
  const sortedClients = useMemo(() => {
    if (!sort) return filtered
    const value = (c: (typeof filtered)[number]): string => {
      switch (sort.head) {
        case "Название": return c.name
        case "Код": return c.code ?? ""
        case "Тел. номер": return c.phone
        case "Информация": return c.inn ?? ""
        case "Тип": return c.type
        case "Зона": return c.zone
        case "Ответственный агент": return c.agent
        case "Ответственный доставщик": return c.deliverer
        case "Ответственный инкассатор": return c.collector
        case "Баланс": return String(Object.values(c.currentBalances ?? {})[0] ?? 0)
        default: return ""
      }
    }
    return [...filtered].sort((a, b) => (sort.desc ? -1 : 1) * compareText(value(a), value(b)))
  }, [filtered, sort])
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * pageSize
  const pageRows = sortedClients.slice(start, start + pageSize)
  const rangeStart = total === 0 ? 0 : start + 1
  const rangeEnd = Math.min(start + pageSize, total)

  // Deep link from an order card: /clients?openClient=<name>
  useEffect(() => {
    if (loading || detailClient) return
    const name = new URLSearchParams(window.location.search).get("openClient")
    if (!name) return
    const match = clients.find((client) => client.name === name)
    if (match) setDetailClient(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, clients])

  // Deep link from Отслеживание ("Изменить маршрут"): /clients?select=<id,id,...> pre-selects
  // those clients (once, after the list has loaded) for the bulk actions.
  const deepSelectDone = useRef(false)
  useEffect(() => {
    if (loading || deepSelectDone.current) return
    deepSelectDone.current = true
    const raw = new URLSearchParams(window.location.search).get("select")
    if (!raw) return
    const wanted = new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => /^\d{1,10}$/.test(part))
        .map(Number)
        .filter((id) => id > 0 && id <= 2_147_483_647),
    )
    const ids = clients.filter((client) => wanted.has(client.id)).map((client) => client.id)
    if (!ids.length) return
    setActiveTab("all")
    setSelectMode(true)
    setSelected(ids)
  }, [loading, clients])

  const allSelected = pageRows.length > 0 && pageRows.every((r) => selected.includes(r.id))
  const selectedClients = clients.filter((client) => selected.includes(client.id))

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

  async function applyMultiEdit(patch: MultiEditPatch, extras: MultiEditExtras = {}) {
    setMultiEditOpen(false)
    const errors: string[] = []
    if (extras.locationLock !== undefined && selectedClients.length) {
      // The lock lives in client_location_locks (Отслеживание), up to 500 clients a call.
      const ids = selectedClients.map((client) => client.id)
      for (let index = 0; index < ids.length; index += 500) {
        try {
          const response = await fetch("/api/tracking/location-locks", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clientIds: ids.slice(index, index + 500), locked: extras.locationLock }),
          })
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null
            errors.push(t(body?.error || "Не удалось сохранить"))
            break
          }
        } catch {
          errors.push(t("Сервер недоступен, попробуйте ещё раз"))
          break
        }
      }
      if (Object.keys(patch).length === 0) {
        setNotice({
          tone: errors.length ? "info" : "success",
          message: errors.length ? errors[0] : `${t("Изменено клиентов")}: ${selectedClients.length}`,
        })
        return
      }
    }
    if (Object.keys(patch).length === 0) return
    const results = await Promise.all(
      selectedClients.map(async (client) => {
        try {
          const response = await fetch(`/api/clients/${client.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...client, ...patch }),
          })
          const body = (await response.json().catch(() => null)) as (Client & { error?: string }) | null
          if (!response.ok && body?.error) errors.push(`${client.name}: ${t(body.error)}`)
          return response.ok ? body : null
        } catch {
          return null
        }
      }),
    )
    const updated = results.filter((client): client is Client => client !== null)
    setClients((current) => current.map((client) => updated.find((item) => item.id === client.id) ?? client))
    setNotice({
      tone: updated.length === selectedClients.length ? "success" : "info",
      message: `${t("Изменено клиентов")}: ${updated.length}${errors.length ? `. ${errors.slice(0, 2).join("; ")}` : ""}`,
    })
  }

  function openAddModal() {
    setForm({ ...emptyClientForm })
    setFormError("")
    setEditingId(null)
    setModalMode("add")
  }

  function openEditModal() {
    if (selectedClients.length !== 1) return
    openEditModalFor(selectedClients[0])
  }

  function openEditModalFor(client: Client) {
    setForm(formFromClient(client))
    setFormError("")
    setEditingId(client.id)
    setModalMode("edit")
  }

  async function deleteClient(client: Client) {
    if (!window.confirm(`${t("Удалить клиента")} «${client.name}»?`)) return
    try {
      const response = await fetch(`/api/clients/${client.id}`, { method: "DELETE" })
      if (!response.ok) {
        // 409: documents reference the client — say which.
        const body = (await response.json().catch(() => null)) as { error?: string; usage?: Array<{ label: string; count: number }> } | null
        const usage = body?.usage?.map((entry) => `${t(entry.label)}: ${entry.count}`).join(", ")
        setNotice({ tone: "info", message: body?.error ? `${t(body.error)}${usage ? ` (${usage})` : ""}` : t("Не удалось удалить клиента") })
        return
      }
      setClients((current) => current.filter((item) => item.id !== client.id))
      setSelected((current) => current.filter((id) => id !== client.id))
      setDetailClient(null)
      setNotice({ tone: "success", message: `${t("Клиент")} «${client.name}» ${t("удалён")}` })
    } catch {
      setNotice({ tone: "info", message: t("Не удалось удалить клиента") })
    }
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

    // An emptied opening balance is cleared explicitly (null); undefined would keep it.
    const parsedBalance = form.balance.trim() === "" ? (modalMode === "edit" ? null : undefined) : Number(form.balance.replace(/\s/g, "").replace(",", "."))
    if (typeof parsedBalance === "number" && !Number.isFinite(parsedBalance)) {
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
      attributes: form.attributes,
    }

    setSaving(true)
    try {
      if (modalMode === "add") {
        const response = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        })
        const body = (await response.json().catch(() => null)) as (Client & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error ? t(body.error) : "")
        const created = body
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
        const body = (await response.json().catch(() => null)) as (Client & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error ? t(body.error) : "")
        const updated = body
        setClients((current) => current.map((client) => (client.id === editingId ? updated : client)))
        setNotice({ tone: "success", message: `${t("Клиент")} «${name}» ${t("обновлён")}` })
      }
      setModalMode(null)
    } catch (caught) {
      setFormError(caught instanceof Error && caught.message ? caught.message : t("Не удалось сохранить клиента, попробуйте ещё раз"))
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

  function openImportDialog(kind: "import" | "promotion" | "excel") {
    if (importingClients) return
    setImportFile(null)
    setImportDialog(kind)
  }

  function refreshFromExcel() {
    openImportDialog("excel")
  }

  async function saveImportDialog() {
    const file = importFile
    const kind = importDialog
    if (!file || !kind) return
    setImportDialog(null)
    setImportFile(null)
    if (kind === "promotion") chooseFile(file, "Импорт акций")
    else await importClientsFromExcel(file)
  }

  function downloadImportTemplate() {
    downloadExcelTable("clients-template", [[t("Название"), t("Тел. номер"), t("ИНН"), t("Тип"), t("Зона"), t("Ответственный агент"), t("Ответственный доставщик"), t("Ответственный инкассатор"), t("Баланс")]])
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
    <div className="bg-[#f2f5f8] px-7 pb-7 pt-px font-sans text-[13px] text-[#333]">
      {/* Header row */}
      <div className="flex h-[60px] items-center justify-between">
        <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          {t("Клиенты")}
        </h1>

        <div className="flex items-center gap-[10px] pr-[10px]">
          <TopButton icon={CI.chart} label={t("Импортировать акции")} onClick={() => openImportDialog("promotion")} />
          <TopButton icon={CI.filter} label={t("Показать на карте")} onClick={() => router.push("/clients/territory?openFilterDialog=true")} />
          <TopButton icon={CI.chart} label={importingClients ? t("Импорт…") : t("Импортировать")} onClick={() => openImportDialog("import")} disabled={importingClients} />
          <TopButton icon={CI.sync} label={importingClients ? t("Импорт…") : t("Обновить с excel")} onClick={refreshFromExcel} disabled={importingClients} spin={importingClients} />
          <TopButton icon={CI.add} label={t("Добавить")} onClick={openAddModal} green />
          <div className="relative ml-[10px]">
            <button
              type="button"
              onClick={() => {
                setPageSizeOpen(false)
                setActionMenu((current) => (current === "header" ? null : "header"))
              }}
              aria-label={t("Дополнительные действия с клиентами")}
              aria-expanded={actionMenu === "header"}
              className="flex h-12 w-12 items-center justify-center"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={CI.more} /></svg>
            </button>
            {actionMenu === "header" && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setActionMenu(null)} />
                <div role="menu" className="absolute right-0 top-[1px] z-30 w-[335px] overflow-hidden rounded-[2px] bg-white py-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                  {[t("Обновить класс магазина"), t("Обновить атрибуты магазина"), t("Обновить KPI план магазина")].map((label) => (
                    <button
                      key={label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionMenu(null)
                        setNotice({ tone: "info", message: `${label}: ${t("обновление запущено")}` })
                      }}
                      className="flex h-12 w-full items-center gap-[25px] px-[20px] text-left text-[13px] hover:bg-[#f2f5f8]"
                    >
                      <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[5px] bg-[#71ce87]">
                        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white"><path d={CI.chart} /></svg>
                      </span>
                      {label}
                    </button>
                  ))}
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
          className={`mb-3 flex items-center gap-3 rounded px-4 py-3 text-[13px] ${
            notice.tone === "success" ? "bg-[#e9f8ed] text-[#278549]" : "bg-[#e8efff] text-[#2f4fb8]"
          }`}
        >
          {notice.tone === "success" ? (
            <CheckCircle2 className="h-5 w-5 shrink-0" />
          ) : (
            <RefreshCw className={`h-5 w-5 shrink-0 ${importingClients ? "animate-spin" : ""}`} />
          )}
          <span className="flex-1">{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("Закрыть уведомление")} className="rounded p-1 hover:bg-black/5">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Card */}
      <div className="shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        {/* Tabs */}
        <div className="relative flex h-10 rounded-[2px] bg-white">
          {clientTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id)
                setPage(1)
              }}
              className="h-10 w-1/5 whitespace-nowrap text-center text-[13px] font-medium text-black"
            >
              {t(tab.label)}
            </button>
          ))}
          <span
            className="absolute -bottom-[2px] left-0 z-10 h-[3px] w-1/5 bg-[#4f71dc] shadow-[0_-3px_10px_0_#5869f0] transition-transform duration-300"
            style={{ transform: `translateX(${clientTabs.findIndex((tab) => tab.id === activeTab) * 100}%)` }}
          />
        </div>

        {activeTab === "problem" && (
          <div className="relative flex h-10 border-t border-[#f1f1f1] bg-white">
            {(
              [
                ["inn", "Неправильный ИНН"],
                ["territory", "Нет территории"],
                ["route", "Нет маршрута"],
                ["all", "Все"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setProblemSub(id)
                  setPage(1)
                }}
                className="h-10 w-1/4 whitespace-nowrap text-center text-[13px] font-medium text-black"
              >
                {t(label)}
              </button>
            ))}
            <span
              className="absolute -bottom-[2px] left-0 z-10 h-[3px] w-1/4 bg-[#4f71dc] shadow-[0_-3px_10px_0_#5869f0] transition-transform duration-300"
              style={{ transform: `translateX(${["inn", "territory", "route", "all"].indexOf(problemSub) * 100}%)` }}
            />
          </div>
        )}

        {/* Toolbar */}
        <div className="relative bg-white">
          <div className="flex h-[50px] items-center px-[5px]">
            {selectedClients.length > 0 ? (
              <>
            <span className="font-semibold">{t("Выбрано")}: {selectedClients.length}</span>
            <div className="ml-auto flex items-center text-[#5d6474]">
              <button
                type="button"
                onClick={() => setColumnsOpen(true)}
                aria-label={t("Настройка таблицы")}
                className="flex h-12 w-[54px] items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#5d6474]"><path d={CI.align} /></svg>
              </button>
              <div className="ml-[10px] flex items-center gap-[19px]">
                <TopButton icon={CI.edit} label={t("Изменить")} onClick={() => setMultiEditOpen(true)} />
                <TopButton icon={CI.trend} label={t("Уст. маршрут")} green onClick={assignRoute} />
              </div>
              <div className="relative ml-[19px]">
                <button
                  type="button"
                  onClick={() => {
                    setPageSizeOpen(false)
                    setActionMenu((current) => (current === "table" ? null : "table"))
                  }}
                  aria-label={t("Дополнительные действия таблицы")}
                  className="flex h-12 w-12 items-center justify-center"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={CI.more} /></svg>
                </button>
                {actionMenu === "table" && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setActionMenu(null)} />
                    <div role="menu" className="absolute right-0 top-0 z-30 w-[224px] overflow-hidden rounded-[2px] bg-white py-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setActionMenu(null)
                          setNotice({ tone: "success", message: `${t("Задача добавлена для")} ${selectedClients.length} ${t("клиент(ов)")}` })
                        }}
                        className="flex h-12 w-full items-center gap-[25px] px-[18px] text-left text-[13px] text-[#333] hover:bg-[#f2f5f8]"
                      >
                        <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[5px] bg-[#71ce87]">
                          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d={CI.add} /></svg>
                        </span>
                        {t("Добавить задачу")}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button type="button" onClick={() => setSelected([])} aria-label={t("Снять выделение")} className="flex h-12 w-12 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-2 10H7v-2h10v2z" /></svg>
              </button>
            </div>
              </>
            ) : (
              <>
            <div className="w-[355px] shrink-0">
              <button
                type="button"
                onClick={() => setFiltersOpen((open) => !open)}
                aria-expanded={filtersOpen}
                className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white hover:brightness-95"
              >
                <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white"><path d={CI.filter} /></svg>
                <span className="pl-2 pr-4">{filtersOpen ? t("Скрыть фильтр") : t("Показать фильтр")}</span>
              </button>
            </div>

            <div className="relative ml-[18px] flex w-[300px] items-center border-b border-[#e0e0e0] focus-within:border-[#5d6474]">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
                placeholder={t("Поиск")}
                className="h-12 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-black/30"
              />
              {query ? (
                <button type="button" onClick={() => { setQuery(""); setPage(1) }} aria-label={t("Очистить поиск")} className="p-1 text-[#999]">
                  <X className="h-5 w-5" />
                </button>
              ) : (
                <Search className="h-6 w-6 shrink-0 text-[#ccc]" />
              )}
            </div>

            <div className="ml-auto flex items-center text-[#5d6474]">
              {/* Page size */}
              <div className="relative mr-[27px]">
                <button
                  type="button"
                  onClick={() => {
                    setActionMenu(null)
                    setPageSizeOpen((open) => !open)
                  }}
                  aria-label={t("Количество строк на странице")}
                  aria-expanded={pageSizeOpen}
                  className="flex h-12 w-[40px] items-center justify-between text-[13px] text-[#333]"
                >
                  {pageSize}
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
                </button>
                {pageSizeOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setPageSizeOpen(false)} />
                    <div className="absolute right-0 z-20 w-24 overflow-hidden rounded-[2px] bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                      {pageSizes.map((size) => (
                        <button
                          type="button"
                          key={size}
                          onClick={() => {
                            setPageSize(size)
                            setPage(1)
                            setPageSizeOpen(false)
                          }}
                          className={`block w-full px-4 py-2 text-left text-[13px] hover:bg-[#f2f5f8] ${size === pageSize ? "font-semibold text-[#4f71dc]" : ""}`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Pagination */}
              <span className="mr-2 whitespace-nowrap">
                {rangeStart} - {rangeEnd}  {t("из")}  {total}
              </span>
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1} aria-label={t("Предыдущая страница")} className="px-[5px]">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${currentPage <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
              </button>
              <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} aria-label={t("Следующая страница")}>
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${currentPage >= totalPages ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
              </button>

              <button
                type="button"
                onClick={() => setSelectMode((mode) => !mode)}
                aria-label={t("Выбрать строки на странице")}
                aria-pressed={selectMode}
                title={t("Выбрать строки на странице")}
                className="ml-[17px] flex h-12 w-[54px] items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={selectMode ? CI.eyeOff : CI.eye} /></svg>
              </button>
              <button
                type="button"
                onClick={() => setColumnsOpen(true)}
                aria-label={t("Настройка таблицы")}
                title={t("Настройка таблицы")}
                className="flex h-12 w-[54px] items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#5d6474]"><path d={CI.align} /></svg>
              </button>

              {selectedClients.length > 0 && <span className="mx-2 whitespace-nowrap font-semibold text-[#4f71dc]">{t("Выбрано")}: {selectedClients.length}</span>}

              <div className="ml-[3px] flex items-center gap-[19px]">
                <TopButton
                  icon={CI.edit}
                  label={t("Изменить")}
                  onClick={() => {
                    if (selectedClients.length === 0) {
                      setSelectMode(true)
                      setNotice({ tone: "info", message: t("Выберите клиентов для изменения") })
                      return
                    }
                    setMultiEditOpen(true)
                  }}
                />
                <TopButton
                  icon={CI.trend}
                  label={t("Уст. маршрут")}
                  green
                  onClick={() => {
                    if (selectedClients.length === 0) {
                      setSelectMode(true)
                      setNotice({ tone: "info", message: t("Выберите клиентов для установки маршрута") })
                      return
                    }
                    assignRoute()
                  }}
                />
              </div>

              <div className="relative ml-[19px]">
                <button
                  type="button"
                  onClick={() => {
                    setPageSizeOpen(false)
                    setActionMenu((current) => (current === "table" ? null : "table"))
                  }}
                  aria-label={t("Дополнительные действия таблицы")}
                  aria-expanded={actionMenu === "table"}
                  className="flex h-12 w-12 items-center justify-center"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={CI.more} /></svg>
                </button>
                {actionMenu === "table" && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setActionMenu(null)} />
                    <div role="menu" className="absolute right-0 top-0 z-30 w-[224px] overflow-hidden rounded-[2px] bg-white py-[3px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={selectedClients.length === 0}
                        onClick={() => {
                          setActionMenu(null)
                          setNotice({ tone: "success", message: `${t("Задача добавлена для")} ${selectedClients.length} ${t("клиент(ов)")}` })
                        }}
                        className="flex h-12 w-full items-center gap-[25px] px-[18px] text-left text-[13px] text-[#333] hover:bg-[#f2f5f8] disabled:text-[#aaa] disabled:hover:bg-transparent"
                      >
                        <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[5px] bg-[#71ce87]">
                          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d={CI.add} /></svg>
                        </span>
                        {t("Добавить задачу")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
              </>
            )}
          </div>

          {filtersOpen && (
            <div className="absolute left-0 top-0 z-30 w-full">
              <ClientsFilterPanel
                clients={clients}
                value={filters}
                onClose={() => setFiltersOpen(false)}
                onApply={(next) => {
                  setFilters(next)
                  setPage(1)
                  setFiltersOpen(false)
                }}
              />
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto">
            <div className="min-w-[1100px]">
              <div className="relative grid h-[50px] items-center bg-[#5d6474] pl-[50px] pr-[30px] font-semibold text-white" style={{ gridTemplateColumns: gridTemplate(columns, "head") }}>
                {COLUMN_DEFS.filter((column) => columns[column.key]).map((column) => column.title).map((head, index) => (
                  <div key={head} className={`flex items-center gap-2 px-2 leading-[16px] ${head === "Баланс" ? "justify-center" : ""}`}>
                    {index === 0 && selectMode && (
                      <button
                        type="button"
                        onClick={toggleAll}
                        disabled={pageRows.length === 0}
                        aria-label={t("Выбрать все")}
                        className="absolute left-5 top-3.5 h-6 w-6"
                      >
                        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={allSelected ? CI.checkOn : CI.selectAll} /></svg>
                      </button>
                    )}
                    <button type="button" onClick={() => setSort((current) => (current?.head === head ? (current.desc ? null : { head, desc: true }) : { head, desc: false }))} className="text-left font-semibold hover:opacity-80">
                      {t(head)}
                      {sort?.head === head ? <span className="ml-1 text-[10px]">{sort.desc ? "▼" : "▲"}</span> : null}
                    </button>
                  </div>
                ))}
              </div>
              {loading ? (
                <div className="px-4 py-16 text-center text-[#666]">{t("Загрузка клиентов...")}</div>
              ) : loadError ? (
                <div className="px-4 py-16 text-center text-red-600">{loadError}</div>
              ) : pageRows.length === 0 ? (
                <div className="px-4 py-16 text-center text-[#666]">{t("По вашему запросу ничего не найдено")}</div>
              ) : (
                pageRows.map((client) => (
                  <ClientRow
                    key={client.id}
                    client={client}
                    selected={selected.includes(client.id)}
                    selectMode={selectMode}
                    columns={columns}
                    routed={routeAssigned.has(client.id)}
                    onToggle={() => toggleRow(client.id)}
                    onOpen={() => setDetailClient(client)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {columnsOpen && (
        <ColumnsDrawer
          columns={columns}
          onSave={(next) => {
            setColumns(next)
            try {
              window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next))
            } catch {}
            setColumnsOpen(false)
          }}
          onClose={() => setColumnsOpen(false)}
        />
      )}

      {multiEditOpen && <MultiEditDialog clients={clients} onSave={(patch, extras) => void applyMultiEdit(patch, extras)} onClose={() => setMultiEditOpen(false)} />}

      {importDialog && (
        <RefImportDialog
          file={importFile}
          onFile={setImportFile}
          onTemplate={downloadImportTemplate}
          onSave={() => void saveImportDialog()}
          onClose={() => {
            setImportDialog(null)
            setImportFile(null)
          }}
          saving={importingClients}
        />
      )}

      {modalMode && (
        <ClientModal
          mode={modalMode}
          form={form}
          error={formError}
          saving={saving}
          clients={clients}
          onTextChange={updateFormField}
          onPhoneChange={updatePhone}
          onPhoneAdd={addPhone}
          onPhoneRemove={removePhone}
          onToggleChange={updateFormToggle}
          onAttributeChange={(name, value) => setForm((current) => ({ ...current, attributes: { ...current.attributes, [name]: value } }))}
          onLocationChange={setFormLocation}
          onClose={() => setModalMode(null)}
          onSubmit={saveClient}
        />
      )}
      {detailClient && (
        <ClientDetail
          client={detailClient}
          onClose={() => setDetailClient(null)}
          onEdit={() => openEditModalFor(detailClient)}
          onDelete={() => deleteClient(detailClient)}
        />
      )}
    </div>
  )
}

type ColumnKey = "name" | "code" | "phone" | "info" | "type" | "zone" | "agent" | "deliverer" | "collector" | "balance"

const COLUMN_DEFS: { key: ColumnKey; title: string; head: number; row: number }[] = [
  { key: "name", title: "Название", head: 205, row: 204 },
  { key: "code", title: "Код", head: 100, row: 100 },
  { key: "phone", title: "Тел. номер", head: 205, row: 204 },
  { key: "info", title: "Информация", head: 191, row: 190 },
  { key: "type", title: "Тип", head: 96, row: 95 },
  { key: "zone", title: "Зона", head: 191, row: 190 },
  { key: "agent", title: "Ответственный агент", head: 136, row: 136 },
  { key: "deliverer", title: "Ответственный доставщик", head: 136, row: 136 },
  { key: "collector", title: "Ответственный инкассатор", head: 109, row: 109 },
  { key: "balance", title: "Баланс", head: 95, row: 95 },
]

const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = { name: true, code: false, phone: true, info: true, type: true, zone: true, agent: true, deliverer: true, collector: true, balance: true }
const COLUMNS_STORAGE_KEY = "linko-clients-columns"

function gridTemplate(columns: Record<ColumnKey, boolean>, field: "head" | "row") {
  return COLUMN_DEFS.filter((column) => columns[column.key]).map((column) => `minmax(0,${column[field]}fr)`).join(" ")
}

const CI = {
  chart: "M10 20h4V4h-4v16zm-6 0h4v-8H4v8zM16 9v11h4V9h-4z",
  filter: "M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z",
  sync: "M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z",
  add: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z",
  eyeOff: "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
  checkEmpty: "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  checkOn: "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  selectAll: "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z",
  checklist: "M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z",
  align: "M3 21h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18V7H3v2zm0-6v2h18V3H3z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  trend: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z",
}

function TopButton({
  icon,
  label,
  onClick,
  disabled = false,
  green = false,
  spin = false,
}: {
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
  green?: boolean
  spin?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-[30px] items-center rounded-[5px] pl-3 text-[13px] font-semibold text-white hover:brightness-95 disabled:cursor-wait disabled:opacity-60 ${green ? "bg-[#71ce87]" : "bg-[#4f71dc]"}`}
    >
      <svg viewBox="0 0 24 24" className={`mb-1 h-[18px] w-[18px] fill-white ${spin ? "animate-spin" : ""}`}><path d={icon} /></svg>
      <span className="pl-2 pr-4 whitespace-nowrap">{label}</span>
    </button>
  )
}

type OptionItem = { name: string }

function ClientModal({
  mode,
  form,
  error,
  saving,
  clients: allClients,
  onTextChange,
  onPhoneChange,
  onPhoneAdd,
  onPhoneRemove,
  onToggleChange,
  onAttributeChange,
  onLocationChange,
  onClose,
  onSubmit,
}: {
  mode: Exclude<ModalMode, null>
  form: ClientForm
  error: string
  saving: boolean
  clients: Client[]
  onTextChange: (field: ClientTextField, value: string) => void
  onPhoneChange: (index: number, value: string) => void
  onPhoneAdd: () => void
  onPhoneRemove: (index: number) => void
  onToggleChange: (field: "autoDelivery" | "unlimitedDebt", value: boolean) => void
  onAttributeChange: (name: string, value: string) => void
  onLocationChange: (lat: number | null, lng: number | null) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const { t } = useLanguage()
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  const [typeOptions, setTypeOptions] = useState<string[]>([])
  // Zones come from the zone directory (Территория), so the first client of a new install can get one ("+").
  const [zoneOptions, setZoneOptions] = useState<string[]>([])
  const [attributeDefs, setAttributeDefs] = useState<{ name: string; fieldType: string; options: string[] }[]>([])
  const [quickAdd, setQuickAdd] = useState<"type" | "zone" | null>(null)
  const [quickName, setQuickName] = useState("")
  const [quickError, setQuickError] = useState("")
  const [quickSaving, setQuickSaving] = useState(false)
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)
  const [canSeePrice, setCanSeePrice] = useState(false)
  const [confirmToOrder, setConfirmToOrder] = useState(false)
  const [changeFinance, setChangeFinance] = useState(false)
  const [objectActive, setObjectActive] = useState(false)
  const distinct = (pick: (client: Client) => string | undefined) =>
    [...new Set(allClients.map(pick).filter((value): value is string => Boolean(value) && value !== "Не указано"))].sort((a, b) => a.localeCompare(b, "ru"))
  const channelOptions = distinct((client) => client.salesChannel)
  const realizationOptions = distinct((client) => client.realizationBy)
  // People are employees (the API refuses other names).
  const employeeNames = useDirectoryNames("employees")
  const delivererOptions = employeeNames
  const collectorOptions = employeeNames
  const agentOptions = employeeNames

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      const [branchesRes, typesRes, zonesRes, attributesRes, valuesRes] = await Promise.all([
        fetch("/api/branches").catch(() => null),
        fetch("/api/client-types").catch(() => null),
        fetch("/api/clients/zones").catch(() => null),
        fetch("/api/client-attributes").catch(() => null),
        fetch("/api/client-attribute-values").catch(() => null),
      ])
      if (cancelled) return
      if (branchesRes?.ok) setBranchOptions(((await branchesRes.json()) as OptionItem[]).map((item) => item.name))
      if (typesRes?.ok) setTypeOptions(((await typesRes.json()) as OptionItem[]).map((item) => item.name))
      if (zonesRes?.ok) setZoneOptions(((await zonesRes.json()) as OptionItem[]).map((item) => item.name))
      if (attributesRes?.ok) {
        const attributes = (await attributesRes.json()) as { name: string; fieldType: string }[]
        const values = valuesRes?.ok ? ((await valuesRes.json()) as { attribute: string; values: string[] }[]) : []
        setAttributeDefs(
          attributes.map((attribute) => ({
            name: attribute.name,
            fieldType: attribute.fieldType,
            options: values.filter((item) => item.attribute === attribute.name).flatMap((item) => item.values),
          })),
        )
      }
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
  const zoneSelectOptions = withCurrent(zoneOptions, form.zone)

  function openQuickAdd(kind: "type" | "zone") {
    setQuickName("")
    setQuickError("")
    setQuickAdd(kind)
  }

  // "+" next to Тип клиента / Зона: adds to that directory and picks the new entry.
  async function saveQuickAdd(event: FormEvent) {
    event.preventDefault()
    event.stopPropagation()
    const kind = quickAdd
    const trimmed = quickName.trim()
    if (!kind) return
    if (!trimmed) {
      setQuickError(t(kind === "zone" ? "Укажите название зоны" : "Укажите название типа клиента"))
      return
    }
    setQuickSaving(true)
    setQuickError("")
    try {
      const response = await fetch(kind === "zone" ? "/api/clients/zones" : "/api/client-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      const body = (await response.json().catch(() => null)) as { error?: string; name?: string; zone?: { name: string } } | null
      if (!response.ok) {
        setQuickError(body?.error ? t(body.error) : t("Не удалось сохранить"))
        return
      }
      const saved = (kind === "zone" ? body?.zone?.name : body?.name) ?? trimmed
      if (kind === "zone") {
        setZoneOptions((current) => (current.includes(saved) ? current : [...current, saved].sort((a, b) => a.localeCompare(b, "ru"))))
        invalidateDirectory("zones")
      } else {
        setTypeOptions((current) => (current.includes(saved) ? current : [...current, saved]))
        invalidateDirectory("clientTypes")
      }
      onTextChange(kind, saved)
      setQuickAdd(null)
    } catch {
      setQuickError(t("Не удалось сохранить"))
    } finally {
      setQuickSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/[0.54]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-modal-title"
        className="fixed bottom-0 left-1/2 top-16 flex w-[80%] max-w-full -translate-x-1/2 flex-col bg-white font-sans text-[13px] text-[#333]"
      >
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
          <b id="client-modal-title" className="text-[13px] font-bold uppercase">
            {mode === "add" ? t("Добавление клиента") : t("Изменение клиента")}
          </b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid min-h-full lg:grid-cols-2">
            {/* Left column */}
            <div className="px-[30px] pb-6 pt-[18px]">
              <section>
                <SectionTitle>{t("Общая информация")}</SectionTitle>
                <FieldInput label={t("Наименование")} required value={form.name} onChange={(value) => onTextChange("name", value)} />
                <FieldSelect className="mt-[15px]" label={t("Филиал")} required value={form.branch} onChange={(value) => onTextChange("branch", value)} options={branchSelectOptions} />
                <FieldSelect label={t("Канал продаж")} value={form.salesChannel} onChange={(value) => onTextChange("salesChannel", value)} options={withCurrent(channelOptions, form.salesChannel)} />
                <div className="relative">
                  <FieldSelect label={t("Тип клиента")} required value={form.type} onChange={(value) => onTextChange("type", value)} options={typeSelectOptions} />
                  <button
                    type="button"
                    title={t("Добавить тип клиента")}
                    aria-label={t("Добавить тип клиента")}
                    onClick={() => openQuickAdd("type")}
                    className="absolute -right-[26px] top-[22px] text-[#5fb583] hover:text-[#4a9d6d]"
                  >
                    <PlusCircle className="h-5 w-5" />
                  </button>
                </div>
                <div className="relative">
                  <FieldSelect label={t("Зона")} required value={form.zone} onChange={(value) => onTextChange("zone", value)} options={zoneSelectOptions} />
                  <button
                    type="button"
                    title={t("Добавить зону")}
                    aria-label={t("Добавить зону")}
                    onClick={() => openQuickAdd("zone")}
                    className="absolute -right-[26px] top-[22px] text-[#5fb583] hover:text-[#4a9d6d]"
                  >
                    <PlusCircle className="h-5 w-5" />
                  </button>
                </div>
                <FieldSelect label={t("Реализация по")} value={form.realizationBy} onChange={(value) => onTextChange("realizationBy", value)} options={withCurrent(realizationOptions, form.realizationBy)} />
              </section>

              <section className="mt-[28px] border-t border-dotted border-[#ccc] pt-[19px]">
                <SectionTitle>{t("Ответственные лица")}</SectionTitle>
                <FieldSelect label={t("Ответственный доставщик")} value={form.deliverer} onChange={(value) => onTextChange("deliverer", value)} options={withCurrent(delivererOptions, form.deliverer)} />
                <FieldSelect label={t("Ответственный инкассатор")} value={form.collector} onChange={(value) => onTextChange("collector", value)} options={withCurrent(collectorOptions, form.collector)} />
                <FieldSelect label={t("Ответственный агент")} value={form.agent} onChange={(value) => onTextChange("agent", value)} options={withCurrent(agentOptions, form.agent)} />
              </section>

              <section className="mt-[28px] border-t border-dotted border-[#ccc] pt-[19px]">
                <SectionTitle>{t("Юридическая информация")}</SectionTitle>
                {attributeDefs.map((attribute) =>
                  attribute.fieldType === "Выбор вариантов" ? (
                    <FieldSelect
                      key={attribute.name}
                      label={attribute.name}
                      value={form.attributes[attribute.name] ?? ""}
                      onChange={(value) => onAttributeChange(attribute.name, value)}
                      options={attribute.options}
                    />
                  ) : (
                    <FieldInput
                      key={attribute.name}
                      label={attribute.name}
                      type={attribute.fieldType === "Цифровое поле" ? "number" : "text"}
                      value={form.attributes[attribute.name] ?? ""}
                      onChange={(value) => onAttributeChange(attribute.name, value)}
                    />
                  ),
                )}
              </section>
            </div>

            {/* Right column */}
            <div className="border-[#efefef] px-[30px] pb-6 pt-[18px] lg:border-l">
              <section>
                <SectionTitle>{t("Адрес и местоположение")}</SectionTitle>
                <FieldInput label={t("Адрес")} required={mode === "add"} value={form.address} onChange={(value) => onTextChange("address", value)} />
                <FieldInput label={t("Ориентир")} required={mode === "add"} value={form.landmark} onChange={(value) => onTextChange("landmark", value)} />

                <div className="pb-1 pt-4">
                  <button type="button" onClick={() => setLocationPickerOpen(true)} className="inline-flex items-center gap-2 text-[13px] text-[#129fdd] hover:underline">
                    <MapPin className="h-4 w-4" />
                    {form.locationLat != null && form.locationLng != null ? `${form.locationLat.toFixed(6)} ${form.locationLng.toFixed(6)}` : t("отметить местоположение на карте")}
                  </button>
                  {form.locationLat != null && form.locationLng != null && (
                    <>
                      <button type="button" onClick={() => setLocationPickerOpen(true)} className="ml-6 text-[13px] text-[#129fdd] hover:underline">
                        {t("Изменить")}
                      </button>
                      <button type="button" title={t("Убрать точку")} onClick={() => onLocationChange(null, null)} className="ml-3 text-[#e57373]">
                        <X className="inline h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>

                <FieldInput
                  label={t("Ссылка локации из телеграм")}
                  value={form.telegramLocationLink}
                  onChange={(value) => onTextChange("telegramLocationLink", value)}
                  info={t("Ссылка на геолокацию, отправленную клиентом в Telegram")}
                />
              </section>

              <section className="mt-[28px] border-t border-dotted border-[#ccc] pt-[19px]">
                <SectionTitle>{t("Контактные данные")}</SectionTitle>
                <FieldInput label={t("Код")} value={form.code} onChange={(value) => onTextChange("code", value)} />

                {form.phones.map((phone, index) => (
                  <div key={index} className="relative">
                    <div className="w-[calc(100%-44px)]">
                      <FieldInput
                        label={t("Номер телефона")}
                        type="tel"
                        value={phone}
                        onChange={(value) => onPhoneChange(index, value)}
                      />
                    </div>
                    {index === form.phones.length - 1 ? (
                      <button type="button" title={t("Добавить номер")} onClick={onPhoneAdd} className="absolute right-3 top-[22px] text-[#666]">
                        <PlusCircle className="h-5 w-5" />
                      </button>
                    ) : (
                      <button type="button" title={t("Удалить номер")} onClick={() => onPhoneRemove(index)} className="absolute right-3 top-[22px] text-[#e57373]">
                        <Minus className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                ))}

                <FieldInput label={t("Контактное лицо")} required={mode === "add"} value={form.contactPerson} onChange={(value) => onTextChange("contactPerson", value)} />
                <FieldInput label={t("Заметка")} value={form.note} onChange={(value) => onTextChange("note", value)} />
              </section>

              <section className="mt-[28px] border-t border-dotted border-[#ccc] pt-[19px]">
                <SectionTitle>{t("Настройки клиента")}</SectionTitle>
                <CheckRow label={t("Автоматическая доставка")} checked={form.autoDelivery} onChange={(value) => onToggleChange("autoDelivery", value)} />
                <CheckRow label={t("Неограниченный долг")} checked={form.unlimitedDebt} onChange={(value) => onToggleChange("unlimitedDebt", value)} />
                <CheckRow label={t("Может увидеть цену")} checked={canSeePrice} onChange={setCanSeePrice} />
                <CheckRow label={t("Подтвердить клиента чтобы взять заказы")} checked={confirmToOrder} onChange={setConfirmToOrder} />
                <CheckRow label={t("Изменить финансовые настройки")} checked={changeFinance} onChange={setChangeFinance} />
                <div className="mt-[14px] flex items-center justify-between">
                  <span>{t("Статус объекта:")}</span>
                  <div className="w-[240px]">
                    <FieldSelect label={t("Выберите")} value={objectActive ? "active" : "inactive"} onChange={(value) => setObjectActive(value === "active")} options={["active", "inactive"]} optionLabels={{ active: t("Активен"), inactive: t("Неактивен") }} />
                  </div>
                </div>
              </section>
            </div>
          </div>

          {error && (
            <p role="alert" className="mx-[30px] mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              {error}
            </p>
          )}
        </div>

        <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#efefef] px-[27px]">
          <button type="submit" disabled={saving} className="text-[13px] font-semibold uppercase text-[#0a9ddb] disabled:opacity-60">
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </footer>
      </form>

      {quickAdd && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4" onMouseDown={(event) => event.stopPropagation()}>
          <form onSubmit={saveQuickAdd} className="w-full max-w-sm rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">{t(quickAdd === "zone" ? "Добавить зону" : "Добавить тип клиента")}</b>
              <button type="button" onClick={() => setQuickAdd(null)} aria-label={t("Закрыть")}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="block border-b border-slate-200 pb-2 text-sm font-medium">
              {t(quickAdd === "zone" ? "Наименование зоны" : "Наименование")} <span className="text-red-500">*</span>
              <input
                autoFocus
                maxLength={200}
                value={quickName}
                onChange={(event) => {
                  setQuickName(event.target.value)
                  setQuickError("")
                }}
                className="mt-2 block w-full outline-none"
              />
            </label>
            {quickError && (
              <p role="alert" className="mt-3 text-[13px] text-red-600">
                {quickError}
              </p>
            )}
            <div className="mt-5 flex justify-end">
              <button type="submit" disabled={quickSaving} className="rounded bg-[#71ce87] px-5 py-2.5 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {quickSaving ? t("Сохранение...") : t("Сохранить")}
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
  return <h3 className="text-[16px] font-semibold leading-6 text-[#4f71dc]">{children}</h3>
}

function FloatLabel({ label, required, filled, info }: { label: string; required?: boolean; filled: boolean; info?: string }) {
  return (
    <span
      className={`pointer-events-none absolute left-0 flex items-center gap-1 font-bold transition-all ${filled ? "top-0 text-[10px] leading-3" : "top-[28px] text-[13px] leading-4"}`}
    >
      {label}
      {required && <span className="text-[#e57373]">*</span>}
      {info && (
        <span title={info} className="pointer-events-auto">
          <Info className="h-3.5 w-3.5 text-[#999]" />
        </span>
      )}
    </span>
  )
}

const fieldLine = "relative block h-[52px] border-b border-[#e0e0e0] focus-within:border-[#5d6474]"

function withCurrent(options: string[], current: string) {
  return current && !options.includes(current) ? [current, ...options] : options
}

function FieldInput({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  autoFocus = false,
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
  const [focused, setFocused] = useState(false)
  const field = (
    <label className={`${fieldLine} ${info ? "w-[calc(100%-25px)]" : ""}`}>
      <FloatLabel label={label} required={required} filled={focused || value !== ""} />
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        required={required}
        autoFocus={autoFocus}
        step={type === "number" ? "any" : undefined}
        list={listId}
        className="absolute inset-x-0 bottom-0 h-[30px] bg-transparent text-[13px] font-semibold outline-none"
      />
      {listId && listOptions && (
        <datalist id={listId}>
          {listOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </label>
  )
  if (!info) return field
  return (
    <div className="relative">
      {field}
      <span title={info} className="absolute right-0 top-[14px]">
        <Info className="h-5 w-5 text-[#555]" />
      </span>
    </div>
  )
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  optionLabels,
  required = false,
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
  const { t } = useLanguage()
  return (
    <label className={`${fieldLine} mb-[10px] ${className ?? ""}`}>
      <FloatLabel label={label} required={required} filled={value !== ""} />
      <select
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-x-0 bottom-0 h-[30px] appearance-none bg-transparent pr-8 text-[13px] font-semibold outline-none"
      >
        <option value="" />
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels?.[option] ?? option}
          </option>
        ))}
      </select>
      {value !== "" && (
        <button type="button" onClick={() => onChange("")} aria-label={t("Очистить")} className="absolute bottom-[3px] right-6 text-[16px] leading-none text-[#999]">
          ×
        </button>
      )}
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-0 right-0 h-6 w-6 fill-black/30">
        <path d="M7 10l5 5 5-5z" />
      </svg>
    </label>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="my-[10px] flex cursor-pointer items-center gap-3 font-semibold">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-[#666]" aria-hidden>
        <path
          d={
            checked
              ? "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
              : "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
          }
        />
      </svg>
      {label}
    </label>
  )
}

const DETAIL_TABS = ["АКТИВНОСТЬ", "ЗАДАЧИ", "КЛИЕНТ", "ОТЧЕТЫ", "ОТКАЗЫ"] as const
const CLIENT_SUBTABS = ["ДЕТАЛИ", "ФИНАНСОВЫЕ НАСТРОЙКИ", "ЛОГИ", "ДОГОВОРЫ"] as const
const WEEK_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
const SHORT_MONTHS = ["Янв.", "Февр.", "Март", "Апр.", "Май", "Июнь", "Июль", "Авг.", "Сент.", "Окт.", "Нояб.", "Дек."]
const LOG_FILTERS = ["Все", "Заказ", "Возврат", "Финансы", "Клиент"]

// The card's figures come from the client ledger (/api/clients/[id]/summary)
// and its documents (orders, payments, returns); nothing here is invented.
type ClientSummary = {
  from: string
  to: string
  baseCurrency: string
  currencies: Array<{ currency: string; begin: number; end: number; orders: number; actualSales: number; returns: number; payments: number }>
  lastOrder: string | null
  lastPayment: string | null
  daysSinceLastOrder: number | null
}

type CardLog = { type: "Заказ" | "Возврат" | "Оплата" | "Клиент"; status: string; by: string; at: string; sortKey: string; sum: string }

function moneyLines(values: Array<{ currency: string; value: number }>, base: string) {
  const lines = values.filter((entry) => entry.value).map((entry) => `${entry.value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${entry.currency}`)
  return lines.length ? lines.join(", ") : `0 ${base}`
}

function displayDay(value: string | null | undefined) {
  if (!value) return ""
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  return `${Number(match[3])} ${SHORT_MONTHS[Number(match[2]) - 1]} ${match[1]}`
}

function displayMoment(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(/[zZ]$/.test(value) ? value : `${value.replace(" ", "T")}Z`)
  if (Number.isNaN(date.getTime())) return value
  return `${formatDetailDate(date)}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function formatDetailDate(date: Date) {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** The client card opened from another page (Активность, Отслеживание): loads the client
 * by id and shows the same drawer as Клиенты, without the edit / delete buttons (those stay
 * on the Клиенты page). Closes itself when the client cannot be loaded. */
export function ClientDrawer({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const [client, setClient] = useState<Client | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/clients/${clientId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as Client | null
        if (!response.ok || !body || typeof body.id !== "number") throw new Error("not found")
        setClient(body)
      })
      .catch((cause: { name?: string }) => {
        if (cause?.name !== "AbortError") onClose()
      })
    return () => controller.abort()
  }, [clientId, onClose])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [onClose])

  if (!client || client.id !== clientId) return null
  return <ClientDetail client={client} onClose={onClose} />
}

function ClientDetail({
  client,
  onClose,
  onEdit,
  onDelete,
}: {
  client: Client
  onClose: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const { t } = useLanguage()
  const [tab, setTab] = useState<(typeof DETAIL_TABS)[number]>("АКТИВНОСТЬ")
  const [subTab, setSubTab] = useState<(typeof CLIENT_SUBTABS)[number]>("ДЕТАЛИ")
  const [logFilter, setLogFilter] = useState("Все")
  const [orderOpen, setOrderOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentComment, setPaymentComment] = useState("")
  // The business day (Asia/Tashkent), the day the server's "not after today" rule uses.
  const [paymentDate, setPaymentDate] = useState(() => todayIso())
  const [paymentError, setPaymentError] = useState("")
  const [paymentSaving, setPaymentSaving] = useState(false)
  const [paymentDone, setPaymentDone] = useState(false)
  const [summary, setSummary] = useState<ClientSummary | null>(null)
  const [cardLogs, setCardLogs] = useState<CardLog[] | null>(null)
  const primaryPhone = client.phone.split(",")[0]?.trim() ?? ""
  const hasPhone = primaryPhone !== "" && primaryPhone !== "-"
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd)
  periodStart.setDate(periodStart.getDate() - 30)
  const hasLocation = client.locationLat !== undefined && client.locationLng !== undefined
  const base = summary?.baseCurrency ?? "SUM"
  const sumOf = (pick: "orders" | "actualSales" | "returns" | "begin" | "end") => moneyLines((summary?.currencies ?? []).map((entry) => ({ currency: entry.currency, value: entry[pick] })), base)
  const beginNegative = (summary?.currencies ?? []).some((entry) => entry.begin < 0)
  const endNegative = (summary?.currencies ?? []).some((entry) => entry.end < 0)

  const loadSummary = useCallback(() => {
    fetch(`/api/clients/${client.id}/summary`)
      .then((response) => (response.ok ? (response.json() as Promise<ClientSummary>) : null))
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [client.id])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  // Logs: the client's own documents (creation, orders, payments, returns).
  useEffect(() => {
    let cancelled = false
    setCardLogs(null)
    const json = <T,>(url: string) => fetch(url).then((response) => (response.ok ? (response.json() as Promise<T>) : null)).catch(() => null)
    void Promise.all([
      json<Array<{ id: number; clientId?: number | null; client: string; status: string; amount: string; createdBy?: string; agent: string; createdAt?: string }>>("/api/orders?balances=0"),
      json<Array<{ amount: number; currency: string; paymentDate: string; createdAt: string; accepted: boolean }>>(`/api/client-payments?clientId=${client.id}`),
      json<{ rows: Array<{ id: number; status: string; amount: number; currency: string; createdBy: string; createdAt: string }> }>(`/api/client-returns?clientId=${client.id}`),
    ]).then(([orders, payments, returns]) => {
      if (cancelled) return
      const logs: CardLog[] = []
      if (client.createdAt) logs.push({ type: "Клиент", status: "Создан", by: client.createdBy || "—", at: displayMoment(client.createdAt), sortKey: client.createdAt, sum: "0" })
      for (const order of orders ?? []) {
        if (order.clientId ? order.clientId !== client.id : order.client !== client.name) continue
        logs.push({ type: "Заказ", status: order.status, by: order.createdBy || order.agent, at: displayMoment(order.createdAt), sortKey: order.createdAt ?? "", sum: order.amount })
      }
      for (const payment of payments ?? []) {
        logs.push({ type: "Оплата", status: payment.accepted ? "Принят" : "Не принят", by: "—", at: displayDay(payment.paymentDate) || displayMoment(payment.createdAt), sortKey: payment.createdAt ?? "", sum: `${payment.amount.toLocaleString("ru-RU")} ${payment.currency}` })
      }
      for (const entry of returns?.rows ?? []) {
        logs.push({ type: "Возврат", status: entry.status === "accepted" ? "Принят" : entry.status === "cancelled" ? "Отменен" : "Ожидает", by: entry.createdBy || "—", at: displayMoment(entry.createdAt), sortKey: entry.createdAt, sum: `${entry.amount.toLocaleString("ru-RU")} ${entry.currency}` })
      }
      setCardLogs(logs.sort((a, b) => b.sortKey.localeCompare(a.sortKey)))
    })
    return () => {
      cancelled = true
    }
  }, [client.id, client.name, client.createdAt, client.createdBy])

  const actionButton = "flex h-[30px] items-center rounded-[5px] pl-3 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"

  return (
    <>
      <button
        type="button"
        aria-label={t("Закрыть карточку клиента")}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <aside className="fixed right-0 top-0 z-50 h-full w-[580px] max-w-full overflow-y-auto bg-white font-sans text-[13px] leading-[1.25] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <header className="flex h-[59px] items-center justify-between border-b border-[#efefef] px-[30px] py-[5px]">
          <div className="flex items-center gap-[10px] text-[13px] font-semibold uppercase">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#92ce95]">
              <circle cx="12" cy="12" r="8" />
            </svg>
            <span>{client.name}</span>
          </div>
          <div className="-mr-[10px] flex items-center">
            {onEdit && (
              <button type="button" aria-label={t("Изменить")} onClick={onEdit} className="flex h-12 w-12 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                </svg>
              </button>
            )}
            {onDelete && (
              <button type="button" aria-label={t("Удалить")} onClick={onDelete} className="flex h-12 w-12 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                </svg>
              </button>
            )}
            <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </header>

        <nav className="flex">
          {DETAIL_TABS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`h-12 w-1/5 border-b-2 text-[13px] font-medium uppercase text-black ${tab === item ? "border-[#4f71dc]" : "border-transparent"}`}
            >
              {t(item)}
            </button>
          ))}
        </nav>

        {tab === "АКТИВНОСТЬ" && (
          <div className="p-5">
            <div>
              <DetailMetricRow
                left={{ label: t("Фактические продажи (30 дней)"), value: summary ? sumOf("actualSales") : "…" }}
                right={{
                  label: t("Прошло дней с последнего заказа"),
                  value: summary ? (summary.daysSinceLastOrder === null ? t("Заказов нет") : String(summary.daysSinceLastOrder)) : "…",
                  red: (summary?.daysSinceLastOrder ?? 0) > 30,
                }}
                bordered
              />
              <DetailMetricRow
                left={{ label: t("Сумма продаж за период (30 дней)"), value: summary ? sumOf("orders") : "…" }}
                right={{ label: t("Прошло дней с последнего визита"), value: t("Нет данных") }}
                bordered
              />
              <DetailMetricRow
                left={{ label: t("Сумма возврата с заказов за период (30 дней)"), value: summary ? sumOf("returns") : "…" }}
                right={{ label: t("Комментарий отказа"), value: t("Не указан") }}
              />
            </div>

            <div className="mt-5 flex gap-[10px]">
              <button
                type="button"
                disabled={!hasPhone}
                onClick={() => hasPhone && (window.location.href = `tel:${primaryPhone}`)}
                className={`${actionButton} bg-[#71ce87]`}
              >
                <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white">
                  <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                </svg>
                <span className="pl-2 pr-4">{t("Позвонить")}</span>
              </button>
              <button type="button" onClick={() => setOrderOpen(true)} className={`${actionButton} bg-[#4f71dc]`}>
                <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z" />
                </svg>
                <span className="pl-2 pr-4">{t("Заказать")}</span>
              </button>
              <button type="button" onClick={() => setTab("ОТКАЗЫ")} className={`${actionButton} bg-[#fa8072]`}>
                <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z" />
                </svg>
                <span className="pl-2 pr-4">{t("Отказ")}</span>
              </button>
              <button type="button" onClick={() => (setPaymentError(""), setPaymentOpen(true))} className={`${actionButton} bg-[#71ce87]`}>
                <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white">
                  <path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z" />
                </svg>
                <span className="pl-2 pr-4">{t("Добавить оплату")}</span>
              </button>
            </div>

            {orderOpen && (
              <AddOrderDialog initialShopId={client.id} onClose={() => setOrderOpen(false)} onCreated={() => setOrderOpen(false)} />
            )}

            {paymentOpen && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
                <form
                  onSubmit={async (event) => {
                    event.preventDefault()
                    setPaymentError("")
                    const amount = Number(paymentAmount.replace(/\s/g, "").replace(",", "."))
                    if (!paymentAmount.trim() || !Number.isFinite(amount) || amount <= 0) return setPaymentError(t("Укажите сумму"))
                    if (amount > 1e13) return setPaymentError(t("Сумма слишком большая"))
                    if (!paymentDate) return setPaymentError(t("Укажите дату"))
                    setPaymentSaving(true)
                    try {
                      const response = await fetch("/api/client-payments", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          clientId: client.id,
                          clientName: client.name,
                          amount,
                          comment: paymentComment.trim(),
                          paymentDate,
                        }),
                      })
                      const body = (await response.json().catch(() => null)) as { error?: string } | null
                      if (!response.ok) {
                        setPaymentError(body?.error ? t(body.error) : t("Не удалось добавить оплату"))
                        return
                      }
                      setPaymentDone(true)
                      setPaymentOpen(false)
                      setPaymentAmount("")
                      setPaymentComment("")
                      loadSummary()
                      window.setTimeout(() => setPaymentDone(false), 2500)
                    } catch {
                      setPaymentError(t("Не удалось добавить оплату"))
                    } finally {
                      setPaymentSaving(false)
                    }
                  }}
                  className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl"
                >
                  <div className="mb-5 flex items-center justify-between">
                    <h3 className="text-lg font-bold">{t("Добавить оплату")}</h3>
                    <button type="button" onClick={() => setPaymentOpen(false)} aria-label={t("Закрыть")}>
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <label className="mb-4 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
                    {t("Сумма")} ({base}) *
                    <input
                      autoFocus
                      type="number"
                      min="0"
                      step="any"
                      value={paymentAmount}
                      onChange={(event) => (setPaymentAmount(event.target.value), setPaymentError(""))}
                      className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-slate-900 outline-none"
                    />
                  </label>
                  <label className="mb-4 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
                    {t("Дата оплаты")} *
                    <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-semibold text-slate-900 outline-none" />
                  </label>
                  <label className="mb-4 block border-b border-slate-200 pb-2 text-[13px] font-medium text-slate-500">
                    {t("Комментарий")}
                    <input value={paymentComment} onChange={(event) => setPaymentComment(event.target.value)} className="mt-1 block w-full bg-transparent text-[15px] font-semibold text-slate-900 outline-none" />
                  </label>
                  <p className="mb-4 text-[12px] text-slate-500">{t("Оплата попадет в «Оплаты от клиентов» как непринятая; примите ее в кассу там.")}</p>
                  {paymentError && <p className="mb-3 text-[13px] font-semibold text-[#e57373]">{paymentError}</p>}
                  <button type="submit" disabled={paymentSaving} className="w-full rounded-md bg-[#71ce87] py-3 font-semibold text-white disabled:opacity-50">
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

            <div className="pt-5">
              <DetailSectionTitle>{t("Агенты магазина")}</DetailSectionTitle>
              <div className="-mx-2 flex items-center border-b border-dashed border-[#d8d8d8] py-5">
                <div className="w-[134px] shrink-0 px-2">{t("Агент")}</div>
                <div className="w-[134px] shrink-0 px-2">{t("Комментарий")}</div>
                <div className="flex-1 px-2">{t("Прайс лист")}</div>
                <div className="flex w-[44.7px] shrink-0 justify-center px-2">
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                  </svg>
                </div>
              </div>

              <div className="mt-[30px]">
                <DetailSectionTitle>{t("Маршруты")}</DetailSectionTitle>
                <div className="-mx-2 flex items-center py-5">
                  <div className="w-[134px] shrink-0 px-2">{t("Агент")}</div>
                  <div className="w-[178.7px] shrink-0 px-2">{t("Частота посещения")}</div>
                  <div className="flex-1 px-2">{t("Дни недели")}</div>
                  <div className="flex w-[44.7px] shrink-0 justify-center px-2">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                    </svg>
                  </div>
                </div>
                <div className="-mx-2 flex items-center border-b border-dashed border-[#d8d8d8] py-5">
                  <div className="w-[134px] shrink-0 px-2">{client.agent && client.agent !== "Не указано" ? client.agent : t("Не указано")}</div>
                  <div className="w-[178.7px] shrink-0 px-2">{client.inRoute ? t("Раз в неделю") : t("Маршрут не установлен")}</div>
                  <div className="flex-1 px-2">
                    <div className="flex w-[207px] flex-wrap">
                      {WEEK_DAYS.map((day) => (
                        <span key={day} className="my-[5px] mr-[10px] flex h-7 items-center rounded-[2px] bg-[#e9ecef] px-[10px]">
                          {t(day)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-[30px]">
                <div className="mb-[15px] flex items-center justify-between">
                  <span className="text-base font-bold leading-[22px]">{t("Баланс")}</span>
                  <span className="mr-[15px] w-[200px] text-[13px] font-bold text-[#4f71dc]">
                    {t(formatDetailDate(periodStart))} - {t(formatDetailDate(periodEnd))}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-[15.5px]">
                  {[
                    { label: t("Баланс на начало периода"), value: summary ? sumOf("begin") : "…", negative: beginNegative },
                    { label: t("Баланс на конец периода"), value: summary ? sumOf("end") : "…", negative: endNegative },
                  ].map((card) => (
                    <div key={card.label} className="rounded-[10px] bg-[#f3f3f3] p-[10px]">
                      <div className="ml-[9px]">
                        <div className="pb-1 text-[#8c8c8c]">{card.label}</div>
                        <span className={`font-semibold ${card.negative ? "text-[#e57373]" : "text-[#48a34b]"}`}>{card.value}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-[15px]">
                  {t("Последняя дата платежа")} :
                  <span className="ml-[5px] font-semibold">{summary ? (summary.lastPayment ? t(displayDay(summary.lastPayment)) : t("Оплат нет")) : "…"}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "ЗАДАЧИ" && (
          <div className="p-5">
            <button type="button" className="mb-5 h-[34px] w-full rounded-[5px] bg-[#4f71dc] text-[13px] font-semibold text-white">
              {t("Создать задачу")}
            </button>
            <div className="flex flex-col items-center py-[30px] text-[#666]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/robot-empty.png" alt="" className="w-[150px]" />
              <span className="mt-[20px]">{t("Задач по этому клиенту нет")}</span>
            </div>
          </div>
        )}

        {tab === "КЛИЕНТ" && (
          <div className="px-[30px] pt-[15px] pb-6">
            <div className="flex h-[300px] flex-col items-center justify-center border border-dashed border-[#c5ced6] bg-[#f0f4f8] text-center text-[#888]">
              <span className="max-w-[70px] text-[11px]">{t("Фото отсутствует")}</span>
              <span className="my-[6px] block h-px w-16 bg-[#bbb]" />
              <button type="button" className="text-[11px] text-[#129fdd]">
                {t("добавить фото")}
              </button>
            </div>
            <div className="mt-[10px] flex">
              {CLIENT_SUBTABS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSubTab(item)}
                  className={`flex h-9 w-1/4 items-center justify-center whitespace-nowrap border-b-2 text-[13px] font-medium uppercase text-black ${subTab === item ? "border-[#4f71dc]" : "border-transparent"}`}
                >
                  {t(item)}
                </button>
              ))}
            </div>

            {subTab === "ДЕТАЛИ" && (
              <div className="pt-1">
                <DetailListTitle>{t("Детали")}</DetailListTitle>
                <DetailListRow label={t("Прайс лист:")} value={t("Не указано")} bold />
                <DetailListRow label={t("Тел. номер:")} value={client.phone || "-"} bold />
                <DetailListRow label={t("Финансовый счет:")} value={client.name} />
                <DetailListRow label={t("Класс клиента:")} value="-" />
                <DetailListRow label={t("Ответственный агент:")} value={client.agent} />
                <DetailListRow label={t("Тип заведения:")} value={client.type} />
                <DetailListRow label={t("Частота посещений:")} value="" />
                <DetailListRow label={t("Создал:")} value={client.createdBy || "—"} />
                <DetailListRow label={t("Дата:")} value={client.createdAt ? displayMoment(client.createdAt) : "—"} />
                <DetailListRow label={t("Зона:")} value={client.zone} />
                <DetailListRow
                  label={t("Локация:")}
                  value={
                    hasLocation ? (
                      <>
                        {client.locationLat!.toFixed(6)}, {client.locationLng!.toFixed(6)}
                        <a
                          className="block cursor-pointer text-[11px] text-[#4f71dc]"
                          href={`https://www.google.com/maps?q=${client.locationLat},${client.locationLng}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("показать на карте")}
                        </a>
                      </>
                    ) : (
                      "-"
                    )
                  }
                />
                <DetailListRow label={t("Статус ИНН:")} value={client.inn ? t("Правильный ИНН") : t("Неправильный ИНН")} />
                <DetailListRow label={t("Ответственный доставщик:")} value={client.deliverer} />
                <DetailListRow label={t("Ответственный инкассатор:")} value={client.collector} />

                <DetailListTitle className="mt-[22px]">{t("Контакты")}</DetailListTitle>
                <DetailListRow label={t("Имя:")} value={client.contactPerson || "-"} />
                <DetailListRow label={t("Адрес:")} value={client.address || "-"} />
                <DetailListRow label={t("Ориентир:")} value={client.landmark || "-"} />

                <DetailListTitle className="mt-[22px]">{t("Класс клиента")}</DetailListTitle>
                <DetailListRow label={t("Названия класса")} value={t("Организация")} bold />
              </div>
            )}

            {subTab === "ФИНАНСОВЫЕ НАСТРОЙКИ" && (
              <div className="pt-[10px]">
                <h3 className="mt-[10px] text-base font-semibold">{t("Лимит долга")}</h3>
                <div className="flex flex-col items-center py-[22px] text-[#666]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/robot-empty.png" alt="" className="w-[150px]" />
                  <span className="mt-[30px]">{t("По вашему запросу ничего не найдено...")}</span>
                </div>
                <div className="border-t border-[#e5e5e5] pt-5">
                  <h3 className="mb-4 text-base font-semibold">{t("Финансовые настройки")}</h3>
                  <div className="flex items-center border-b border-[#e5e5e5] pb-2 font-semibold">
                    {t("Без автоматических бонусов:")}
                    <X className="ml-2 h-5 w-5 text-[#e57373]" />
                  </div>
                  <div className="flex items-center border-b border-[#e5e5e5] py-2 font-semibold">
                    {t("Маркетинговые акции:")}
                    <span className="ml-2 rounded-full bg-[#ff9a9a] px-3 py-[3px] font-semibold text-white">{t("Нет данных")}</span>
                  </div>
                  <div className="flex items-center py-2 font-semibold">
                    KPI:
                    <span className="ml-2 rounded-full bg-[#ff9a9a] px-3 py-[3px] font-semibold text-white">{t("Нет данных")}</span>
                  </div>
                </div>
              </div>
            )}

            {subTab === "ЛОГИ" && (
              <div className="pt-[10px]">
                <div className="flex items-center justify-center gap-2 py-3">
                  <b className="mr-1">{t("Фильтры:")}</b>
                  {LOG_FILTERS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setLogFilter(item)}
                      className={`h-[26px] rounded-full border px-4 ${logFilter === item ? "border-[#4f71dc] bg-[#4f71dc] font-semibold text-white" : "border-[#ccc] bg-white"}`}
                    >
                      {t(item)}
                    </button>
                  ))}
                </div>
                <DetailPager total={(cardLogs ?? []).length} />
                <div className="mt-4 grid grid-cols-[89px_134px_120px_150px_1fr] border-b border-dashed border-[#d8d8d8] pb-4 pt-3 font-semibold">
                  <span>{t("Тип")}</span>
                  <span>{t("Статус")}</span>
                  <span>{t("Кем")}</span>
                  <span>{t("Дата создания")}</span>
                  <span>{t("Сумма")}</span>
                </div>
                {cardLogs === null ? (
                  <p className="py-6 text-center text-[#888]">{t("Загрузка...")}</p>
                ) : (
                  cardLogs
                    .filter((log) => logFilter === "Все" || (logFilter === "Финансы" ? log.type === "Оплата" : log.type === logFilter))
                    .map((log, index) => (
                      <div key={index} className="grid grid-cols-[89px_134px_120px_150px_1fr] items-center border-b border-dashed border-[#d8d8d8] py-4">
                        <span>{t(log.type)}</span>
                        <span>
                          {log.status === "Создан" ? (
                            <span className="inline-block w-[118px] rounded-full border border-[#48a34b] py-[2px] text-center text-[#48a34b]">{t(log.status)}</span>
                          ) : log.status === "Отменен" ? (
                            <span className="inline-block w-[118px] rounded-full border border-[#e57373] py-[2px] text-center text-[#e57373]">{t(log.status)}</span>
                          ) : (
                            t(log.status)
                          )}
                        </span>
                        <span className="truncate pr-2">{log.by}</span>
                        <span className="pr-3">{t(log.at)}</span>
                        <span>{log.sum}</span>
                      </div>
                    ))
                )}
              </div>
            )}

            {subTab === "ДОГОВОРЫ" && (
              <div className="pt-[10px]">
                <DetailPager total={0} />
                <div className="mt-4 grid grid-cols-[179px_179px_1fr] border-b border-dashed border-[#d8d8d8] pb-4 pt-3 font-semibold">
                  <span>№</span>
                  <span>{t("Дата")}</span>
                  <span>{t("Организация")}</span>
                </div>
                <p className="py-8 text-center text-[#333]">{t("Ничего не найдено")}</p>
              </div>
            )}
          </div>
        )}

        {(tab === "ОТЧЕТЫ" || tab === "ОТКАЗЫ") && (
          <div className="flex flex-col items-center pt-[18px] text-[#666]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/robot-empty.png" alt="" className="w-[120px]" />
            <span>{tab === "ОТЧЕТЫ" ? t("Отчеты не найдены") : t("Отказы не найдены")}</span>
          </div>
        )}
      </aside>
    </>
  )
}

function DetailMetricRow({
  left,
  right,
  bordered,
}: {
  left: { label: string; value: string; red?: boolean }
  right: { label: string; value: string; red?: boolean }
  bordered?: boolean
}) {
  return (
    <div className={`flex justify-between ${bordered ? "mb-[10px] border-b border-[#efefef] pb-2" : ""}`}>
      {[left, right].map((metric) => (
        <div key={metric.label} className="flex w-[180px] flex-col justify-between">
          <div className="mb-[7px] text-[#666]">{metric.label}</div>
          <div className={`text-base font-semibold leading-5 ${metric.red ? "text-[#e57373]" : "text-[#333]"}`}>{metric.value}</div>
        </div>
      ))}
    </div>
  )
}

function DetailSectionTitle({ children }: { children: React.ReactNode }) {
  return <span className="block text-base font-bold leading-[22px]">{children}</span>
}

function DetailListTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h4 className={`mb-[6px] text-[13px] font-semibold ${className}`}>{children}</h4>
}

function DetailListRow({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex min-h-[25px] items-start justify-between ${bold ? "font-bold" : ""}`}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

function DetailPager({ total }: { total: number }) {
  const { t } = useLanguage()
  const arrow = "flex h-5 w-5 items-center justify-center rounded-full border border-[#999] text-[#999]"
  return (
    <div className="flex items-center justify-center gap-4 text-[#666]">
      <span className="flex items-center gap-1">
        25 <ChevronDown className="h-4 w-4 text-[#bbb]" />
      </span>
      <span>
        {total === 0 ? 0 : 1} - {total} {t("из")} {total}
      </span>
      <span className="flex gap-2">
        <span className={arrow}>
          <ChevronLeft className="h-3 w-3" />
        </span>
        <span className={arrow}>
          <ChevronRight className="h-3 w-3" />
        </span>
      </span>
    </div>
  )
}

function ClientRow({
  client,
  selected,
  selectMode,
  columns,
  routed,
  onToggle,
  onOpen,
}: {
  client: Client
  selected: boolean
  selectMode: boolean
  columns: Record<ColumnKey, boolean>
  routed: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const { t } = useLanguage()
  const confirmed = client.tab !== "unconfirmed"

  return (
    <div
      onClick={onOpen}
      className={`grid cursor-pointer items-center border-b border-dotted border-[#d6d6d6] relative border-l-[3px] [border-left-style:solid] pl-[52px] pr-[30px] [&>div]:[overflow-wrap:anywhere] h-[50px] hover:bg-[#f2f5f8] ${
        confirmed ? "border-l-[#7ed07e]" : "border-l-[#5d6474]"
      } bg-white`}
      style={{ gridTemplateColumns: gridTemplate(columns, "row") }}
    >
      {selectMode && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          aria-label={`${t("Выбрать")} ${client.name}`}
          className="absolute left-[17px] top-3 h-6 w-6"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d={selected ? CI.checkOn : CI.checkEmpty} /></svg>
        </button>
      )}
      {columns.name && <div className="px-2 leading-[16.25px]">{client.name}</div>}
      {columns.code && <div className="px-2 leading-[16.25px]">{client.code ?? ""}</div>}
      {columns.phone && <div className="px-2 leading-[16.25px]">{/^\d{9}$/.test(client.phone) ? `+998${client.phone}` : client.phone}</div>}
      {columns.info && <div className="px-2 leading-[16.25px]">
        {client.inn ? (
          <>
            {t("ИНН")}: <b>{client.inn}</b>
          </>
        ) : (
          client.info ?? ""
        )}
      </div>}
      {columns.type && <div className="px-2 leading-[16.25px]">{client.type}</div>}
      {columns.zone && <div className="px-2 leading-[16.25px]">
        {client.zone || t("Не указано")}
        <br />
        <span className="text-[#4f71dc]">{client.zoneAgent}</span>
        {routed && <div className="text-[11px] font-semibold text-[#48a34b]">{t("Маршрут установлен")}</div>}
      </div>}
      {columns.agent && <div className="px-2 leading-[16.25px]">{client.agent}</div>}
      {columns.deliverer && <div className="px-2 leading-[16.25px]">{client.deliverer}</div>}
      {columns.collector && <div className="px-2 leading-[16.25px]">{client.collector}</div>}
      {columns.balance && <div className="pl-2 text-center leading-[16.25px]">
        {client.balanceLines?.length
          ? client.balanceLines.map((line) => <div key={line} className={line.startsWith("-") ? "text-[#e57373]" : ""}>{line}</div>)
          : client.balance ? <span className={client.balance < 0 ? "text-[#e57373]" : ""}>{formatBalance(client.balance)}</span> : ""}
      </div>}
    </div>
  )
}


function ColumnsDrawer({ columns, onSave, onClose }: { columns: Record<ColumnKey, boolean>; onSave: (columns: Record<ColumnKey, boolean>) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(columns)
  return (
    <div className="fixed inset-0 z-[1200] bg-black/[0.54]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="fixed right-0 top-0 flex h-full w-[340px] max-w-full flex-col bg-white text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
        <header className="flex h-[58px] shrink-0 items-center border-b border-[#efefef] pl-[30px]">
          <h2 className="text-[15px] font-medium">{t("Настройка таблицы")}</h2>
        </header>
        <ul className="min-h-0 flex-1 overflow-y-auto pt-[14px]">
          {COLUMN_DEFS.map((column) => (
            <li key={column.key} className="h-[35px]">
              <button type="button" onClick={() => setDraft((current) => ({ ...current, [column.key]: !current[column.key] }))} className="flex h-[35px] w-full items-center gap-[10px] pl-[30px] text-left font-semibold">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d={draft[column.key] ? CI.checkOn : CI.checkEmpty} /></svg>
                {t(column.title)}
              </button>
            </li>
          ))}
        </ul>
        <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#efefef] pr-[26px]">
          <button type="button" onClick={() => onSave(draft)} className="font-semibold uppercase text-[#0a9ddb]">{t("Сохранить")}</button>
        </footer>
      </aside>
    </div>
  )
}
