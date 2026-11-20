"use client"

import { Loader2, X } from "lucide-react"
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { useJsonList } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  KB_FILE_MAX_BYTES,
  KB_MESSAGES,
  KB_NAME_MAX,
  KB_TEXT_MAX,
  KNOWLEDGE_BASE_ACCESS_RIGHTS_API,
  KNOWLEDGE_BASE_API,
  KNOWLEDGE_BASE_FILES_API,
  type KnowledgeBaseArticle,
  type KnowledgeBaseFile,
  type KnowledgeBasePosition,
} from "@/lib/knowledge-base-types"

// The full-screen add / edit dialog of "База знания" (demo KnowledgeCreateForm), laid out like
// Linko's: title "Добавить" / "Изменить" with ✕, full-width material fields Название, Текст (grows
// with the text), Активный (off for a new article), Права доступа (access rights as chips; none =
// everyone) and the PDF drop zone, which uploads the file at once (POST /api/knowledge-base/files)
// and keeps the stored file on edit unless it is removed or replaced (Linko cannot show the stored
// file at all); "Сохранить" at the bottom right.
// Escape closes the open position list first, then the dialog.

type FieldErrors = Partial<Record<"name" | "text" | "positions" | "file", string>>

type ErrorBody = {
  error?: string
  field?: string | null
  fields?: Record<string, string>
  details?: { fieldErrors?: Record<string, string[] | undefined> }
}

const FIELDS = ["name", "text", "positions", "file"] as const

/** Field errors of a refused save: {fields} (repo) or zod's {details.fieldErrors}; "positions.0" → positions. */
function fieldErrorsOf(body: ErrorBody): FieldErrors {
  const out: FieldErrors = {}
  for (const [key, message] of Object.entries(body.fields ?? {})) {
    const field = FIELDS.find((name) => key === name || key.startsWith(`${name}.`)) ?? (key === "fileId" ? "file" : undefined)
    if (field && message && !out[field]) out[field] = message
  }
  for (const [key, messages] of Object.entries(body.details?.fieldErrors ?? {})) {
    const field = FIELDS.find((name) => key === name) ?? (key === "fileId" ? "file" : undefined)
    if (field && messages?.[0] && !out[field]) out[field] = messages[0]
  }
  return out
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function KnowledgeBaseFormDialog({ articleId, onClose, onSaved }: { articleId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [isActive, setIsActive] = useState(false)
  const [positions, setPositions] = useState<KnowledgeBasePosition[]>([])
  const [file, setFile] = useState<KnowledgeBaseFile | null>(null)
  const [loading, setLoading] = useState(articleId !== null)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [generalError, setGeneralError] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (articleId === null) return
    const controller = new AbortController()
    fetch(`${KNOWLEDGE_BASE_API}/${articleId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as KnowledgeBaseArticle & ErrorBody
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить данные")
        setName(body.name)
        setText(body.text)
        setIsActive(body.isActive)
        setPositions(body.positions)
        setFile(body.file)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [articleId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (pickerOpen) setPickerOpen(false)
      else onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, pickerOpen])

  const clearError = (field: keyof FieldErrors) => {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
    setGeneralError("")
  }

  function validate(): FieldErrors {
    const found: FieldErrors = {}
    const trimmed = name.trim()
    if (!trimmed) found.name = KB_MESSAGES.nameRequired
    else if (trimmed.length > KB_NAME_MAX) found.name = KB_MESSAGES.nameTooLong
    if (text.length > KB_TEXT_MAX) found.text = KB_MESSAGES.textTooLong
    return found
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving || loading || uploading || loadError) return
    const found = validate()
    setErrors(found)
    setGeneralError("")
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      const response = await fetch(articleId === null ? KNOWLEDGE_BASE_API : `${KNOWLEDGE_BASE_API}/${articleId}`, {
        method: articleId === null ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), text, isActive, positions: positions.map((item) => item.id), fileId: file?.id ?? null }),
      })
      if (response.ok) return onSaved()
      const body = (await response.json().catch(() => ({}))) as ErrorBody
      const fields = fieldErrorsOf(body)
      setErrors(fields)
      if (!Object.keys(fields).length) setGeneralError(body.error || "Не удалось сохранить")
    } catch {
      setGeneralError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  const busy = loading || saving
  return createPortal(
    <div className="fixed inset-0 z-[120] flex flex-col bg-white text-[13px] text-[#333]" role="dialog" aria-modal="true" aria-label={t(articleId === null ? "Добавить" : "Изменить")}>
      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#efefef] pl-[30px] pr-[10px]">
          <h2 className="text-[15px] font-bold uppercase">{t(articleId === null ? "Добавить" : "Изменить")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center rounded-full text-[#666] hover:bg-slate-100">
            <X className="h-6 w-6" />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-[30px] pb-8">
          {loading ? (
            <div className="flex h-full min-h-[200px] items-center justify-center">
              <Loader2 className="h-9 w-9 animate-spin text-[#1E4A9A]" aria-label={t("Загрузка...")} />
            </div>
          ) : loadError ? (
            <p className="py-10 text-center text-[14px] text-[#f44336]">{t(loadError)}</p>
          ) : (
            <div className="flex flex-col">
              {/* Linko's material fields: the label sits on the line until the field has focus or a value. */}
              <FloatingField label={t("Название")} error={errors.name ? t(errors.name) : ""} filled={name !== ""} className="mt-[14px] h-[72px]" lineBottom={22} errorBottom={4}>
                {(onFocus, onBlur) => (
                  <input
                    value={name}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    onChange={(event) => {
                      setName(event.target.value)
                      clearError("name")
                    }}
                    aria-label={t("Название")}
                    aria-invalid={Boolean(errors.name)}
                    className="absolute inset-x-0 top-[24px] h-[24px] bg-transparent text-[13px] font-semibold text-black outline-none"
                  />
                )}
              </FloatingField>

              {/* Linko lifts the text field 20 px (style top: -20px); its box still takes its place below. */}
              <FloatingField label={t("Текст")} error={errors.text ? t(errors.text) : ""} filled={text !== ""} className="-top-[20px] pb-[22px]" lineBottom={18} errorBottom={0}>
                {(onFocus, onBlur) => (
                  <GrowingTextarea
                    value={text}
                    label={t("Текст")}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    onChange={(value) => {
                      setText(value)
                      clearError("text")
                    }}
                  />
                )}
              </FloatingField>

              <label className="flex h-[20px] w-fit cursor-pointer items-center text-[13px] font-semibold text-black">
                <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="peer sr-only" />
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-[#666] peer-focus-visible:outline peer-focus-visible:outline-1" aria-hidden="true">
                  <path d={isActive ? CHECKBOX_ON : CHECKBOX_OFF} />
                </svg>
                <span className="ml-[6px]">{t("Активный")}</span>
              </label>

              <AccessRightsSelect
                value={positions}
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onChange={(next) => {
                  setPositions(next)
                  clearError("positions")
                }}
                error={errors.positions ? t(errors.positions) : ""}
              />

              <PdfDropZone
                file={file}
                uploading={uploading}
                onUploading={setUploading}
                onChange={(next) => {
                  setFile(next)
                  clearError("file")
                }}
                error={errors.file ? t(errors.file) : ""}
              />
            </div>
          )}
        </div>

        <footer className="flex h-[57px] shrink-0 items-center justify-end gap-4 border-t border-[#efefef] px-[10px]">
          {generalError && <span className="mr-auto pl-5 text-[13px] text-[#f44336]">{t(generalError)}</span>}
          <button
            type="submit"
            disabled={busy || uploading || Boolean(loadError)}
            className="inline-flex h-9 items-center gap-2 rounded-[2px] px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-black/5 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("Сохранить")}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  )
}

// Material checkbox glyphs (24-viewBox), drawn in #666 like Linko's.
const CHECKBOX_OFF = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const CHECKBOX_ON = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const FILE_GLYPH = "M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"

/** Linko's material text field: 13 px semibold label on the line (26 px down), floated to the top
 * at 3/4 size while focused or filled; the line 49 px down (2 px #5d6474 while focused), the error under it. */
function FloatingField({
  label,
  error,
  filled,
  className,
  lineBottom,
  errorBottom,
  children,
}: {
  label: string
  error: string
  filled: boolean
  className: string
  /** Distance of the line and of the error text from the field's bottom edge (px). */
  lineBottom: number
  errorBottom: number
  children: (onFocus: () => void, onBlur: () => void) => ReactNode
}) {
  const [focused, setFocused] = useState(false)
  const floated = focused || filled
  return (
    <div className={`relative ${className}`}>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-0 origin-top-left text-[13px] font-semibold transition-all duration-200 ${floated ? "top-[5px] scale-75" : "top-[26px]"} ${error ? "text-[#f44336]" : "text-black"}`}
      >
        {label}
      </span>
      {children(
        () => setFocused(true),
        () => setFocused(false),
      )}
      <div className={`absolute inset-x-0 ${focused || error ? "h-[2px]" : "h-px"} ${error ? "bg-[#f44336]" : focused ? "bg-[#5d6474]" : "bg-[#e0e0e0]"}`} style={{ bottom: lineBottom }} />
      {error && <p className="absolute inset-x-0 text-[12px] leading-[15px] text-[#f44336]" style={{ bottom: errorBottom }}>{error}</p>}
    </div>
  )
}

/** Linko's multi-line text: one 24 px row that grows to three, then scrolls; it sits 22 px down in its field. */
function GrowingTextarea({ value, label, onChange, onFocus, onBlur }: { value: string; label: string; onChange: (value: string) => void; onFocus: () => void; onBlur: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = "24px"
    node.style.height = `${Math.min(Math.max(node.scrollHeight, 24), 72)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onFocus={onFocus}
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className="relative mt-[22px] block h-[24px] w-full resize-none bg-transparent text-[13px] font-semibold leading-[24px] text-[#333] outline-none"
    />
  )
}

/** "Права доступа" (Linko main/position/): a multi-select of access rights. The chosen ones are
 * chips (× removes one), typing filters the menu, a chosen one stays in it highlighted (a click
 * there removes it), the menu stays open while picking, × clears all. */
function AccessRightsSelect({
  value,
  open,
  onOpenChange,
  onChange,
  error,
}: {
  value: KnowledgeBasePosition[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (next: KnowledgeBasePosition[]) => void
  error: string
}) {
  const { t } = useLanguage()
  const { items, loading } = useJsonList<KnowledgeBasePosition>(KNOWLEDGE_BASE_ACCESS_RIGHTS_API)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const chosen = useMemo(() => new Set(value.map((item) => item.id)), [value])
  const needle = query.trim().toLocaleLowerCase()
  const options = useMemo(
    () => items.filter((item) => !needle || item.name.toLocaleLowerCase().includes(needle)).slice(0, 300),
    [items, needle],
  )

  const close = useCallback(() => {
    onOpenChange(false)
    setQuery("")
  }, [onOpenChange])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open, close])

  const floated = value.length > 0 || query !== ""
  return (
    <div ref={rootRef} className="relative mt-[20px] pt-[13px]">
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-0 z-[1] origin-top-left text-[13px] font-semibold transition-all duration-200 ${floated ? "top-0 scale-75" : "top-[25px]"} ${error ? "text-[#f44336]" : "text-black"}`}
      >
        {t("Права доступа")}
      </span>
      <div
        className={`flex min-h-[36px] cursor-text items-center border-b ${error ? "border-[#f44336]" : "border-[#e8e8e8]"}`}
        onMouseDown={(event) => {
          if (event.target === inputRef.current) return
          event.preventDefault()
          inputRef.current?.focus()
          if (open) close()
          else onOpenChange(true)
        }}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[5px] py-[5px]">
          {value.map((item) => (
            <span key={item.id} className="inline-flex h-[22px] items-stretch rounded-[2px] border border-[#1E4A9A] bg-[#1E4A9A] text-[11.7px] font-semibold leading-[20px] text-white">
              <button
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => onChange(value.filter((current) => current.id !== item.id))}
                aria-label={`${t("Удалить")}: ${item.name}`}
                className="w-[18px] border-r border-[#efefef] text-center hover:bg-white/15"
              >
                ×
              </button>
              <span className="truncate px-[5px]">{item.name}</span>
            </span>
          ))}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              onOpenChange(true)
            }}
            onFocus={() => onOpenChange(true)}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !query && value.length) onChange(value.slice(0, -1))
              if (event.key === "Enter") {
                event.preventDefault()
                const first = options.find((item) => !chosen.has(item.id))
                if (first) onChange([...value, { id: first.id, name: first.name }])
                setQuery("")
              }
            }}
            aria-label={t("Права доступа")}
            aria-expanded={open}
            aria-controls={listId}
            role="combobox"
            className="h-[24px] min-w-[5px] flex-1 bg-transparent text-[13px] outline-none"
            style={{ width: `${Math.max(5, query.length * 8)}px` }}
          />
        </div>
        {value.length > 0 && (
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => onChange([])}
            aria-label={t("Очистить")}
            title={t("Очистить")}
            className="mr-[9px] text-[18px] leading-none text-[#999] hover:text-[#d0021b]"
          >
            ×
          </button>
        )}
        <span aria-hidden="true" className={`relative top-[3px] mr-[10px] h-0 w-0 border-x-[5px] border-x-transparent ${open ? "border-b-[5px] border-b-[#999]" : "border-t-[5px] border-t-[#999]"}`} />
      </div>
      {error && <p className="mt-[2px] text-[12px] text-[#f44336]">{error}</p>}
      {open && (
        <div id={listId} className="absolute inset-x-0 top-full z-20 max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]" role="listbox" aria-multiselectable="true">
          {loading && !items.length ? (
            <p className="px-[10px] py-[9px] text-[#999]">{t("Загрузка...")}</p>
          ) : options.length === 0 ? (
            <p className="px-[10px] py-[9px] text-[#999]">{t("Не найдено")}</p>
          ) : (
            options.map((item) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={chosen.has(item.id)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(chosen.has(item.id) ? value.filter((current) => current.id !== item.id) : [...value, { id: item.id, name: item.name }])
                  setQuery("")
                }}
                className={`block w-full truncate px-[10px] py-[9px] text-left text-[13px] font-semibold leading-[18px] text-[#333] ${chosen.has(item.id) ? "bg-[#e8f0fb]" : "hover:bg-[#f2f5f8]"}`}
              >
                {item.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Linko's 200 px dashed drop zone (20 px in from the left): click or drop uploads at once; the
 * stored file stays shown with Заменить / Удалить файл under the zone. */
function PdfDropZone({
  file,
  uploading,
  onUploading,
  onChange,
  error,
}: {
  file: KnowledgeBaseFile | null
  uploading: boolean
  onUploading: (busy: boolean) => void
  onChange: (file: KnowledgeBaseFile | null) => void
  error: string
}) {
  const { t } = useLanguage()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploadError, setUploadError] = useState("")

  async function upload(picked: File) {
    setUploadError("")
    if (!picked.size) return setUploadError(KB_MESSAGES.fileEmpty)
    if (picked.size > KB_FILE_MAX_BYTES) return setUploadError(KB_MESSAGES.fileTooLarge)
    if (!/\.pdf$/i.test(picked.name) && picked.type !== "application/pdf") return setUploadError(KB_MESSAGES.fileNotPdf)
    onUploading(true)
    try {
      const form = new FormData()
      form.append("file", picked, picked.name)
      const response = await fetch(KNOWLEDGE_BASE_FILES_API, { method: "POST", body: form })
      const body = (await response.json().catch(() => ({}))) as KnowledgeBaseFile & ErrorBody
      if (!response.ok) {
        setUploadError(body.fields?.file || body.error || "Не удалось загрузить файл")
        return
      }
      onChange({ id: body.id, name: body.name, size: body.size, url: body.url })
    } catch {
      setUploadError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      onUploading(false)
    }
  }

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0]
    event.target.value = ""
    if (picked) void upload(picked)
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (uploading) return
    const picked = event.dataTransfer.files?.[0]
    if (picked) void upload(picked)
  }

  const shownError = uploadError || error
  return (
    <div className="ml-[20px] mt-[13px]">
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={pick} className="hidden" tabIndex={-1} />
      <div
        role="button"
        tabIndex={0}
        aria-label={t("Добавьте PDF файл")}
        aria-busy={uploading}
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !uploading) {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={`flex h-[200px] cursor-pointer flex-col items-center justify-center border-2 border-dashed px-4 text-center text-[13px] text-[#333] ${dragging ? "border-[#1E4A9A] bg-[#f3f6fd]" : "border-[#efefef]"}`}
      >
        {uploading ? (
          <Loader2 className="h-9 w-9 animate-spin text-[#1E4A9A]" aria-label={t("Загрузка...")} />
        ) : shownError ? (
          <p className="font-semibold text-[#f44336]">
            {t("Ошибка")}: {t(shownError)}
          </p>
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="mb-[5px] h-6 w-6 fill-[#333]" aria-hidden="true"><path d={FILE_GLYPH} /></svg>
            {file ? (
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="max-w-full truncate hover:underline"
                title={formatSize(file.size)}
              >
                {file.name}
              </a>
            ) : (
              <p>{t("Добавьте PDF файл")}</p>
            )}
          </>
        )}
      </div>
      {file && !uploading && (
        <div className="mt-2 flex items-center gap-4 text-[13px]">
          <button type="button" onClick={() => inputRef.current?.click()} className="font-semibold text-[#1E4A9A] hover:underline">
            {t("Заменить")}
          </button>
          <button
            type="button"
            onClick={() => {
              setUploadError("")
              onChange(null)
            }}
            className="font-semibold text-[#f44336] hover:underline"
          >
            {t("Удалить файл")}
          </button>
        </div>
      )}
    </div>
  )
}
