"use client"

import { ChangeEvent, Fragment, FormEvent, useEffect, useMemo, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { EmptyState, HoverActions, ImportDialog, LineField, LineSelect, ListToolbar, Modal, SaveButton, grayHead } from "./catalog-ui"
import type { UnitOfMeasure } from "./units-of-measure-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "родительское измерение": "parentName", "родитель": "parentName", "parent": "parentName",
}

function emptyDraft() {
  return { parentId: "", name: "" }
}

export function UnitsOfMeasureView({ embedded = false }: { embedded?: boolean }) {
  void embedded
  const { t } = useLanguage()
  const [units, setUnits] = useState<UnitOfMeasure[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<UnitOfMeasure | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/units-of-measure")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить единицы измерения")
        return (await response.json()) as UnitOfMeasure[]
      })
      .then((data) => {
        if (cancelled) return
        setUnits(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить единицы измерения с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const topLevel = useMemo(() => units.filter((unit) => unit.parentId === null), [units])
  const childrenOf = (id: number) => units.filter((unit) => unit.parentId === id)

  const filtered = useMemo(() => {
    if (!query.trim()) return null
    const q = query.trim().toLowerCase()
    return units.filter((unit) => unit.name.toLowerCase().includes(q))
  }, [units, query])

  const flatCount = filtered ? filtered.length : topLevel.length
  const pageCount = Math.max(1, Math.ceil(flatCount / pageSize))
  const safePage = Math.min(page, pageCount)

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditing("new")
  }

  function openEdit(unit: UnitOfMeasure) {
    setDraft({ parentId: unit.parentId !== null ? String(unit.parentId) : "", name: unit.name })
    setFormError("")
    setEditing(unit)
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить единицу измерения?")) return
    try {
      const response = await fetch(`/api/units-of-measure/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить единицу измерения")
        return
      }
      // Server also removes direct children pointing at this unit — mirror that locally.
      setUnits((current) => current.filter((unit) => unit.id !== id && unit.parentId !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const trimmed = draft.name.trim()
    if (!trimmed) return
    const parentId = draft.parentId ? Number(draft.parentId) : null

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editing !== "new" && editing !== null
      const targetId = isEdit ? (editing as UnitOfMeasure).id : null
      const response = await fetch(isEdit ? `/api/units-of-measure/${targetId}` : "/api/units-of-measure", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, parentId }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить единицу измерения")
        return
      }
      const saved = (await response.json()) as UnitOfMeasure
      setUnits((current) => (isEdit ? current.map((unit) => (unit.id === targetId ? saved : unit)) : [saved, ...current]))
      setEditing(null)
      setPage(1)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function downloadTemplate() {
    downloadExcelTable("units-of-measure-template", [["Наименование", "Родительское измерение"]])
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

      const parsed: { name: string; parentId: number | null }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.parentName = row[1] ?? ""
        }
        if (!record.name) continue
        const parent = record.parentName
          ? units.find((unit) => unit.name.toLowerCase() === record.parentName.trim().toLowerCase())
          : undefined
        parsed.push({ name: record.name.trim(), parentId: parent ? parent.id : null })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: UnitOfMeasure[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/units-of-measure", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as UnitOfMeasure)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setUnits((current) => [...created, ...current])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  const gridCols = "grid-cols-[666px_1fr]"
  const dateOf = (value: string) => value.replace(/\s*г\.$/, "")

  function renderRow(unit: UnitOfMeasure, isChild: boolean) {
    const hasChildren = !isChild && childrenOf(unit.id).length > 0
    return (
      <div
        key={unit.id}
        onClick={() => openEdit(unit)}
        className={`group relative grid min-h-[50px] cursor-pointer items-center hover:bg-[#f8f9fb] ${isChild ? "grid-cols-[616px_1fr]" : gridCols} ${isChild ? "ml-[30px] mr-[30px] border-b-2 border-dotted border-[#d9e0e5] pl-[50px]" : "border-b-2 border-dotted border-[#d9e0e5] pl-[30px]"}`}
      >
        <span className={isChild ? "" : "font-bold"}>{unit.name}</span>
        <span className={hasChildren ? "font-bold" : ""}>{dateOf(unit.createdDate)}</span>
        <HoverActions onEdit={() => openEdit(unit)} onDelete={() => remove(unit.id)} />
      </div>
    )
  }

  const flatVisible = filtered ? filtered.slice((safePage - 1) * pageSize, safePage * pageSize) : null

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        addLabel={t("добавить измерение")}
        onAdd={openCreate}
        query={query}
        onQuery={(value) => { setQuery(value); setPage(1) }}
        pageSize={pageSize}
        from={flatCount ? (safePage - 1) * pageSize + 1 : 0}
        to={Math.min(safePage * pageSize, flatCount)}
        total={flatCount}
        onPrev={safePage > 1 ? () => setPage(safePage - 1) : undefined}
        onNext={safePage < pageCount ? () => setPage(safePage + 1) : undefined}
        extra={<button type="button" onClick={() => setImportOpen(true)} className="ml-[24px] pt-[8px] text-[13px] text-[#4f71dc] hover:underline">{t("Импорт с Excel")}</button>}
      />

      <div className={`${grayHead} ${gridCols}`}>
        <span>{t("Наименование")}</span><span>{t("Дата создания")}</span>
      </div>

      {loading ? (
        <p className="py-16 text-center text-slate-400">{t("Загрузка единиц измерения...")}</p>
      ) : loadError ? (
        <p className="py-16 text-center text-red-600">{loadError}</p>
      ) : filtered ? (
        flatVisible!.map((unit) => renderRow(unit, false))
      ) : (
        topLevel.slice((safePage - 1) * pageSize, safePage * pageSize).map((unit) => (
          <Fragment key={unit.id}>
            {renderRow(unit, false)}
            {childrenOf(unit.id).map((child) => renderRow(child, true))}
          </Fragment>
        ))
      )}
      {!loading && !loadError && flatCount === 0 && <EmptyState />}

      {editing !== null && (
        <Modal
          title={editing === "new" ? t("Добавить единицу измерения") : t("Изменить единицу измерения")}
          onClose={() => setEditing(null)}
          footer={<SaveButton disabled={saving || !draft.name.trim()} onClick={() => void save({ preventDefault() {} } as FormEvent)}>{saving ? t("Сохранение...") : t("Сохранить")}</SaveButton>}
        >
          <LineSelect
            label={t("Родительское измерение")}
            value={topLevel.find((unit) => String(unit.id) === draft.parentId)?.name ?? ""}
            onChange={(name) => setDraft((value) => ({ ...value, parentId: String(topLevel.find((unit) => unit.name === name)?.id ?? "") }))}
            options={topLevel.filter((unit) => editing === "new" || unit.id !== (editing as UnitOfMeasure).id).map((unit) => unit.name)}
            onClear={() => setDraft((value) => ({ ...value, parentId: "" }))}
          />
          <div className="mt-[27px]"><LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} /></div>
          {formError && <p className="mt-4 text-[13px] font-semibold text-rose-600">{formError}</p>}
        </Modal>
      )}

      {importOpen && <ImportDialog file={importFile} onFile={setImportFile} onTemplate={downloadTemplate} onSave={saveImport} saving={importSaving} onClose={() => { setImportOpen(false); setImportFile(null) }} />}
    </div>
  )
}
