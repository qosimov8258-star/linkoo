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
import { ProductTypeFormDialog } from "./product-types-form"
import { PRODUCT_TYPES_API, PRODUCT_TYPE_ORDERINGS, PRODUCT_TYPE_PAGE_SIZE, type ProductTypeNode, type ProductTypeTreeResult } from "./product-types-data"

// "Типы продуктов" (demo #/product-type, Settings → Типы продуктов; API
// main/product_type/as_menu/). Settings side menu + "+ добавить тип продукта" + a tree grid
// Категории | Организация | Дата создания | Показывать в боте (Да / Нет): a type with
// subcategories is a bold group row followed by its children (indented, with their
// picture), hover ✎ / 🗑. Create / update dialog = product-types-form.tsx, delete confirm =
// dictionaries-shared.tsx. Like the demo the state lives in the URL (?openCreateDialog=true,
// ?productType=<id>&openUpdateDialog=true | openDeleteDialog=true, ?ordering); the search
// box and the paginator (over top-level types, 100 per page) are additions of this app.

const COLUMNS = 5

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
  useClampPage(data?.count, loading, state, update)

  const rows = data?.results ?? []
  const notSet = t("Не указано")
  const created = (node: ProductTypeNode) => (node.createdAt ? formatStatementDate(node.createdAt, language, false).replace(/\s*г\.$/, "") : node.createdDate)
  const sort = (next: string) => update({ ordering: next, page: 1 })

  function renderNode(node: ProductTypeNode, level: number) {
    const group = level === 0 && node.children.length > 0
    return (
      <Fragment key={node.id}>
        <tr className={`group border-b border-dashed border-slate-300 hover:bg-slate-50 ${group ? "bg-[#f8f9fb]" : ""}`}>
          <td className="py-3 pr-4" style={{ paddingLeft: 24 + level * 30 }}>
            <div className="flex items-center gap-3">
              {level > 0 && (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private API pictures */}
                  {node.imageUrl && <img src={node.imageUrl} alt="" className="max-h-10 max-w-10 object-contain" />}
                </span>
              )}
              <span className={group ? "font-semibold" : level === 0 ? "font-medium" : ""}>{node.name}</span>
            </div>
          </td>
          <td className="px-4 py-3">{node.organization || notSet}</td>
          <td className="whitespace-nowrap px-4 py-3">{created(node)}</td>
          <td className="px-4 py-3">{node.showInBot ? t("Да") : t("Нет")}</td>
          <td className="px-4 py-3">
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
      <DictionaryToolbar addLabel={canEdit ? t("добавить тип продукта") : null} onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={data?.count ?? 0} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-[14px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <SortHeader label={t("Категории")} field="name" ordering={state.ordering} onSort={sort} className="pl-6" />
              <SortHeader label={t("Организация")} field="division" ordering={state.ordering} onSort={sort} />
              <SortHeader label={t("Дата создания")} field="created_date" ordering={state.ordering} onSort={sort} />
              <th className="px-4 py-4 font-semibold">{t("Показывать в боте")}</th>
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
    </section>
  )
}
