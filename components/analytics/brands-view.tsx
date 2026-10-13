"use client"

import { ImagePlus, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { brandOrganizations as organizations, type Brand } from "./brands-data"
import { EmptyState, ImportDialog, LineField, LineSelect, ListToolbar, Modal, SaveButton, grayHead, listRow } from "./catalog-ui"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "организация": "organization", "organization": "organization",
}

function emptyDraft() {
  return { name: "", organization: "", photoUrl: null as string | null }
}

export function BrandsView({ embedded = false }: { embedded?: boolean }) {
  void embedded
  const { t } = useLanguage()
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/brands")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить бренды")
        return (await response.json()) as Brand[]
      })
      .then((data) => {
        if (cancelled) return
        setBrands(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить бренды с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return brands
    const q = query.trim().toLowerCase()
    return brands.filter((brand) => brand.name.toLowerCase().includes(q))
  }, [brands, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(brand: Brand) {
    setDraft({ name: brand.name, organization: brand.organization === "Не указано" ? "" : brand.organization, photoUrl: brand.photoUrl && brand.photoUrl !== "brand" ? brand.photoUrl : null })
    setFormError("")
    setEditingId(brand.id)
    setModalOpen(true)
    setOpenMenuId(null)
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить бренд?")) return
    try {
      const response = await fetch(`/api/brands/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить бренд")
        return
      }
      setBrands((current) => current.filter((brand) => brand.id !== id))
      setOpenMenuId(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setDraft((value) => ({ ...value, photoUrl: String(reader.result ?? "") }))
    reader.readAsDataURL(file)
    event.target.value = ""
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const name = draft.name.trim()
    if (!name || !draft.organization) return

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/brands/${editingId}` : "/api/brands", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, organization: draft.organization, photoUrl: draft.photoUrl }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить бренд")
        return
      }
      const saved = (await response.json()) as Brand
      setBrands((current) => (isEdit ? current.map((brand) => (brand.id === editingId ? saved : brand)) : [saved, ...current]))
      setModalOpen(false)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function downloadTemplate() {
    downloadExcelTable("brands-template", [["Наименование", "Организация"]])
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

      const parsed: { name: string; organization: string }[] = []
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
        }
        if (!record.name || /^(наименование|название|name)$/i.test(record.name)) continue
        parsed.push({ name: record.name, organization: organizations.includes(record.organization) ? record.organization : organizations[0] })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: Brand[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/brands", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: item.name, organization: item.organization, photoUrl: null }),
          })
          if (response.ok) created.push((await response.json()) as Brand)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setBrands((current) => [...created, ...current])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  const total = filtered.length
  const gridCols = "grid-cols-[118px_219px_329px_328px_1fr]"

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        addLabel={t("Добавить бренд")}
        bigPlus
        onAdd={openCreate}
        query={query}
        onQuery={(value) => { setQuery(value); setPage(1) }}
        pageSize={pageSize}
        from={total ? (safePage - 1) * pageSize + 1 : 0}
        to={Math.min(safePage * pageSize, total)}
        total={total}
        onPrev={safePage > 1 ? () => setPage(safePage - 1) : undefined}
        onNext={safePage < pageCount ? () => setPage(safePage + 1) : undefined}
        extra={<button type="button" onClick={() => setImportOpen(true)} className="ml-[24px] pt-[8px] text-[13px] text-[#4f71dc] hover:underline">{t("Импорт с Excel")}</button>}
      />

      <div className={`${grayHead} ${gridCols}`}>
        <span>Id</span><span>{t("Фото")}</span><span>{t("Наименование")}</span><span>{t("Организация")}</span><span>{t("Дата создания")}</span>
      </div>

      {loading ? (
        <p className="py-16 text-center text-slate-400">{t("Загрузка брендов...")}</p>
      ) : loadError ? (
        <p className="py-16 text-center text-red-600">{loadError}</p>
      ) : (
        visible.map((brand) => (
          <div key={brand.id} onClick={() => openEdit(brand)} className={`${listRow} ${gridCols}`}>
            <span>{brand.id}</span>
            <span>
              {brand.photoUrl && brand.photoUrl !== "brand" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.photoUrl} alt={brand.name} className="h-[20px] w-[40px] object-cover" />
              )}
              {brand.photoUrl === "brand" && <span className="inline-block h-[20px] w-[40px] border border-[#c9ced6]" />}
            </span>
            <span className="pr-4">{brand.name}</span>
            <span className="pr-4">{brand.organization}</span>
            <span>{brand.createdDate.replace(/\s*г\.$/, "")}</span>
            <>
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => (current === brand.id ? null : brand.id)) }}
                aria-label={t("Ещё")}
                className="absolute right-[41px] top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-[#333]"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" /></svg>
              </button>
              {openMenuId === brand.id && (
                <>
                  <span className="fixed inset-0 z-20" onClick={(event) => { event.stopPropagation(); setOpenMenuId(null) }} />
                  <div onClick={(event) => event.stopPropagation()} className="absolute right-[60px] top-[-8px] z-30 w-[168px] bg-white py-[2px] text-left shadow-[0_2px_12px_rgba(0,0,0,0.22)]">
                    <button type="button" onClick={() => openEdit(brand)} className="flex h-[48px] w-full items-center gap-[20px] pl-[22px] text-[13px] font-semibold text-[#444] hover:bg-slate-50">
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#757575]"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
                      {t("Изменить")}
                    </button>
                    <button type="button" onClick={() => remove(brand.id)} className="flex h-[48px] w-full items-center gap-[20px] pl-[22px] text-[13px] font-semibold text-[#444] hover:bg-slate-50">
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#757575]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
                      {t("Удалить")}
                    </button>
                  </div>
                </>
              )}
            </>
          </div>
        ))
      )}

      {!loading && !loadError && visible.length === 0 && <EmptyState />}

      {modalOpen && (
        <Modal
          title={editingId !== null ? t("Изменить бренд") : t("Добавить бренд")}
          onClose={() => setModalOpen(false)}
          footer={<SaveButton disabled={saving || !draft.name.trim() || !draft.organization} onClick={() => void save({ preventDefault() {} } as FormEvent)}>{saving ? t("Сохранение...") : t("Сохранить")}</SaveButton>}
        >
          <LineField label={t("Наименование")} required value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} />
          <div className="mt-[27px]"><LineSelect label={t("Организация")} required value={draft.organization} onChange={(value) => setDraft((current) => ({ ...current, organization: value }))} options={organizations} onClear={() => setDraft((current) => ({ ...current, organization: "" }))} /></div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
          <div className="mt-[30px] flex items-start gap-[20px]">
            {draft.photoUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={draft.photoUrl} alt={t("Фото бренда")} className="h-[110px] w-[110px] object-cover" />
                <button type="button" onClick={() => setDraft((current) => ({ ...current, photoUrl: null }))} aria-label={t("Удалить фото")} className="absolute -right-2 -top-2 rounded-full bg-white p-1 text-slate-500 shadow hover:text-rose-500"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-[110px] w-[110px] flex-col items-center justify-center gap-2 border border-dashed border-[#c9ced6] text-[#9aa3b0] hover:text-[#4f71dc]">
                <ImagePlus className="h-7 w-7" />
                {t("Добавьте фото")}
              </button>
            )}
            {draft.photoUrl && <button type="button" onClick={() => fileInputRef.current?.click()} className="text-[13px] text-[#4f71dc] hover:underline">{t("Заменить фото")}</button>}
          </div>
          {formError && <p className="mt-4 text-[13px] font-semibold text-rose-600">{formError}</p>}
        </Modal>
      )}

      {importOpen && <ImportDialog file={importFile} onFile={setImportFile} onTemplate={downloadTemplate} onSave={saveImport} saving={importSaving} onClose={() => { setImportOpen(false); setImportFile(null) }} />}
    </div>
  )
}
