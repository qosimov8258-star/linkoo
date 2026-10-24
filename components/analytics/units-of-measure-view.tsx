"use client"

import { Pencil, Trash2 } from "lucide-react"
import { useCallback, useState } from "react"

import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import { formatCategoryDate } from "./categories-grid"
import {
  DictionaryDeleteDialog,
  DICT_HEAD,
  DICT_ROW,
  DictionaryPage,
  DictionaryRowActions,
  DictionaryToolbar,
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
// with children is bold, its children follow indented, hover ✎ / 🗑.
// Create / update dialog = units-of-measure-form.tsx, delete confirm = dictionaries-shared.tsx.
// URL state: ?search ?ordering ?page ?pageSize ?openCreateDialog=true,
// ?measurement=<id>&openUpdateDialog=true | openDeleteDialog=true.

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
  const created = (node: UnitOfMeasureNode) => (node.createdAt ? formatCategoryDate(node.createdAt, language) : node.createdDate)
  const sort = (next: string) => update({ ordering: next, page: 1 })

  const actions = (node: UnitOfMeasureNode) =>
    canEdit && <DictionaryRowActions onEdit={() => setDialog({ kind: "update", id: node.id })} onDelete={() => setDialog({ kind: "delete", id: node.id, name: node.name })} />

  // demo rows: every top-level unit is bold, its child units follow indented
  function renderNode(node: UnitOfMeasureNode, level: number) {
    return (
      <div key={node.id}>
        <div className={`${DICT_ROW} grid-cols-[615.5px_1fr]`}>
          <div className={`break-words py-3 pr-4 leading-[16.25px] ${level === 0 ? "font-semibold" : "pl-[50px]"}`}>{node.name}</div>
          <div className={`whitespace-nowrap py-3 pr-4 leading-[16.25px] ${node.children.length > 0 ? "font-semibold" : ""}`}>{created(node)}</div>
          {actions(node)}
        </div>
        {node.children.map((child) => renderNode(child, level + 1))}
      </div>
    )
  }

  const headerCell = "px-0 font-semibold"

  return (
    <DictionaryPage>
      <DictionaryToolbar addLabel={canEdit ? t("добавить измерение") : null} onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={data?.count ?? 0} />

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className={`${DICT_HEAD} grid-cols-[615.5px_1fr]`}>
            <SortHeader as="div" label={t("Наименование")} field="name" ordering={state.ordering} onSort={sort} className={headerCell} />
            <SortHeader as="div" label={t("Дата создания")} field="created_date" ordering={state.ordering} onSort={sort} className={headerCell} />
          </div>
          <div className={loading && data ? "opacity-60" : undefined}>
            {loading && !data ? (
              <p className="px-9 py-10 text-center text-slate-400">{t("Загрузка...")}</p>
            ) : error ? (
              <p className="px-9 py-10 text-center text-red-600">{t(error)}</p>
            ) : rows.length === 0 ? (
              <p className="px-9 py-10 text-center text-slate-400">{t("По вашему запросу ничего не найдено")}</p>
            ) : (
              rows.map((node) => renderNode(node, 0))
            )}
          </div>
        </div>
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
    </DictionaryPage>
  )
}
