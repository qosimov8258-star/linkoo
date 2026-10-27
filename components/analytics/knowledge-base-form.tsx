"use client"

import { ChevronDown, FileText, Loader2, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { useJsonList } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  KB_FILE_MAX_BYTES,
  KB_MESSAGES,
  KB_NAME_MAX,
  KB_TEXT_MAX,
  KNOWLEDGE_BASE_API,
  KNOWLEDGE_BASE_FILES_API,
  type KnowledgeBaseArticle,
  type KnowledgeBaseFile,
  type KnowledgeBasePosition,
} from "@/lib/knowledge-base-types"

// The full-screen add / edit dialog of "База знания" (demo KnowledgeCreateForm): title
// "Добавить" / "Изменить" with ✕, the fields Название, Текст (grows with the text), Активный
// (off for a new article), Права доступа (job positions as chips; none = every position) and the
// PDF drop zone, which uploads the file at once (POST /api/knowledge-base/files) and keeps the
// stored file on edit unless it is removed or replaced; "Сохранить" at the bottom right.
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
        <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[18px]">
          <h2 className="text-[14px] font-bold uppercase">{t(articleId === null ? "Добавить" : "Изменить")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-slate-100">
            <X className="h-6 w-6" />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-[30px] pb-8 pt-4">
          {loading ? (
            <div className="flex h-full min-h-[200px] items-center justify-center">
              <Loader2 className="h-9 w-9 animate-spin text-[#4f70e7]" aria-label={t("Загрузка...")} />
            </div>
          ) : loadError ? (
            <p className="py-10 text-center text-[14px] text-[#f44336]">{t(loadError)}</p>
          ) : (
            <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
              <UnderlinedField label={t("Название")} error={errors.name ? t(errors.name) : ""} filled={name !== ""}>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    clearError("name")
                  }}
                  aria-invalid={Boolean(errors.name)}
                  className="h-[28px] w-full bg-transparent text-[14px] outline-none"
                />
              </UnderlinedField>

              <UnderlinedField label={t("Текст")} error={errors.text ? t(errors.text) : ""} filled={text !== ""}>
                <GrowingTextarea
                  value={text}
                  onChange={(value) => {
                    setText(value)
                    clearError("text")
                  }}
                />
              </UnderlinedField>

              <label className="flex w-fit cursor-pointer items-center gap-[10px] text-[14px]">
                <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-[18px] w-[18px] accent-[#4f71dc]" />
                {t("Активный")}
              </label>

              <PositionsPicker
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

        <footer className="flex h-[60px] shrink-0 items-center justify-end gap-4 border-t border-[#e8ebf0] px-[20px]">
          {generalError && <span className="mr-auto text-[13px] text-[#f44336]">{t(generalError)}</span>}
          <button
            type="submit"
            disabled={busy || uploading || Boolean(loadError)}
            className="inline-flex h-9 items-center gap-2 rounded px-4 text-[13px] font-bold uppercase text-[#1ea1f2] hover:bg-[#1ea1f2]/10 disabled:opacity-50"
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

/** Material-like underlined field: label above, the control, the error under the line. */
function UnderlinedField({ label, error, filled, children }: { label: string; error: string; filled: boolean; children: ReactNode }) {
  return (
    <div>
      <div className={`border-b ${error ? "border-[#f44336]" : "border-[#d5dae1] focus-within:border-[#4f71dc]"}`}>
        <span className={`block text-[12px] ${error ? "text-[#f44336]" : filled ? "text-[#586174]" : "text-[#8a93a6]"}`}>{label}</span>
        {children}
      </div>
      {error && <p className="mt-1 text-[12px] text-[#f44336]">{error}</p>}
    </div>
  )
}

/** A textarea of 1 row that grows with its text up to 3 rows, then scrolls (demo multiline 1–3). */
function GrowingTextarea({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.style.height = "auto"
    const line = 20
    node.style.height = `${Math.min(Math.max(node.scrollHeight, line + 8), line * 3 + 8)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="block w-full resize-none bg-transparent py-1 text-[14px] leading-5 outline-none"
    />
  )
}

/** "Права доступа": job positions (GET /api/job-positions) as removable chips, searchable list. */
function PositionsPicker({
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
  const { items, loading } = useJsonList<KnowledgeBasePosition>("/api/job-positions")
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
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

  const toggle = (item: KnowledgeBasePosition) =>
    onChange(chosen.has(item.id) ? value.filter((current) => current.id !== item.id) : [...value, { id: item.id, name: item.name }])

  return (
    <div ref={rootRef} className="relative">
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex min-h-[44px] cursor-pointer flex-col border-b outline-none ${error ? "border-[#f44336]" : open ? "border-[#4f71dc]" : "border-[#d5dae1] focus:border-[#4f71dc]"}`}
        onClick={() => (open ? close() : onOpenChange(true))}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
            event.preventDefault()
            onOpenChange(true)
          }
        }}
      >
        <span className={`block text-[12px] ${error ? "text-[#f44336]" : "text-[#586174]"}`}>{t("Права доступа")}</span>
        <div className="flex items-center gap-2 py-1">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {value.map((item) => (
              <span key={item.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-[#e8ecf5] py-0.5 pl-1 pr-2.5 text-[13px] text-[#333]">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onChange(value.filter((current) => current.id !== item.id))
                  }}
                  aria-label={`${t("Удалить")}: ${item.name}`}
                  className="rounded-full p-0.5 text-[#666] hover:bg-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <span className="truncate">{item.name}</span>
              </span>
            ))}
          </div>
          {value.length > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onChange([])
              }}
              aria-label={t("Очистить")}
              title={t("Очистить")}
              className="rounded-full p-1 text-[#666] hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <ChevronDown className={`h-4 w-4 shrink-0 text-[#666] transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </div>
      {error && <p className="mt-1 text-[12px] text-[#f44336]">{error}</p>}
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded bg-white shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Поиск")}
            aria-label={t("Поиск")}
            className="h-10 w-full border-b border-[#eef1f5] px-3 text-[14px] outline-none"
          />
          <div className="max-h-64 overflow-y-auto py-1" role="listbox" aria-multiselectable="true">
            {loading && !items.length ? (
              <p className="px-3 py-2 text-[#9aa3b6]">{t("Загрузка...")}</p>
            ) : options.length === 0 ? (
              <p className="px-3 py-2 text-[#9aa3b6]">{t("Не найдено")}</p>
            ) : (
              options.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={chosen.has(item.id)}
                  onClick={() => toggle(item)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-[#f2f5f8] ${chosen.has(item.id) ? "bg-[#e3effd] font-semibold" : ""}`}
                >
                  <span className="truncate">{item.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** The dashed 200px PDF zone: click or drop uploads at once; then the file link with Заменить / Удалить файл. */
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
    <div>
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
        className={`flex h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded border-2 border-dashed px-4 text-center transition-colors ${
          dragging ? "border-[#4f71dc] bg-[#f3f6fd] text-[#4f71dc]" : shownError ? "border-[#f44336] text-[#757575]" : "border-[#c4cad4] text-[#757575] hover:border-[#4f71dc] hover:text-[#4f71dc]"
        }`}
      >
        {uploading ? (
          <Loader2 className="h-9 w-9 animate-spin text-[#4f70e7]" aria-label={t("Загрузка...")} />
        ) : (
          <>
            <FileText className="h-10 w-10" />
            {file ? (
              <span className="flex max-w-full flex-col items-center gap-1">
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="max-w-full truncate text-[14px] font-semibold text-[#4f71dc] hover:underline"
                >
                  {file.name}
                </a>
                <span className="text-[12px] text-[#9aa3b6]">{formatSize(file.size)}</span>
              </span>
            ) : (
              <span className="text-[14px]">{t("Добавьте PDF файл")}</span>
            )}
          </>
        )}
      </div>
      {file && !uploading && (
        <div className="mt-2 flex items-center gap-4 text-[13px]">
          <button type="button" onClick={() => inputRef.current?.click()} className="font-semibold text-[#4f71dc] hover:underline">
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
      {shownError && (
        <p className="mt-1 text-[13px] text-[#f44336]">
          {t("Ошибка")}: {t(shownError)}
        </p>
      )}
    </div>
  )
}
