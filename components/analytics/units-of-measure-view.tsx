"use client"

import { Pencil, Trash2 } from "lucide-react"
import { Fragment, useCallback, useState } from "react"

import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  DictionaryDeleteDialog,
  DictionaryToolbar,
  MessageRow,
  SortHeader,
  dictionaryListUrl,
  useClampPage,
  useDictionaryList,
  useDictionaryUrlState,
} from "./dictionaries-shared"
import { UnitFormDialog } from "./units-of-measure-form"
import { UNITS_OF_MEASURE_API, UNIT_ORDERINGS, type UnitOfMeasureNode, type UnitOfMeasureTreeResult } from "./units-of-measure-data"

// "Ед.измерения" (demo #/measurement, Settings → Ед.измерения; API
// main/measurement/hierarchy/). Settings side menu + "+ добавить измерение", search,
// paginator (over top-level units) and a tree grid Наименование | Дата создания: a unit
// with children is a bold group row followed by its children, hover ✎ / 🗑.
// Create / update dialog = units-of-measure-form.tsx, delete confirm = dictionaries-shared.tsx.
// URL state: ?search ?ordering ?page ?pageSize ?openCreateDialog=true,
// ?measurement=<id>&openUpdateDialog=true | openDeleteDialog=true.

const COLUMNS = 3

export function UnitsOfMeasureView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <UnitsGrid />
  return (
    <CatalogPageLayout>
      <UnitsGrid />
    </CatalogPageLayout>
  )
}

function UnitsGrid() {
  const { t, language } = useLanguage()
  const { state, update, dialog, setDialog } = useDictionaryUrlState("measurement", UNIT_ORDERINGS, 25)
  const { data, loading, error, reload } = useDictionaryList<UnitOfMeasureTreeResult>(dictionaryListUrl(UNITS_OF_MEASURE_API, state, true))
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const canEdit = useCanWrite()
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [setDialog])
  useClampPage(data?.count, loading, state, update)

  const rows = data?.results ?? []
  const created = (node: UnitOfMeasureNode) => (node.createdAt ? formatStatementDate(node.createdAt, language, false).replace(/\s*г\.$/, "") : node.createdDate)
  const sort = (next: string) => update({ ordering: next, page: 1 })

  function renderNode(node: UnitOfMeasureNode, level: number) {
    const group = level === 0 && node.children.length > 0
    return (
      <Fragment key={node.id}>
        <tr className={`group border-b border-dashed border-slate-300 hover:bg-slate-50 ${group ? "bg-[#f8f9fb]" : ""}`}>
          <td className={`py-4 pr-4 ${group ? "font-semibold" : level === 0 ? "font-medium" : ""}`} style={{ paddingLeft: 24 + level * 30 }}>
            {node.name}
          </td>
          <td className="whitespace-nowrap px-4 py-4">{created(node)}</td>
          <td className="px-4 py-4">
            {canEdit && (
              <div className="flex items-center justify-end gap-3 text-slate-500 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button type="button" onClick={() => setDialog({ kind: "update", id: node.id })} title={t("Изменить")} aria-label={t("Изменить")} className="hover:text-[#4f70e7]">
                  <Pencil className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setDialog({ kind: "delete", id: node.id, name: node.name })} title={t("Удалить")} aria-label={t("Удалить")} className="hover:text-rose-600">
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            )}
          </td>
        </tr>
        {node.children.map((child) => renderNode(child, level + 1))}
      </Fragment>
    )
  }

  return (
    <section className="min-w-0 flex-1 px-6 pb-6 pt-4 lg:px-9">
      <DictionaryToolbar addLabel={canEdit ? t("добавить измерение") : null} onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={data?.count ?? 0} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[14px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <SortHeader label={t("Наименование")} field="name" ordering={state.ordering} onSort={sort} className="w-1/2 pl-6" />
              <SortHeader label={t("Дата создания")} field="created_date" ordering={state.ordering} onSort={sort} />
              <th className="w-24" />
            </tr>
          </thead>
          <tbody className={loading && data ? "opacity-60" : undefined}>
            {loading && !data ? (
              <MessageRow colSpan={COLUMNS}>{t("Загрузка...")}</MessageRow>
            ) : error ? (
              <MessageRow colSpan={COLUMNS} tone="error">
                {t(error)}
              </MessageRow>
            ) : rows.length === 0 ? (
              <MessageRow colSpan={COLUMNS}>{t("По вашему запросу ничего не найдено")}</MessageRow>
            ) : (
              rows.map((node) => renderNode(node, 0))
            )}
          </tbody>
        </table>
      </div>

      {(dialog?.kind === "create" || dialog?.kind === "update") && (
        <UnitFormDialog
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          unitId={dialog.kind === "update" ? dialog.id : null}
          onClose={closeDialog}
          onSaved={() => {
            setDialog(null)
            setNotice({ text: "Успешно сохранено", tone: "success" })
            reload()
          }}
        />
      )}

      {dialog?.kind === "delete" && (
        <DictionaryDeleteDialog
          key={`delete-${dialog.id}`}
          api={UNITS_OF_MEASURE_API}
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
