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
  useDictionaryList,
  useDictionaryUrlState,
} from "./dictionaries-shared"
import { ProductTypeFormDialog } from "./product-types-form"
import { PRODUCT_TYPES_API, PRODUCT_TYPE_ORDERINGS, PRODUCT_TYPE_PAGE_SIZE, type ProductTypeNode, type ProductTypeTreeResult } from "./product-types-data"

// "Типы продуктов" (demo #/product-type, Settings → Типы продуктов; API
// main/product_type/as_menu/). Settings side menu + "+ добавить тип продукта" + a tree grid
// Категории | Организация | Дата создания | Показывать в боте (Да / Нет): a type with
// subcategories is a bold group row followed by its children (indented, with their
// picture), hover ✎ / 🗑. Create / update dialog = product-types-form.tsx, delete confirm =
// dictionaries-shared.tsx. Like the demo the state lives in the URL (?openCreateDialog=true,
// ?productType=<id>&openUpdateDialog=true | openDeleteDialog=true, ?ordering). Like the demo
// there is no search box and no paginator: every type is listed, ordered by name.

export function ProductTypesView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <ProductTypesGrid />
  return (
    <CatalogPageLayout>
      <ProductTypesGrid />
    </CatalogPageLayout>
  )
}

function ProductTypesGrid() {
  const { t, language } = useLanguage()
  const { state, update, dialog, setDialog } = useDictionaryUrlState("productType", PRODUCT_TYPE_ORDERINGS, PRODUCT_TYPE_PAGE_SIZE)
  const { data, loading, error, reload } = useDictionaryList<ProductTypeTreeResult>(dictionaryListUrl(PRODUCT_TYPES_API, state, true))
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const canEdit = useCanWrite()
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [setDialog])

  const rows = data?.results ?? []
  const notSet = t("Не указано")
  const created = (node: ProductTypeNode) => (node.createdAt ? formatCategoryDate(node.createdAt, language) : node.createdDate)
  const sort = (next: string) => update({ ordering: next, page: 1 })

  const actions = (node: ProductTypeNode) =>
    canEdit && <DictionaryRowActions onEdit={() => setDialog({ kind: "update", id: node.id })} onDelete={() => setDialog({ kind: "delete", id: node.id, name: node.name })} />

  // demo rows: Bootstrap grid xs-3 / 3 / 3 / 2 / 1; the children of a type sit in a nested grid
  // (picture xs-1, name xs-4, organization xs-3, date xs-2, bot xs-1, actions xs-1)
  function renderNode(node: ProductTypeNode) {
    const group = node.children.length > 0
    return (
      <div key={node.id}>
        <div className={`${DICT_ROW} grid-cols-[311.8px_303.7px_303.8px_1fr] ${group ? "font-semibold" : ""}`}>
          <div className="break-words py-3 pr-4 font-semibold leading-[16.25px]">{node.name}</div>
          <div className="py-3 pr-4 leading-[16.25px]">{node.organization || notSet}</div>
          <div className="whitespace-nowrap py-3 pr-4 leading-[16.25px]">{created(node)}</div>
          <div className="py-3 pr-4 leading-[16.25px]">{node.showInBot ? t("Да") : t("Нет")}</div>
          {actions(node)}
        </div>
        {node.children.map((child) => (
          <div key={child.id} className="group relative ml-[145px] mr-[30px] grid min-h-[45px] grid-cols-[408px_300px_200px_1fr] items-center after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] hover:bg-[#f2f5f8]">
            <div className="flex min-h-[45px] items-center break-words py-2.5 pr-4 leading-[16.25px]">
              {/* eslint-disable-next-line @next/next/no-img-element -- private API pictures */}
              {child.imageUrl && <img src={child.imageUrl} alt="" className="mr-2 max-h-10 max-w-10 object-contain" />}
              {child.name}
            </div>
            <div className="py-2.5 pr-4">{child.organization || notSet}</div>
            <div className="whitespace-nowrap py-2.5 pr-4">{created(child)}</div>
            <div className="py-2.5 pr-4">{child.showInBot ? t("Да") : t("Нет")}</div>
            {actions(child)}
          </div>
        ))}
      </div>
    )
  }

  const headerCell = "px-0 font-semibold"

  return (
    <DictionaryPage>
      <DictionaryToolbar addLabel={canEdit ? t("добавить тип продукта") : null} onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={data?.count ?? 0} bare />

      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className={`${DICT_HEAD} grid-cols-[311.8px_303.7px_303.8px_1fr]`}>
            <SortHeader as="div" label={t("Категории")} field="name" ordering={state.ordering} onSort={sort} className={headerCell} />
            <SortHeader as="div" label={t("Организация")} field="division" ordering={state.ordering} onSort={sort} className={headerCell} />
            <SortHeader as="div" label={t("Дата создания")} field="created_date" ordering={state.ordering} onSort={sort} className={headerCell} />
            <div className={headerCell}>{t("Показывать в боте")}</div>
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
        <ProductTypeFormDialog
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          typeId={dialog.kind === "update" ? dialog.id : null}
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
          api={PRODUCT_TYPES_API}
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
