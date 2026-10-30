"use client"

import { ArrowDown, ArrowUp } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { CashSnackbar, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { importKey, postJson, repeatedInFile, type PreparedRow } from "@/lib/excel-row-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { ConfirmDelete, EmptyState, ErrorAlert, HoverActions, LineField, ListToolbar, Modal, SaveLink, grayHead, listRow } from "./catalog-ui"
import { ExcelImportLink, ExcelRowImportDialog, type ExcelImportSpec } from "./excel-row-import"
import type { SupplierCategory as Category } from "./supplier-categories-data"

// "Категории поставщиков" (demo #/provider-category, Settings → Поставщики): "+ Добавить категорию
// поставщика", the single column Категории (sortable) with the pencil / trash on row hover, the
// dialog "Добавить / Изменить тип поставщика" (Наименование категории) and the delete confirm.
// A category still used by a supplier cannot be deleted. "Импорт с Excel" (ours, not in the demo)
// creates the categories of a file through POST /api/supplier-categories.

type Dialog = { kind: "create" } | { kind: "update"; category: Category } | { kind: "delete"; category: Category } | null

export function SupplierCategoriesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [dialog, setDialog] = useState<Dialog>(null)
  const [ordering, setOrdering] = useState<"" | "asc" | "desc">("")
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const canImport = useCanManage(["procurement.manage"])
  const closeNotice = useCallback(() => setNotice(null), [])

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/supplier-categories", { cache: "no-store" })
      if (!response.ok) throw new Error("failed")
      setCategories((await response.json()) as Category[])
      setLoadError("")
    } catch {
      setLoadError("Не удалось загрузить категории поставщиков с сервера")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const importSpec: ExcelImportSpec<{ name: string }> = {
    templateName: "supplier-categories-template",
    columns: [{ field: "name", header: "Наименование", aliases: ["Название", "Наименование категории", "Категория", "Категории", "Name"] }],
    keyField: "name",
    prepare: async (records) => {
      const rows: PreparedRow<{ name: string }>[] = records.map((record) => ({ line: record.line, label: record.values.name, item: { name: record.values.name } }))
      return { rows, errors: repeatedInFile(rows, (row) => importKey(row.item.name)) }
    },
    send: (item) => postJson("/api/supplier-categories", item),
    fallbackError: "Не удалось сохранить категорию",
  }

  const rows = useMemo(() => {
    if (!ordering) return categories
    const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" }) || a.id - b.id)
    return ordering === "desc" ? sorted.reverse() : sorted
  }, [categories, ordering])

  const body = (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <div className="-mb-[3px] mt-[3px]">
        <ListToolbar
          addLabel={t("Добавить категорию поставщика")}
          onAdd={() => setDialog({ kind: "create" })}
          extra={canImport ? <ExcelImportLink className="pt-[8px]" onClick={() => setImportOpen(true)} /> : undefined}
        />
      </div>
      <div className={`${grayHead} grid-cols-1`}>
        <button type="button" onClick={() => setOrdering(ordering === "" ? "asc" : ordering === "asc" ? "desc" : "")} className="flex items-center gap-[10px] text-left font-bold">
          {t("Категории")}
          {ordering === "asc" ? <ArrowDown className="h-4 w-4 text-white/60" /> : ordering === "desc" ? <ArrowUp className="h-4 w-4 text-white/60" /> : null}
        </button>
      </div>
      {rows.map((category) => (
        <div key={category.id} className={`${listRow} grid-cols-1 font-semibold`}>
          <span>{category.name}</span>
          <HoverActions onEdit={() => setDialog({ kind: "update", category })} onDelete={() => setDialog({ kind: "delete", category })} />
        </div>
      ))}
      {!rows.length && (loading ? <p className="py-10 text-center text-slate-400">{t("Загрузка категорий...")}</p> : loadError ? <p className="py-10 text-center text-red-600">{t(loadError)}</p> : <EmptyState />)}

      {(dialog?.kind === "create" || dialog?.kind === "update") && (
        <CategoryFormDialog
          key={dialog.kind === "update" ? `update-${dialog.category.id}` : "create"}
          category={dialog.kind === "update" ? dialog.category : undefined}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: "Успешно сохранено", tone: "success" })
            void load()
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog
          category={dialog.category}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null)
            setNotice(message)
            void load()
          }}
        />
      )}
      {importOpen && (
        <ExcelRowImportDialog
          spec={importSpec}
          onClose={() => setImportOpen(false)}
          onChanged={() => void load()}
          onDone={(summary) => {
            setImportOpen(false)
            setNotice({ text: summary, tone: "success" })
          }}
        />
      )}
      <CashSnackbar message={notice} onClose={closeNotice} />
    </section>
  )
  return embedded ? body : <CatalogPageLayout>{body}</CatalogPageLayout>
}

function CategoryFormDialog({ category, onClose, onSaved }: { category?: Category; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(category?.name ?? "")
  const [saving, setSaving] = useState(false)
  const [alert, setAlert] = useState("")

  async function save() {
    if (saving) return
    if (!name.trim()) return setAlert(`name: ${t("Это поле обязательно к заполнению")}`)
    setSaving(true)
    try {
      const response = await fetch(category ? `/api/supplier-categories/${category.id}` : "/api/supplier-categories", {
        method: category ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (response.ok) return onSaved()
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      setAlert(t(data.error || "Не удалось сохранить категорию"))
    } catch {
      setAlert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        title={category ? t("Изменить тип поставщика") : t("Добавить тип поставщика")}
        onClose={onClose}
        bodyClassName="min-h-[100px] pl-[30px] pr-[52px] pb-[10px] pt-[15px]"
        footer={<SaveLink disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveLink>}
      >
        <LineField label={t("Наименование категории")} required value={name} onChange={setName} />
      </Modal>
      {alert && <ErrorAlert message={alert} onClose={() => setAlert("")} />}
    </>
  )
}

function DeleteDialog({ category, onClose, onDone }: { category: Category; onClose: () => void; onDone: (message: SnackbarMessage) => void }) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      const response = await fetch(`/api/supplier-categories/${category.id}`, { method: "DELETE" })
      if (response.ok) return onDone({ text: "Успешно удалено", tone: "success" })
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      onDone({ text: t(data.error || "Не удалось удалить категорию"), tone: "error" })
    } catch {
      onDone({ text: t("Сервер недоступен, попробуйте ещё раз"), tone: "error" })
    }
  }

  return <ConfirmDelete name={category.name} busy={busy} onConfirm={() => void remove()} onClose={onClose} />
}
