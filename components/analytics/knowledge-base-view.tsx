"use client"

import { X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { CheckBox, EmptyState, grayHead, HoverActions, LineField, listRow, SaveLink } from "@/components/analytics/catalog-ui"
import { ConfirmDeleteDialog, SettingsPager, SettingsSearch, SettingsToolbar } from "@/components/settings/settings-list-ui"
import { LineMultiSearchSelect } from "@/components/settings/user-select"
import { useLanguage } from "@/lib/i18n/language-context"

type Article = { id: number; name: string; text: string; active: boolean; roles: string[]; fileName: string | null }

const COLS = "grid-cols-[41.3%_1fr]"

/** Position names of the company ("Права доступа" options). */
function usePositionNames() {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/job-positions", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: { name: string }[]) => {
        if (!cancelled) setNames(Array.from(new Set(rows.map((row) => row.name))).reverse())
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return names
}

function ArticleDialog({ article, positions, onClose, onSaved }: { article: Article | null; positions: string[]; onClose: () => void; onSaved: (saved: Article) => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(article?.name ?? "")
  const [text, setText] = useState(article?.text ?? "")
  const [active, setActive] = useState(article?.active ?? false)
  const [roles, setRoles] = useState<string[]>(article?.roles ?? [])
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const valid = name.trim() !== ""

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function save() {
    if (!valid || saving) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(article ? `/api/knowledge-base/${article.id}` : "/api/knowledge-base", {
        method: article ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), text, active, roles }),
      })
      const body = (await response.json().catch(() => ({}))) as Article & { error?: string }
      if (!response.ok) {
        setError(body.error || "Не удалось сохранить статью")
        return
      }
      let saved = body
      if (file) {
        const upload = await fetch(`/api/knowledge-base/${saved.id}/file`, { method: "PUT", headers: { "x-file-name": encodeURIComponent(file.name) }, body: file })
        if (!upload.ok) {
          const failure = (await upload.json().catch(() => ({}))) as { error?: string }
          setError(failure.error || "Не удалось загрузить файл")
          onSaved(saved)
          return
        }
        saved = { ...saved, fileName: file.name }
      }
      onSaved(saved)
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[28px]">
        <h3 className="text-[15px] font-bold uppercase">{t(article ? "Изменить" : "Добавить")}</h3>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800"><X className="h-6 w-6" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[30px] pb-[24px] pt-[24px]">
        <LineField label={t("Название")} value={name} onChange={setName} />
        <div className="mt-[12px]">
          <LineField label={t("Текст")} value={text} onChange={setText} />
        </div>
        <div className="mt-[39px]">
          <CheckBox checked={active} onChange={setActive} label={t("Активный")} />
        </div>
        <div className="mt-[19px]">
          <LineMultiSearchSelect label={t("Права доступа")} value={roles} onChange={setRoles} options={positions} />
        </div>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={(event) => { setFile(event.target.files?.[0] ?? null); event.target.value = "" }} className="hidden" />
        <div role="button" tabIndex={0} onClick={() => fileRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter") fileRef.current?.click() }} className="ml-[20px] mt-[14px] flex h-[200px] cursor-pointer flex-col items-center justify-center gap-[10px] border-2 border-dashed border-[#e8e8e8]">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#2b2b2b]"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" /></svg>
          <span>{file ? file.name : t("Добавьте PDF файл")}</span>
        </div>
        {error && <p className="mt-3 text-center text-[13px] text-red-500">{t(error)}</p>}
      </div>
      <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
        <SaveLink disabled={!valid || saving} onClick={() => void save()}>{t("Сохранить")}</SaveLink>
      </footer>
    </div>,
    document.body,
  )
}

export function KnowledgeBaseView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [articles, setArticles] = useState<Article[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [dialog, setDialog] = useState<{ article: Article | null } | null>(null)
  const [removing, setRemoving] = useState<Article | null>(null)
  const [removeError, setRemoveError] = useState("")
  const positions = usePositionNames()

  useEffect(() => {
    let cancelled = false
    fetch("/api/knowledge-base", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Article[]) => {
        if (!cancelled) setArticles(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return articles.filter((article) => !needle || article.name.toLowerCase().includes(needle) || String(article.id) === needle)
  }, [articles, query])
  const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, lastPage)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)

  async function confirmRemove() {
    if (!removing) return
    setRemoveError("")
    try {
      const response = await fetch(`/api/knowledge-base/${removing.id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setRemoveError(body.error || "Не удалось удалить статью")
        return
      }
      setArticles((list) => list.filter((article) => article.id !== removing.id))
      setRemoving(null)
    } catch {
      setRemoveError("Сервер недоступен, попробуйте ещё раз")
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      <SettingsToolbar
        className="h-[60px] pt-[4px]"
        left={
          <div className="w-[335px] shrink-0 pl-[20px]">
            <button type="button" onClick={() => setDialog({ article: null })} className="text-[13px] text-[#4f71dc] hover:underline">+ {t("Добавить")}</button>
          </div>
        }
        search={<SettingsSearch value={query} onChange={(value) => { setQuery(value); setPage(1) }} className="w-[295px]" />}
        pager={<SettingsPager page={current} pageSize={pageSize} count={filtered.length} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} />}
      />
      <div className={`${grayHead} ${COLS}`}>
        <span>№</span>
        <span>{t("Наименование")}</span>
      </div>
      {visible.length === 0 ? (
        <EmptyState />
      ) : (
        visible.map((article) => (
          <div key={article.id} className={`${listRow} ${COLS} last:border-b-0`}>
            <span>{article.id}</span>
            <span>{article.name}</span>
            <HoverActions offset={68} onEdit={() => setDialog({ article })} onDelete={() => { setRemoveError(""); setRemoving(article) }} />
          </div>
        ))
      )}

      {dialog && (
        <ArticleDialog
          article={dialog.article}
          positions={positions}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setArticles((list) => (list.some((item) => item.id === saved.id) ? list.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...list]))
            setDialog(null)
          }}
        />
      )}
      {removing && <ConfirmDeleteDialog name={removing.name} error={removeError} onConfirm={() => void confirmRemove()} onClose={() => setRemoving(null)} />}
    </main>
  )
}
