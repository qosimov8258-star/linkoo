"use client"

import { CheckBox, LineField, LineSelect } from "@/components/analytics/catalog-ui"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download, FileText, Filter, Pencil, PlusCircle, Search, Trash2, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { RefHeader, RefPage, RefTabs } from "@/components/ref/list-kit"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "название": "name", "наименование": "name", "name": "name",
  "организация": "organization",
  "тип магазина": "storeType",
  "комментарий": "comment",
}

type Survey = {
  id: number
  name: string
  createdAt: string
  active: boolean
  organization: string
  /** null = saved before surveys were linked by id. */
  organizationId: number | null
  storeType: string
  clientTypeId: number | null
  comment: string
}

// "Организация" = the factory's organizations (/api/organizations, required), "Тип клиента" = its
// client types (/api/client-types; "Не указано" = none). Nothing is pre-selected; the API checks both.
type Named = { id: number; name: string }
const NO_CLIENT_TYPE = "Не указано"

type Draft = { name: string; active: boolean; organizationId: string; clientTypeId: string; comment: string }

const initial: Survey[] = []

type Tab = "active" | "inactive" | "all"

function emptyDraft(): Draft {
  return { name: "", active: true, organizationId: "", clientTypeId: "", comment: "" }
}

async function loadNamed(url: string): Promise<Named[]> {
  try {
    const response = await fetch(url)
    if (!response.ok) return []
    const rows = (await response.json()) as unknown
    return Array.isArray(rows)
      ? rows
          .map((row) => ({ id: Number((row as Named).id), name: String((row as Named).name ?? "") }))
          .filter((row) => row.id > 0 && row.name)
          .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      : []
  } catch {
    return []
  }
}

export function QuestionnaireView() {
  const { t, language } = useLanguage()
  const [surveys, setSurveys] = useState(initial)
  const [organizations, setOrganizations] = useState<Named[]>([])
  const [clientTypes, setClientTypes] = useState<Named[]>([])
  useEffect(() => {
    let cancelled = false
    void Promise.all([loadNamed("/api/organizations"), loadNamed("/api/client-types")]).then(([organizationRows, typeRows]) => {
      if (cancelled) return
      setOrganizations(organizationRows)
      setClientTypes(typeRows)
    })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    fetch("/api/surveys")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Survey[]
      })
      .then((data) => {
        if (!cancelled) setSurveys(data)
      })
      .catch(() => {
        if (!cancelled) window.alert(t("Не удалось загрузить опросники с сервера"))
      })
    return () => {
      cancelled = true
    }
  }, [t])
  const [tab, setTab] = useState<Tab>("active")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  // "" = every organization; else an organization id.
  const [organizationFilter, setOrganizationFilter] = useState("")
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | "new" | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [showErrors, setShowErrors] = useState(false)
  const [formError, setFormError] = useState("")
  const [orderNo, setOrderNo] = useState("")
  const [flags, setFlags] = useState({ required: false, storeCheck: false, scoring: false, perfect: false })
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const filterOrganization = organizations.find((item) => String(item.id) === organizationFilter) ?? null
  const filtered = useMemo(() => {
    return surveys
      .filter((survey) => (tab === "active" ? survey.active : tab === "inactive" ? !survey.active : true))
      // Surveys saved before the organization id was kept match by name.
      .filter((survey) => !filterOrganization || survey.organizationId === filterOrganization.id || (survey.organizationId === null && survey.organization === filterOrganization.name))
      .filter((survey) => survey.name.toLowerCase().includes(query.toLowerCase()))
  }, [surveys, tab, filterOrganization, query])

  const counts = useMemo(
    () => ({
      active: surveys.filter((survey) => survey.active).length,
      inactive: surveys.filter((survey) => !survey.active).length,
      all: surveys.length,
    }),
    [surveys],
  )

  const detail = selected !== null ? surveys.find((survey) => survey.id === selected) ?? null : null

  function openCreate() {
    setDraft(emptyDraft())
    setShowErrors(false)
    setFormError("")
    setEditing("new")
  }

  function openEdit(survey: Survey) {
    // An older survey without ids is matched by name (an unknown name has to be chosen again).
    const organizationId = survey.organizationId ?? organizations.find((item) => item.name === survey.organization)?.id ?? null
    const clientTypeId = survey.clientTypeId ?? clientTypes.find((item) => item.name === survey.storeType)?.id ?? null
    setDraft({ name: survey.name, active: survey.active, organizationId: organizationId ? String(organizationId) : "", clientTypeId: clientTypeId ? String(clientTypeId) : "", comment: survey.comment })
    setShowErrors(false)
    setFormError("")
    setEditing(survey.id)
  }

  const organizationName = organizations.find((item) => String(item.id) === draft.organizationId)?.name ?? ""
  const clientTypeName = draft.clientTypeId ? (clientTypes.find((item) => String(item.id) === draft.clientTypeId)?.name ?? "") : t(NO_CLIENT_TYPE)

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/surveys/${id}`, { method: "DELETE" })
      if (!response.ok) {
        window.alert(t("Не удалось удалить опросник"))
        return
      }
      setSurveys((list) => list.filter((survey) => survey.id !== id))
      setSelected((current) => (current === id ? null : current))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setShowErrors(true)
    setFormError("")
    if (!draft.name.trim() || !draft.organizationId) return
    const payload = {
      name: draft.name.trim(),
      active: draft.active,
      organizationId: Number(draft.organizationId),
      clientTypeId: draft.clientTypeId ? Number(draft.clientTypeId) : null,
      comment: draft.comment,
    }
    try {
      if (editing === "new") {
        const response = await fetch("/api/surveys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          setFormError(t(data.error || "Не удалось создать опросник"))
          return
        }
        const saved = (await response.json()) as Survey
        setSurveys((list) => [saved, ...list])
      } else if (editing !== null) {
        const response = await fetch(`/api/surveys/${editing}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          setFormError(t(data.error || "Не удалось сохранить опросник"))
          return
        }
        const saved = (await response.json()) as Survey
        setSurveys((list) => list.map((survey) => (survey.id === saved.id ? saved : survey)))
      }
      setEditing(null)
    } catch {
      setFormError(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadTemplate() {
    downloadExcelTable("questionnaires-template", [["Название", "Организация", "Тип магазина", "Комментарий"]])
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

      // Names of the factory's own organization / client type: the API links them (or refuses the row).
      const parsed: Array<{ name: string; active: boolean; organization: string; storeType: string; comment: string }> = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.organization = row[1] ?? ""
          record.storeType = row[2] ?? ""
          record.comment = row[3] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name.trim(),
          active: true,
          // Without an organization in the file: the only organization, if there is exactly one.
          organization: (record.organization ?? "").trim() || (organizations.length === 1 ? organizations[0].name : ""),
          storeType: (record.storeType ?? "").trim(),
          comment: record.comment || "",
        })
      }

      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }

      const created: Survey[] = []
      let failed = 0
      let firstError = ""
      for (const item of parsed) {
        try {
          const response = await fetch("/api/surveys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as Survey)
          else {
            failed += 1
            if (!firstError) firstError = String(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "")
          }
        } catch {
          failed += 1
        }
      }
      if (created.length) setSurveys((current) => [...created, ...current])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} / ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}${firstError ? ` (${t(firstError)})` : ""}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  function downloadSurvey(survey: Survey) {
    downloadExcelTable(`oprosnik-${survey.id}.xls`, [
      ["№", t("Название"), t("Дата создания"), t("Статус"), t("Организация"), t("Тип магазина"), t("Комментарий")],
      [survey.id, survey.name, formatDateText(survey.createdAt, language), survey.active ? t("Активный") : t("Отключен"), survey.organization, survey.storeType, survey.comment],
    ])
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "active", label: "Активные", count: counts.active },
    { key: "inactive", label: "Не активные", count: counts.inactive },
    { key: "all", label: "Все", count: counts.all },
  ]

  return (
    <RefPage>
      <RefHeader title="Опросник">
        <button type="button" onClick={openCreate} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95">
          <PlusCircle className="h-4 w-4" />
          {t("Добавить")}
        </button>
      </RefHeader>

      <section className="overflow-hidden rounded bg-white shadow">
        <RefTabs labels={tabs.map((item) => item.label)} value={tabs.find((item) => item.key === tab)?.label ?? ""} onChange={(label) => setTab(tabs.find((item) => item.label === label)?.key ?? tab)} />

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95">
            <Filter className="h-4 w-4" />
            {t("Показать фильтр")}
          </button>
          <label className="relative w-64">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-slate-300 py-3 pr-10 outline-none focus:border-[#4f71dc]" />
            <Search className="absolute right-2 top-3 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? 1 : 0} - {filtered.length} {t("из")} {filtered.length}
          </span>
          <ChevronLeft className="h-5 w-5 text-slate-300" />
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-end gap-4 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <label className="text-sm font-medium text-slate-600">
              {t("Организация")}
              <select value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)} className="mt-1 block w-56 border-0 border-b border-slate-300 bg-white px-0 py-2 outline-none focus:border-[#4f71dc]">
                <option value="">{t("Все организации")}</option>
                {organizations.map((item) => (
                  <option key={item.id} value={String(item.id)}>{item.name}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setFilterOpen(false)} className="rounded bg-[#5d6474] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              {t("Применить")}
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="bg-[#5d6474] text-white">
              <tr>
                <th className="px-9 py-4 text-[13px]">№</th>
                <th className="px-5 py-4 text-[13px]">{t("Название")}</th>
                <th className="px-5 py-4 text-[13px]">{t("Дата создания")}</th>
                <th className="px-5 py-4 text-[13px]">{t("Статус")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((survey) => (
                <tr key={survey.id} className={`border-b border-dashed border-slate-300 hover:bg-slate-50 ${selected === survey.id ? "bg-slate-50" : ""}`}>
                  <td className="px-12 py-3 text-[13px]">{survey.id}</td>
                  <td className="px-5 py-3 text-[13px]">
                    <button type="button" onClick={() => setSelected((current) => (current === survey.id ? null : survey.id))} className="text-left text-[#4f71dc] hover:underline">
                      {survey.name}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-[13px]">{formatDateText(survey.createdAt, language)}</td>
                  <td className="px-5 py-3 text-[13px]">
                    <span className={survey.active ? "text-[#71ce87]" : "text-slate-400"}>{survey.active ? t("Активный") : t("Отключен")}</span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
                    {t("Ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {detail && (
          <div className="border-t border-slate-200 p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">
                № {detail.id} - {detail.name}
              </h2>
              <div className="flex items-center gap-4 text-slate-500">
                <button type="button" onClick={() => downloadSurvey(detail)} aria-label={t("Скачать")} className="hover:text-[#4f71dc]">
                  <Download className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => openEdit(detail)} aria-label={t("Изменить")} className="hover:text-[#4f71dc]">
                  <Pencil className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => remove(detail.id)} aria-label={t("Удалить")} className="hover:text-red-500">
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="mt-5 space-y-2 border-t border-slate-100 pt-5 text-[15px]">
              <p>
                <span className="text-slate-500">{t("Дата создания")}</span> <b className="ml-2">{formatDateText(detail.createdAt, language)}</b>
              </p>
              <p>
                <span className="text-slate-500">{t("Организация")}</span> <b className="ml-2">{detail.organization}</b>
              </p>
              <p>
                <span className="text-slate-500">{t("Тип магазина")}</span> <b className="ml-2">{detail.storeType || t(NO_CLIENT_TYPE)}</b>
              </p>
            </div>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="font-bold text-slate-800">{t("Комментарий:")}</p>
              <p className="mt-1 text-slate-700">{detail.comment || "—"}</p>
            </div>
          </div>
        )}
      </section>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex bg-white text-[13px]">
          <form onSubmit={save} className="flex h-full w-full flex-col">
            <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#efefef] px-[14px]">
              <b className="uppercase">{editing === "new" ? t("Добавление") : t("Изменить опросник")}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label={t("Закрыть")}><X className="h-6 w-6" /></button>
            </header>
            <div className="grid min-h-0 flex-1 grid-cols-[405px_minmax(0,1fr)]">
              <aside className="space-y-[10px] overflow-y-auto border-r border-[#efefef] px-[14px] py-[16px] pr-[60px]">
                <LineField label="Название" required autoFocus value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} />
                {showErrors && !draft.name.trim() && <p className="text-[12px] text-[#e57373]">{t("Это поле обязательно к заполнению")}</p>}
                <LineField label="Порядковый номер" value={orderNo} onChange={setOrderNo} />
                <LineSelect
                  label={t("Организация")}
                  required
                  value={organizationName}
                  onChange={(value) => setDraft((current) => ({ ...current, organizationId: String(organizations.find((item) => item.name === value)?.id ?? "") }))}
                  options={organizations.map((item) => item.name)}
                />
                {showErrors && !draft.organizationId && <p className="text-[12px] text-[#e57373]">{t("Выберите организацию")}</p>}
                {!organizations.length && <p className="text-[12px] text-amber-600">{t("Нет организаций — добавьте их в разделе «Организация»")}</p>}
                <LineSelect
                  label={t("Тип клиента")}
                  value={clientTypeName}
                  onChange={(value) => setDraft((current) => ({ ...current, clientTypeId: String(clientTypes.find((item) => item.name === value)?.id ?? "") }))}
                  options={[t(NO_CLIENT_TYPE), ...clientTypes.map((item) => item.name)]}
                />
                <div className="space-y-[12px] pt-[10px]">
                  <CheckBox checked={flags.required} onChange={(value) => setFlags((current) => ({ ...current, required: value }))} label="Обязательный" />
                  <CheckBox checked={flags.storeCheck} onChange={(value) => setFlags((current) => ({ ...current, storeCheck: value }))} label="Store Check" />
                  <CheckBox checked={draft.active} onChange={(value) => setDraft((current) => ({ ...current, active: value }))} label="Активный" />
                  <CheckBox checked={flags.scoring} onChange={(value) => setFlags((current) => ({ ...current, scoring: value }))} label="Имеет систему оценки" />
                  <CheckBox checked={flags.perfect} onChange={(value) => setFlags((current) => ({ ...current, perfect: value }))} label="Perfect Store" />
                </div>
                <LineField label="Оставить комментарий..." value={draft.comment} onChange={(value) => setDraft((current) => ({ ...current, comment: value }))} />
              </aside>
              <main className="min-w-0 overflow-y-auto bg-[#f4f4f4] px-[14px] py-[12px]">
                <p className="text-[13px] font-semibold">{t("Список вопросов")}</p>
                <div className="mt-[10px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12)]">
                  <div className="flex h-[60px] items-center justify-between bg-[#f2f5f8] px-[20px]"><b className="text-[15px]">{t("Вопрос № 1")}</b><button type="button" className="flex h-[30px] w-[30px] items-center justify-center rounded-[3px] bg-[#4f71dc] text-white">+</button></div>
                  <div className="grid grid-cols-2 gap-[20px] px-[20px] py-[16px]">
                    <div className="space-y-[10px]"><LineField label="Напишите вопрос" value="" onChange={() => {}} /><LineSelect label="Тип" value="" onChange={() => {}} options={[]} /><LineField label="Максимум ответов" value="" onChange={() => {}} /><LineSelect label="Формат" value="" onChange={() => {}} options={[]} /><LineField label="Порядковый номер" value="" onChange={() => {}} /><CheckBox checked={false} onChange={() => {}} label="Обязательный вопрос" /></div>
                    <div><p className="text-[18px] font-semibold">{t("Ответы")}</p><div className="mt-[14px] flex items-center justify-between border-b border-[#d5dae1] pb-[8px] font-semibold"><span>{t("Ответ #1")}</span><span className="text-[18px]">+</span></div></div>
                  </div>
                </div>
              </main>
            </div>
            <footer className="flex h-[56px] shrink-0 items-center justify-end gap-4 border-t border-[#efefef] px-[14px]">
              {formError && <span className="mr-auto text-[13px] text-[#e57373]">{formError}</span>}
              <button type="submit" className="text-[12px] font-bold uppercase text-[#0a9ddb]">{t("Сохранить")}</button>
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
    </RefPage>
  )
}
