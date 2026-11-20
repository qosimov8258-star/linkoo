"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { CashSnackbar, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { EQUIPMENT_PHOTO_ACCEPT, readEquipmentPhoto } from "@/components/analytics/production/equipment-photo"
import { useLanguage } from "@/lib/i18n/language-context"

import { ConfirmDelete, EmptyState, ErrorAlert, HoverActions, LineField, LineSelect, ListToolbar, Modal, SaveLink, grayHead, listRow } from "./catalog-ui"

// Настройки → «Оборудования» (Linko #/equipment: Id | Наименование | Производство). The same machines as the
// stage tabs «Оборудование» (/api/equipment reads the production equipment): one added, renamed, moved or
// deleted here is the stage tab's machine. «Производство» is the stage (/api/manufacturings = the stages).

type Equipment = { id: number; name: string; manufacturingId: number | null; manufacturing: string }
type Manufacturing = { id: number; name: string }
type Field = "name" | "manufacturingId" | "photo"

const GRID = "grid-cols-[210px_608px_1fr]"
/** Who may add, change and delete machines (the server's rule for /api/equipment writes, lib/capabilities-catalog.ts). */
const EQUIPMENT_WRITE = ["production.manage"] as const
// Linko's field messages (the server answers the same ones, lib/production-staffeq-schemas.ts).
const REQUIRED = "Это поле обязательно к заполнению"
const BLANK = "Это поле не может быть пустым."
const TOO_LONG = "Убедитесь, что в этом поле не больше 255 символов."
const FIELD_ERROR = "mt-1 block text-[12px] font-normal text-[#f44336]"

type Refusal = { error?: unknown; field?: unknown; details?: { fieldErrors?: Record<string, unknown> }; usage?: unknown }

/** A refusal in the UI language, with the usage list of a blocked delete ("…: Операции (1), Продукция (1)"). */
function refusalText(data: Refusal, fallback: string, t: (text: string) => string): string {
  const base = t(typeof data.error === "string" && data.error ? data.error : fallback)
  const usage = Array.isArray(data.usage) ? (data.usage as Array<{ label?: unknown; count?: unknown }>).filter((item) => typeof item?.label === "string") : []
  return usage.length ? `${base}: ${usage.map((item) => `${t(String(item.label))} (${Number(item.count) || 0})`).join(", ")}` : base
}

export function EquipmentView() {
  const { t } = useLanguage()
  const canManage = useCanManage(EQUIPMENT_WRITE)
  const [items, setItems] = useState<Equipment[]>([])
  const [manufacturings, setManufacturings] = useState<Manufacturing[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editing, setEditing] = useState<{ id: number } | null>(null)
  const [name, setName] = useState("")
  const [manufacturingId, setManufacturingId] = useState<number | null>(null)
  const [manufacturingName, setManufacturingName] = useState("")
  // undefined: the stored photo stays; null: removed; a data URL: the new photo.
  const [photo, setPhoto] = useState<string | null | undefined>(undefined)
  const [storedPhoto, setStoredPhoto] = useState("")
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<Equipment | null>(null)
  const [alertMessage, setAlertMessage] = useState("")
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const closeMessage = useCallback(() => setMessage(null), [])
  const photoInput = useRef<HTMLInputElement>(null)

  function load() {
    fetch("/api/equipment")
      .then((response) => (response.ok ? (response.json() as Promise<Equipment[]>) : []))
      .then(setItems)
      .catch(() => setItems([]))
  }

  useEffect(load, [])
  // The stages are read again whenever the dialog opens: a stage added or renamed meanwhile is there.
  useEffect(() => {
    if (!editing) return
    fetch("/api/manufacturings")
      .then((response) => (response.ok ? (response.json() as Promise<Manufacturing[]>) : []))
      .then(setManufacturings)
      .catch(() => undefined)
  }, [editing])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru")
    return needle ? items.filter((item) => item.name.toLocaleLowerCase("ru").includes(needle)) : items
  }, [items, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const visible = filtered.slice(start, start + pageSize)
  const clear = (field: Field) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))

  async function open(item?: Equipment) {
    setEditing({ id: item?.id ?? 0 })
    setName(item?.name ?? "")
    setManufacturingId(item?.manufacturingId ?? null)
    setManufacturingName(item?.manufacturing ?? "")
    setPhoto(undefined)
    setStoredPhoto("")
    setErrors({})
    if (item) {
      const response = await fetch(`/api/equipment/${item.id}`)
      if (response.ok) setStoredPhoto(((await response.json()) as { photo: string }).photo)
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return
    try {
      setPhoto(await readEquipmentPhoto(file))
      clear("photo")
    } catch (error) {
      setAlertMessage(t(error instanceof Error && error.message ? error.message : "Неверный формат изображения"))
    }
  }

  async function save() {
    if (!editing || saving) return
    // Like Linko: СОХРАНИТЬ is always on, the reasons appear under the fields.
    const found: Partial<Record<Field, string>> = {}
    if (name === "") found.name = REQUIRED
    else if (!name.trim()) found.name = BLANK
    else if (name.trim().length > 255) found.name = TOO_LONG
    if (!manufacturingId) found.manufacturingId = REQUIRED
    if (Object.keys(found).length) {
      setErrors(found)
      return
    }
    setSaving(true)
    try {
      const response = await fetch(editing.id ? `/api/equipment/${editing.id}` : "/api/equipment", {
        method: editing.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, manufacturingId, ...(photo === undefined ? {} : { photo }) }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as Refusal
        const fields: Partial<Record<Field, string>> = {}
        const fieldErrors = data.details?.fieldErrors ?? {}
        const firstOf = (key: string) => {
          const value = fieldErrors[key]
          return Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined
        }
        for (const [key, field] of [["name", "name"], ["manufacturingId", "manufacturingId"], ["stageId", "manufacturingId"], ["photo", "photo"], ["image", "photo"]] as const) {
          const text = firstOf(key) ?? (data.field === key && typeof data.error === "string" ? data.error : undefined)
          if (text && !fields[field]) fields[field] = text
        }
        if (Object.keys(fields).length) setErrors(fields)
        else setAlertMessage(refusalText(data, "Не удалось сохранить", t))
        return
      }
      setEditing(null)
      load()
      setMessage({ text: "Успешно сохранено", tone: "success" })
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
        // A machine in use stays: the alert names where it is used.
        const data = (await response.json().catch(() => ({}))) as Refusal
        setDeleting(null)
        setAlertMessage(refusalText(data, "Не удалось удалить запись", t))
        return
      }
      setDeleting(null)
      load()
      setMessage({ text: "Успешно удалено", tone: "success" })
    } catch {
      setAlertMessage(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const shownPhoto = photo === undefined ? storedPhoto : (photo ?? "")

  return (
    <div className="min-h-[calc(100vh-50px)] min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <ListToolbar
        hideTotal
        hideAdd={!canManage}
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
          {canManage && <HoverActions offset={24} onEdit={() => void open(item)} onDelete={() => setDeleting(item)} />}
        </div>
      ))}
      {visible.length === 0 && <EmptyState />}

      {editing && (
        <Modal
          title={editing.id ? t("Изменить оборудование") : t("Добавить оборудование")}
          onClose={() => setEditing(null)}
          bodyClassName="pl-[30px] pr-[52px] pt-[38px] pb-[50px]"
          footer={<SaveLink disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveLink>}
        >
          <div className="space-y-[26px]">
            <div>
              <LineField label={t("Наименование")} value={name} onChange={(value) => { setName(value); clear("name") }} />
              {errors.name && <span className={FIELD_ERROR}>{t(errors.name)}</span>}
            </div>
            <div>
              <LineSelect
                label={t("Производство")}
                value={manufacturingName}
                options={manufacturings.map((item) => item.name)}
                onChange={(value) => {
                  const found = manufacturings.find((item) => item.name === value)
                  setManufacturingName(value)
                  setManufacturingId(found?.id ?? null)
                  clear("manufacturingId")
                }}
                onClear={() => { setManufacturingName(""); setManufacturingId(null) }}
              />
              {errors.manufacturingId && <span className={FIELD_ERROR}>{t(errors.manufacturingId)}</span>}
            </div>
          </div>
          <input ref={photoInput} type="file" accept={EQUIPMENT_PHOTO_ACCEPT} className="hidden" onChange={(event) => { void pickPhoto(event.target.files?.[0]); event.target.value = "" }} />
          <div
            role="button"
            tabIndex={0}
            aria-label={t("Добавьте фото")}
            onClick={() => photoInput.current?.click()}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") photoInput.current?.click() }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); void pickPhoto(event.dataTransfer.files?.[0]) }}
            className={`relative ml-[30px] mt-[30px] flex h-[160px] w-[160px] cursor-pointer items-center justify-center overflow-hidden border-2 border-dashed ${errors.photo ? "border-[#f44336]" : "border-[#efefef]"}`}
          >
            {shownPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element -- the machine's picture URL or a new data URL
              <img src={shownPhoto} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="flex flex-col items-center gap-[10px] text-[13px]">
                <svg viewBox="0 0 24 24" className="h-8 w-8 fill-[#bdbdbd]"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" /></svg>
                {t("Добавьте фото")}
              </span>
            )}
            {shownPhoto && (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); setPhoto(null); clear("photo") }}
                aria-label={t("Удалить фото")}
                title={t("Удалить фото")}
                className="absolute right-1 top-1 rounded-full bg-white/90 p-1 shadow hover:bg-white"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#666] hover:fill-[#e57373]" aria-hidden><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
              </button>
            )}
          </div>
          {errors.photo && <span className={`${FIELD_ERROR} ml-[30px]`}>{t(errors.photo)}</span>}
        </Modal>
      )}

      {deleting && <ConfirmDelete name={deleting.name} onConfirm={() => void remove()} onClose={() => setDeleting(null)} />}
      {alertMessage && <ErrorAlert message={alertMessage} onClose={() => setAlertMessage("")} />}
      <CashSnackbar message={message} onClose={closeMessage} />
    </div>
  )
}
