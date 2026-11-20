"use client"

import { Fragment, useCallback, useState, type ReactNode } from "react"

import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import { formatCategoryDate } from "./categories-grid"
import {
  DictionaryDeleteDialog,
  DICT_HEAD,
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

  // Linko's rows: Bootstrap xs-6 / 4 / 2 of the 30 px inset row (cells padded 8 px, the first only on the right). A
  // top-level unit's name is bold (its date too when it has child units); its child units follow inside the same item,
  // their name 50 px in, each under an inset dotted line; the item ends with a full-width dotted line. Rows have no
  // hover colour: the ✎ / 🗑 of the hovered row show.
  const dotted = "after:pointer-events-none after:absolute after:inset-x-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"
  // The ✎ / 🗑 (absolute, 34 px from the right) measured from the page edge like Linko's.
  const actionsBox = "pointer-events-none absolute inset-y-0 left-0 right-[-30px] [&>*]:pointer-events-auto"
  function renderRow(node: UnitOfMeasureNode, level: number): ReactNode {
    return (
      <Fragment key={node.id}>
        <div className={`group relative grid min-h-[50px] grid-cols-[50%_33.3333%_1fr] items-center ${level > 0 ? `${dotted} after:top-0` : ""}`}>
          <div className={`break-words pr-2 leading-[16.25px] ${level === 0 ? "font-semibold" : "pl-[50px]"}`}>{node.name}</div>
          <div className={`whitespace-nowrap px-2 leading-[16.25px] ${node.children.length > 0 ? "font-semibold" : ""}`}>{created(node)}</div>
          <div className={actionsBox}>{actions(node)}</div>
        </div>
        {node.children.map((child) => renderRow(child, level + 1))}
      </Fragment>
    )
  }
  function renderNode(node: UnitOfMeasureNode) {
    return (
      <div key={node.id} className={`relative bg-white px-[30px] ${dotted} after:bottom-0`}>
        {renderRow(node, 0)}
      </div>
    )
  }

  const headerCell = "px-2 font-semibold"

  return (
    <DictionaryPage>
      {/* Linko's hierarchy answers no count: its pager prints «from - page × size из» (1 - 25 из even for 3 found). */}
      <DictionaryToolbar
        addLabel={canEdit ? t("добавить измерение") : null}
        onAdd={() => setDialog({ kind: "create" })}
        state={state}
        update={update}
        count={Math.max(data?.count ?? 0, state.page * state.pageSize)}
        hideTotal
      />

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className={`${DICT_HEAD} grid-cols-[50%_33.3333%_1fr]`}>
            <SortHeader as="div" label={t("Наименование")} field="name" ordering={state.ordering} onSort={sort} className="pr-2 font-semibold" />
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
              rows.map((node) => renderNode(node))
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
