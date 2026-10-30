"use client"

import { Loader2, X } from "lucide-react"
import { useEffect, useState } from "react"

import type { CategoryErrorBody, CategoryUsage } from "@/lib/categories-schema"
import type { CategoryKind } from "@/lib/category-options"
import { useLanguage } from "@/lib/i18n/language-context"
import { categoriesApi, type SavedCategory } from "./category-form-modal"

// Dialogs of the "Категории приходов / расходов" pages: the delete confirm (demo
// ConfirmDialog type "delete": "Подтверждение удаления" + the category name; a refused
// delete shows "Удаление невозможно из-за связи с другими данными") and the snackbar
// ("Успешно сохранено" / "Успешно удалено"). The Excel import lives in categories-grid.tsx.

export type CategoryNotice = { text: string; tone: "success" | "error" }

export function CategorySnackbar({ notice, onClose }: { notice: CategoryNotice | null; onClose: () => void }) {
  const { t } = useLanguage()
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(onClose, notice.tone === "error" ? 6000 : 3500)
    return () => window.clearTimeout(timer)
  }, [notice, onClose])
  if (!notice) return null
  return (
    <div
      role="status"
      className={`fixed bottom-6 left-1/2 z-[300] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-4 rounded-md px-5 py-3 text-[14px] font-medium text-white shadow-lg ${
        notice.tone === "success" ? "bg-[#323232]" : "bg-[#c94b4b]"
      }`}
    >
      {notice.text}
      <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/** "Касса (3), Дочерние категории (1)" in the UI language. */
export function categoryUsageText(usage: CategoryUsage[], t: (text: string) => string): string {
  return usage.map((item) => `${t(item.label)} (${item.count})`).join(", ")
}

// --- delete confirm ----------------------------------------------------------------

export function CategoryDeleteDialog({
  kind,
  categoryId,
  name,
  onClose,
  onDeleted,
  onFailed,
}: {
  kind: CategoryKind
  categoryId: number
  /** Known name (grid row); otherwise read from GET /api/{kind}-categories/[id]. */
  name?: string
  onClose: () => void
  onDeleted: () => void
  /** Already translated message for the snackbar. */
  onFailed: (message: string) => void
}) {
  const { t } = useLanguage()
  const api = categoriesApi(kind)
  const [loadedName, setLoadedName] = useState("")
  const [loading, setLoading] = useState(!name)
  const [loadError, setLoadError] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [blockedBy, setBlockedBy] = useState<CategoryUsage[] | null>(null)

  useEffect(() => {
    if (name) return
    const controller = new AbortController()
    fetch(`${api}/${categoryId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as SavedCategory & CategoryErrorBody
        if (!response.ok) throw new Error(data.error || "Категория не найдена")
        setLoadedName(data.name)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [api, categoryId, name])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function remove() {
    if (deleting || loading || loadError) return
    setDeleting(true)
    try {
      const response = await fetch(`${api}/${categoryId}`, { method: "DELETE" })
      if (response.ok) {
        onDeleted()
        return
      }
      const data = (await response.json().catch(() => ({}))) as CategoryErrorBody
      const usage = data.usage ?? []
      if (response.status === 409) setBlockedBy(usage)
      const base = t(response.status === 403 ? "Недостаточно прав" : data.error || "Удаление невозможно из-за связи с другими данными")
      onFailed(usage.length ? `${base}: ${categoryUsageText(usage, t)}` : base)
    } catch {
      onFailed(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setDeleting(false)
    }
  }

  const busy = loading || deleting
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4" onMouseDown={onClose}>
      <div onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" className="w-full max-w-[500px] rounded bg-white shadow-2xl">
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-3">
          <b className="text-[14px] uppercase text-[#333]">{t("Подтверждение удаления")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="relative min-h-[150px] px-[30px] text-[14px] text-[#333]">
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          <p className="py-5">{t("Вы уверены что хотите удалить эти данные?")}</p>
          {loadError ? (
            <p className="pb-5 text-[#f44336]">{t(loadError)}</p>
          ) : (
            <div className="-mx-[30px] break-words bg-[#f1f5f8] px-[30px] py-5 font-semibold">{name || loadedName}</div>
          )}
          {blockedBy && (
            <p className="py-5 text-[#f44336]">
              {t("Удаление невозможно из-за связи с другими данными")}
              {blockedBy.length > 0 && `: ${categoryUsageText(blockedBy, t)}`}
            </p>
          )}
        </div>
        <footer className="flex justify-end border-t border-[#efefef] p-[10px]">
          <button
            type="button"
            onClick={remove}
            disabled={busy || Boolean(loadError)}
            className="rounded px-5 py-2.5 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#129fdd]/10 disabled:opacity-50"
          >
            {t("Удалить")}
          </button>
        </footer>
      </div>
    </div>
  )
}
