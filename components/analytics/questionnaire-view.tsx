"use client"

import { SplitDetailList } from "@/components/ref/split-detail"
import { SurveyForm, emptySurveyDraft, type SurveyDraft } from "@/components/analytics/survey-form"
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { Download, FileText, Pencil, Trash2, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { RefHeader, RefPage, RefTabs, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

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
  storeType: string
  comment: string
  orderNo?: string
  flags?: SurveyDraft["flags"]
  questions?: SurveyDraft["questions"]
}

const initial: Survey[] = []

type Tab = "active" | "inactive" | "all"


function now() {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(".", "")
}

export function QuestionnaireView() {
  const { t } = useLanguage()
  const [surveys, setSurveys] = useState(initial)
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
        if (!cancelled) notify("Не удалось загрузить опросники с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])
  const [tab, setTab] = useState<Tab>("all")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [organizationFilter, setOrganizationFilter] = useState("Все организации")
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | "new" | null>(null)
  const [draft, setDraft] = useState<SurveyDraft>(emptySurveyDraft)
  const [organizations, setOrganizations] = useState<string[]>([])
  const [clientTypes, setClientTypes] = useState<string[]>([])
  useEffect(() => {
    const names = (rows: unknown) => (Array.isArray(rows) ? (rows as { name?: string }[]).map((row) => row.name ?? "").filter(Boolean) : [])
    fetch("/api/organizations").then((r) => (r.ok ? r.json() : [])).then((rows) => setOrganizations(names(rows))).catch(() => {})
    fetch("/api/client-types").then((r) => (r.ok ? r.json() : [])).then((rows) => setClientTypes(names(rows))).catch(() => {})
  }, [])
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    return surveys
      .filter((survey) => (tab === "active" ? survey.active : tab === "inactive" ? !survey.active : true))
      .filter((survey) => organizationFilter === "Все организации" || survey.organization === organizationFilter)
      .filter((survey) => survey.name.toLowerCase().includes(query.toLowerCase()))
  }, [surveys, tab, organizationFilter, query])
  const paging = usePaging(filtered.length)

  const counts = useMemo(
    () => ({
      active: surveys.filter((survey) => survey.active).length,
      inactive: surveys.filter((survey) => !survey.active).length,
      all: surveys.length,
    }),
    [surveys],
  )

  function openCreate() {
    setDraft(emptySurveyDraft())
    setEditing("new")
  }

  function openEdit(survey: Survey) {
    setDraft({
      ...emptySurveyDraft(),
      name: survey.name,
      orderNo: survey.orderNo ?? "",
      organization: survey.organization,
      storeType: survey.storeType,
      active: survey.active,
      comment: survey.comment,
      flags: { ...emptySurveyDraft().flags, ...(survey.flags ?? {}) },
      questions: survey.questions?.length ? survey.questions : emptySurveyDraft().questions,
    })
    setEditing(survey.id)
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/surveys/${id}`, { method: "DELETE" })
      if (!response.ok) {
        notify("Не удалось удалить опросник")
        return
      }
      setSurveys((list) => list.filter((survey) => survey.id !== id))
      setSelected((current) => (current === id ? null : current))
    } catch {
      notify("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function save() {
    if (!draft.name.trim()) return
    const payload = { ...draft, name: draft.name.trim() }
    try {
      if (editing === "new") {
        const response = await fetch("/api/surveys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          notify(data.error || "Не удалось создать опросник")
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
          notify(data.error || "Не удалось сохранить опросник")
          return
        }
        const saved = (await response.json()) as Survey
        setSurveys((list) => list.map((survey) => (survey.id === saved.id ? saved : survey)))
      }
      setEditing(null)
    } catch {
      notify("Сервер недоступен, попробуйте ещё раз")
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
        notify("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: Omit<Survey, "id">[] = []
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
          createdAt: now(),
          active: true,
          organization: record.organization || "",
          storeType: record.storeType || "",
          comment: record.comment || "",
        })
      }

      if (!parsed.length) {
        notify("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: Survey[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/surveys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as Survey)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setSurveys((current) => [...created, ...current])
      if (failed) notify(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  function downloadSurvey(survey: Survey) {
    downloadExcelTable(`oprosnik-${survey.id}.xls`, [
      ["№", "Название", "Дата создания", "Статус", "Организация", "Тип магазина", "Комментарий"],
      [survey.id, survey.name, survey.createdAt, survey.active ? "Активный" : "Отключен", survey.organization, survey.storeType, survey.comment],
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
        <button type="button" onClick={openCreate} className="flex h-[30px] w-[118px] items-center justify-center gap-2 rounded-[5px] bg-[#71ce87] text-[13px] font-semibold text-white hover:brightness-95">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" /></svg>
          Добавить
        </button>
      </RefHeader>

      <SplitDetailList
        rows={filtered.slice(paging.start, paging.end)}
        selectedKey={selected}
        rowKey={(survey) => survey.id}
        toolbar={
          <>
        <RefTabs labels={tabs.map((item) => item.label)} value={tabs.find((item) => item.key === tab)?.label ?? ""} onChange={(label) => { setTab(tabs.find((item) => item.label === label)?.key ?? tab); paging.setPage(1) }} />
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <div className="flex w-full flex-wrap items-end gap-4 border-b border-slate-200 bg-white px-5 py-4 shadow">
              <label className="text-sm font-medium text-slate-600">
                {t("Организация")}
                <select value={organizationFilter} onChange={(event) => { setOrganizationFilter(event.target.value); paging.setPage(1) }} className="mt-1 block w-56 border-0 border-b border-slate-300 bg-white px-0 py-2 outline-none focus:border-[#4f71dc]">
                  <option>{t("Все организации")}</option>
                  {organizations.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => setFilterOpen(false)} className="rounded bg-[#4f71dc] px-5 py-2.5 font-semibold text-white hover:brightness-95">
                {t("Применить")}
              </button>
            </div>
          }
          query={query}
          onQuery={(value) => { setQuery(value); paging.setPage(1) }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={filtered.length ? paging.start + 1 : 0}
          to={paging.end}
          total={filtered.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
        />
          </>
        }
        tableProps={{
          cols: "minmax(0,1fr) minmax(0,5fr) minmax(0,3fr) minmax(0,2fr)",
          heads: [t("№"), t("Название"), t("Дата создания"), t("Статус")],
          rowKey: (survey: Survey) => survey.id,
          onRowClick: (survey: Survey) => setSelected((current) => (current === survey.id ? null : survey.id)),
          empty: t("Ничего не найдено"),
          render: (survey: Survey) => [survey.id, survey.name, survey.createdAt, t(survey.active ? "Активный" : "Отключен")],
        }}
        detail={(survey) => (
          <>
            <div className="flex h-[66px] items-center justify-between border-b border-[#e5e8ed] px-[30px]">
              <h2 className="text-[18px] font-medium text-[#333]">
                № {survey.id} - {survey.name}
              </h2>
              <div className="flex items-center gap-[10px] text-[#5d6474]">
                <button type="button" onClick={() => downloadSurvey(survey)} aria-label={t("Скачать")} className="flex h-[30px] w-[30px] items-center justify-center hover:text-[#4f71dc]">
                  <Download className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => openEdit(survey)} aria-label={t("Изменить")} className="flex h-[30px] w-[30px] items-center justify-center hover:text-[#4f71dc]">
                  <Pencil className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => remove(survey.id)} aria-label={t("Удалить")} className="flex h-[30px] w-[30px] items-center justify-center hover:text-red-500">
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="w-[320px] px-[30px] pb-[20px] pt-[16px] text-[13px] leading-[25px] text-[#333]">
              <p>{t("Дата создания")} <b className="float-right">{survey.createdAt}</b></p>
              <p>{t("Организация")} <b className="float-right">{survey.organization}</b></p>
              <p>{t("Тип магазина")} <b className="float-right">{survey.storeType || t("Не указано")}</b></p>
              <div className="-mx-[30px] mt-[15px] border-t border-[#e7ebf0] px-[30px] pt-[16px]">
                <p className="font-bold">{t("Комментарий")}:</p>
                <p className="mt-[3px]">{survey.comment || t("Комментарий отсутствует")}</p>
              </div>
            </div>
          </>
        )}
      />

      {editing !== null && (
        <SurveyForm
          title={editing === "new" ? "Добавление" : "Изменить опросник"}
          draft={draft}
          organizations={organizations}
          clientTypes={clientTypes}
          onChange={setDraft}
          onSave={() => void save()}
          onClose={() => setEditing(null)}
        />
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
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f71dc] hover:underline">
                1. Скачать шаблон
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f71dc] hover:text-[#4f71dc]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#71ce87] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </RefPage>
  )
}
