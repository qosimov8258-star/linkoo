"use client"

import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react"
import {
  BarChart3,
  Bot,
  ChevronDown,
  Download,
  FileText,
  Info,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "клиент": "client", "client": "client",
  "агент": "agent", "agent": "agent",
  "зона": "zone", "zone": "zone",
  "инн": "inn", "inn": "inn",
  "организация": "organization", "organization": "organization",
  "комментарий": "comment", "comment": "comment",
}

type Status = "active" | "completed" | "cancelled"

type ContractRow = {
  id: string
  createdAt: string
  client: string
  hasInfo?: boolean
  zone: string
  agent: string
  inn: string
  status: Status
  officialName: string
  year: number
  organization: string
  comment: string
}

const initialRows: ContractRow[] = []

const TOTAL_ALL = 0
const TOTAL_ACTIVE = 0
const TOTAL_COMPLETED = 0

const statusMeta: Record<Status, { label: string; dot: string; text: string }> = {
  active: { label: "Активный", dot: "bg-[#3aca6a]", text: "text-[#3aa76d]" },
  completed: { label: "Завершен", dot: "bg-[#4f70e7]", text: "text-[#4f70e7]" },
  cancelled: { label: "Отменен", dot: "bg-[#e5484d]", text: "text-[#e5484d]" },
}

const agents = ["Все агенты", "Admin Ritm", "Fozil Agent", "Шохрух Туляганов"]
const zones = ["Все зоны", "spark", "chilonzor", "Не указан"]

function StatusBadge({ status }: { status: Status }) {
  const { t } = useLanguage()
  const meta = statusMeta[status]
  return (
    <span className={`inline-flex items-center gap-2 font-medium ${meta.text}`}>
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} /> {t(meta.label)}
    </span>
  )
}

export function ContractsView() {
  const { t } = useLanguage()
  const [rows, setRows] = useState(initialRows)
  const [tab, setTab] = useState<"active" | "completed" | "all">("all")
  const [search, setSearch] = useState("")
  const [agentFilter, setAgentFilter] = useState("Все агенты")
  const [zoneFilter, setZoneFilter] = useState("Все зоны")
  const [filterOpen, setFilterOpen] = useState(false)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ContractRow | null>(null)
  const [editName, setEditName] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/contracts")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить договоры")
        return (await response.json()) as ContractRow[]
      })
      .then((data) => {
        if (!cancelled) {
          setRows(data)
          setLoadError("")
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Не удалось загрузить договоры с сервера"))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (tab === "active" && row.status !== "active") return false
      if (tab === "completed" && row.status !== "completed") return false
      if (search.trim() && !row.client.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")) && !String(row.id).toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (agentFilter !== "Все агенты" && row.agent !== agentFilter) return false
      if (zoneFilter !== "Все зоны" && row.zone !== zoneFilter) return false
      return true
    }).map((row, index) => ({ row, index }))
  }, [agentFilter, rows, search, tab, zoneFilter])

  const isDefault = !search.trim() && agentFilter === "Все агенты" && zoneFilter === "Все зоны"
  const totalLabel = isDefault ? (tab === "active" ? TOTAL_ACTIVE : tab === "completed" ? TOTAL_COMPLETED : TOTAL_ALL) : filtered.length

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const appliedFilterCount = (tab !== "all" ? 1 : 0) + (agentFilter !== "Все агенты" ? 1 : 0) + (zoneFilter !== "Все зоны" ? 1 : 0)

  const clearFilters = () => {
    setTab("all")
    setAgentFilter("Все агенты")
    setZoneFilter("Все зоны")
    setFilterOpen(false)
    setPage(1)
  }

  const startEdit = (row: ContractRow) => {
    setEditTarget(row)
    setEditName(row.officialName)
  }

  const saveEdit = async () => {
    if (!editTarget) return
    try {
      const response = await fetch(`/api/contracts/${editTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officialName: editName || editTarget.officialName }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось сохранить договор"))
        return
      }
      const saved = (await response.json()) as ContractRow
      setRows((current) => current.map((row) => (row.id === editTarget.id ? saved : row)))
      setEditTarget(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const addContract = async (draft: { client: string; agent: string; zone: string; inn: string; organization: string; comment: string }) => {
    try {
      const response = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось создать договор"))
        return
      }
      const saved = (await response.json()) as ContractRow
      setRows((current) => [saved, ...current])
      setAddOpen(false)
      setTab("all")
      setPage(1)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadTemplate() {
    downloadExcelTable("contracts-template", [[t("Клиент"), t("Агент"), t("Зона"), t("ИНН"), t("Организация"), t("Комментарий")]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const parsedRows = await readExcelRows(importFile)
      if (!parsedRows.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(parsedRows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("client")
      const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows

      const parsed: { client: string; agent: string; zone: string; inn: string; organization: string; comment: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.client = row[0] ?? ""
          record.agent = row[1] ?? ""
          record.zone = row[2] ?? ""
          record.inn = row[3] ?? ""
          record.organization = row[4] ?? ""
          record.comment = row[5] ?? ""
        }
        if (!record.client || /^(клиент|client)$/i.test(record.client)) continue
        parsed.push({
          client: record.client,
          agent: record.agent || "Admin Ritm",
          zone: record.zone || "Не указан",
          inn: record.inn || "0",
          organization: record.organization || "Не указано",
          comment: record.comment || "Не указано",
        })
      }

      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }

      const created: ContractRow[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/contracts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as ContractRow)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setRows((current) => [...created, ...current])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
      setTab("all")
      setPage(1)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  const downloadExcel = () => {
    const header = [t("№"), t("Дата создания"), t("Клиент"), t("Зона"), t("Агент"), t("ИНН"), t("Статус")]
    const body = filtered.map(({ row }) => [row.id, row.createdAt, row.client, row.zone, row.agent, row.inn, t(statusMeta[row.status].label)])
    const html = [header, ...body].map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")
    const blob = new Blob([`﻿<html><meta charset="UTF-8"><table>${html}</table></html>`], { type: "application/vnd.ms-excel;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = "contracts.xls"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] items-center justify-between border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f70e7]" /><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Договоры")}</span>
        </div>
        <div className="relative flex items-center gap-3">
          <button onClick={() => setMenuOpen((value) => !value)} aria-label={t("Меню")} className="text-[#586174] hover:text-[#17233b]"><MoreVertical className="h-6 w-6" /></button>
          {menuOpen && (
            <div className="absolute right-12 top-9 z-20 w-52 rounded-md border border-[#e1e5eb] bg-white py-2 shadow-xl" onMouseLeave={() => setMenuOpen(false)}>
              <button onClick={() => { downloadExcel(); setMenuOpen(false) }} className="block w-full px-4 py-2 text-left text-sm hover:bg-[#f6f9fc]">{t("Скачать Excel")}</button>
              <button onClick={() => { clearFilters(); setMenuOpen(false) }} className="block w-full px-4 py-2 text-left text-sm hover:bg-[#f6f9fc]">{t("Сбросить фильтры")}</button>
            </div>
          )}
          <button onClick={() => setAddOpen(true)} aria-label={t("Добавить договор")} className="flex h-11 w-11 items-center justify-center rounded-md bg-[#4f70e7] text-white hover:bg-[#3f5fd0]">
            <Plus className="h-6 w-6" />
          </button>
          <button onClick={() => setImportOpen(true)} aria-label={t("Импорт с Excel")} title={t("Импорт с Excel")} className="flex h-11 w-11 items-center justify-center rounded-md bg-[#4f70e7] text-white hover:bg-[#3f5fd0]">
            <FileText className="h-6 w-6" />
          </button>
        </div>
      </header>

      {loadError && <p className="px-6 pt-3 text-sm text-red-500 md:px-9">{loadError}</p>}

      <section className="grid grid-cols-3 bg-white text-center shadow-sm">
        {(
          [
            ["active", "Активные"],
            ["completed", "Завершенные"],
            ["all", "Все"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); setPage(1) }}
            className={`border-b-2 py-4 text-[16px] font-medium ${tab === key ? "border-[#4f5fd9] text-[#17233b]" : "border-transparent text-[#586174]"}`}
          >
            {t(label)}
          </button>
        ))}
      </section>

      <section className="mx-4 mt-4 rounded-md bg-white shadow-sm md:mx-6">
        <div className="flex flex-wrap items-center gap-5 border-b border-[#e1e5eb] px-6 py-4">
          {appliedFilterCount > 0 ? (
            <div className="flex items-center gap-2 rounded-md bg-[#eef1f6] px-3 py-1.5 text-[#586174]">
              <span>{t("Фильтр")}: {appliedFilterCount} {t("элемента")}</span>
              <button onClick={() => setFilterOpen(true)} aria-label={t("Изменить фильтр")} className="text-[#586174] hover:text-[#17233b]"><Pencil className="h-4 w-4" /></button>
              <button onClick={clearFilters} aria-label={t("Очистить фильтр")} className="text-[#586174] hover:text-[#17233b]"><X className="h-5 w-5 rounded-full border border-current p-0.5" /></button>
            </div>
          ) : (
            <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 font-medium text-[#4f70e7]">
              {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition ${filterOpen ? "rotate-180" : ""}`} />
            </button>
          )}

          <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={t("Поиск")} className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
            <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
          </label>

          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>

          <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {totalLabel}</span>

          <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
            <ChevronDown className="h-5 w-5 rotate-90" />
          </button>
          <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
            <ChevronDown className="h-5 w-5 -rotate-90" />
          </button>

          <button onClick={downloadExcel} aria-label={t("Скачать")} className="text-[#586174] hover:text-[#17233b]"><Download className="h-5 w-5" /></button>
          <button aria-label={t("Статистика")} className="text-[#586174] hover:text-[#17233b]"><BarChart3 className="h-5 w-5" /></button>
        </div>

        {filterOpen && (
          <div className="relative grid grid-cols-1 gap-6 border-b border-[#e1e5eb] px-6 py-6 sm:grid-cols-3">
            <button onClick={() => setFilterOpen(false)} aria-label={t("Закрыть")} className="absolute right-4 top-4 text-[#9aa3b6] hover:text-[#17233b]"><X className="h-5 w-5" /></button>
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              {t("Агент")}
              <select value={agentFilter} onChange={(event) => { setAgentFilter(event.target.value); setPage(1) }} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {agents.map((option) => <option key={option} value={option}>{t(option)}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
            </label>
            <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
              {t("Зона")}
              <select value={zoneFilter} onChange={(event) => { setZoneFilter(event.target.value); setPage(1) }} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                {zones.map((option) => <option key={option} value={option}>{t(option)}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-6 h-4 w-4 text-[#9aa3b6]" />
            </label>
            <div className="flex items-end">
              <button onClick={() => setFilterOpen(false)} className="rounded-md bg-[#586174] px-8 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-[#4a5163]">{t("Применить")}</button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto pb-2">
          <table className="w-full min-w-[1100px] border-collapse text-[14px]">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                {["№", "Дата создания", "Клиент", "Зона", "Агент", "ИНН", "Статус"].map((title) => (
                  <th key={title} className="whitespace-nowrap px-4 py-4 text-left font-semibold">{t(title)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row, index }) => (
                <Fragment key={`${row.id}-${row.createdAt}-${index}`}>
                  <tr
                    onClick={() => setExpandedId((current) => (current === index ? null : index))}
                    className={`cursor-pointer border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"} hover:bg-[#eef2ff]`}
                  >
                    <td className="px-4 py-4 align-top">{row.id}</td>
                    <td className="px-4 py-4 align-top">{row.createdAt}</td>
                    <td className="px-4 py-4 align-top">
                      <span className="inline-flex items-center gap-2">
                        {row.hasInfo && <Info className="h-4 w-4 text-[#4f70e7]" />}
                        {row.client}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-top">{row.zone}</td>
                    <td className="px-4 py-4 align-top">{row.agent}</td>
                    <td className="px-4 py-4 align-top">{row.inn}</td>
                    <td className="px-4 py-4 align-top"><StatusBadge status={row.status} /></td>
                  </tr>
                  {expandedId === index && (
                    <tr>
                      <td colSpan={7} className="border-b border-dashed border-slate-200 bg-[#f6f9fc] px-6 py-6">
                        <div className="rounded-md bg-white p-6 shadow-md">
                          <div className="mb-5 flex items-center justify-between">
                            <h3 className="text-lg font-bold">{t("Договоры")} {row.client}</h3>
                            <button onClick={() => startEdit(row)} aria-label={t("Редактировать")} className="text-[#586174] hover:text-[#17233b]"><Pencil className="h-4 w-4" /></button>
                          </div>
                          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                            <div className="space-y-3">
                              {[
                                ["Официальное название:", row.officialName],
                                ["Дата создания:", row.createdAt],
                                ["Клиент:", `${row.client} (${row.zone})`],
                                ["Агент:", row.agent],
                                ["ИНН:", row.inn],
                                ["Год:", String(row.year)],
                                ["Организация:", row.organization],
                                ["Комментарий:", row.comment],
                              ].map(([label, value]) => (
                                <div key={label} className="flex justify-between gap-4 border-b border-dashed border-slate-200 pb-2">
                                  <span className="text-[#586174]">{t(label)}</span>
                                  <span className="font-semibold text-[#17233b]">{value}</span>
                                </div>
                              ))}
                              <div className="flex justify-between gap-4 border-b border-dashed border-slate-200 pb-2">
                                <span className="text-[#586174]">{t("Статус:")}</span>
                                <StatusBadge status={row.status} />
                              </div>
                            </div>
                            <div>
                              <h4 className="mb-4 font-semibold text-[#17233b]">{t("Транзакции")}</h4>
                              <table className="w-full text-left text-[13px] text-[#586174]">
                                <thead>
                                  <tr className="border-b border-slate-200">
                                    <th className="pb-2 font-semibold">{t("№")}</th>
                                    <th className="pb-2 font-semibold">{t("Дата")}</th>
                                    <th className="pb-2 font-semibold">{t("Создал")}</th>
                                    <th className="pb-2 font-semibold">{t("Сумма")}</th>
                                  </tr>
                                </thead>
                              </table>
                              <div className="flex flex-col items-center gap-3 py-10 text-center text-[#9aa3b6]">
                                <Bot className="h-16 w-16 text-[#c7ceda]" />
                                <p>{t("По вашему запросу ничего не найдено...")}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-[#9aa3b6]">{t("Ничего не найдено по заданным фильтрам")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {addOpen && <AddContractModal onClose={() => setAddOpen(false)} onSave={addContract} />}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{t("Импорт с Excel")}</b>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label={t("Закрыть")}>
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">
                {t("1. Скачать шаблон")}
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : t("Добавьте файл Excel или нажмите для выбора")}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? t("Импорт...") : t("Сохранить")}
              </button>
            </footer>
          </div>
        </div>
      )}

      {editTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={() => setEditTarget(null)}>
          <div onClick={(event) => event.stopPropagation()} className="w-[440px] max-w-[92vw] rounded-md bg-white p-7 shadow-2xl">
            <h2 className="mb-4 text-lg font-bold">{t("Редактировать договор")}</h2>
            <label className="mb-6 block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
              {t("Официальное название")}
              <input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
            </label>
            <div className="flex justify-end gap-3">
              <button onClick={() => setEditTarget(null)} className="rounded-md border border-[#dbe0e8] px-5 py-2.5 font-semibold text-[#586174]">{t("Отмена")}</button>
              <button onClick={saveEdit} className="rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white">{t("Сохранить")}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function AddContractModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (draft: { client: string; agent: string; zone: string; inn: string; organization: string; comment: string }) => void
}) {
  const { t } = useLanguage()
  const [client, setClient] = useState("")
  const [agent, setAgent] = useState("Admin Ritm")
  const [zone, setZone] = useState("")
  const [inn, setInn] = useState("")
  const [organization, setOrganization] = useState("")
  const [comment, setComment] = useState("")

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[520px] max-w-[94vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-lg font-bold uppercase tracking-wide">{t("Новый договор")}</h2>
          <button aria-label={t("Закрыть")} onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="space-y-6 px-8 py-7">
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            {t("Клиент")}
            <input value={client} onChange={(event) => setClient(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            {t("Агент")}
            <select value={agent} onChange={(event) => setAgent(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
              {agents.filter((option) => option !== "Все агенты").map((option) => <option key={option} value={option}>{t(option)}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-8 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            {t("Зона")}
            <input value={zone} onChange={(event) => setZone(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            {t("ИНН")}
            <input value={inn} onChange={(event) => setInn(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            {t("Организация")}
            <input value={organization} onChange={(event) => setOrganization(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] font-semibold text-[#17233b] outline-none" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            {t("Комментарий")}
            <input value={comment} onChange={(event) => setComment(event.target.value)} className="mt-1 block w-full bg-transparent text-[16px] outline-none" />
          </label>
        </div>
        <footer className="flex justify-end gap-3 border-t px-8 py-5">
          <button onClick={onClose} className="rounded-md border border-[#dbe0e8] px-5 py-2.5 font-semibold text-[#586174]">{t("Отмена")}</button>
          <button onClick={() => onSave({ client, agent, zone, inn, organization, comment })} className="rounded-md bg-[#4f70e7] px-5 py-2.5 font-semibold text-white">{t("Сохранить")}</button>
        </footer>
      </div>
    </div>
  )
}
