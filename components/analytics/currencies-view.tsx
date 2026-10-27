"use client"

import { ChevronLeft, ChevronRight, FileText, Pencil, Search, Trash2, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import type { Currency } from "./currencies-data"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "код": "code", "code": "code",
  "курс": "rate", "курс к sum": "rate", "rate": "rate",
}

function emptyDraft() {
  return { name: "", code: "", rate: "1", isBase: false }
}

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

/** Codes of the national currency (the import's base currency when there is none yet). */
const NATIONAL_CODES = new Set(["SUM", "UZS"])

/** The order to save imported rows in while the company has no base currency: the first
 * currency saved becomes the base one and must have rate 1 (lib/currencies-repo.ts), so the
 * national currency with rate 1 (else another row with rate 1) goes first. null = the file
 * has no row that can be the base currency. */
export function baseCurrencyFirst<T extends { code: string; rate: number }>(rows: T[]): T[] | null {
  const national = rows.findIndex((row) => row.rate === 1 && NATIONAL_CODES.has(row.code))
  const index = national >= 0 ? national : rows.findIndex((row) => row.rate === 1)
  if (index < 0) return null
  return [rows[index], ...rows.slice(0, index), ...rows.slice(index + 1)]
}

export function CurrenciesView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/currencies")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить валюты")
        return (await response.json()) as Currency[]
      })
      .then((data) => {
        if (cancelled) return
        setCurrencies(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить валюты с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return currencies
    const q = query.trim().toLocaleLowerCase("ru")
    return currencies.filter((currency) => currency.name.toLocaleLowerCase("ru").includes(q) || currency.code.toLocaleLowerCase("ru").includes(q))
  }, [currencies, query])

  // There is always one base currency: while there is none (a fresh install) the first
  // currency created becomes the base one, and it must have rate 1 (lib/currencies-repo.ts
  // createCurrency). Nothing is pre-ticked here: the list may still be loading or have
  // failed to load, and "Базовая валюта" would then move the base of the company.
  const baseCode = currencies.find((currency) => currency.isBase)?.code ?? ""
  const noBase = !loading && !loadError && !baseCode
  const rateLabel = t(baseCode && baseCode.toUpperCase() !== "SUM" ? "Курс к базовой валюте" : "Курс к SUM")

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(currency: Currency) {
    setDraft({ name: currency.name, code: currency.code, rate: String(currency.rate), isBase: currency.isBase })
    setFormError("")
    setEditingId(currency.id)
    setModalOpen(true)
  }

  async function remove(id: number) {
    const target = currencies.find((currency) => currency.id === id)
    if (target?.isBase) {
      window.alert(t("Нельзя удалить базовую валюту"))
      return
    }
    if (!window.confirm(t("Удалить валюту?"))) return
    try {
      const response = await fetch(`/api/currencies/${id}`, { method: "DELETE" })
      if (!response.ok) {
        // 409 while other records use it: the usage list says where.
        const data = (await response.json().catch(() => ({}))) as { error?: string; usage?: { label: string; count: number }[] }
        const usage = data.usage?.map((item) => `${t(item.label)}: ${item.count}`).join(", ")
        window.alert(`${t(data.error || "Не удалось удалить валюту")}${usage ? ` (${usage})` : ""}`)
        return
      }
      setCurrencies((current) => current.filter((currency) => currency.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const name = draft.name.trim()
    const code = draft.code.trim().toUpperCase()
    if (!name || !code) return
    const rate = draft.isBase ? 1 : Math.max(0, Number(draft.rate) || 0)

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/currencies/${editingId}` : "/api/currencies", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, rate, isBase: draft.isBase }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить валюту")
        return
      }
      const saved = (await response.json()) as Currency
      setCurrencies((current) => {
        const withoutBaseConflict = saved.isBase ? current.map((currency) => ({ ...currency, isBase: false })) : current
        if (isEdit) {
          return withoutBaseConflict.map((currency) => (currency.id === editingId ? saved : currency))
        }
        return [saved, ...withoutBaseConflict]
      })
      setModalOpen(false)
      setPage(1)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function downloadTemplate() {
    downloadExcelTable("currencies-template", [["Наименование", "Код", "Курс к SUM"]])
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
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: { name: string; code: string; rate: number }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.code = row[1] ?? ""
          record.rate = row[2] ?? ""
        }
        if (!record.name || /^(наименование|название|name)$/i.test(record.name)) continue
        if (!record.code) continue
        parsed.push({ name: record.name, code: record.code.toUpperCase(), rate: Math.max(0, Number(record.rate) || 0) })
      }

      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }

      // Without a base currency the first row saved becomes the base one and must have rate 1:
      // save the national currency (or another row with rate 1) first, never a row whose
      // rate is against a base that does not exist yet (the server refuses those then).
      let ordered = parsed
      if (!baseCode) {
        const withBase = baseCurrencyFirst(parsed)
        if (!withBase && noBase) {
          window.alert(t("Базовой валюты ещё нет: добавьте в файл базовую валюту с курсом 1"))
          return
        }
        if (withBase) ordered = withBase
      }

      const created: Currency[] = []
      let failed = 0
      for (const item of ordered) {
        try {
          const response = await fetch("/api/currencies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: item.name, code: item.code, rate: item.rate, isBase: false }),
          })
          if (response.ok) created.push((await response.json()) as Currency)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setCurrencies((current) => [...created, ...current].sort((a, b) => Number(b.isBase) - Number(a.isBase)))
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-screen bg-white text-[#17233b]"}>
      {!embedded && (
        <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
          <div className="flex items-center gap-3">
            <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f71dc]" /><span className="text-3xl font-light text-[#586174]">|</span>
            <span className="text-2xl font-bold text-[#586174]">{t("Валюты")}</span>
          </div>
        </header>
      )}

      <div className="px-9 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <button type="button" onClick={openCreate} className="text-[16px] text-[#4f71dc] hover:underline">
            {t("+ добавить валюту")}
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <FileText className="h-4 w-4" /> {t("Импорт с Excel")}
          </button>
          <label className="relative ml-auto w-64">
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1) }}
              placeholder={t("Поиск")}
              className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]"
            />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} {t("из")} {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label={t("Назад")} className="disabled:opacity-30">
            <ChevronLeft className="h-5 w-5 text-slate-400" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label={t("Вперед")} className="disabled:opacity-30">
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-5">{t("Наименование")}</th>
              <th className="px-5 py-5">{t("Код")}</th>
              <th className="px-5 py-5">{rateLabel}</th>
              <th className="px-5 py-5">{t("Базовая")}</th>
              <th className="px-5 py-5">{t("Дата создания")}</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-9 py-10 text-center text-slate-400">{t("Загрузка валют...")}</td></tr>
            ) : loadError ? (
              <tr><td colSpan={6} className="px-9 py-10 text-center text-red-600">{t(loadError)}</td></tr>
            ) : visible.map((currency) => (
              <tr key={currency.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4 font-medium">{currency.name}</td>
                <td className="px-5 py-4">
                  <span className="inline-block rounded bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-600">{currency.code}</span>
                </td>
                <td className="px-5 py-4">{number(currency.rate)}</td>
                <td className="px-5 py-4">
                  {currency.isBase && <span className="inline-block rounded bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-600">{t("Базовая")}</span>}
                </td>
                <td className="px-5 py-4">{formatDateText(currency.createdDate, language)}</td>
                <td className="px-5 py-4">
                  <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => openEdit(currency)} aria-label={t("Изменить")}>
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => remove(currency.id)} aria-label={t("Удалить")}>
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && !loadError && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-9 py-10 text-center text-slate-400">
                  {t("Ничего не найдено")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? t("Изменить валюту") : t("Добавить валюту")}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label={t("Закрыть")}>
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                {t("Наименование")} <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                {t("Код")} <span className="text-red-500">*</span>
                <input value={draft.code} onChange={(event) => setDraft((value) => ({ ...value, code: event.target.value }))} placeholder="USD" maxLength={5} className="mt-2 block w-full uppercase outline-none" />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.isBase}
                  onChange={(event) => setDraft((value) => ({ ...value, isBase: event.target.checked }))}
                  className="h-4 w-4 accent-[#4f71dc]"
                />
                {t("Базовая валюта")}
              </label>
              {editingId === null && noBase && <p className="text-sm text-slate-500">{t("Базовой валюты ещё нет: первая валюта станет базовой, поэтому её курс должен быть 1.")}</p>}
              {!draft.isBase && (
                <label className="block border-b border-slate-200 pb-2 font-medium">
                  {rateLabel}
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.rate}
                    onChange={(event) => setDraft((value) => ({ ...value, rate: event.target.value }))}
                    className="mt-2 block w-full outline-none"
                  />
                </label>
              )}
              {formError && <p className="text-sm font-medium text-rose-600">{t(formError)}</p>}
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? t("Сохранение...") : t("Сохранить")}
              </button>
            </footer>
          </form>
        </div>
      )}

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
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f71dc] hover:underline">
                {t("1. Скачать шаблон")}
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f71dc] hover:text-[#4f71dc]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : t("Добавьте файл Excel или нажмите для выбора")}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#71ce87] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? t("Импорт...") : t("Сохранить")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
