"use client"

import { Pencil, Trash2 } from "lucide-react"
import { useCallback, useState } from "react"

import { EmptyState } from "@/components/analytics/catalog-ui"
import { CashSnackbar, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import { KNOWLEDGE_BASE_API, KNOWLEDGE_BASE_PERMISSION, type KnowledgeBaseListResult } from "@/lib/knowledge-base-types"
import {
  DictionaryDeleteDialog,
  DictionaryToolbar,
  MessageRow,
  dictionaryListUrl,
  useClampPage,
  useDictionaryList,
  useDictionaryUrlState,
} from "./dictionaries-shared"
import { KnowledgeBaseFormDialog } from "./knowledge-base-form"

// "База знания" (demo #/knowledge-base: Персонал → Заказ → База знания). Toolbar "+ Добавить",
// search (?search, server side), page size + "1 - 25 из N" + ‹ ›; grid № (the record id, like the
// demo) | Наименование with the pencil / trash shown on row hover; newest first. The full-screen
// add / edit dialog is knowledge-base-form.tsx, the delete confirm the shared dictionary one.
// URL state: ?search ?page ?pageSize ?openCreateDialog=true, ?knowledge=<id>&openUpdateDialog=true
// | openDeleteDialog=true. Add / edit / delete are hidden without the knowledge base permission.

const COLUMNS = 3

export function KnowledgeBaseView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <KnowledgeBaseGrid />
  return (
    <CatalogPageLayout>
      <KnowledgeBaseGrid />
    </CatalogPageLayout>
  )
}

function KnowledgeBaseGrid() {
  const { t } = useLanguage()
  const { state, update, dialog, setDialog } = useDictionaryUrlState("knowledge", [], 25)
  const { data, loading, error, reload } = useDictionaryList<KnowledgeBaseListResult>(dictionaryListUrl(KNOWLEDGE_BASE_API, state, false))
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const canManage = useCanManage([KNOWLEDGE_BASE_PERMISSION])
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [setDialog])
  useClampPage(data?.count, loading, state, update)

  const rows = data?.results ?? []
  const showEmpty = !error && data !== null && rows.length === 0

  return (
    <section className="min-w-0 flex-1 px-6 pb-6 pt-4 text-[13px] text-[#333] lg:px-9">
      <DictionaryToolbar addLabel={canManage ? t("Добавить") : null} onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={data?.count ?? 0} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] table-fixed text-left">
          <colgroup>
            <col className="w-5/12" />
            <col className="w-6/12" />
            <col className="w-1/12" />
          </colgroup>
          <thead className="bg-[#5d6474] text-[13px] text-white">
            <tr className="h-[50px]">
              <th className="px-[30px] font-semibold">№</th>
              <th className="px-4 font-semibold">{t("Наименование")}</th>
              <th />
            </tr>
          </thead>
          <tbody className={loading && data ? "opacity-60" : undefined}>
            {loading && !data ? (
              <MessageRow colSpan={COLUMNS}>{t("Загрузка...")}</MessageRow>
            ) : error ? (
              <MessageRow colSpan={COLUMNS} tone="error">
                {t(error)}
              </MessageRow>
            ) : (
              rows.map((article) => (
                <tr key={article.id} className="group h-[50px] border-b border-dashed border-slate-300 hover:bg-[#f8f9fb]">
                  <td className="px-[30px] py-3">{article.id}</td>
                  <td className="break-words px-4 py-3">{article.name}</td>
                  <td className="py-2 pr-4">
                    {canManage && (
                      <span className="flex items-center justify-end gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: "update", id: article.id })}
                          aria-label={t("Изменить")}
                          title={t("Изменить")}
                          className="rounded-full p-2 text-[#757575] hover:bg-slate-100"
                        >
                          <Pencil className="h-[18px] w-[18px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: "delete", id: article.id, name: article.name })}
                          aria-label={t("Удалить")}
                          title={t("Удалить")}
                          className="rounded-full p-2 text-[#757575] hover:bg-slate-100"
                        >
                          <Trash2 className="h-[18px] w-[18px]" />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {showEmpty && <EmptyState />}
      </div>

      {canManage && (dialog?.kind === "create" || dialog?.kind === "update") && (
        <KnowledgeBaseFormDialog
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          articleId={dialog.kind === "update" ? dialog.id : null}
          onClose={closeDialog}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: "Успешно сохранено", tone: "success" })
            reload()
          }}
        />
      )}

      {canManage && dialog?.kind === "delete" && (
        <DictionaryDeleteDialog
          key={`delete-${dialog.id}`}
          api={KNOWLEDGE_BASE_API}
          id={dialog.id}
          name={dialog.name}
          onClose={closeDialog}
          onDeleted={() => {
            setDialog(null)
            setNotice({ text: "Успешно удалено", tone: "success" })
            reload()
          }}
          onFailed={(message) => setNotice({ text: message, tone: "error" })}
        />
      )}

      <CashSnackbar message={notice} onClose={closeNotice} />
    </section>
  )
}
