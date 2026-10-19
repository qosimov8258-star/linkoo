"use client"

import { MoreVertical, Pencil, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { BrandFormDialog } from "./brands-form"
import { BRANDS_API, BRAND_ORDERINGS, type Brand, type BrandListResult } from "./brands-data"
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

// "Бренд" (demo #/brand, Settings → Бренд; API main/brand/?thumbnail_type=large).
// Settings side menu + "+ Добавить бренд", search, paginator and the grid
// Id | Фото | Наименование | Организация | Дата создания (all sortable) with a ⋮ menu
// (Изменить / Удалить) per row. Create / update dialog = brands-form.tsx, delete confirm =
// dictionaries-shared.tsx. URL state: ?search ?ordering ?page ?pageSize ?openCreateDialog=true,
// ?brand=<id>&openUpdateDialog=true | openDeleteDialog=true.

const COLUMNS = 6

export function BrandsView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <BrandsGrid />
  return (
    <CatalogPageLayout>
      <BrandsGrid />
    </CatalogPageLayout>
  )
}

function BrandsGrid() {
  const { t, language } = useLanguage()
  const { state, update, dialog, setDialog } = useDictionaryUrlState("brand", BRAND_ORDERINGS, 25)
  const { data, loading, error, reload } = useDictionaryList<BrandListResult>(dictionaryListUrl(BRANDS_API, state, false))
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const canEdit = useCanWrite()
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [setDialog])
  useClampPage(data?.count, loading, state, update)

  const rows = data?.results ?? []
  const created = (brand: Brand) => (brand.createdAt ? formatStatementDate(brand.createdAt, language, false).replace(/\s*г\.$/, "") : brand.createdDate)
  const sort = (next: string) => update({ ordering: next, page: 1 })

  return (
    <section className="min-w-0 flex-1 px-6 pb-6 pt-4 lg:px-9">
      <DictionaryToolbar addLabel={canEdit ? t("Добавить бренд") : null} onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={data?.count ?? 0} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[14px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <SortHeader label="Id" field="id" ordering={state.ordering} onSort={sort} className="w-20 pl-6" />
              <SortHeader label={t("Фото")} field="image" ordering={state.ordering} onSort={sort} className="w-28" />
              <SortHeader label={t("Наименование")} field="name" ordering={state.ordering} onSort={sort} />
              <SortHeader label={t("Организация")} field="division" ordering={state.ordering} onSort={sort} />
              <SortHeader label={t("Дата создания")} field="created_date" ordering={state.ordering} onSort={sort} />
              <th className="w-16" />
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
              rows.map((brand) => (
                <tr key={brand.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="py-3 pl-6 pr-4 text-[#586174]">{brand.id}</td>
                  <td className="px-4 py-2">
                    <span className="flex h-10 w-10 items-center justify-center overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private API pictures */}
                      {brand.photoUrl && <img src={brand.photoUrl} alt="" className="max-h-10 max-w-10 object-contain" />}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{brand.name}</td>
                  <td className="px-4 py-3">{brand.organization || t("Не указано")}</td>
                  <td className="whitespace-nowrap px-4 py-3">{created(brand)}</td>
                  <td className="px-2 py-3 text-right">
                    {canEdit && (
                      <RowMenu
                        onEdit={() => setDialog({ kind: "update", id: brand.id })}
                        onDelete={() => setDialog({ kind: "delete", id: brand.id, name: brand.name })}
                      />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(dialog?.kind === "create" || dialog?.kind === "update") && (
        <BrandFormDialog
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          brandId={dialog.kind === "update" ? dialog.id : null}
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
          api={BRANDS_API}
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

/** Demo IconMenu ⋮: Изменить / Удалить (fixed, so the table's scroll box never clips it). */
function RowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useLanguage()
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!anchor) return
    const close = () => setAnchor(null)
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [anchor])
  const toggle = (button: HTMLButtonElement) => {
    if (anchor) return setAnchor(null)
    const rect = button.getBoundingClientRect()
    // Below the button when there is room, otherwise above it (menu ≈ 100 px).
    const top = rect.bottom + 100 > window.innerHeight ? Math.max(8, rect.top - 100) : rect.top
    setAnchor({ top, right: Math.max(8, window.innerWidth - rect.right) })
  }
  const item = (label: string, icon: ReactNode, action: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setAnchor(null)
        action()
      }}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] text-[#333] hover:bg-slate-100"
    >
      {icon}
      {label}
    </button>
  )
  return (
    <div ref={ref} className="inline-block">
      <button
        type="button"
        onClick={(event) => toggle(event.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-label={t("Действия")}
        className="rounded-full p-2 text-[#666] hover:bg-slate-100"
      >
        <MoreVertical className="h-5 w-5" />
      </button>
      {anchor && (
        <div role="menu" style={{ top: anchor.top, right: anchor.right }} className="fixed z-50 min-w-[160px] rounded bg-white py-1 text-left shadow-lg ring-1 ring-black/5">
          {item(t("Изменить"), <Pencil className="h-4 w-4 text-[#666]" />, onEdit)}
          {item(t("Удалить"), <Trash2 className="h-4 w-4 text-[#666]" />, onDelete)}
        </div>
      )}
    </div>
  )
}
