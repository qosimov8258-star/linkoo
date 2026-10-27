"use client"

import { X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import {
  AddLink,
  ConfirmDeleteDialog,
  EmptyRows,
  RowActions,
  SettingsToolbar,
  kitHead,
  kitRow,
  useListControls,
  usePaged,
} from "@/components/analytics/settings-list-kit"
import { Check, useOutsideClose } from "@/components/staff/staff-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// "База знания" (reference #/knowledge-base, API main/knowledge/): № | Наименование, newest first, ✎ / 🗑 on row hover.
// The full-screen "Добавить / Изменить" dialog has Название, Текст, Активный, Права доступа (positions of
// "Права доступа", picked by id) and a file drop zone (any report/document file, the name replaces the hint).

type Article = { id: number; name: string; text: string; active: boolean; roles: string[]; fileName: string | null }
type RoleOption = { value: string; label: string }

const COLUMNS = "536.3fr 607.5fr 131.2fr"
/** Same extension list as the reference's file input. */
const FILE_ACCEPT = ".xlsx,.xlsb,.xlsm,.xls,.xml,.csv,.txt,.ods,.fods,.uos,.sylk,.dif,.dbf,.prn,.qpw,.123,.wb*,.wq*,.html,.htm,.pdf"

/** Positions of "Права доступа" in id order (the reference lists `main/position/`). */
function useRoleOptions() {
  const [options, setOptions] = useState<RoleOption[] | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch("/api/access-rights", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { id: number; name: string }[]) => {
        if (!cancelled) setOptions(rows.map((row) => ({ value: String(row.id), label: row.name })).sort((a, b) => Number(a.value) - Number(b.value)))
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])
  return options
}

/** Rows saved before roles were kept by id hold position names: map them to ids. */
function roleIds(roles: string[], options: RoleOption[]): string[] {
  const ids = roles.map((role) => (options.some((option) => option.value === role) ? role : options.find((option) => option.label === role)?.value))
  return ids.filter((id): id is string => Boolean(id))
}

/** Line input of the full-screen dialog: caption inside while empty, small above once focused or filled. `multiline` = the reference's auto-growing "Текст" textarea. */
function DialogLine({ label, value, onChange, multiline }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const [focused, setFocused] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.style.height = "auto"
    area.style.height = `${Math.max(24, area.scrollHeight)}px`
  }, [value])
  const floating = focused || value !== ""
  return (
    <div className={`relative min-h-[52px] border-b border-[#e0e0e0] ${multiline ? "pb-[5px] pt-[22px]" : "pb-[1px] pt-[26px]"}`}>
      <span className={`pointer-events-none absolute left-0 font-semibold text-black transition-all duration-200 ${floating ? "top-[6.5px] text-[10px] leading-[13.5px]" : "top-[28px] text-[13px] leading-[18px]"}`}>{label}</span>
      {multiline ? (
        <textarea ref={areaRef} rows={1} value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="relative block h-[24px] w-full resize-none overflow-hidden bg-transparent text-[13px] font-semibold leading-[24px] text-[#333] outline-none" />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="relative block h-[24px] w-full bg-transparent text-[13px] font-semibold leading-[24px] text-black outline-none" />
      )}
      {focused && <span className="absolute inset-x-0 -bottom-px h-[2px] bg-[#5d6474]" />}
    </div>
  )
}

/** react-select multi of the reference "Права доступа": ⊗ chips, inline search, ✕ clear, ▾; the menu keeps picked items highlighted and stays open. */
function RolesSelect({ label, options, value, onChange }: { label: string; options: RoleOption[]; value: string[]; onChange: (value: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const ref = useOutsideClose(open, () => { setOpen(false); setSearch("") })
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = value.map((id) => options.find((option) => option.value === id)).filter((option): option is RoleOption => Boolean(option))
  const shown = options.filter((option) => option.label.toLowerCase().includes(search.trim().toLowerCase()))
  const floating = selected.length > 0 || search !== ""
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
    setSearch("")
  }
  return (
    <div ref={ref} className="relative">
      <div className={`pointer-events-none absolute left-0 font-semibold text-black ${floating ? "-top-[13px] text-[10px] leading-[12.2px]" : "top-[12px] text-[13px] leading-[16.3px]"}`}>{label}</div>
      <div
        onClick={() => { setOpen(true); inputRef.current?.focus() }}
        className={`relative flex min-h-[36px] cursor-text flex-wrap content-start border-b pb-[1.6px] pt-[5px] pr-[60px] ${open ? "border-[#d9d9d9]" : "border-[#e8e8e8]"}`}
      >
        {selected.map((option) => (
          <span key={option.value} className="mb-[5px] mr-[5px] flex h-[22.4px] items-center rounded-[2px] border border-[#5868f0] bg-[#5868f0] text-[11.7px] font-semibold leading-[16.38px] text-white">
            <button type="button" aria-label={t("Удалить")} onClick={(event) => { event.stopPropagation(); onChange(value.filter((id) => id !== option.value)) }} className="border-r border-white px-[5px] leading-[20.4px]">×</button>
            <span className="px-[5px] leading-[20.4px]">{option.label}</span>
          </span>
        ))}
        <input
          ref={inputRef}
          value={search}
          onChange={(event) => { setSearch(event.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => { if (event.key === "Backspace" && !search && value.length) onChange(value.slice(0, -1)) }}
          style={{ width: Math.max(5, search.length * 8 + 5) }}
          className="mb-[5px] h-[22.4px] bg-transparent text-[13px] outline-none"
        />
        {selected.length > 0 && (
          <button type="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange([]) }} className="absolute right-[28.4px] top-1/2 mt-[4.9px] -translate-y-1/2 text-[18px] leading-[18px] text-[#999]">×</button>
        )}
        <span className={`pointer-events-none absolute right-[10px] top-1/2 mt-[3.4px] h-[5px] w-[10px] border-x-[5px] border-x-transparent ${open ? "-translate-y-[1.5px] border-b-[5px] border-b-[#999]" : "border-t-[5px] border-t-[#999]"}`} />
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 -mt-px max-h-[200px] overflow-y-auto bg-white [box-shadow:0_4px_12px_rgba(0,0,0,0.37)]">
          {shown.length === 0 && <div className="h-[36.3px] px-[10px] text-[13px] leading-[36.3px] text-[#999]">{t("Ничего не найдено")}</div>}
          {shown.map((option) => (
            <div key={option.value} role="option" aria-selected={value.includes(option.value)} onClick={() => toggle(option.value)} className={`h-[36.3px] cursor-pointer px-[10px] text-[13px] font-semibold leading-[36.3px] text-[#333] ${value.includes(option.value) ? "bg-[#e6f0ff]" : "hover:bg-[#f2f5f8]"}`}>{option.label}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function ArticleDialog({ article, roles, onClose, onSaved }: { article: Article | null; roles: RoleOption[]; onClose: () => void; onSaved: (saved: Article) => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(article?.name ?? "")
  const [text, setText] = useState(article?.text ?? "")
  const [active, setActive] = useState(article?.active ?? false)
  const [picked, setPicked] = useState<string[]>(() => roleIds(article?.roles ?? [], roles))
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function save() {
    if (saving) return
    // The reference keeps "Сохранить" enabled and answers an empty name with the API field error.
    if (!name.trim()) {
      notify(`name: ${t("Это поле обязательно к заполнению")}`)
      return
    }
    setSaving(true)
    try {
      const response = await fetch(article ? `/api/knowledge-base/${article.id}` : "/api/knowledge-base", {
        method: article ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), text, active, roles: picked }),
      })
      const body = (await response.json().catch(() => ({}))) as Article & { error?: string }
      if (!response.ok) {
        notify(t(body.error || "Не удалось сохранить статью"))
        return
      }
      let saved = body
      if (file) {
        const upload = await fetch(`/api/knowledge-base/${saved.id}/file`, { method: "PUT", headers: { "x-file-name": encodeURIComponent(file.name) }, body: file })
        if (!upload.ok) {
          const failure = (await upload.json().catch(() => ({}))) as { error?: string }
          notify(t(failure.error || "Не удалось загрузить файл"))
          onSaved(saved)
          return
        }
        saved = { ...saved, fileName: file.name }
      }
      onSaved(saved)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-hidden bg-white text-[13px] text-[#333]">
      <header className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[22px]">
        <h3 className="text-[15px] font-bold uppercase">{t(article ? "Изменить" : "Добавить")}</h3>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#333] hover:opacity-70"><X className="h-6 w-6" strokeWidth={1.6} /></button>
      </header>
      <div className="px-[30px] pt-[12px]">
        <DialogLine label={t("Название")} value={name} onChange={setName} />
        <DialogLine multiline label={t("Текст")} value={text} onChange={setText} />
        <Check className="mt-[38px] !text-black" checked={active} onChange={setActive} label={t("Активный")} />
        <div className="mt-[33px]">
          <RolesSelect label={t("Права доступа")} options={roles} value={picked} onChange={setPicked} />
        </div>
        <input ref={fileRef} type="file" accept={FILE_ACCEPT} onChange={(event) => { setFile(event.target.files?.[0] ?? null); event.target.value = "" }} className="hidden" />
        <div role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter") fileRef.current?.click() }} className="ml-[20px] mt-[13px] flex h-[200px] cursor-pointer flex-col items-center justify-center border-2 border-dashed border-[#efefef]">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z" /></svg>
          <p className="mt-[5px] text-[13px] leading-[16.3px]">{file ? file.name : t("Добавьте PDF файл")}</p>
        </div>
      </div>
      <footer className="absolute -left-[30px] -right-[30px] -bottom-[20px] flex h-[57px] items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
        <button type="button" onClick={() => void save()} disabled={saving} className="h-9 px-[16px] text-[13px] font-semibold uppercase text-[#129fdd] hover:opacity-80">{t("Сохранить")}</button>
      </footer>
    </div>,
    document.body,
  )
}

export function KnowledgeBaseView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [articles, setArticles] = useState<Article[] | null>(null)
  const controls = useListControls()
  const [dialog, setDialog] = useState<{ article: Article | null } | null>(null)
  const [removing, setRemoving] = useState<Article | null>(null)
  const roles = useRoleOptions()

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/knowledge-base", { cache: "no-store" })
      setArticles(response.ok ? ((await response.json()) as Article[]) : [])
    } catch {
      setArticles([])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const needle = controls.query.trim().toLowerCase()
    return (articles ?? []).filter((article) => !needle || article.name.toLowerCase().includes(needle))
  }, [articles, controls.query])
  const paged = usePaged(filtered, controls.page, controls.pageSize)

  async function confirmRemove() {
    if (!removing) return
    try {
      const response = await fetch(`/api/knowledge-base/${removing.id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(body.error || "Не удалось удалить статью"))
        return
      }
      setRemoving(null)
      await load()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const body = (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <SettingsToolbar
        className="h-[60px] pt-[10px]"
        left={<span className="flex self-start"><AddLink onClick={() => setDialog({ article: null })}>{t("Добавить")}</AddLink></span>}
        query={controls.query}
        onQuery={controls.setQuery}
        pager={{
          pageSize: controls.pageSize,
          onPageSize: controls.setPageSize,
          from: paged.from,
          to: paged.to,
          total: paged.total,
          onPrev: paged.page > 1 ? () => controls.setPage(paged.page - 1) : undefined,
          onNext: paged.page < paged.pageCount ? () => controls.setPage(paged.page + 1) : undefined,
        }}
      />
      <div className={kitHead} style={{ gridTemplateColumns: COLUMNS }}>
        <span className="pl-[30px] leading-[16.3px]">№</span>
        <span className="pl-[8px] leading-[16.3px]">{t("Наименование")}</span>
      </div>
      {paged.rows.map((article) => (
        <div key={article.id} className={kitRow} style={{ gridTemplateColumns: COLUMNS }}>
          <span className="pl-[30px]"><span className="block leading-[16.3px]">{article.id}</span></span>
          <span className="pl-[8px] pr-4"><span className="block leading-[16.3px]">{article.name}</span></span>
          <RowActions onEdit={() => setDialog({ article })} onDelete={() => setRemoving(article)} />
        </div>
      ))}
      {articles && paged.rows.length === 0 && <EmptyRows />}

      {dialog && roles && (
        <ArticleDialog
          key={dialog.article?.id ?? "new"}
          article={dialog.article}
          roles={roles}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            void load()
          }}
        />
      )}
      {removing && <ConfirmDeleteDialog name={removing.name} onConfirm={() => void confirmRemove()} onClose={() => setRemoving(null)} />}
    </section>
  )
  return embedded ? body : <main className="min-h-[calc(100vh-4rem)] bg-white">{body}</main>
}
