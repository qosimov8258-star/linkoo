"use client"

import { useCallback, useState } from "react"

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
// there is no search box and no paginator: every type is listed by its Порядок (a column header sorts by that
// column instead).

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

  // Linko's rows (Bootstrap xs-3 / 3 / 3 / 2 / 1 of the 30 px inset row; cells padded 8 px, the first only on the
  // right). A type with subcategories is a bold row followed by its subcategories; a type without them is a row padded
  // 15 px all round with only its name bold. A subcategory row (picture xs-1, name 1/3, xs-3, xs-2, xs-1, actions xs-1)
  // sits 15 px further in on every level (its own subcategories nest inside it) under an inset dotted line. Rows have
  // no hover colour: the ✎ / 🗑 of the hovered row show.
  const dotted = "after:pointer-events-none after:absolute after:inset-x-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"
  const cell = "break-words px-2 leading-[16.25px]"
  // The ✎ / 🗑 (absolute, 34 px from the right) measured from the page edge like Linko's, whatever the row's inset.
  const actionsBox = "pointer-events-none absolute inset-y-0 left-0 [&>*]:pointer-events-auto"

  function renderChild(child: ProductTypeNode, depth: number) {
    return (
      <div key={child.id} style={{ paddingLeft: depth * 15 }}>
        <div className={`group relative grid min-h-[45px] grid-cols-[8.3333%_33.3333%_25%_16.6667%_8.3333%_1fr] items-center py-2.5 ${dotted} after:top-0`}>
          <div className="px-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- private API pictures */}
            {child.imageUrl && <img src={child.imageUrl} alt="" className="max-h-10 max-w-10 object-contain" />}
          </div>
          <div className="break-words leading-[16.25px]">{child.name}</div>
          <div className={cell}>{child.organization || notSet}</div>
          <div className={`${cell} whitespace-nowrap`}>{created(child)}</div>
          <div className={cell}>{child.showInBot ? t("Да") : t("Нет")}</div>
          <div className={`${actionsBox} right-[-30px]`}>{actions(child)}</div>
        </div>
        {child.children.map((grandchild) => renderChild(grandchild, depth + 1))}
      </div>
    )
  }

  function renderNode(node: ProductTypeNode) {
    const group = node.children.length > 0
    const columns = "grid grid-cols-[25%_25%_25%_16.6667%_1fr] items-center"
    return (
      <div key={node.id} className={`relative bg-white ${dotted} after:bottom-0`}>
        {group ? (
          <div className="px-[30px]">
            <div className={`group relative min-h-[50px] font-semibold ${columns}`}>
              <div className="break-words pr-2 leading-[16.25px]">{node.name}</div>
              <div className={cell}>{node.organization || notSet}</div>
              <div className={`${cell} whitespace-nowrap`}>{created(node)}</div>
              <div className={cell}>{node.showInBot ? t("Да") : t("Нет")}</div>
              <div className={`${actionsBox} right-[-30px]`}>{actions(node)}</div>
            </div>
            {node.children.map((child) => renderChild(child, 1))}
          </div>
        ) : (
          <div className={`group relative min-h-[55px] p-[15px] ${columns}`}>
            <div className="break-words pr-2 font-semibold leading-[16.25px]">{node.name}</div>
            <div className={cell}>{node.organization || notSet}</div>
            <div className={`${cell} whitespace-nowrap`}>{created(node)}</div>
            <div className={cell}>{node.showInBot ? t("Да") : t("Нет")}</div>
            {/* The ✎ / 🗑 sit 15 px further out here (Linko's padded row). */}
            <div className={`${actionsBox} right-[-15px]`}>{actions(node)}</div>
          </div>
        )}
      </div>
    )
  }

  const headerCell = "px-2 font-semibold"

  return (
    <DictionaryPage>
      <DictionaryToolbar addLabel={canEdit ? t("добавить тип продукта") : null} onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={data?.count ?? 0} bare />

      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className={`${DICT_HEAD} grid-cols-[25%_25%_25%_16.6667%_1fr]`}>
            <SortHeader as="div" label={t("Категории")} field="name" ordering={state.ordering} onSort={sort} className="pr-2 font-semibold" />
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
