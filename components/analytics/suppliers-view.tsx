"use client"

import { ChevronLeft, ChevronRight, Download, FileText, Minus, Pencil, Plus, PlusCircle, Search, Trash2, X } from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import {
  supplierCategoryPool as categories,
  supplierBranchPool as branches,
  supplierOrganizationPool as organizations,
  type Supplier,
} from "./suppliers-data"

type DraftContact = { id: number; name: string; email: string; phone: string }

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "название": "name", "наименование": "name", "name": "name",
  "категория": "category", "category": "category",
  "адрес": "address", "местоположение": "address", "address": "address",
  "филиал": "branch", "branch": "branch",
  "организация": "organization", "organization": "organization",
}

function emptyDraft() {
  return { name: "", category: "", address: "", branch: "", organization: "" }
}

export function SuppliersView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [draftContacts, setDraftContacts] = useState<DraftContact[]>([{ id: 1, name: "", email: "", phone: "" }])
  const [categoryOptions, setCategoryOptions] = useState(categories)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/suppliers")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Supplier[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить поставщиков с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () => rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()) || String(row.id).includes(query)),
    [rows, query],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleExpand(row: Supplier) {
    setExpandedId((current) => (current === row.id ? null : row.id))
  }

  function openCreate() {
    setDraft(emptyDraft())
    setDraftContacts([{ id: 1, name: "", email: "", phone: "" }])
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(row: Supplier) {
    setDraft({ name: row.name, category: row.category, address: row.address, branch: row.branch, organization: row.organization })
    setDraftContacts(row.contacts.length ? row.contacts.map((contact) => ({ ...contact })) : [{ id: 1, name: "", email: "", phone: "" }])
    setEditingId(row.id)
    setModalOpen(true)
  }

  async function removeRow(row: Supplier) {
    if (!window.confirm(`Удалить поставщика «${row.name}»?`)) return
    try {
      const response = await fetch(`/api/suppliers/${row.id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить поставщика")
        return
      }
      setRows((current) => current.filter((item) => item.id !== row.id))
      if (expandedId === row.id) setExpandedId(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function addContact() {
    setDraftContacts((current) => [...current, { id: Math.max(0, ...current.map((contact) => contact.id)) + 1, name: "", email: "", phone: "" }])
  }

  function removeContact(id: number) {
    setDraftContacts((current) => (current.length > 1 ? current.filter((contact) => contact.id !== id) : current))
  }

  function updateContact(id: number, patch: Partial<DraftContact>) {
    setDraftContacts((current) => current.map((contact) => (contact.id === id ? { ...contact, ...patch } : contact)))
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault()
    const trimmed = newCategoryName.trim()
    if (!trimmed) return
    try {
      await fetch("/api/supplier-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
    } catch {
      // Category creation is best-effort here; the supplier form still uses it locally.
    }
    setCategoryOptions((current) => (current.includes(trimmed) ? current : [...current, trimmed]))
    setDraft((current) => ({ ...current, category: trimmed }))
    setNewCategoryName("")
    setCategoryModalOpen(false)
  }

  const [saving, setSaving] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim() || !draft.category || !draft.address.trim()) return
    const contacts = draftContacts.filter((contact) => contact.name.trim() || contact.phone.trim()).map((contact) => ({ ...contact }))
    setSaving(true)
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/suppliers/${editingId}` : "/api/suppliers", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          category: draft.category,
          address: draft.address.trim(),
          branch: draft.branch || "Не указано",
          organization: draft.organization || "Не указано",
          contacts,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось сохранить поставщика")
        return
      }
      const saved = (await response.json()) as Supplier
      setRows((current) => (isEdit ? current.map((row) => (row.id === editingId ? saved : row)) : [saved, ...current]))
      setModalOpen(false)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function downloadList() {
    downloadExcelTable("postavshiki", [
      ["Id", "Наименование", "Категория", "Дата создания"],
      ...filtered.map((row) => [row.id, row.name, row.category, row.createdDate]),
    ])
  }

  function downloadTemplate() {
    downloadExcelTable("suppliers-template", [["Название", "Категория", "Местоположение", "Филиал", "Организация"]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const rowsRaw = await readExcelRows(importFile)
      if (!rowsRaw.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(rowsRaw[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rowsRaw.slice(1) : rowsRaw

      type ParsedSupplier = { name: string; category: string; address: string; branch: string; organization: string }
      const parsed: ParsedSupplier[] = []
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
          record.address = row[2] ?? ""
          record.branch = row[3] ?? ""
          record.organization = row[4] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name,
          category: record.category || categoryOptions[0] || "",
          address: record.address || "Не указано",
          branch: record.branch || "Не указано",
          organization: record.organization || "Не указано",
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: Supplier[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/suppliers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...item, contacts: [] }),
          })
          if (response.ok) created.push((await response.json()) as Supplier)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setRows((current) => [...created, ...current])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
            <span className="mx-2 text-slate-400">|</span> Поставщики
          </h1>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <FileText className="h-4 w-4" /> Импорт с Excel
            </button>
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> Добавить
            </button>
          </div>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
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
          <button type="button" onClick={downloadList} aria-label="Скачать" className="text-slate-500 hover:text-[#4f70e7]">
            <Download className="h-5 w-5" />
          </button>
          {embedded && (
            <>
              <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                <FileText className="h-4 w-4" /> Импорт с Excel
              </button>
              <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                <Plus className="h-4 w-4" /> Добавить
              </button>
            </>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">Id</th>
              <th className="px-5 py-5">Наименование</th>
              <th className="px-5 py-5">Категория</th>
              <th className="px-5 py-5">Дата создания</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-9 py-10 text-center text-slate-400">Загрузка поставщиков...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={4} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{row.id}</td>
                  <td className="px-5 py-4 text-[#4f70e7]">{row.name}</td>
                  <td className="px-5 py-4">{row.category}</td>
                  <td className="px-5 py-4">{row.createdDate}</td>
                </tr>

                {expandedId === row.id && (
                  <tr>
                    <td colSpan={4} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex items-center justify-between">
                          <h2 className="text-xl font-bold text-slate-700">{row.name}</h2>
                          <div className="flex items-center gap-3 text-slate-500">
                            <button type="button" aria-label="Добавить продукт" className="text-emerald-500 hover:text-emerald-600">
                              <PlusCircle className="h-6 w-6" />
                            </button>
                            <button type="button" onClick={() => openEdit(row)} aria-label="Изменить" className="hover:text-[#4f70e7]">
                              <Pencil className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => removeRow(row)} aria-label="Удалить" className="hover:text-rose-500">
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-6 sm:grid-cols-[1fr_2fr]">
                          <div>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Адрес</dt><dd className="font-medium text-[#4f70e7]">{row.address}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Категория</dt><dd className="font-medium text-[#4f70e7]">{row.category}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Филиал</dt><dd className="font-medium text-[#4f70e7]">{row.branch}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Организация</dt><dd className="font-medium text-[#4f70e7]">{row.organization}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Дата добавления</dt><dd className="font-medium text-[#4f70e7]">{row.createdDate}</dd></div>
                            </dl>
                            <p className="mb-2 mt-5 font-medium text-slate-800">Контакты</p>
                            {row.contacts.length === 0 && <p className="text-sm text-slate-400">Не указано</p>}
                            {row.contacts.map((contact) => (
                              <div key={contact.id} className="flex justify-between gap-4 border-b border-dashed border-slate-200 py-1.5 text-sm">
                                <span className="text-[#4f70e7]">{contact.name}</span>
                                <span>{contact.phone}</span>
                              </div>
                            ))}
                          </div>

                          <div>
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-2 pr-4">Продукт</th>
                                  <th className="py-2 pr-4">Кол-во</th>
                                  <th className="py-2 pr-4">Цена</th>
                                  <th className="py-2 pr-4">Сумма</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.products.map((product) => (
                                  <tr key={product.id} className="border-t border-slate-100">
                                    <td className="py-2 pr-4">{product.product}</td>
                                    <td className="py-2 pr-4">{product.qty}</td>
                                    <td className="py-2 pr-4">{product.price.toLocaleString("ru-RU")}</td>
                                    <td className="py-2 pr-4">{(product.qty * product.price).toLocaleString("ru-RU")}</td>
                                  </tr>
                                ))}
                                {row.products.length === 0 && (
                                  <tr>
                                    <td colSpan={4} className="py-6 text-center text-slate-400">Товары не добавлены</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {!loading && !loadError && visible.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-10">
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-lg flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? "Изменить поставщика" : "Добавление поставщика"}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Название <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>

              <div className="flex items-end gap-3">
                <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
                  Категория <span className="text-red-500">*</span>
                  <select value={draft.category} onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                    <option value="">Выберите...</option>
                    {categoryOptions.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => setCategoryModalOpen(true)} aria-label="Добавить категорию" className="mb-2 text-emerald-500 hover:text-emerald-600">
                  <PlusCircle className="h-6 w-6" />
                </button>
              </div>

              <label className="block border-b border-slate-200 pb-2 font-medium">
                Местоположение <span className="text-red-500">*</span>
                <input value={draft.address} onChange={(event) => setDraft((value) => ({ ...value, address: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>

              <label className="block border-b border-slate-200 pb-2 font-medium">
                Филиал
                <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="">Выберите...</option>
                  {branches.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>

              <label className="block border-b border-slate-200 pb-2 font-medium">
                Организация
                <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="">Выберите...</option>
                  {organizations.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>

              <div className="rounded bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-medium text-slate-500">Контактные данные</p>
                  {draftContacts.length > 1 && (
                    <button type="button" onClick={() => removeContact(draftContacts[draftContacts.length - 1].id)} aria-label="Убрать контакт" className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-400 text-white hover:bg-rose-500">
                      <Minus className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {draftContacts.map((contact) => (
                  <div key={contact.id} className="mb-4 space-y-3 border-b border-slate-200 pb-4 last:mb-0 last:border-b-0 last:pb-0">
                    <label className="block border-b border-slate-200 pb-2 text-sm font-medium">
                      Контактное лицо <span className="text-red-500">*</span>
                      <input value={contact.name} onChange={(event) => updateContact(contact.id, { name: event.target.value })} className="mt-2 block w-full bg-transparent outline-none" />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block border-b border-slate-200 pb-2 text-sm font-medium">
                        Email
                        <input value={contact.email} onChange={(event) => updateContact(contact.id, { email: event.target.value })} className="mt-2 block w-full bg-transparent outline-none" />
                      </label>
                      <label className="block border-b border-slate-200 pb-2 text-sm font-medium">
                        Телефон номер <span className="text-red-500">*</span>
                        <input value={contact.phone} onChange={(event) => updateContact(contact.id, { phone: event.target.value })} className="mt-2 block w-full bg-transparent outline-none" />
                      </label>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={addContact} className="mt-3 text-sm text-[#4f70e7] hover:underline">
                  + добавить контакт
                </button>
              </div>
            </div>

            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </footer>
          </form>
        </div>
      )}

      {categoryModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={saveCategory} className="w-full max-w-sm rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">Добавить категорию</b>
              <button type="button" onClick={() => setCategoryModalOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <label className="block border-b border-slate-200 pb-2 text-sm font-medium">
              Наименование категории <span className="text-red-500">*</span>
              <input autoFocus value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} className="mt-2 block w-full outline-none" />
            </label>
            <div className="mt-5 flex justify-end">
              <button type="submit" className="rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">Сохранить</button>
            </div>
          </form>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Импорт с Excel</b>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">
                1. Скачать шаблон
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
