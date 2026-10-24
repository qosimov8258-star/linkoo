"use client"

import { MoreVertical, Pencil, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { CashSnackbar, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import { formatCategoryDate } from "./categories-grid"
import { BrandFormDialog } from "./brands-form"
import { BRANDS_API, BRAND_ORDERINGS, type Brand, type BrandListResult } from "./brands-data"
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

// "Бренд" (demo #/brand, Settings → Бренд; API main/brand/?thumbnail_type=large).
// Settings side menu + "+ Добавить бренд", search, paginator and the grid
// Id | Фото | Наименование | Организация | Дата создания (all sortable) with a ⋮ menu
// (Изменить / Удалить) per row. Create / update dialog = brands-form.tsx, delete confirm =
// dictionaries-shared.tsx. URL state: ?search ?ordering ?page ?pageSize ?openCreateDialog=true,
// ?brand=<id>&openUpdateDialog=true | openDeleteDialog=true.

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
  const created = (brand: Brand) => (brand.createdAt ? formatCategoryDate(brand.createdAt, language) : brand.createdDate)
  const sort = (next: string) => update({ ordering: next, page: 1 })

  const cols = "grid-cols-[109.3px_202.5px_303.7px_303.8px_1fr]"
  const headerCell = "px-0 font-semibold"

  return (
    <DictionaryPage>
      <DictionaryToolbar plus="icon" addLabel={canEdit ? t("Добавить бренд") : null} onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={data?.count ?? 0} />

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className={`${DICT_HEAD} ${cols}`}>
            <SortHeader as="div" label="Id" field="id" ordering={state.ordering} onSort={sort} className={headerCell} />
            <SortHeader as="div" label={t("Фото")} field="image" ordering={state.ordering} onSort={sort} className={headerCell} />
            <SortHeader as="div" label={t("Наименование")} field="name" ordering={state.ordering} onSort={sort} className={headerCell} />
            <SortHeader as="div" label={t("Организация")} field="division" ordering={state.ordering} onSort={sort} className={headerCell} />
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
              rows.map((brand) => (
                <div key={brand.id} className={`${DICT_ROW} ${cols}`}>
                  <div className="py-2 pr-4">{brand.id}</div>
                  <div className="py-2 pr-4">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private API pictures */}
                    {brand.photoUrl && <img src={brand.photoUrl} alt="" className="h-5 w-10 object-contain" />}
                  </div>
                  <div className="break-words py-2 pr-4">{brand.name}</div>
                  <div className="break-words py-2 pr-4">{brand.organization || t("Не указано")}</div>
                  <div className="whitespace-nowrap py-2 pr-4">{created(brand)}</div>
                  <div className="absolute right-[36px] top-[7px]">
                    {canEdit && (
                      <RowMenu
                        onEdit={() => setDialog({ kind: "update", id: brand.id })}
                        onDelete={() => setDialog({ kind: "delete", id: brand.id, name: brand.name })}
                      />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
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
    </DictionaryPage>
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
    const top = rect.bottom + 100 > window.innerHeight ? Math.max(8, rect.top - 100) : rect.top - 9
    setAnchor({ top, right: Math.max(8, window.innerWidth - rect.right - 12) })
  }
  const item = (label: string, icon: ReactNode, action: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setAnchor(null)
        action()
      }}
      className="flex h-12 w-full items-center gap-[34px] pl-[22px] text-left text-[13px] text-[#333] hover:bg-[#f2f5f8]"
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
        <div role="menu" style={{ top: anchor.top, right: anchor.right }} className="fixed z-50 w-[168px] rounded-[2px] bg-white py-[3px] text-left shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          {item(t("Изменить"), <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>, onEdit)}
          {item(t("Удалить"), <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>, onDelete)}
        </div>
      )}
    </div>
  )
}
