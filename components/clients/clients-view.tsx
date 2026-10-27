"use client"

import { askDelete } from "@/lib/ask-confirm"
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react"
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
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { shortRuDate } from "@/lib/ref-date"

import { AddOrderDialog } from "@/components/orders/add-order-dialog"

import { clientTabs, type Client } from "./clients-data"
import { ClientDebtLimits } from "./client-debt-limits"
import { MultiEditDialog, type MultiEditPatch } from "./multi-edit-dialog"
import { applyClientFilters, ClientsFilterPanel, DEBT_LIMIT_TYPES, emptyClientFilters, type ClientFilters, type DebtLimitFilterContext } from "./clients-filter-panel"

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

/** The reference app counts the "days since last order/visit" from this fixed date. */
const DAYS_SINCE_ANCHOR = String(Math.floor((Date.now() - new Date(2020, 0, 1).getTime()) / 86_400_000))
const pageSizes = [10, 25, 50, 100, 200, 500, 1000, 2000]

// The reference keeps the list state in the URL (…/shop?showTab=problem_all&ordering=-name,phone&page=2…).
const TAB_PARAM: Record<Client["tab"], string> = { unconfirmed: "unconfirmed", problem: "problem_all", plan: "plan", closing: "closed", all: "all" }
const PROBLEM_PARAM = { inn: "problem_inn", territory: "problem_border", route: "problem_plan", all: "problem_all" } as const
/** Only these three headers are sortable in the reference (value = its `ordering` key). */
const SORT_KEYS: Record<string, string> = { Название: "name", "Тел. номер": "phone", Зона: "border" }
const IMPORT_PARAM = { promotion: "openImportPromotionDialog", import: "openImportProductDialog", excel: "excelUpdateCreateDialogOpen" } as const
type SortKey = { key: string; desc: boolean }

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
  isActive: boolean
  attributes: Record<string, string>
}

type ClientTextField = Exclude<
  keyof ClientForm,
  "tab" | "phones" | "locationLat" | "locationLng" | "autoDelivery" | "unlimitedDebt" | "isActive" | "attributes"
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
  isActive: false,
  attributes: {},
}

function formatBalance(value: number) {
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} SUM`
}

function formFromClient(client: Client): ClientForm {
  const phones = client.phone
    ? client.phone.split(",").map((phone) => phone.trim()).filter(Boolean).map((phone) => (/^\d{9}$/.test(phone) ? `+998${phone}` : phone))
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
    isActive: client.isActive ?? true,
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
  const [selectMode, setSelectMode] = useState(false)
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

  const zoneOptions = useMemo(
    () => [...new Set(clients.map((client) => client.zone))].sort((a, b) => a.localeCompare(b, "ru")),
    [clients],
  )

  // `?ids=1,2,3` narrows the list to specific clients (e.g. links from the «Объединение» page).
  const [idFilter, setIdFilter] = useState<number[] | null>(null)
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("ids")
    const ids = (raw ?? "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0)
    setIdFilter(ids.length ? ids : null)
  }, [])

  // "Тип лимита долга": per-client limit types are loaded once the filter is used and reloaded when the filter changes.
  const [debtTypes, setDebtTypes] = useState<Record<number, string[]> | null>(null)
  useEffect(() => {
    if (!filters.debtLimitType) return
    let cancelled = false
    fetch("/api/client-debt-limits?types=1")
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: Record<number, string[]>) => {
        if (!cancelled) setDebtTypes(data)
      })
      .catch(() => {
        if (!cancelled) setDebtTypes({})
      })
    return () => {
      cancelled = true
    }
  }, [filters.debtLimitType])
  const debtLimitFilter = useMemo<DebtLimitFilterContext>(
    () => ({
      types: debtTypes,
      idByLabel: new Map(DEBT_LIMIT_TYPES.flatMap((type) => [[type.label, type.id], [t(type.label), type.id]] as [string, string][])),
    }),
    [debtTypes, t],
  )

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (idFilter && !idFilter.includes(c.id)) return false
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
      const matchesFilters = applyClientFilters(c, filters, debtLimitFilter)
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
  }, [activeTab, problemSub, clients, query, filters, idFilter, debtLimitFilter])

  const [sort, setSort] = useState<SortKey[]>([])
  const sortedClients = useMemo(() => {
    if (sort.length === 0) return filtered
    const value = (c: (typeof filtered)[number], key: string): string => {
      switch (key) {
        case "name": return c.name
        case "phone": return c.phone
        case "border": return c.zone
        default: return ""
      }
    }
    return [...filtered].sort((a, b) => {
      for (const { key, desc } of sort) {
        const order = compareText(value(a, key), value(b, key))
        if (order !== 0) return desc ? -order : order
      }
      return 0
    })
  }, [filtered, sort])

  /** Click cycle of a sortable header: none → ascending → descending → none; other sorts are kept. */
  function toggleSort(key: string) {
    setSort((current) => {
      const existing = current.find((item) => item.key === key)
      if (!existing) return [...current, { key, desc: false }]
      if (!existing.desc) return current.map((item) => (item.key === key ? { ...item, desc: true } : item))
      return current.filter((item) => item.key !== key)
    })
  }

  // List state <-> URL, same parameter names as the reference. Unknown params (ids, openClient) are left alone.
  const urlReady = useRef(false)
  const pagingTouched = useRef(false)
  const childTouched = useRef(false)
  const deepLinkedShopId = useRef(0)
  const deepLinkedUpdate = useRef(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    deepLinkedShopId.current = Number(params.get("openShop")) || 0
    deepLinkedUpdate.current = params.get("openUpdateDialog") === "true"
    const tabEntry = Object.entries(TAB_PARAM).find(([, value]) => value === params.get("showTab"))
    if (tabEntry) {
      setActiveTab(tabEntry[0] as Client["tab"])
      const child = Object.entries(PROBLEM_PARAM).find(([, value]) => value === params.get("showChildTab"))
      if (child) {
        setProblemSub(child[0] as keyof typeof PROBLEM_PARAM)
        childTouched.current = true
      }
    }
    const pageParam = Number(params.get("page"))
    if (Number.isInteger(pageParam) && pageParam > 0) setPage(pageParam)
    const sizeParam = Number(params.get("pageSize"))
    if (pageSizes.includes(sizeParam)) setPageSize(sizeParam)
    if (params.has("page") || params.has("pageSize")) pagingTouched.current = true
    setQuery(params.get("search") ?? "")
    const keys = Object.values(SORT_KEYS)
    setSort(
      (params.get("ordering") ?? "")
        .split(",")
        .filter(Boolean)
        .map((part) => ({ key: part.replace(/^-/, ""), desc: part.startsWith("-") }))
        .filter((item) => keys.includes(item.key)),
    )
    if (params.get("showCheckboxes") === "true") setSelectMode(true)
    const ids = (params.get("select") ?? "").split("-").map(Number).filter((id) => Number.isInteger(id) && id > 0)
    if (ids.length) setSelected(ids)
    if (params.get("openFilterDialog") === "true") setFiltersOpen(true)
    if (params.get("openMultiUpdateDialog") === "true") setMultiEditOpen(true)
    const dialog = (Object.keys(IMPORT_PARAM) as (keyof typeof IMPORT_PARAM)[]).find((key) => params.get(IMPORT_PARAM[key]) === "true")
    if (dialog) setImportDialog(dialog)
    urlReady.current = true
  }, [])

  useEffect(() => {
    if (!urlReady.current) return
    const params = new URLSearchParams(window.location.search)
    for (const key of ["showTab", "showChildTab", "page", "pageSize", "search", "ordering", "showCheckboxes", "select", "openFilterDialog", "openMultiUpdateDialog", ...Object.values(IMPORT_PARAM)]) params.delete(key)
    if (activeTab !== "all" || pagingTouched.current) {
      params.set("showTab", TAB_PARAM[activeTab])
      if (activeTab === "problem" && childTouched.current) params.set("showChildTab", PROBLEM_PARAM[problemSub])
    }
    if (pagingTouched.current) {
      params.set("page", String(page))
      params.set("pageSize", String(pageSize))
    }
    if (query.trim()) params.set("search", query.trim())
    if (sort.length) params.set("ordering", sort.map(({ key, desc }) => (desc ? `-${key}` : key)).join(","))
    if (selectMode || selected.length) params.set("showCheckboxes", "true")
    if (selected.length) params.set("select", selected.join("-"))
    if (filtersOpen) params.set("openFilterDialog", "true")
    if (multiEditOpen) params.set("openMultiUpdateDialog", "true")
    if (importDialog) params.set(IMPORT_PARAM[importDialog], "true")
    params.delete("openShop")
    params.delete("openUpdateDialog")
    if (modalMode === "edit") params.set("openUpdateDialog", "true")
    if (detailClient) {
      params.delete("openClient")
      params.set("openShop", String(detailClient.id))
    }
    const sorted = new URLSearchParams([...params.entries()].sort(([a], [b]) => a.localeCompare(b)))
    const search = sorted.toString()
    const next = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next)
  }, [activeTab, problemSub, page, pageSize, query, sort, selectMode, selected, filtersOpen, multiEditOpen, importDialog, detailClient, modalMode])
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
    const params = new URLSearchParams(window.location.search)
    const name = params.get("openClient")
    const shopId = deepLinkedShopId.current
    const match = name ? clients.find((client) => client.name === name) : shopId ? clients.find((client) => client.id === shopId) : undefined
    if (match) {
      setDetailClient(match)
      if (deepLinkedUpdate.current) openEditModalFor(match)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function applyMultiEdit(patch: MultiEditPatch) {
    setMultiEditOpen(false)
    if (Object.keys(patch).length === 0) return
    const results = await Promise.all(
      selectedClients.map(async (client) => {
        try {
          const response = await fetch(`/api/clients/${client.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...client, ...patch }),
          })
          return response.ok ? ((await response.json()) as Client) : null
        } catch {
          return null
        }
      }),
    )
    const updated = results.filter((client): client is Client => client !== null)
    setClients((current) => current.map((client) => updated.find((item) => item.id === client.id) ?? client))
    setNotice({ tone: updated.length === selectedClients.length ? "success" : "info", message: `${t("Изменено клиентов")}: ${updated.length}` })
  }

  function openAddModal() {
    setForm({ ...emptyClientForm })
    setFormError("")
    setEditingId(null)
    setModalMode("add")
  }

  function openEditModalFor(client: Client) {
    setForm(formFromClient(client))
    setFormError("")
    setEditingId(client.id)
    setModalMode("edit")
  }

  async function deleteClient(client: Client) {
    if (!(await askDelete(client.name))) return
    try {
      const response = await fetch(`/api/clients/${client.id}`, { method: "DELETE" })
      if (!response.ok) throw new Error("delete failed")
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

  function updateFormToggle(field: "autoDelivery" | "unlimitedDebt" | "isActive", value: boolean) {
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
    // phone and zone carry no asterisk in the dialog: a client without them is valid (the list shows "-" / "Не указано")
    if (!name || !type) {
      setFormError(t("Заполните название и тип клиента"))
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
      isActive: form.isActive,
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
                <div role="menu" className="absolute right-0 top-[-1px] z-30 w-[336px] overflow-hidden rounded-[8px] bg-white p-1 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                  {[t("Обновить класс магазина"), t("Обновить атрибуты магазина"), t("Обновить KPI план магазина")].map((label) => (
                    <button
                      key={label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionMenu(null)
                        setNotice({ tone: "info", message: `${label}: ${t("обновление запущено")}` })
                      }}
                      className="flex h-12 w-full items-center gap-[26px] px-[16px] text-left text-[13px] hover:bg-[#f2f5f8]"
                    >
                      <span className="relative top-[3px] flex h-[30px] w-[30px] items-center justify-center rounded-[5px] bg-[#71ce87]">
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
                pagingTouched.current = true
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
                  pagingTouched.current = true
                  childTouched.current = true
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
            {selectedClients.length === 0 ? (
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
              </>
            ) : (
              <span className="pl-[0px] text-[13px] font-semibold text-[#333]">{t("Выбрано")}: {selectedClients.length}</span>
            )}

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
                    <div className="absolute left-[5px] top-[2px] z-20 w-[96px] overflow-hidden rounded-[2px] bg-white py-2 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                      {pageSizes.map((size) => (
                        <button
                          type="button"
                          key={size}
                          onClick={() => {
                            pagingTouched.current = true
                            setPageSize(size)
                            setPage(1)
                            setPageSizeOpen(false)
                          }}
                          className={`block h-8 w-full pl-7 text-left text-[13px] hover:bg-[#f2f5f8] ${size === pageSize ? "text-[#5d6474]" : "text-[#333]"}`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Pagination */}
              <span className="whitespace-nowrap leading-[16.25px]">
                {rangeStart} - {rangeEnd}  {t("из")}  {total}
              </span>
              <button type="button" onClick={() => { pagingTouched.current = true; setPage((p) => Math.max(1, p - 1)) }} disabled={currentPage <= 1} aria-label={t("Предыдущая страница")} className="pl-[10px] pr-[5px]">
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${currentPage <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm1-12l-5 4 5 4V8z" /></svg>
              </button>
              <button type="button" onClick={() => { pagingTouched.current = true; setPage((p) => Math.min(totalPages, p + 1)) }} disabled={currentPage >= totalPages} aria-label={t("Следующая страница")}>
                <svg viewBox="0 0 24 24" className={`h-6 w-6 ${currentPage >= totalPages ? "fill-black/30" : "fill-black/55"}`}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zM11 8v8l5-4-5-4z" /></svg>
              </button>

              {selectedClients.length > 0 && <span aria-hidden className="w-[23px]" />}
              {selectedClients.length === 0 && (
                <div className="group/tip relative ml-[20px]">
                  <button
                    type="button"
                    onClick={() => setSelectMode((mode) => !mode)}
                    aria-label={t("Выбрать из списка")}
                    aria-pressed={selectMode}
                    className="flex h-12 w-12 items-center justify-center"
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={selectMode ? CI.eyeOff : CI.listCheck} /></svg>
                  </button>
                  <span className="pointer-events-none absolute right-[calc(100%+7px)] top-[7px] z-50 hidden whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[12px] font-bold leading-[17px] text-white opacity-90 group-hover/tip:block">
                    {t("Выбрать из списка")}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setColumnsOpen(true)}
                aria-label={t("Вкл/Выкл колонки")}
                title={t("Вкл/Выкл колонки")}
                className="ml-[10px] flex h-10 w-10 items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]"><path d={CI.align} /></svg>
              </button>

              <div className="ml-[10px] flex items-center gap-[18px]">
                <TopButton
                  icon={CI.edit}
                  label={t("Изменить")}
                  tip={selectedClients.length === 0 ? t("Выберите одного клиента") : undefined}
                  onClick={() => setMultiEditOpen(true)}
                />
                <TopButton
                  icon={CI.trend}
                  label={t("Уст. маршрут")}
                  green
                  tip={selectedClients.length === 0 ? t("Выделите заказы, которые хотите изменить!") : undefined}
                  onClick={assignRoute}
                />
              </div>

              <div className="relative ml-[18px]">
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
                    <div role="menu" className="absolute right-0 top-0 z-30 w-[224px] overflow-hidden rounded-[8px] bg-white p-1 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={selectedClients.length === 0}
                        onClick={() => {
                          setActionMenu(null)
                          setNotice({ tone: "success", message: `${t("Задача добавлена для")} ${selectedClients.length} ${t("клиент(ов)")}` })
                        }}
                        className="flex h-12 w-full items-center gap-[28px] px-[14px] text-left text-[13px] text-[#333] hover:bg-[#f2f5f8] disabled:text-black/30 disabled:hover:bg-transparent"
                      >
                        <span className="relative top-px flex h-[30px] w-[30px] items-center justify-center rounded-[5px] bg-[#71ce87]">
                          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d={CI.add} /></svg>
                        </span>
                        {t("Добавить задачу")}
                      </button>
                    </div>
                  </>
                )}
              </div>
              {selectedClients.length > 0 && (
                <button type="button" onClick={() => setSelected([])} aria-label={t("Снять выделение")} className="flex h-12 w-12 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-2 10H7v-2h10v2z" /></svg>
                </button>
              )}
            </div>
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
              <div className={`relative grid h-[50px] items-center bg-[#5d6474] pr-[30px] font-semibold text-white ${selectMode ? "pl-[50px]" : "pl-[30px]"}`} style={{ gridTemplateColumns: gridTemplate(columns, "head") }}>
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
                        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white"><path d={allSelected ? CI.doneAll : CI.selectAll} /></svg>
                      </button>
                    )}
                    {SORT_KEYS[head] ? (
                      <button type="button" onClick={() => toggleSort(SORT_KEYS[head])} className="text-left font-semibold hover:opacity-80">
                        {t(head)}
                        {sort.find((item) => item.key === SORT_KEYS[head]) ? <span className="ml-1 text-[10px]">{sort.find((item) => item.key === SORT_KEYS[head])?.desc ? "▼" : "▲"}</span> : null}
                      </button>
                    ) : (
                      <span className="text-left font-semibold">{t(head)}</span>
                    )}
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

      {multiEditOpen && <MultiEditDialog clients={clients} onSave={(patch) => void applyMultiEdit(patch)} onClose={() => setMultiEditOpen(false)} />}

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
          zoneOptions={zoneOptions}
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
  listCheck: "M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19.5-4.5L23 13l-6.99 7-4.51-4.5L13 14l3.01 3 5.49-5.5z",
  align: "M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z",
  doneAll: "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z",
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
  tip,
}: {
  icon: string
  label: string
  onClick: () => void
  disabled?: boolean
  green?: boolean
  spin?: boolean
  tip?: string
}) {
  const button = (
    <button
      type="button"
      onClick={tip ? undefined : onClick}
      disabled={disabled}
      className={`flex h-[30px] items-center rounded-[5px] pl-3 text-[13px] font-semibold text-white hover:brightness-95 disabled:cursor-wait disabled:opacity-60 ${green ? "bg-[#71ce87]" : "bg-[#4f71dc]"}`}
    >
      <svg viewBox="0 0 24 24" className={`mb-1 h-[18px] w-[18px] fill-white ${spin ? "animate-spin" : ""}`}><path d={icon} /></svg>
      <span className="pl-2 pr-4 whitespace-nowrap">{label}</span>
    </button>
  )
  if (!tip) return button
  return (
    <div className="group/tip relative">
      {button}
      <span className="pointer-events-none absolute right-[calc(100%+11px)] top-[-2px] z-50 hidden whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] leading-[17px] text-white opacity-90 group-hover/tip:block">
        {tip}
      </span>
    </div>
  )
}

type OptionItem = { name: string }

function ClientModal({
  mode,
  form,
  error,
  saving,
  zoneOptions,
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
  zoneOptions: string[]
  clients: Client[]
  onTextChange: (field: ClientTextField, value: string) => void
  onPhoneChange: (index: number, value: string) => void
  onPhoneAdd: () => void
  onPhoneRemove: (index: number) => void
  onToggleChange: (field: "autoDelivery" | "unlimitedDebt" | "isActive", value: boolean) => void
  onAttributeChange: (name: string, value: string) => void
  onLocationChange: (lat: number | null, lng: number | null) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const { t } = useLanguage()
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  const [typeOptions, setTypeOptions] = useState<string[]>([])
  const [attributeDefs, setAttributeDefs] = useState<{ name: string; fieldType: string; options: string[] }[]>([])
  const [linkoOptions, setLinkoOptions] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/linko-markets")
      .then((response) => (response.ok ? response.json() : []))
      .then((items: { name: string }[]) => !cancelled && setLinkoOptions(items.map((item) => item.name)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  const linkoRows: string[] = (() => {
    try {
      const parsed = JSON.parse(form.attributes[LINKO_MARKETS_KEY] ?? "[]")
      return Array.isArray(parsed) && parsed.length ? parsed.map(String) : [""]
    } catch {
      return [""]
    }
  })()
  const setLinkoRows = (rows: string[]) => onAttributeChange(LINKO_MARKETS_KEY, rows.length === 1 && rows[0] === "" ? "" : JSON.stringify(rows))
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)
  const [canSeePrice, setCanSeePrice] = useState(false)
  const [confirmToOrder, setConfirmToOrder] = useState(false)
  const [changeFinance, setChangeFinance] = useState(false)
  const distinct = (pick: (client: Client) => string | undefined) =>
    [...new Set(allClients.map(pick).filter((value): value is string => Boolean(value) && value !== "Не указано"))].sort((a, b) => a.localeCompare(b, "ru"))
  const channelOptions = distinct((client) => client.salesChannel)
  const delivererOptions = distinct((client) => client.deliverer)
  const collectorOptions = distinct((client) => client.collector)
  const agentOptions = distinct((client) => client.agent)

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      const [branchesRes, typesRes, attributesRes, valuesRes] = await Promise.all([
        fetch("/api/branches?sort=created").catch(() => null),
        fetch("/api/client-types").catch(() => null),
        fetch("/api/client-attributes").catch(() => null),
        fetch("/api/client-attribute-values").catch(() => null),
      ])
      if (cancelled) return
      if (branchesRes?.ok) setBranchOptions([...new Set(((await branchesRes.json()) as OptionItem[]).map((item) => item.name))])
      if (typesRes?.ok) setTypeOptions([...new Set(((await typesRes.json()) as OptionItem[]).map((item) => item.name))])
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

  return (
    <div
      className="fixed inset-0 z-[80] overflow-y-auto bg-black/[0.54]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-modal-title"
        className="relative mx-auto mt-16 w-[80%] max-w-full bg-white font-sans text-[13px] text-[#333]"
      >
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[22px]">
          <b id="client-modal-title" className="text-[13px] font-bold uppercase">
            {mode === "add" ? t("Добавление клиента") : t("Изменение клиента")}
          </b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </header>

        <div className="grid lg:grid-cols-2">
          {/* Left column */}
          <div className="border-[#efefef] px-[30px] py-5 lg:border-r">
            <FormSection title={t("Общая информация")}>
              <FieldInput label={t("Наименование")} required value={form.name} onChange={(value) => onTextChange("name", value)} />
              <FieldSelect label={t("Филиал")} required value={form.branch} onChange={(value) => onTextChange("branch", value)} options={branchSelectOptions} />
              <FieldSelect label={t("Канал продаж")} value={form.salesChannel} onChange={(value) => onTextChange("salesChannel", value)} options={withCurrent(channelOptions, form.salesChannel)} />
              <FieldSelect label={t("Тип клиента")} required value={form.type} onChange={(value) => onTextChange("type", value)} options={typeSelectOptions} />
              {form.type && (
                <div className="-mt-[9px]">
                  <FieldSelect label={t("Подкатегория")} value="" onChange={() => {}} options={[]} />
                </div>
              )}
              <FieldSelect label={t("Зона")} value={form.zone} onChange={(value) => onTextChange("zone", value)} options={withCurrent(zoneOptions.filter((zone) => zone && zone !== "Не указано"), form.zone)} />
              <FieldSelect label={t("Реализация по")} value={form.realizationBy} onChange={(value) => onTextChange("realizationBy", value)} options={["FIFO", "LIFO"]} />
            </FormSection>

            <FormSection title={t("Ответственные лица")}>
              <FieldSelect label={t("Ответственный доставщик")} value={form.deliverer} onChange={(value) => onTextChange("deliverer", value)} options={withCurrent(delivererOptions, form.deliverer)} />
              <FieldSelect label={t("Ответственный инкассатор")} value={form.collector} onChange={(value) => onTextChange("collector", value)} options={withCurrent(collectorOptions, form.collector)} />
              <FieldSelect label={t("Ответственный агент")} value={form.agent} onChange={(value) => onTextChange("agent", value)} options={withCurrent(agentOptions, form.agent)} />
            </FormSection>

            <FormSection title={t("Юридическая информация")}>
              {attributeDefs.map((attribute, attributeIndex) =>
                attribute.fieldType === "Выбор вариантов" ? (
                  <FieldSelect
                    key={`${attribute.name}-${attributeIndex}`}
                    label={attribute.name}
                    value={form.attributes[attribute.name] ?? ""}
                    onChange={(value) => onAttributeChange(attribute.name, value)}
                    options={attribute.options}
                  />
                ) : (
                  <FieldInput
                    key={`${attribute.name}-${attributeIndex}`}
                    label={attribute.name}
                    type={attribute.fieldType === "Цифровое поле" ? "number" : "text"}
                    value={form.attributes[attribute.name] ?? ""}
                    onChange={(value) => onAttributeChange(attribute.name, value)}
                  />
                ),
              )}
              {linkoRows.map((value, index) => (
                <div key={index} className="relative pb-[9px]">
                  <div className="w-[499px]">
                    <FieldSelect
                      label={t("Linko магазин")}
                      value={value}
                      onChange={(next) => setLinkoRows(linkoRows.map((row, rowIndex) => (rowIndex === index ? next : row)))}
                      options={linkoOptions}
                    />
                  </div>
                  <RowAddRemove
                    isLast={index === linkoRows.length - 1}
                    onAdd={() => setLinkoRows([...linkoRows, ""])}
                    onRemove={() => setLinkoRows(linkoRows.filter((_, rowIndex) => rowIndex !== index))}
                    removeLabel={t("Удалить")}
                    className="left-[499px] top-[0px]"
                  />
                </div>
              ))}
            </FormSection>
          </div>

          {/* Right column */}
          <div className="px-[30px] py-5">
            <FormSection title={t("Адрес и местоположение")}>
              <FieldInput label={t("Адрес")} required value={form.address} onChange={(value) => onTextChange("address", value)} />
              <FieldInput label={t("Ориентир")} required value={form.landmark} onChange={(value) => onTextChange("landmark", value)} />

              <div className="mt-[5px] flex h-6 items-center justify-between">
                <button type="button" onClick={() => setLocationPickerOpen(true)} className="inline-flex items-center text-[13px] text-[#129fdd]">
                  <svg viewBox="-255.4 385.6 24 23.5" className="h-6 w-4 fill-[#129fdd]" aria-hidden>
                    <path d="M-243.3,395.8c1.5,0,2.7-1.2,2.7-2.7c0-1.5-1.2-2.7-2.7-2.7c-1.5,0-2.7,1.2-2.7,2.7C-246,394.6-244.8,395.8-243.3,395.8z M-243.3,391.1c1.1,0,2,0.9,2,2c0,1.1-0.9,2-2,2s-2-0.9-2-2C-245.2,392-244.4,391.1-243.3,391.1z" />
                    <path d="M-235.7,400.2h-2.8l1.2-1.7c2.3-3,1.9-8-0.7-10.6c-1.4-1.4-3.3-2.2-5.3-2.2c-2,0-3.9,0.8-5.3,2.2c-2.6,2.6-3,7.6-0.7,10.6 l1.2,1.7h-2.9l-4.3,9h24L-235.7,400.2z M-248.7,398c-2-2.7-1.7-7.2,0.6-9.6c1.3-1.3,3-2,4.8-2s3.5,0.7,4.8,2 c2.4,2.4,2.7,6.8,0.6,9.6l-5.4,7.8l-3.9-5.6l0,0L-248.7,398z M-250.6,400.9h3l4.3,6.2l4.3-6.2h2.9l3.6,7.5h-21.5L-250.6,400.9z" />
                  </svg>
                  <span className="ml-[5px] hover:underline">
                    {form.locationLat != null && form.locationLng != null ? `${form.locationLat} ${form.locationLng}` : t("отметить местоположение на карте")}
                  </span>
                </button>
                {form.locationLat != null && form.locationLng != null && (
                  <button type="button" onClick={() => setLocationPickerOpen(true)} className="text-[13px] text-[#129fdd] hover:underline">
                    {t("Изменить")}
                  </button>
                )}
              </div>

              <FieldInput
                label={t("Ссылка локации из телеграм")}
                value={form.telegramLocationLink}
                onChange={(value) => onTextChange("telegramLocationLink", value)}
                info
                tall
              />
            </FormSection>

            <FormSection title={t("Контактные данные")}>
              <FieldInput label={t("Код")} value={form.code} onChange={(value) => onTextChange("code", value)} />

              {form.phones.map((phone, index) => (
                <div key={index} className="relative w-[266px]">
                  <FieldInput label={t("Номер телефона")} type="tel" value={phone} onChange={(value) => onPhoneChange(index, value)} narrow />
                  <RowAddRemove isLast={index === form.phones.length - 1} onAdd={onPhoneAdd} onRemove={() => onPhoneRemove(index)} removeLabel={t("Удалить номер")} className="left-[266px] top-[6px]" />
                </div>
              ))}

              <FieldInput label={t("Контактное лицо")} required value={form.contactPerson} onChange={(value) => onTextChange("contactPerson", value)} />
              <FieldInput label={t("Заметка")} value={form.note} onChange={(value) => onTextChange("note", value)} />
            </FormSection>

            <FormSection title={t("Настройки клиента")}>
              <CheckRow label={t("Автоматическая доставка")} checked={form.autoDelivery} onChange={(value) => onToggleChange("autoDelivery", value)} />
              <CheckRow label={t("Неограниченный долг")} checked={form.unlimitedDebt} onChange={(value) => onToggleChange("unlimitedDebt", value)} />
              <CheckRow label={t("Может увидеть цену")} checked={canSeePrice} onChange={setCanSeePrice} />
              <CheckRow label={t("Подтвердить клиента чтобы взять заказы")} checked={confirmToOrder} onChange={setConfirmToOrder} />
              <CheckRow label={t("Изменить финансовые настройки")} checked={changeFinance} onChange={setChangeFinance} />
              <div className="mt-[9px] flex items-center justify-between">
                <span>{t("Статус объекта:")}</span>
                <div className="w-[270px]">
                  <FieldSelect label={t("Выберите")} value={form.isActive ? "active" : "inactive"} onChange={(value) => onToggleChange("isActive", value === "active")} options={["active", "inactive"]} optionLabels={{ active: t("Активен"), inactive: t("Неактивен") }} />
                </div>
              </div>
            </FormSection>
          </div>
        </div>

        {error && (
          <p role="alert" className="mx-[30px] mb-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </p>
        )}

        <footer className="flex h-[57px] items-center justify-end border-t border-[#efefef] pr-[10px]">
          <button type="submit" disabled={saving} className="h-9 px-4 text-[13px] font-semibold uppercase text-[#0a9ddb] disabled:opacity-60">
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </footer>
      </form>

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

/** One block of the client form: blue title, fields, and the reference's dotted rule underneath. */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="relative mb-5 pb-5 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']">
      <h3 className="mb-[10px] text-[16px] font-semibold leading-5 text-[#4f71dc]">{title}</h3>
      {children}
    </section>
  )
}

const FLOAT_LABEL = "pointer-events-none absolute left-0 flex origin-top-left items-center gap-1 text-[13px] font-semibold leading-[18px] text-black transition-transform duration-150"

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
  info = false,
  tall = false,
  narrow = false,
  listId,
  listOptions,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "tel" | "number"
  required?: boolean
  autoFocus?: boolean
  /** Shows the reference's "i" icon to the right of the field. */
  info?: boolean
  /** The reference's taller multi-line variant (13px extra above the text). */
  tall?: boolean
  /** The phone variant, 10px narrower than the column so the +/− button fits beside it. */
  narrow?: boolean
  listId?: string
  listOptions?: string[]
}) {
  const [focused, setFocused] = useState(false)
  const filled = focused || value !== ""
  const lift = tall ? 28 : 13
  return (
    <div className={`relative pt-[7px] ${info ? "w-[calc(100%-24px)]" : narrow ? "w-[256px]" : ""}`}>
      <label className={`relative block ${tall ? "h-[60px]" : "h-[45px]"}`}>
        <span
          className={FLOAT_LABEL}
          style={{ top: lift, transform: filled ? `translateY(-${lift + 6}px) scale(0.75)` : undefined }}
        >
          {label}
          {required && <span className="text-[#e57373]">*</span>}
        </span>
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
          className="peer absolute inset-0 w-full bg-transparent text-[13px] font-semibold leading-[22px] text-black outline-none"
          style={{ paddingTop: lift - 1, paddingBottom: (tall ? 60 : 45) - (lift - 1) - 22 }}
        />
        <span className={`pointer-events-none absolute inset-x-0 ${tall ? "bottom-[11px]" : "bottom-[9px]"} border-b border-[#e0e0e0] peer-focus:border-[#5d6474]`} />
        {listId && listOptions && (
          <datalist id={listId}>
            {listOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        )}
      </label>
      {info && (
        <svg viewBox="0 0 24 24" className="absolute -right-6 top-[19px] h-6 w-6 fill-[#666]" aria-hidden>
          <path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z" />
        </svg>
      )}
    </div>
  )
}

/** The reference's searchable react-select: floating label, grey caret, ×, and a 200px option list. */
const LINKO_MARKETS_KEY = "__linko_markets"

/** "+ Добавить еще" on the last repeatable row, "−" on the others (phone numbers, Linko магазин). */
function RowAddRemove({
  isLast,
  onAdd,
  onRemove,
  removeLabel,
  className,
}: {
  isLast: boolean
  onAdd: () => void
  onRemove: () => void
  removeLabel: string
  className: string
}) {
  const { t } = useLanguage()
  if (!isLast) {
    return (
      <button type="button" aria-label={removeLabel} onClick={onRemove} className={`absolute flex h-10 w-10 items-start justify-center text-[#666] ${className}`}>
        <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current"><path d="M7 11v2h10v-2H7zm5-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg>
      </button>
    )
  }
  return (
    <span className={`group/tip absolute ${className}`}>
      <button type="button" aria-label={t("Добавить еще")} onClick={onAdd} className="flex h-10 w-10 items-start justify-center text-[#666]">
        <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current"><path d="M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7zm-1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg>
      </button>
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+10px)] z-50 hidden -translate-x-1/2 whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] leading-[17px] text-white opacity-90 group-hover/tip:block">
        {t("Добавить еще")}
      </span>
    </span>
  )
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  optionLabels,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  optionLabels?: Record<string, string>
  required?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [focusIndex, setFocusIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const labelOf = (option: string) => optionLabels?.[option] ?? option
  const shown = query ? options.filter((option) => labelOf(option).toLowerCase().includes(query.toLowerCase())) : options

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const pick = (option: string) => {
    onChange(option)
    setOpen(false)
    setQuery("")
  }

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      setFocusIndex((current) => (shown.length ? (current + step + shown.length) % shown.length : 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (shown[focusIndex] !== undefined) pick(shown[focusIndex])
    }
  }

  return (
    <div ref={rootRef} className="relative mb-2 mt-[5px] h-[54px]" onKeyDown={(event) => event.key === "Escape" && (setOpen(false), setQuery(""))}>
      <span className={FLOAT_LABEL} style={{ top: 29, transform: value !== "" || open ? "translateY(-24px) scale(0.75)" : undefined }}>
        {label}
        {required && <span className="text-[#e57373]">*</span>}
      </span>
      <div
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        tabIndex={0}
        onClick={() => {
          setFocusIndex(Math.max(0, options.indexOf(value)))
          setOpen((current) => !current)
        }}
        onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && event.target === event.currentTarget && (event.preventDefault(), setOpen((current) => !current))}
        className="absolute inset-x-0 bottom-0 h-9 cursor-pointer border-b border-[#e8e8e8] outline-none focus:border-[#5d6474]"
      >
        {open ? (
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setFocusIndex(0)
            }}
            onKeyDown={onSearchKeyDown}
            onClick={(event) => event.stopPropagation()}
            className="absolute left-0 right-[40px] top-[12px] h-[23px] bg-transparent text-[13px] font-semibold text-black outline-none"
          />
        ) : (
          value !== "" && <span className="absolute left-0 right-[40px] top-[11px] truncate text-[13px] font-semibold leading-[22px] text-black">{labelOf(value)}</span>
        )}
        {value !== "" && (
          <span
            role="button"
            aria-label="clear"
            onClick={(event) => {
              event.stopPropagation()
              onChange("")
            }}
            className="absolute right-[25px] top-0 h-[35px] w-[17px] pt-[14px] text-center text-[18px] font-normal leading-[18px] text-[#999] hover:text-[#666]"
          >
            ×
          </span>
        )}
        <span
          aria-hidden
          className={`absolute right-[10px] top-[21.4px] h-[7px] w-[10px] border-x-[5px] border-b-[2px] border-t-[5px] border-x-transparent border-b-transparent border-t-[#999] ${open ? "origin-[50%_35%] rotate-180" : ""}`}
        />
      </div>
      {required && <input tabIndex={-1} aria-hidden required value={value} onChange={() => {}} className="pointer-events-none absolute bottom-0 left-0 h-px w-full opacity-0" />}
      {open && (
        <ul id={listId} className="absolute inset-x-0 top-[53px] z-30 max-h-[200px] overflow-y-auto rounded-b-[4px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
          {shown.length === 0 && <li className="px-[10px] py-[8px] text-[13px] font-semibold leading-[16.25px] text-black/30">{t("Не найдено")}</li>}
          {shown.map((option, index) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => pick(option)}
                onMouseEnter={() => setFocusIndex(index)}
                className={`block w-full px-[10px] py-[8px] text-left text-[13px] font-semibold leading-[16.25px] ${index === focusIndex || option === value ? "bg-[#e6f2ff] text-[#333]" : "text-[#666]"}`}
              >
                {labelOf(option)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="my-[10px] flex h-5 cursor-pointer items-center gap-[6px] text-[13px] font-semibold leading-5 text-black">
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
const SHORT_MONTHS = ["Янв.", "Февр.", "Март", "Апр.", "Май", "Июнь", "Июль", "Авг.", "Сент.", "Окт.", "Нояб.", "Дек."]
const LOG_FILTERS = ["Все", "Заказ", "Возврат", "Финансы", "Клиент"]

type DetailTask = { text: string; at?: string; link?: boolean; done: boolean; by?: string; time?: number }

const MONTHS_NOMINATIVE = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
function createdDateText(raw: string | undefined): string {
  const date = raw ? new Date(raw.replace(" ", "T")) : null
  return date && !Number.isNaN(date.getTime()) ? `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()}` : "-"
}
const MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

type DetailOrder = { id: number; client: string; created: string; createdAt: string; status: string; amount?: string }

/**
 * The reference's task feed for a client: every order the client placed shows up as an unscheduled
 * visit + «Оформили заказ» (+ «Доставили заказ» once delivered). Built from the real orders.
 */
function tasksFromOrders(orders: DetailOrder[]): DetailTask[] {
  return [...orders]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .flatMap((order) => {
      const [datePart, timePart = "00:00:00"] = order.createdAt.split(/[ T]/)
      const [, month, day] = datePart.split("-").map(Number)
      const [hours, minutes] = timePart.split(":").map(Number)
      const monthName = MONTHS_NOMINATIVE[month - 1]
      const time = new Date(order.createdAt.replace(" ", "T")).getTime()
      return [
        ...(order.status === "Доставлено" ? [{ text: `Доставили заказ №${order.id} в ${hours}:${minutes}`, at: order.created, done: true, time }] : []),
        { text: `Оформили заказ №${order.id}`, at: order.created, link: true, done: true, time },
        { text: `Внеплановый визит ${day} ${monthName} в ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`, at: order.created, done: true, time },
      ]
    })
}

type FieldVisit = { agent: string; startedAt: string; durationSec: number; result: string; refusal: string; planned: boolean }
type FieldTask = { responsible: string; store: string; description: string; date: string; status: string }

/** Visits without an order and the client's planned tasks join the order feed, newest first. */
function mergeFieldTasks(base: DetailTask[], visits: FieldVisit[], planned: FieldTask[]): DetailTask[] {
  const fromVisits = visits.map((visit): DetailTask => {
    const date = new Date(visit.startedAt.replace(" ", "T"))
    const when = `${date.getDate()} ${MONTHS_NOMINATIVE[date.getMonth()]} в ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    const label = visit.planned ? "Плановый визит" : "Внеплановый визит"
    return {
      text: visit.result === "refusal" ? `${label} ${when}. Отказ: ${visit.refusal}` : `${label} ${when}`,
      at: `${String(date.getDate()).padStart(2, "0")} ${SHORT_MONTHS[date.getMonth()].toLowerCase()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
      done: true,
      by: visit.agent,
      time: date.getTime(),
    }
  })
  const fromTasks = planned.map((task): DetailTask => {
    const date = new Date(`${task.date}T09:00:00`)
    return {
      text: `${task.description}`.trim() || "Следует посетить клиента",
      at: `${String(date.getDate()).padStart(2, "0")} ${SHORT_MONTHS[date.getMonth()].toLowerCase()} ${date.getFullYear()}`,
      done: task.status !== "in_progress",
      by: task.responsible,
      time: date.getTime(),
    }
  })
  return [...base, ...fromVisits, ...fromTasks].sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
}

function formatDetailDate(date: Date) {
  return `${date.getDate()} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export function ClientDetail({
  client,
  onClose,
  onEdit,
  onDelete,
  variant,
}: {
  client: Client
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  /** "activity": the card as the reference opens it from «Активность» (no delete icon, no «Позвонить», balance tiles only with a balance). */
  variant?: "activity"
}) {
  const { t } = useLanguage()
  const fromActivity = variant === "activity"
  const [tab, setTab] = useState<(typeof DETAIL_TABS)[number]>("АКТИВНОСТЬ")
  const [subTab, setSubTab] = useState<(typeof CLIENT_SUBTABS)[number]>("ДЕТАЛИ")
  const [logFilter, setLogFilter] = useState("Все")
  const [clientOrders, setClientOrders] = useState<DetailOrder[]>([])
  const [fieldVisits, setFieldVisits] = useState<FieldVisit[]>([])
  const [fieldTasks, setFieldTasks] = useState<FieldTask[]>([])
  const [clientPayments, setClientPayments] = useState<{ client: string; paidAt: string; amount: number; currency: string }[]>([])
  useEffect(() => {
    if (!(tab === "АКТИВНОСТЬ" || (tab === "КЛИЕНТ" && subTab === "ЛОГИ"))) return
    let cancelled = false
    fetch("/api/customer-payments")
      .then((response) => (response.ok ? response.json() : []))
      .then((payments: { client: string; paidAt: string; amount: number; currency: string }[]) => {
        if (!cancelled && Array.isArray(payments)) setClientPayments(payments.filter((payment) => payment.client === client.name))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tab, subTab, client.name])
  useEffect(() => {
    if (tab !== "ЗАДАЧИ" && !(tab === "КЛИЕНТ" && subTab === "ЛОГИ")) return
    let cancelled = false
    fetch("/api/orders")
      .then((response) => (response.ok ? (response.json() as Promise<DetailOrder[]>) : []))
      .then((orders) => {
        if (!cancelled) setClientOrders(orders.filter((order) => order.client === client.name))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tab, subTab, client.name])
  useEffect(() => {
    if (tab !== "ЗАДАЧИ") return
    let cancelled = false
    fetch(`/api/agent-visits?view=client&client=${encodeURIComponent(client.name)}`)
      .then((response) => (response.ok ? (response.json() as Promise<FieldVisit[]>) : []))
      .then((visits) => {
        if (!cancelled && Array.isArray(visits)) setFieldVisits(visits)
      })
      .catch(() => {})
    fetch("/api/tasks?all=1")
      .then((response) => (response.ok ? (response.json() as Promise<FieldTask[]>) : []))
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setFieldTasks(list.filter((task) => task.store === client.name))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tab, client.name])
  const tasks = useMemo(() => mergeFieldTasks(tasksFromOrders(clientOrders), fieldVisits, fieldTasks), [clientOrders, fieldVisits, fieldTasks])
  // What the app records for a client: its creation and every order it placed (cancelled orders show as «Удаленный»).
  const logs = useMemo(() => {
    const format = (raw: string) => {
      const date = new Date(raw.replace(" ", "T"))
      if (Number.isNaN(date.getTime())) return null
      return {
        time: date.getTime(),
        text: `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
      }
    }
    const entries: { time: number; type: string; status: string; at: string; sum: string }[] = []
    const created = client.createdAt ? format(client.createdAt) : null
    if (created) entries.push({ time: created.time, type: "Клиент", status: "Создан", at: created.text, sum: "0" })
    for (const order of clientOrders) {
      const placed = format(order.createdAt)
      if (!placed) continue
      entries.push({ time: placed.time, type: "Заказ", status: order.status === "Отменен" ? "Удаленный" : "Создан", at: placed.text, sum: order.amount ?? "0" })
    }
    // Payments carry no status pill in the reference («Не установлен» as plain text).
    for (const payment of clientPayments) {
      const paid = format(payment.paidAt)
      if (!paid) continue
      entries.push({ time: paid.time, type: "Оплата", status: "Не установлен", at: paid.text, sum: `${payment.amount.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${payment.currency}` })
    }
    return entries.sort((a, b) => b.time - a.time)
  }, [client.createdAt, clientOrders, clientPayments])
  const [orderOpen, setOrderOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [paymentDone, setPaymentDone] = useState(false)
  const primaryPhone = client.phone.split(",")[0]?.trim() ?? ""
  const hasPhone = primaryPhone !== "" && primaryPhone !== "-"
  const balance = client.balance ?? 0
  const balanceText = formatBalance(balance)
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd)
  periodStart.setDate(periodStart.getDate() - 30)
  const hasLocation = client.locationLat !== undefined && client.locationLng !== undefined

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
            <svg viewBox="0 0 24 24" className={`h-6 w-6 ${fromActivity && client.isActive === false ? "fill-[#e57373]" : "fill-[#92ce95]"}`}>
              <circle cx="12" cy="12" r="8" />
            </svg>
            <span>{client.name}</span>
          </div>
          <div className="-mr-[10px] flex items-center">
            <button type="button" aria-label={t("Изменить")} onClick={onEdit} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
              </svg>
            </button>
            {!fromActivity && <button type="button" aria-label={t("Удалить")} onClick={onDelete} className="flex h-12 w-12 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
              </svg>
            </button>}
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
                left={{ label: t("Фактические продажи (30 дней)"), value: "0 SUM" }}
                right={{ label: t("Прошло дней с последнего заказа"), value: DAYS_SINCE_ANCHOR, red: true }}
                bordered
              />
              <DetailMetricRow
                left={{ label: t("Сумма продаж за период (30 дней)"), value: "0 SUM" }}
                right={{ label: t("Прошло дней с последнего визита"), value: DAYS_SINCE_ANCHOR, red: true }}
                bordered
              />
              <DetailMetricRow
                left={{ label: t("Сумма возврата с заказов за период (30 дней)"), value: "0 SUM" }}
                right={{ label: t("Комментарий отказа"), value: t("Не указан") }}
              />
            </div>

            <div className="mt-5 flex gap-[10px]">
              {!fromActivity && <button
                type="button"
                disabled={!hasPhone}
                onClick={() => hasPhone && (window.location.href = `tel:${primaryPhone}`)}
                className={`${actionButton} bg-[#71ce87]`}
              >
                <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white">
                  <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
                </svg>
                <span className="pl-2 pr-4">{t("Позвонить")}</span>
              </button>}
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
              <button type="button" onClick={() => setPaymentOpen(true)} className={`${actionButton} bg-[#71ce87]`}>
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
                  <button type="submit" className="w-full rounded-md bg-[#71ce87] py-3 font-semibold text-white">
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

            <div className="pt-[19px]">
              <DetailSectionTitle>{t("Агенты магазина")}</DetailSectionTitle>
              <div className="-mx-2 mr-[12px] flex items-center border-b border-dotted border-[#ccc] pb-[18px] pt-[19px]">
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
                <div className="-mx-2 mr-[12px] flex items-center border-b border-dotted border-[#ccc] py-[17px]">
                  <div className="w-[134px] shrink-0 px-2">{t("Агент")}</div>
                  <div className="w-[178.7px] shrink-0 px-2">{t("Частота посещения")}</div>
                  <div className="flex-1 px-2">{t("Дни недели")}</div>
                  <div className="flex w-[44.7px] shrink-0 justify-center px-2">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                    </svg>
                  </div>
                </div>
                {/* only a client that really has a route is listed: the agent of the client (the visit days are not stored per client) */}
                {fromActivity && !(client.inRoute && client.agent && client.agent !== "Не указано") && (
                  <div className="relative h-[118px]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/robot-empty.png" alt="" className="absolute left-1/2 top-[10px] h-[103px] w-[100px] -translate-x-1/2 object-contain" />
                    <div className="absolute inset-x-0 top-[101px] text-center text-[13px] leading-[16.25px] text-[#666]">{t("Маршрут отсутствует")}</div>
                  </div>
                )}
                {client.inRoute && client.agent && client.agent !== "Не указано" && (
                  <div className="-mx-2 mr-[12px] flex items-center border-b border-dotted border-[#ccc] py-[17px]">
                    <div className="w-[134px] shrink-0 px-2">{client.agent}</div>
                    <div className="w-[178.7px] shrink-0 px-2">-</div>
                    <div className="flex-1 px-2" />
                  </div>
                )}
              </div>

              <div className={fromActivity ? "mt-[21px] pb-[15px]" : "mt-[21px]"}>
                <div className="mb-[22px] flex h-[35px] items-center justify-between">
                  <span className="text-base font-bold leading-[35px]">{t("Баланс")}</span>
                  <span className="mr-[15px] w-[200px] text-right text-[13px] font-bold text-[#4f71dc]">
                    {formatDetailDate(periodStart)} - {formatDetailDate(periodEnd)}
                  </span>
                </div>
                <div className={`grid grid-cols-2 gap-[15.5px] ${fromActivity && balance === 0 ? "hidden" : ""}`}>
                  {[t("Баланс на начало периода"), t("Баланс на конец периода")].map((label) => (
                    <div key={label} className="rounded-[10px] bg-[#f3f3f3] p-[10px]">
                      <div className="ml-[9px]">
                        <div className="pb-1 text-[#8c8c8c]">{label}</div>
                        <span className={`font-semibold ${balance < 0 ? "text-[#e57373]" : "text-[#48a34b]"}`}>{balanceText}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {clientPayments.length > 0 && (
                  <div className="mt-[15px]">
                    {t("Последняя дата платежа")}:
                    <span className="ml-[9px] font-semibold">{fromActivity ? shortRuDate(clientPayments[0].paidAt.split(",")[0]) : clientPayments[0].paidAt.split(",")[0]}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "ЗАДАЧИ" && (
          <div className="p-5">
            <button type="button" className="mb-5 h-[34px] w-full rounded-[5px] bg-[#4f71dc] text-[13px] font-semibold text-white">
              {t("Создать задачу")}
            </button>
            <div className="relative pt-[10px]">
              <span className="absolute bottom-0 left-[8px] top-0 w-[3px] bg-[#22a6c6]" />
              {tasks.map((task, index) => (
                <div key={index} className="relative mb-[10px] pl-[41px]">
                  <span className="absolute left-0 top-[15px] h-4 w-4 rounded-full bg-[#22a6c6]" />
                  <div className="relative mr-[10px] rounded-[2px] bg-white px-5 py-[15px] text-[#666] shadow-[0_1px_6px_rgba(0,0,0,0.25)]">
                    <span className="absolute -left-[9px] top-[13px] h-0 w-0 border-y-[9px] border-r-[9px] border-y-transparent border-r-white" />
                    <div className="flex justify-between">
                      <h2 className="mb-[10px] text-base font-bold leading-[16px]">{task.by ?? "Admin Ritm"}</h2>
                      {task.at && <p className="mb-[10px]">{task.at}</p>}
                    </div>
                    <div className={`flex items-center gap-[10px] font-semibold ${task.done ? "h-[25px]" : "h-[23px]"}`}>
                      <svg viewBox="0 0 24 24" className={`h-5 w-5 ${task.done ? "fill-[#92ce95]" : "fill-[#f0ad4e]"}`}>
                        {task.done ? (
                          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                        ) : (
                          <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
                        )}
                      </svg>
                      <span>
                        {t(task.text)}
                        {task.link && (
                          <>
                            {" ("}
                            <a className="cursor-pointer text-[#129fdd]">{t("Просмотреть")}</a>
                            {")"}
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "КЛИЕНТ" && (
          <div className="px-[30px] pt-[15px] pb-6">
            <div className="flex h-[300px] flex-col items-center justify-center border border-dashed border-[#c5ced6] bg-[#f0f4f8] text-center text-[#999]">
              <span className="max-w-[90px] text-[11px]">{t("Фото отсутствует")}</span>
              <span className="my-[8.85px] block h-px w-16 bg-[#bbb]" />
              <button type="button" className="text-[11px] leading-[15px] text-[#129fdd]">
                {t("добавить фото")}
              </button>
            </div>
            <div className="flex">
              {CLIENT_SUBTABS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSubTab(item)}
                  className={`flex h-12 w-1/4 items-center justify-center whitespace-nowrap border-b-2 text-[13px] font-medium uppercase text-black ${subTab === item ? "border-[#4f71dc]" : "border-transparent"}`}
                >
                  {t(item)}
                </button>
              ))}
            </div>

            {subTab === "ДЕТАЛИ" && (
              <div>
                <DetailListTitle>{t("Детали")}</DetailListTitle>
                <DetailListRow label={t("Прайс лист:")} value={t("Не указано")} bold />
                <DetailListRow label={t("Тел. номер:")} value={/^\d{9}$/.test(client.phone) ? `+998${client.phone}` : client.phone || "-"} bold />
                <DetailListRow label={t("Финансовый счет:")} value={client.name} />
                <DetailListRow label={t("Класс клиента:")} value="-" />
                <DetailListRow label={t("Ответственный агент:")} value={client.agent} />
                <DetailListRow label={t("Тип заведения:")} value={client.type} />
                <DetailListRow label={t("Частота посещений:")} value="" />
                <DetailListRow label={t("Создал:")} value="Admin Ritm" />
                <DetailListRow label={t("Дата:")} value={createdDateText(client.createdAt)} />
                <DetailListRow label={t("Зона:")} value={client.zone} />
                <DetailListRow
                  label={t("Локация:")}
                  value={
                    hasLocation ? (
                      <>
                        {client.locationLat!.toFixed(6)}, {client.locationLng!.toFixed(6)}
                        <a
                          className="-mt-[8px] ml-auto block w-fit cursor-pointer text-[12px] text-[#4f71dc]"
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

                <DetailListTitle className="mt-[18px]">{t("Контакты")}</DetailListTitle>
                <DetailListRow label={t("Имя:")} value={client.contactPerson || "-"} />
                <DetailListRow label={t("Адрес:")} value={client.address || "-"} />
                <DetailListRow label={t("Ориентир:")} value={client.landmark || "-"} />

                <DetailListTitle className="mt-[19px]">{t("Класс клиента")}</DetailListTitle>
                <DetailListRow label={t("Названия класса")} value={t("Организация")} bold />
              </div>
            )}

            {subTab === "ФИНАНСОВЫЕ НАСТРОЙКИ" && (
              <div className="pt-[10px]">
                <ClientDebtLimits clientId={client.id} />
                <div className="border-t border-[#e5e5e5] pt-[14px]">
                  <h3 className="text-[15px] font-semibold">{t("Финансовые настройки")}</h3>
                  <div className="flex items-center border-b border-[#e5e5e5] pb-[2px] pt-[14px] text-[13px] font-semibold leading-[18px]">
                    {t("Без автоматических бонусов:")}
                    <X className="ml-2 h-5 w-5 text-[#e57373]" />
                  </div>
                  <div className="flex h-[45px] items-center border-b border-[#e5e5e5] text-[13px] font-semibold">
                    {t("Маркетинговые акции:")}
                    <span className="ml-[10px] inline-flex h-[26px] items-center rounded-full bg-[#ff9a9a] px-[5px] text-[13px] font-normal text-white">{t("Нет данных")}</span>
                  </div>
                  <div className="flex h-[47px] items-center text-[13px] font-semibold">
                    KPI:
                    <span className="ml-[10px] inline-flex h-[26px] items-center rounded-full bg-[#ff9a9a] px-[5px] text-[13px] font-normal text-white">{t("Нет данных")}</span>
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
                <DetailPager total={logs.length} />
                <div className="mt-4 grid grid-cols-[89px_134px_89px_134px_1fr] border-b border-dashed border-[#d8d8d8] pb-4 pt-3 font-semibold">
                  <span>{t("Тип")}</span>
                  <span>{t("Статус")}</span>
                  <span>{t("Кем")}</span>
                  <span>{t("Дата создания")}</span>
                  <span>{t("Сумма")}</span>
                </div>
                {logs.filter((log) => logFilter === "Все" || (logFilter === "Финансы" ? log.type === "Оплата" : log.type === logFilter)).map(
                  (log, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[89px_134px_89px_134px_1fr] items-center border-b border-dashed border-[#d8d8d8] py-4"
                    >
                      <span>{t(log.type)}</span>
                      <span>
                        {log.status === "Удаленный" ? (
                          <span className="inline-block w-[118px] rounded-full border border-[#e57373] py-[2px] text-center text-[#e57373]">{t(log.status)}</span>
                        ) : log.status === "Создан" ? (
                          <span className="inline-block w-[118px] rounded-full border border-[#48a34b] py-[2px] text-center text-[#48a34b]">{t(log.status)}</span>
                        ) : (
                          t(log.status)
                        )}
                      </span>
                      <span>Admin Ritm</span>
                      <span className="pr-3">{log.at}</span>
                      <span>{log.sum}</span>
                    </div>
                  ),
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
  return <h4 className={`text-[13px] font-semibold leading-[25px] ${className}`}>{children}</h4>
}

function DetailListRow({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex min-h-[25px] items-stretch justify-between leading-[25px] ${bold ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

function DetailPager({ total }: { total: number }) {
  const arrow = "flex h-5 w-5 items-center justify-center rounded-full border border-[#999] text-[#999]"
  return (
    <div className="flex items-center justify-center gap-4 text-[#666]">
      <span className="flex items-center gap-1">
        25 <ChevronDown className="h-4 w-4 text-[#bbb]" />
      </span>
      <span>
        {total === 0 ? 0 : 1} - {total} {"из"} {total}
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
      className={`grid cursor-pointer items-center border-b border-dotted border-[#d6d6d6] relative border-l-[3px] [border-left-style:solid] ${selectMode ? "pl-[52px]" : "pl-[27px]"} pr-[30px] [&>div]:[overflow-wrap:anywhere] h-[50px] hover:bg-[#f2f5f8] ${
        !confirmed ? "border-l-[#5d6474]" : client.isActive === false ? "border-l-[#e57373]" : "border-l-[#81c784]"
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
          <svg viewBox="0 0 24 24" className={`h-6 w-6 ${selected ? "fill-[#5d6474]" : "fill-[#333]"}`}><path d={selected ? CI.checkOn : CI.checkEmpty} /></svg>
        </button>
      )}
      {columns.name && <div className="px-2 leading-[16.25px]">{client.name}</div>}
      {columns.code && <div className="px-2 leading-[16.25px]">{client.code ?? ""}</div>}
      {columns.phone && <div className="px-2 leading-[16.25px]">{/^\d{9}$/.test(client.phone) ? `+998${client.phone}` : client.phone}</div>}
      {columns.info && <div className="px-2 leading-[16.25px]">
        {client.inn ? (
          <>
            {t("ИНН")}: <b>{client.inn}</b>
            <br />
            PRICE_LIST_ID: <b>12</b>
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
