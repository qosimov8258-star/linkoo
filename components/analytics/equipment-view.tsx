"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

import { resizeDictionaryImage } from "./dictionaries-shared"
import { ConfirmDelete, EmptyState, ErrorAlert, HoverActions, LineField, LineSelect, ListToolbar, Modal, SaveLink, grayHead, listRow } from "./catalog-ui"

type Equipment = { id: number; name: string; manufacturingId: number | null; manufacturing: string }
type Manufacturing = { id: number; name: string }

const GRID = "grid-cols-[210px_608px_1fr]"

export function EquipmentView() {
  const { t } = useLanguage()
  const [items, setItems] = useState<Equipment[]>([])
  const [manufacturings, setManufacturings] = useState<Manufacturing[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editing, setEditing] = useState<{ id: number } | null>(null)
  const [name, setName] = useState("")
  const [manufacturing, setManufacturing] = useState("")
  const [photo, setPhoto] = useState<string | null | undefined>(undefined)
  const [storedPhoto, setStoredPhoto] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<Equipment | null>(null)
  const [alertMessage, setAlertMessage] = useState("")
  const photoInput = useRef<HTMLInputElement>(null)

  function load() {
    fetch("/api/equipment")
      .then((response) => (response.ok ? (response.json() as Promise<Equipment[]>) : []))
      .then(setItems)
      .catch(() => setItems([]))
  }

  useEffect(load, [])
  useEffect(() => {
    fetch("/api/manufacturings")
      .then((response) => (response.ok ? (response.json() as Promise<Manufacturing[]>) : []))
      .then(setManufacturings)
      .catch(() => undefined)
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items
  }, [items, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const visible = filtered.slice(start, start + pageSize)

  async function open(item?: Equipment) {
    setEditing({ id: item?.id ?? 0 })
    setName(item?.name ?? "")
    setManufacturing(item?.manufacturing ?? "")
    setPhoto(undefined)
    setStoredPhoto("")
    if (item) {
      const response = await fetch(`/api/equipment/${item.id}`)
      if (response.ok) setStoredPhoto(((await response.json()) as { photo: string }).photo)
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) return
    try {
      setPhoto(await resizeDictionaryImage(file))
    } catch {
      setAlertMessage(t("Неверный формат изображения"))
    }
  }

  async function save() {
    if (!editing || !name.trim() || saving) return
    setSaving(true)
    try {
      const response = await fetch(editing.id ? `/api/equipment/${editing.id}` : "/api/equipment", {
        method: editing.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), manufacturingId: manufacturings.find((item) => item.name === manufacturing)?.id ?? null, photo }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setAlertMessage(t(data.error || "Не удалось сохранить"))
        return
      }
      setEditing(null)
      load()
    } catch {
      setAlertMessage(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!deleting) return
    try {
      const response = await fetch(`/api/equipment/${deleting.id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setAlertMessage(t(data.error || "Не удалось удалить запись"))
        return
      }
      setDeleting(null)
      load()
    } catch {
      setAlertMessage(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const shownPhoto = photo === undefined ? storedPhoto : photo

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        hideTotal
        addLabel={t("добавить оборудование")}
        onAdd={() => void open()}
        query={query}
        onQuery={(value) => { setQuery(value); setPage(1) }}
        addPad={16}
        searchPos={{ left: 335, top: 19 }}
        pageSize={pageSize}
        onPageSize={(size) => { setPageSize(size); setPage(1) }}
        from={filtered.length ? start + 1 : 0}
        to={Math.min(start + pageSize, filtered.length)}
        total={filtered.length}
        onPrev={safePage > 1 ? () => setPage(safePage - 1) : undefined}
        onNext={safePage < pageCount ? () => setPage(safePage + 1) : undefined}
      />
      <div className={`${grayHead} ${GRID}`}>
        <span>Id</span><span>{t("Наименование")}</span><span>{t("Производство")}</span>
      </div>
      {visible.map((item) => (
        <div key={item.id} className={`${listRow} ${GRID}`}>
          <span>{item.id}</span>
          <span>{item.name}</span>
          <span>{item.manufacturing}</span>
          <HoverActions offset={24} onEdit={() => void open(item)} onDelete={() => setDeleting(item)} />
        </div>
      ))}
      {visible.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить оборудование") : t("Добавить оборудование")}
          onClose={() => setEditing(null)}
          bodyClassName="pl-[30px] pr-[52px] pt-[38px] pb-[50px]"
          footer={<SaveLink disabled={saving || !name.trim()} onClick={() => void save()}>{t("Сохранить")}</SaveLink>}
        >
          <div className="space-y-[26px]">
            <LineField label={t("Наименование")} value={name} onChange={setName} />
            <LineSelect label={t("Производство")} value={manufacturing} options={manufacturings.map((item) => item.name)} onChange={setManufacturing} onClear={() => setManufacturing("")} />
          </div>
          <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={(event) => { void pickPhoto(event.target.files?.[0]); event.target.value = "" }} />
          <div
            role="button"
            tabIndex={0}
            onClick={() => photoInput.current?.click()}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") photoInput.current?.click() }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); void pickPhoto(event.dataTransfer.files?.[0]) }}
            className="relative ml-[30px] mt-[30px] flex h-[160px] w-[160px] cursor-pointer items-center justify-center overflow-hidden border-2 border-dashed border-[#efefef]"
          >
            {shownPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL preview
              <img src={shownPhoto} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="flex flex-col items-center gap-[10px] text-[13px]">
                <svg viewBox="0 0 24 24" className="h-8 w-8 fill-[#bdbdbd]"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
                {t("Добавьте фото")}
              </span>
            )}
          </div>
        </Modal>
      )}

      {deleting && <ConfirmDelete name={deleting.name} onConfirm={() => void remove()} onClose={() => setDeleting(null)} />}
      {alertMessage && <ErrorAlert message={alertMessage} onClose={() => setAlertMessage("")} />}
    </div>
  )
}
