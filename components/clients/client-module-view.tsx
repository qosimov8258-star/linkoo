"use client"

import Link from "next/link"
import type { ChangeEvent, FormEvent } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
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
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, normalizeHeader, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

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

type ApiModuleItem = {
  id: number
  moduleKey: string
  name: string
  category: string
  detail: string
  value: string
  status: ModuleRowStatus
  statusLabel: string
  updatedAt: string
}

function apiItemToRow(item: ApiModuleItem): ModuleRow {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    detail: item.detail,
    value: item.value,
    status: item.status,
    statusLabel: item.statusLabel,
    updatedAt: item.updatedAt,
  }
}

function csvCell(value: string | number) {
  return '"' + String(value).replace(/"/g, '""') + '"'
}

function todayLabel() {
  return new Intl.DateTimeFormat("ru-RU").format(new Date())
}

export function ClientModuleView({ clientModule }: { clientModule: ClientModule }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<ModuleRow[]>([])
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
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQuery("")
    setStatusFilter("all")
    setSelectedIds([])
    setModalMode(null)
    setEditingId(null)
    setDeleteIds([])

    let cancelled = false
    fetch("/api/client-module-items?moduleKey=" + encodeURIComponent(clientModule.slug))
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить записи")
        return (await response.json()) as ApiModuleItem[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data.map(apiItemToRow))
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
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
    setNotice(next ? t("Раздел добавлен в избранное") : t("Раздел удалён из избранного"))
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

  async function saveRow(event: FormEvent<HTMLFormElement>) {
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
      setFormError(t("Заполните все обязательные поля."))
      return
    }

    try {
      if (modalMode === "edit" && editingId !== null) {
        const response = await fetch("/api/client-module-items/" + editingId, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moduleKey: clientModule.slug, ...cleanDraft }),
        })
        if (!response.ok) {
          setFormError(t("Не удалось сохранить запись."))
          return
        }
        const saved = apiItemToRow((await response.json()) as ApiModuleItem)
        setRows((current) => current.map((row) => (row.id === editingId ? saved : row)))
        setNotice(t("Запись успешно обновлена"))
      } else {
        const response = await fetch("/api/client-module-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moduleKey: clientModule.slug, ...cleanDraft }),
        })
        if (!response.ok) {
          setFormError(t("Не удалось добавить запись."))
          return
        }
        const saved = apiItemToRow((await response.json()) as ApiModuleItem)
        setRows((current) => [saved, ...current])
        setNotice(t("Новая запись добавлена"))
      }
    } catch {
      setFormError(t("Сервер недоступен, попробуйте ещё раз."))
      return
    }

    closeEditor()
  }

  function askToDelete(ids: number[]) {
    if (ids.length === 0) return
    setDeleteIds(ids)
  }

  async function confirmDelete() {
    const count = deleteIds.length
    const ids = deleteIds
    try {
      await Promise.all(ids.map((id) => fetch("/api/client-module-items/" + id, { method: "DELETE" })))
    } catch {
      // Rows are still removed from the visible list below; a failed request
      // simply means it may reappear after the next reload.
    }
    setRows((current) => current.filter((row) => !ids.includes(row.id)))
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)))
    setDeleteIds([])
    setNotice(count === 1 ? t("Запись удалена") : t("Удалено записей") + ": " + count)
  }

  function resetFilters() {
    setQuery("")
    setStatusFilter("all")
  }

  function downloadCsv() {
    const exportRows = selectedRows.length > 0 ? selectedRows : filteredRows
    if (exportRows.length === 0) {
      setNotice(t("Нет записей для экспорта"))
      return
    }

    const csvRows = [
      [t("Название"), clientModule.categoryLabel, t("Описание"), clientModule.valueLabel, t("Статус"), t("Обновлено")],
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
    setNotice(t("CSV подготовлен") + ": " + exportRows.length + " " + t("записей"))
  }

  const importAliases = useMemo(() => {
    const aliases: Record<string, string> = {
      "название": "name",
      "наименование": "name",
      "name": "name",
      "описание": "detail",
      "detail": "detail",
      "статус": "statusLabel",
      "status": "statusLabel",
    }
    aliases[normalizeHeader(clientModule.categoryLabel)] = "category"
    aliases[normalizeHeader(clientModule.valueLabel)] = "value"
    return aliases
  }, [clientModule.categoryLabel, clientModule.valueLabel])

  function downloadTemplate() {
    downloadExcelTable(clientModule.slug + "-template", [
      [t("Название"), clientModule.categoryLabel, t("Описание"), clientModule.valueLabel, t("Статус")],
    ])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const excelRows = await readExcelRows(importFile)
      if (!excelRows.length) {
        notify(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(excelRows[0], importAliases)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? excelRows.slice(1) : excelRows

      const parsed: Omit<ModuleRow, "id">[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.category = row[1] ?? ""
          record.detail = row[2] ?? ""
          record.value = row[3] ?? ""
          record.statusLabel = row[4] ?? ""
        }
        if (!record.name) continue
        const matchedStatus = statusOptions.find(
          (option) => normalizeHeader(option.label) === normalizeHeader(record.statusLabel || ""),
        )
        const status = matchedStatus ? matchedStatus.value : "active"
        parsed.push({
          name: record.name.trim(),
          category: record.category?.trim() || "-",
          detail: record.detail?.trim() || "-",
          value: record.value?.trim() || "-",
          status,
          statusLabel: record.statusLabel?.trim() || defaultStatusLabels[status],
          updatedAt: todayLabel(),
        })
      }

      if (!parsed.length) {
        notify(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }

      const created: ModuleRow[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/client-module-items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              moduleKey: clientModule.slug,
              name: item.name,
              category: item.category,
              detail: item.detail,
              value: item.value,
              status: item.status,
              statusLabel: item.statusLabel,
            }),
          })
          if (response.ok) created.push(apiItemToRow((await response.json()) as ApiModuleItem))
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setRows((current) => [...created, ...current])
      if (failed)
        notify(
          t("Импортировано") + " " + created.length + " " + t("из") + " " + parsed.length + ". " + t("Не удалось сохранить") + ": " + failed,
        )
      else setNotice(t("Импортировано записей") + ": " + created.length)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <Link
          href="/clients"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-blue transition-colors hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("Назад к клиентам")}
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
                  {t(kindLabels[clientModule.kind])}
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
              aria-label={favorite ? t("Удалить из избранного") : t("Добавить в избранное")}
              aria-pressed={favorite}
              className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold ring-1 ring-white/15 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Star className={cn("h-4 w-4 text-amber-300", favorite && "fill-current")} />
              {favorite ? t("В избранном") : t("В избранное")}
            </button>
          </div>
        </section>

        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={FileText}
            label={t("Всего записей")}
            value={String(rows.length)}
            color="bg-blue-50 text-brand-blue"
          />
          <MetricCard
            icon={CheckCircle2}
            label={t("Активные")}
            value={String(activeCount)}
            color="bg-emerald-50 text-emerald-600"
          />
          <MetricCard
            icon={ShieldAlert}
            label={t("Требуют внимания")}
            value={String(attentionCount)}
            color="bg-amber-50 text-amber-600"
          />
          <MetricCard
            icon={Users}
            label={t("Выбрано")}
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
              aria-label={t("Закрыть уведомление")}
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
                  <span className="sr-only">{t("Поиск")}</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("Поиск по всем полям")}
                    className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10"
                  />
                </label>

                <label className="min-w-52">
                  <span className="sr-only">{t("Фильтр по статусу")}</span>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10"
                  >
                    <option value="all">{t("Все статусы")}</option>
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t(option.filterLabel)}
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
                  {t("Сбросить")}
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
                      ? t("Изменить выбранную запись")
                      : t("Выберите одну запись")
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Pencil className="h-4 w-4" />
                  {t("Изменить")}
                </button>
                <button
                  type="button"
                  onClick={() => askToDelete(selectedIds)}
                  disabled={selectedIds.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3.5 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("Удалить")}
                </button>
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-3.5 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95"
                >
                  <FileText className="h-4 w-4" />
                  {t("Импорт с Excel")}
                </button>
                <button
                  type="button"
                  onClick={openAddModal}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-green-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
                >
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  {t("Добавить")}
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {t("Показано")} {filteredRows.length} {t("из")} {rows.length}
                {selectedIds.length > 0 && " · " + t("выбрано") + " " + selectedIds.length}
              </span>
              <span>
                {t("CSV экспортирует")} {selectedRows.length > 0 ? t("выбранные записи") : t("текущую выборку")}
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
                      aria-label={t("Выбрать все показанные записи")}
                      className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-brand-blue"
                    />
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {t("Название")}
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {clientModule.categoryLabel}
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {t("Описание")}
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {clientModule.valueLabel}
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {t("Статус")}
                  </th>
                  <th className="px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {t("Обновлено")}
                  </th>
                  <th className="w-24 px-4 py-3.5 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                    {t("Действия")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-16 text-center">
                      <Search className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                      <p className="font-semibold text-slate-700">{t("Ничего не найдено")}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {t("Измените поисковый запрос или сбросьте фильтры.")}
                      </p>
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="mt-4 text-sm font-semibold text-brand-blue hover:text-blue-700"
                      >
                        {t("Сбросить фильтры")}
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
                            aria-label={t("Выбрать") + " " + row.name}
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
                              aria-label={t("Изменить") + " " + row.name}
                              className="rounded-md p-2 text-slate-400 transition-colors hover:bg-blue-50 hover:text-brand-blue"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => askToDelete([row.id])}
                              aria-label={t("Удалить") + " " + row.name}
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
                  {modalMode === "add" ? t("Добавить запись") : t("Изменить запись")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{clientModule.label}</p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                aria-label={t("Закрыть")}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveRow}>
              <div className="grid gap-4 px-5 py-4 text-[13px] sm:grid-cols-2 sm:px-6">
                <FormField label={t("Название")}>
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    className={inputClassName}
                    placeholder={t("Введите название")}
                  />
                </FormField>

                <FormField label={clientModule.categoryLabel}>
                  <input
                    value={draft.category}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, category: event.target.value }))
                    }
                    className={inputClassName}
                    placeholder={t("Введите") + ": " + clientModule.categoryLabel.toLocaleLowerCase("ru-RU")}
                  />
                </FormField>

                <FormField label={clientModule.valueLabel}>
                  <input
                    value={draft.value}
                    onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
                    className={inputClassName}
                    placeholder={t("Введите значение")}
                  />
                </FormField>

                <FormField label={t("Системный статус")}>
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
                        {t(option.label)}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label={t("Отображаемый статус")}>
                  <input
                    value={draft.statusLabel}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, statusLabel: event.target.value }))
                    }
                    className={inputClassName}
                    placeholder={t("Например: В норме")}
                  />
                </FormField>

                <div className="sm:col-span-2">
                  <FormField label={t("Описание")}>
                    <textarea
                      value={draft.detail}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, detail: event.target.value }))
                      }
                      rows={3}
                      className={cn(inputClassName, "resize-y")}
                      placeholder={t("Добавьте подробное описание")}
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
                  {t("Отмена")}
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95"
                >
                  {modalMode === "add" ? t("Добавить") : t("Сохранить изменения")}
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
              {t("Удалить")} {deleteIds.length === 1 ? t("запись") : t("записи")}?
            </h2>
            <p id="delete-client-module-description" className="mt-2 text-sm leading-6 text-slate-500">
              {deleteIds.length === 1
                ? t("Выбранная запись будет удалена из текущего раздела.")
                : t("Будет удалено записей") + ": " + deleteIds.length + "."}
              {" "}{t("Это действие нельзя отменить.")}
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteIds([])}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                {t("Отмена")}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                autoFocus
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700"
              >
                {t("Удалить")}
              </button>
            </div>
          </section>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-lg bg-white">
            <header className="flex items-center justify-between border-b border-slate-200 p-6">
              <b className="uppercase">{t("Импорт с Excel")}</b>
              <button
                type="button"
                onClick={() => {
                  setImportOpen(false)
                  setImportFile(null)
                }}
                aria-label={t("Закрыть")}
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-brand-blue hover:underline">
                {t("1. Скачать шаблон")}
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-brand-blue hover:text-brand-blue"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : t("Добавьте файл Excel или нажмите для выбора")}
              </button>
            </div>
            <footer className="flex justify-end border-t border-slate-200 p-5">
              <button
                type="button"
                disabled={!importFile || importSaving}
                onClick={saveImport}
                className="rounded-lg bg-brand-green px-5 py-3 font-semibold text-white hover:bg-brand-green-dark disabled:opacity-40"
              >
                {importSaving ? t("Импорт...") : t("Сохранить")}
              </button>
            </footer>
          </div>
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
