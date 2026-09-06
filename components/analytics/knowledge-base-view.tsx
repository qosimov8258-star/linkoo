"use client"

import { ChevronLeft, ChevronRight, FileText, Pencil, Search, Trash2, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"

type Article = { id: number; name: string; text: string; active: boolean; roles: string[]; fileName?: string }

const roles = ["Агент", "Доставщик", "Супервайзер", "Инкассатор", "Мерчендайзер", "Кассир", "Зав. склад", "Супер-Админ"]

const seed: Article[] = []

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "название": "name", "наименование": "name", "name": "name",
  "текст": "text", "text": "text",
  "активный": "active", "active": "active",
  "права доступа": "roles", "роли": "roles", "roles": "roles",
}

function parseBool(value: string) {
  return /^(да|yes|true|1|\+|✓)$/i.test(value.trim())
}

function parseRoles(value: string) {
  if (!value) return [] as string[]
  const wanted = value.split(/[,;]/).map((item) => item.trim().toLowerCase()).filter(Boolean)
  return roles.filter((role) => wanted.includes(role.toLowerCase()))
}

function emptyDraft() {
  return { name: "", text: "", active: false, roles: [] as string[], fileName: undefined as string | undefined }
}

export function KnowledgeBaseView({ embedded = false }: { embedded?: boolean }) {
  const [articles, setArticles] = useState(seed)
  const [query, setQuery] = useState("")
  useEffect(() => {
    let cancelled = false
    fetch("/api/knowledge-base")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Article[]
      })
      .then((data) => {
        if (!cancelled) setArticles(data)
      })
      .catch(() => {
        if (!cancelled) window.alert("Не удалось загрузить статьи с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Article | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  const filtered = useMemo(() => articles.filter((article) => article.name.toLowerCase().includes(query.toLowerCase())), [articles, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setDraft(emptyDraft())
    setEditing("new")
  }

  function openEdit(article: Article) {
    setDraft({ name: article.name, text: article.text, active: article.active, roles: [...article.roles], fileName: article.fileName })
    setEditing(article)
  }

  function toggleRole(role: string) {
    setDraft((current) => ({ ...current, roles: current.roles.includes(role) ? current.roles.filter((item) => item !== role) : [...current.roles, role] }))
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) setDraft((current) => ({ ...current, fileName: file.name }))
    event.target.value = ""
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    const payload = { name: draft.name.trim(), text: draft.text, active: draft.active, roles: draft.roles }
    try {
      if (editing !== "new" && editing) {
        const response = await fetch(`/api/knowledge-base/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось сохранить статью")
          return
        }
        const saved = (await response.json()) as Article
        setArticles((current) => current.map((article) => (article.id === saved.id ? { ...saved, fileName: draft.fileName } : article)))
      } else {
        const response = await fetch("/api/knowledge-base", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось создать статью")
          return
        }
        const saved = (await response.json()) as Article
        setArticles((current) => [{ ...saved, fileName: draft.fileName }, ...current])
      }
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/knowledge-base/${id}`, { method: "DELETE" })
      if (!response.ok) {
        window.alert("Не удалось удалить статью")
        return
      }
      setArticles((current) => current.filter((article) => article.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function downloadTemplate() {
    downloadExcelTable("knowledge-base-template", [["Название", "Текст", "Активный (да/нет)", "Права доступа"]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const rows = await readExcelRows(importFile)
      if (!rows.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rows.slice(1) : rows

      type ParsedArticle = { name: string; text: string; active: boolean; roles: string[] }
      const parsed: ParsedArticle[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.text = row[1] ?? ""
          record.active = row[2] ?? ""
          record.roles = row[3] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name.trim(),
          text: record.text?.trim() || "",
          active: parseBool(record.active || ""),
          roles: parseRoles(record.roles || ""),
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: Article[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/knowledge-base", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as Article)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setArticles((current) => [...created, ...current])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      <div className={embedded ? "" : "overflow-hidden rounded bg-white shadow"}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={openCreate} className="text-[17px] text-[#4f70e7] hover:underline">
            + Добавить
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className="flex items-center gap-1 text-[17px] text-[#4f70e7] hover:underline">
            <FileText className="h-4 w-4" /> Импорт с Excel
          </button>
          <label className="relative ml-4 w-72">
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

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">№</th>
              <th className="px-5 py-5">Наименование</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {visible.map((article) => (
              <tr key={article.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-5">{article.id}</td>
                <td className="px-5 py-5 text-[#4f70e7]">{article.name}</td>
                <td className="px-5 py-5">
                  <div className="hidden items-center justify-end gap-3 pr-4 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => openEdit(article)} aria-label="Изменить">
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => remove(article.id)} aria-label="Удалить">
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
      </div>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Добавить" : "Изменить"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Название
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Текст
                <textarea value={draft.text} onChange={(event) => setDraft((value) => ({ ...value, text: event.target.value }))} rows={4} className="mt-2 block w-full resize-none outline-none" />
              </label>
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={draft.active} onChange={(event) => setDraft((value) => ({ ...value, active: event.target.checked }))} className="h-5 w-5" />
                Активный
              </label>
              <div>
                <p className="mb-2 font-medium text-slate-800">Права доступа</p>
                <div className="grid gap-2 border-b border-slate-200 pb-4 sm:grid-cols-3">
                  {roles.map((role) => (
                    <label key={role} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={draft.roles.includes(role)} onChange={() => toggleRole(role)} />
                      {role}
                    </label>
                  ))}
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="application/pdf" onChange={pickFile} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
              >
                <FileText className="h-8 w-8" />
                {draft.fileName ?? "Добавьте PDF файл"}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="font-bold uppercase text-sky-500">
                Сохранить
              </button>
            </footer>
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
