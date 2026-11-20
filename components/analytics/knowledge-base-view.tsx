"use client"

import { useCallback, useState } from "react"

import { EmptyState } from "@/components/analytics/catalog-ui"
import { CashSnackbar, useCanManage, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import { KNOWLEDGE_BASE_API, KNOWLEDGE_BASE_PERMISSION, type KnowledgeBaseListResult } from "@/lib/knowledge-base-types"
import {
  DICT_HEAD,
  DICT_ROW,
  DictionaryDeleteDialog,
  DictionaryPage,
  DictionaryToolbar,
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

// Linko's grid: 30 px inset, columns 5 / 6 / 1 of 12, every column but the first 8 px padded.
const COLS = "grid-cols-[5fr_6fr_1fr]"
const PENCIL = "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
const BIN = "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"

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
    // Full width next to the settings menu, as Linko's other dictionary lists (no inset card).
    <DictionaryPage>
      <DictionaryToolbar addLabel={canManage ? t("Добавить") : null} addClassName="top-[21px]" onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={data?.count ?? 0} />

      <div className="overflow-x-auto">
        <div className="min-w-[480px]">
          <div className={`${DICT_HEAD} ${COLS}`}>
            <span>№</span>
            <span className="pl-2">{t("Наименование")}</span>
            <span />
          </div>
          <div className={loading && data ? "opacity-60" : undefined}>
            {loading && !data ? (
              <p className="px-9 py-10 text-center text-slate-400">{t("Загрузка...")}</p>
            ) : error ? (
              <p className="px-9 py-10 text-center text-red-600">{t(error)}</p>
            ) : (
              rows.map((article) => (
                <div key={article.id} className={`${DICT_ROW} ${COLS}`}>
                  <span className="py-2">{article.id}</span>
                  <span className="break-words py-2 pl-2">{article.name}</span>
                  <span className="pl-2">
                    {canManage && (
                      // Linko: two 30 x 25 icon buttons (22 px glyphs, #666) shown on row hover.
                      <span className="flex opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: "update", id: article.id })}
                          aria-label={t("Изменить")}
                          title={t("Изменить")}
                          className="flex h-[25px] w-[30px] items-center justify-center"
                        >
                          <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden="true"><path d={PENCIL} /></svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: "delete", id: article.id, name: article.name })}
                          aria-label={t("Удалить")}
                          title={t("Удалить")}
                          className="flex h-[25px] w-[30px] items-center justify-center"
                        >
                          <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]" aria-hidden="true"><path d={BIN} /></svg>
                        </button>
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
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
    </DictionaryPage>
  )
}
