"use client"

import { ArrowDown, ArrowUp } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { ConfirmDelete, EmptyState, HoverActions, ListToolbar, grayHead, listRow } from "./catalog-ui"
import { DocTemplateFormDialog } from "./doc-templates-form"
import { DOC_TEMPLATES_API, DOC_TEMPLATE_ORDERINGS, docTemplateKeyName, type DocTemplateListResult } from "./doc-templates-data"
import { dictionaryListUrl, useClampPage, useDictionaryList, useDictionaryUrlState } from "./dictionaries-shared"

// "Конструктор документов" (demo #/docs-builder, Settings → Конструкторы). List № | Наименование |
// Дата | Ключ | Активный (every header sorts) with the pencil / trash on row hover, "+ добавить шаблон",
// search, page size and paginator; the create / update dialog is the full-screen editor in
// doc-templates-form.tsx. URL state: ?search ?ordering ?page ?pageSize ?openCreateDialog=true,
// ?docsBuilderId=<id>&openUpdateDialog=true | openDeleteDialog=true.

const GRID = "grid-cols-[104px_385px_193px_192px_1fr]"

export function DocTemplatesView() {
  const { t, language } = useLanguage()
  const { state, update, dialog, setDialog } = useDictionaryUrlState("docsBuilderId", DOC_TEMPLATE_ORDERINGS, 25)
  const { data, loading, error, reload } = useDictionaryList<DocTemplateListResult>(dictionaryListUrl(DOC_TEMPLATES_API, state, false))
  const [search, setSearch] = useState(state.search)
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const [deleting, setDeleting] = useState(false)
  const searchTimer = useRef(0)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [setDialog])
  useClampPage(data?.count, loading, state, update)

  const rows = data?.results ?? []
  const count = data?.count ?? 0
  const from = (state.page - 1) * state.pageSize + 1
  const to = Math.min(state.page * state.pageSize, count)
  const lastPage = Math.max(1, Math.ceil(count / state.pageSize))
  const sort = (field: string) => update({ ordering: state.ordering === field ? `-${field}` : state.ordering === `-${field}` ? "" : field, page: 1 })

  async function remove(id: number) {
    setDeleting(true)
    try {
      const response = await fetch(`${DOC_TEMPLATES_API}/${id}`, { method: "DELETE" })
      if (!response.ok) throw new Error("failed")
      setDialog(null)
      setNotice({ text: "Успешно удалено", tone: "success" })
      reload()
    } catch {
      setDialog(null)
      setNotice({ text: "Удаление невозможно из-за связи с другими данными", tone: "error" })
    } finally {
      setDeleting(false)
    }
  }

  const header = (field: string, label: string) => {
    const icon = state.ordering === field ? <ArrowDown className="h-4 w-4 font-normal text-white/60" /> : state.ordering === `-${field}` ? <ArrowUp className="h-4 w-4 text-white/60" /> : null
    return (
      <button type="button" onClick={() => sort(field)} className="flex items-center gap-[10px] text-left font-bold">
        {label}
        {icon}
      </button>
    )
  }

  return (
    <CatalogPageLayout>
      <div className="min-w-0 flex-1 bg-white px-[30px] text-[13px] text-[#333]">
        <div className="-mb-[3px] -ml-[18px] mt-[3px]">
          <ListToolbar
            addLabel={t("добавить шаблон")}
            onAdd={() => setDialog({ kind: "create" })}
            query={search}
            onQuery={(value) => {
              setSearch(value)
              window.clearTimeout(searchTimer.current)
              searchTimer.current = window.setTimeout(() => update({ search: value.trim(), page: 1 }), 500)
            }}
            searchPos={{ left: 338, top: 17 }}
            pageSize={state.pageSize}
            onPageSize={(size) => update({ pageSize: size, page: 1 })}
            from={from}
            to={to}
            total={count}
            onPrev={state.page > 1 ? () => update({ page: state.page - 1 }) : undefined}
            onNext={state.page < lastPage ? () => update({ page: state.page + 1 }) : undefined}
          />
        </div>
        <div className={`${grayHead} ${GRID}`}>
          {header("id", "№")}
          {header("name", t("Наименование"))}
          {header("date", t("Дата"))}
          {header("key_name", t("Ключ"))}
          {header("is_active", t("Активный"))}
        </div>
        <div className={loading && data ? "opacity-60" : undefined}>
          {rows.map((row) => (
            <div key={row.id} className={`${listRow} ${GRID}`}>
              <span>{row.id}</span>
              <span className="truncate pr-4">{row.name}</span>
              <span>{row.createdDate ? formatStatementDate(row.createdDate, language, false).replace(/\s*г\.$/, "") : ""}</span>
              <span>{t(docTemplateKeyName(row.keyName))}</span>
              <span>{row.isActive ? t("Активный") : t("Отключен")}</span>
              <HoverActions offset={63} onEdit={() => setDialog({ kind: "update", id: row.id })} onDelete={() => setDialog({ kind: "delete", id: row.id })} />
            </div>
          ))}
        </div>
        {!rows.length && (loading && !data ? <p className="py-10 text-center text-slate-400">{t("Загрузка...")}</p> : error ? <p className="py-10 text-center text-red-600">{t(error)}</p> : <EmptyState />)}
      </div>

      {mounted && (dialog?.kind === "create" || dialog?.kind === "update") && (
        <DocTemplateFormDialog
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          templateId={dialog.kind === "update" ? dialog.id : null}
          onClose={closeDialog}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: "Успешно сохранено", tone: "success" })
            reload()
          }}
        />
      )}
      {mounted && dialog?.kind === "delete" && <ConfirmDelete name="" busy={deleting} onConfirm={() => void remove(dialog.id)} onClose={closeDialog} />}
      <CashSnackbar message={notice} onClose={closeNotice} />
    </CatalogPageLayout>
  )
}
