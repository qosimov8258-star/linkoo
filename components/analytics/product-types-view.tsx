"use client"

import { ImagePlus } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { EmptyState, HoverActions, ImportDialog, LineField, LineSelect, ListToolbar, Modal, SaveButton, grayHead } from "./catalog-ui"
import { productTypeOrganizations as organizations, type ProductType } from "./product-types-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование категории": "name", "название": "name", "наименование": "name", "name": "name",
  "организация": "organization", "organization": "organization",
  "показывать в боте": "showInBot",
  "родительская категория": "parentName",
}

function emptyDraft() {
  return { parentId: "", name: "", organization: organizations[0], order: "", showInBot: false, photoName: "" }
}

export function ProductTypesView({ embedded = false }: { embedded?: boolean }) {
  void embedded
  const { t } = useLanguage()
  const [types, setTypes] = useState<ProductType[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [editing, setEditing] = useState<ProductType | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/product-types")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить типы продуктов")
        return (await response.json()) as ProductType[]
      })
      .then((data) => {
        if (cancelled) return
        setTypes(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить типы продуктов с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const topLevel = types.filter((type) => type.parentId === null)
  const childrenOf = (id: number) => types.filter((type) => type.parentId === id)

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditing("new")
  }

  function openEdit(type: ProductType) {
    setDraft({
      parentId: type.parentId !== null ? String(type.parentId) : "",
      name: type.name,
      organization: type.organization,
      order: "",
      showInBot: type.showInBot,
      photoName: "",
    })
    setFormError("")
    setEditing(type)
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить тип продукта?")) return
    try {
      const response = await fetch(`/api/product-types/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить тип продукта")
        return
      }
      // Server also removes direct children pointing at this type — mirror that locally.
      setTypes((current) => current.filter((type) => type.id !== id && type.parentId !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) setDraft((value) => ({ ...value, photoName: file.name }))
    event.target.value = ""
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const trimmed = draft.name.trim()
    if (!trimmed || !draft.organization) return
    const parentId = draft.parentId ? Number(draft.parentId) : null

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editing !== "new" && editing !== null
      const targetId = isEdit ? (editing as ProductType).id : null
      const response = await fetch(isEdit ? `/api/product-types/${targetId}` : "/api/product-types", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, organization: draft.organization, showInBot: draft.showInBot, parentId }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить тип продукта")
        return
      }
      const saved = (await response.json()) as ProductType
      setTypes((current) => (isEdit ? current.map((type) => (type.id === targetId ? saved : type)) : [...current, saved]))
      setEditing(null)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function downloadTemplate() {
    downloadExcelTable("product-types-template", [["Наименование категории", "Организация", "Показывать в боте", "Родительская категория"]])
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

      const parsed: { name: string; organization: string; showInBot: boolean; parentId: number | null }[] = []
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
          record.showInBot = row[2] ?? ""
          record.parentName = row[3] ?? ""
        }
        if (!record.name) continue
        const parent = record.parentName
          ? topLevel.find((type) => type.name.trim().toLowerCase() === record.parentName.trim().toLowerCase())
          : undefined
        parsed.push({
          name: record.name.trim(),
          organization: record.organization || organizations[0],
          showInBot: /^(да|yes|true|1)$/i.test((record.showInBot || "").trim()),
          parentId: parent ? parent.id : null,
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: ProductType[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/product-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as ProductType)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setTypes((current) => [...current, ...created])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  const dateOf = (value: string) => value.replace(/\s*г\.$/, "")
  const yes = (type: ProductType) => (type.showInBot ? t("Да") : t("Нет"))
  const rowBase = "group relative grid cursor-pointer items-center hover:bg-[#f8f9fb]"

  function renderParent(type: ProductType) {
    const kids = childrenOf(type.id)
    if (kids.length === 0) {
      return (
        <div key={type.id} onClick={() => openEdit(type)} className={`${rowBase} min-h-[55px] grid-cols-[344px_337px_336px_1fr] border-b-2 border-dotted border-[#d9e0e5] pl-[15px]`}>
          <span className="pr-4 font-bold">{type.name}</span>
          <span>{type.organization}</span>
          <span>{dateOf(type.createdDate)}</span>
          <span>{yes(type)}</span>
          <HoverActions onEdit={() => openEdit(type)} onDelete={() => remove(type.id)} />
        </div>
      )
    }
    return (
      <div key={type.id}>
        <div onClick={() => openEdit(type)} className={`${rowBase} min-h-[50px] grid-cols-[337px_329px_328px_1fr] border-b-2 border-dotted border-[#d9e0e5] pl-[30px] font-bold`}>
          <span className="pr-4">{type.name}</span>
          <span>{type.organization}</span>
          <span>{dateOf(type.createdDate)}</span>
          <span>{yes(type)}</span>
          <HoverActions onEdit={() => openEdit(type)} onDelete={() => remove(type.id)} />
        </div>
        {kids.map((child) => (
          <div key={child.id} onClick={() => openEdit(child)} className={`${rowBase} mx-[30px] min-h-[45px] grid-cols-[442px_325px_216px_1fr] border-b-2 border-dotted border-[#d9e0e5] pl-[123px]`}>
            <span className="pr-4">{child.name}</span>
            <span>{child.organization}</span>
            <span>{dateOf(child.createdDate)}</span>
            <span>{yes(child)}</span>
            <HoverActions onEdit={() => openEdit(child)} onDelete={() => remove(child.id)} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        addLabel={t("добавить тип продукта")}
        onAdd={openCreate}
        extra={<button type="button" onClick={() => setImportOpen(true)} className="ml-[24px] pt-[8px] text-[13px] text-[#4f71dc] hover:underline">{t("Импорт с Excel")}</button>}
      />

      <div className={`${grayHead} grid-cols-[337px_329px_328px_1fr]`}>
        <span>{t("Категории")}</span><span>{t("Организация")}</span><span>{t("Дата создания")}</span><span>{t("Показывать в боте")}</span>
      </div>

      {loading ? (
        <p className="py-16 text-center text-slate-400">{t("Загрузка типов продуктов...")}</p>
      ) : loadError ? (
        <p className="py-16 text-center text-red-600">{loadError}</p>
      ) : (
        topLevel.map((type) => renderParent(type))
      )}
      {!loading && !loadError && types.length === 0 && <EmptyState />}

      {editing !== null && (
        <Modal
          title={editing === "new" ? t("Добавить тип продукта") : t("Изменить тип продукта")}
          onClose={() => setEditing(null)}
          footer={<SaveButton disabled={saving || !draft.name.trim()} onClick={() => void save({ preventDefault() {} } as FormEvent)}>{saving ? t("Сохранение...") : t("Сохранить")}</SaveButton>}
        >
          <LineSelect
            label={t("Родительская категория")}
            value={topLevel.find((type) => String(type.id) === draft.parentId)?.name ?? ""}
            onChange={(name) => setDraft((value) => ({ ...value, parentId: String(topLevel.find((type) => type.name === name)?.id ?? "") }))}
            options={topLevel.filter((type) => editing === "new" || type.id !== (editing as ProductType).id).map((type) => type.name)}
            onClear={() => setDraft((value) => ({ ...value, parentId: "" }))}
          />
          <div className="mt-[27px]"><LineField label={t("Наименование категории")} required value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} /></div>
          <div className="mt-[27px]"><LineSelect label={t("Организация")} required value={draft.organization} onChange={(value) => setDraft((current) => ({ ...current, organization: value }))} options={organizations} onClear={() => setDraft((current) => ({ ...current, organization: "" }))} /></div>
          <div className="mt-[27px]"><LineField label={t("Порядок")} value={draft.order} onChange={(value) => setDraft((current) => ({ ...current, order: value }))} /></div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-[24px] flex h-[80px] w-[110px] flex-col items-center justify-center gap-1 border border-dashed border-[#c9ced6] text-[12px] text-[#9aa3b0] hover:text-[#4f71dc]">
            <ImagePlus className="h-6 w-6" />
            {draft.photoName || t("Добавьте фото")}
          </button>
          <div className="mt-[24px] flex items-center gap-[10px]">
            <button type="button" role="switch" aria-checked={draft.showInBot} onClick={() => setDraft((value) => ({ ...value, showInBot: !value.showInBot }))} className="relative h-[22px] w-[40px] shrink-0">
              <span className={`absolute left-[2px] top-[4px] h-[14px] w-[34px] rounded-full ${draft.showInBot ? "bg-[#a7b8ed]" : "bg-[#bdbdbd]"}`} />
              <span className={`absolute top-0 h-[22px] w-[22px] rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-all ${draft.showInBot ? "left-[18px] bg-[#4f71dc]" : "left-0 bg-white"}`} />
            </button>
            <span className="leading-[16px]"><span className="font-semibold">{t("Показывать в боте")}</span><span className="block text-[#555]">{t("Показывать в телеграм боте")}</span></span>
          </div>
          {formError && <p className="mt-4 text-[13px] font-semibold text-rose-600">{formError}</p>}
        </Modal>
      )}

      {importOpen && <ImportDialog file={importFile} onFile={setImportFile} onTemplate={downloadTemplate} onSave={saveImport} saving={importSaving} onClose={() => { setImportOpen(false); setImportFile(null) }} />}
    </div>
  )
}
