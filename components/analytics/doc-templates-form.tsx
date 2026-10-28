"use client"

import { Loader2, X } from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"
import { CheckBox, ErrorAlert } from "./catalog-ui"
import { DOC_TEMPLATES_API, DOC_TEMPLATE_KEYS, type DocTemplateDetail } from "./doc-templates-data"

// Full-screen editor of "Конструктор документов" (demo DocsBuilderCreateForm): title, Название,
// Ключ, Подтвержденный and "Оформить шаблон" / "Изменить шаблон" in the top bar, then the live
// preview of the html and the html text area. Failed saves list "<field>: <message>" in an alert.

const labelCls = "pointer-events-none absolute left-0 uppercase transition-all"

function FieldError({ message }: { message?: string }) {
  const { t } = useLanguage()
  return message ? <p className="mt-[2px] text-[11px] font-bold uppercase leading-[12px] text-[#c62828]">{t(message)}</p> : null
}

function NameField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  const { t } = useLanguage()
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className="w-[250px]">
      <div className={`relative h-[45px] border-b ${error ? "border-[#c62828]" : "border-[#d5dae1]"}`}>
        <span className={`${labelCls} ${error ? "text-[#c62828]" : ""} ${floating ? "top-[3px] text-[10px] font-semibold leading-3" : "top-[25px] text-[13px] font-bold leading-4"}`}>{t("Название")}</span>
        <input value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent text-[13px] font-semibold outline-none" />
      </div>
      <FieldError message={error} />
    </div>
  )
}

function KeyField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const selected = DOC_TEMPLATE_KEYS.find((key) => key.id === value)
  return (
    <div ref={rootRef} className="relative w-[250px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className={`relative block h-[45px] w-full border-b text-left ${error ? "border-[#c62828]" : "border-[#d5dae1]"}`}>
        <span className={`${labelCls} ${error ? "text-[#c62828]" : ""} ${selected ? "top-[3px] text-[10px] font-semibold leading-3" : "top-[25px] text-[13px] font-bold leading-4"}`}>{t("Ключ")}</span>
        {selected && <span className="absolute inset-x-0 bottom-[6px] truncate pr-12 text-[13px] font-semibold uppercase">{t(selected.name)}</span>}
        <span className="absolute bottom-[8px] right-0 flex items-center gap-[10px] text-slate-500">
          {selected && (
            <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange("") }}>
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <i className="border-x-[5px] border-t-[5px] border-x-transparent border-t-[#8a8a8a]" />
        </span>
      </button>
      <FieldError message={error} />
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-[200px] overflow-y-auto bg-white py-0 shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {DOC_TEMPLATE_KEYS.map((key, index) => (
            <li key={`${key.id}-${index}`}>
              <button
                type="button"
                onClick={() => { onChange(key.id); setOpen(false) }}
                className={`block h-8 w-full px-[10px] text-left text-[13px] font-semibold uppercase ${key.id === value ? "bg-[#e3effd] text-slate-800" : "text-slate-500 hover:bg-slate-50"}`}
              >
                {t(key.name)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700&subset=cyrillic,latin&display=swap">'

/** The template rendered in a script-less iframe (the html is user-written); tags like {% … %} stay visible as text. */
function HtmlPreview({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(0)
  const [shown, setShown] = useState(html)
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(html), 200)
    return () => window.clearTimeout(timer)
  }, [html])
  const measure = () => {
    const doc = frameRef.current?.contentDocument
    if (doc) setHeight(doc.documentElement.scrollHeight)
  }
  // The frame is as tall as its content, so 100vh of the template means the browser window, like in the page itself.
  const source = shown.replace(/100vh/g, `${typeof window === "undefined" ? 900 : window.innerHeight}px`)
  return (
    <iframe
      ref={frameRef}
      title="preview"
      sandbox="allow-same-origin"
      scrolling="no"
      srcDoc={`<!doctype html><meta charset="utf-8">${FONT_LINK}<style>html,body{margin:0;overflow:hidden;font-family:"Open Sans",sans-serif}</style>${source}`}
      onLoad={measure}
      style={{ height: shown ? height : 0 }}
      className="block w-full border-0"
    />
  )
}

export function DocTemplateFormDialog({ templateId, onClose, onSaved }: { templateId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const isUpdate = templateId !== null
  const [loading, setLoading] = useState(isUpdate)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [keyName, setKeyName] = useState("")
  const [isActive, setIsActive] = useState(false)
  const [html, setHtml] = useState("")
  const [htmlFocused, setHtmlFocused] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [alert, setAlert] = useState("")
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (templateId === null) return
    const controller = new AbortController()
    fetch(`${DOC_TEMPLATES_API}/${templateId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error || "Не найдено")
        const item = (await response.json()) as DocTemplateDetail
        setName(item.name)
        setKeyName(item.keyName)
        setIsActive(item.isActive)
        setHtml(item.html)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setAlert(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [templateId])

  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.style.height = "0px"
    area.style.height = `${Math.max(96, area.scrollHeight)}px`
  }, [html, loading])

  async function submit() {
    if (saving) return
    setSaving(true)
    setErrors({})
    try {
      const response = await fetch(isUpdate ? `${DOC_TEMPLATES_API}/${templateId}` : DOC_TEMPLATES_API, {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, keyName, isActive, html }),
      })
      if (response.ok) return onSaved()
      const body = (await response.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> }
      if (body.fields && Object.keys(body.fields).length) {
        setErrors(body.fields)
        setAlert(Object.entries(body.fields).map(([field, message]) => `${field}: ${t(message)}`).join("\n"))
      } else {
        setAlert(t(body.error || "Не удалось сохранить"))
      }
    } catch {
      setAlert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  const closeAlert = () => {
    setAlert("")
    if (isUpdate && loading) onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-white text-[13px] text-[#333]">
      {loading ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
        </div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void submit() }} noValidate>
          <div className="flex min-h-[80px] items-end justify-between border-b border-[#efefef] pl-[30px] pr-[20px]">
            <div className="flex items-end pb-[14px]">
              <b className="w-[314px] self-center pl-[30px] text-[13px] uppercase">{isUpdate ? t("Изменение шаблона") : t("Добавление шаблона")}</b>
              <NameField value={name} onChange={setName} error={errors.name} />
              <div className="ml-[51px]"><KeyField value={keyName} onChange={setKeyName} error={errors.key_name} /></div>
              <div className="ml-[53px] pb-[8px]"><CheckBox checked={isActive} onChange={setIsActive} label={t("Подтвержденный").toUpperCase()} /></div>
            </div>
            <div className="flex items-center gap-[20px] self-center">
              <button type="submit" disabled={saving} className="h-9 px-4 text-[13px] uppercase text-[#222] hover:bg-black/5 disabled:opacity-50">{isUpdate ? t("Изменить шаблон") : t("Оформить шаблон")}</button>
              <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center text-[#666]"><X className="h-6 w-6" /></button>
            </div>
          </div>
          <div className="min-h-[470px] px-[30px]">
            <div className="border-b border-[#efefef] py-[20px]">
              <HtmlPreview html={html} />
            </div>
            <div className="py-[20px]">
              <div className={`relative border-b pt-[36px] ${errors.html ? "border-[#c62828]" : "border-[#d5dae1]"}`}>
                <span className={`pointer-events-none absolute left-0 transition-all ${errors.html ? "text-[#c62828]" : ""} ${htmlFocused || html ? "top-[19px] text-[10px] font-semibold leading-3" : "top-[39px] text-[13px] font-bold leading-4"}`}>html</span>
                <textarea
                  ref={areaRef}
                  name="html"
                  value={html}
                  rows={4}
                  onChange={(event) => setHtml(event.target.value)}
                  onFocus={() => setHtmlFocused(true)}
                  onBlur={() => setHtmlFocused(false)}
                  className="block min-h-[96px] w-full resize-none overflow-hidden bg-transparent text-[13px] leading-[24px] outline-none"
                />
              </div>
              <FieldError message={errors.html} />
            </div>
          </div>
        </form>
      )}
      {alert && <ErrorAlert message={alert} onClose={closeAlert} />}
    </div>,
    document.body,
  )
}
