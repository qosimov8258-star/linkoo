"use client"

import { Pencil, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState, type FormEvent } from "react"

import { CashSnackbar, SearchSelect, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { CELLS_API, CELL_TYPES_API, type Cell, type CellListResult, type CellType } from "./cells-data"
import type { DictionaryErrorBody } from "./dictionaries-data"
import {
  DictionaryDeleteDialog,
  DictionaryFormShell,
  DictionaryPage,
  DictionaryToolbar,
  Field,
  MessageRow,
  dictionaryInputClass,
  dictionaryListUrl,
  requestErrors,
  useClampPage,
  useDictionaryList,
  useDictionaryUrlState,
} from "./dictionaries-shared"

// "Ячейки" (demo #/cell, Settings → Ячейки; API stock/cell/). Settings side menu +
// "+ добавить оборудование" (sic, the demo labels it so), search, paginator and the grid
// Barcode | Наименование | Тип ячейки | Дата создания with hover ✎ / 🗑. The dialog (demo
// "Добавить / Изменить оборудование") has Наименование, Баркод and Тип ячейки.
// URL state: ?search ?page ?pageSize ?openCreateDialog=true, ?cell=<id>&openUpdateDialog=true | openDeleteDialog=true.

const COLUMNS = 5

export function CellsView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <CellsGrid />
  return (
    <CatalogPageLayout>
      <CellsGrid />
    </CatalogPageLayout>
  )
}

function CellsGrid() {
  const { t, language } = useLanguage()
  const { state, update, dialog, setDialog } = useDictionaryUrlState("cell", [], 25)
  const { data, loading, error, reload } = useDictionaryList<CellListResult>(dictionaryListUrl(CELLS_API, state, false))
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const canEdit = useCanWrite()
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [setDialog])
  useClampPage(data?.count, loading, state, update)

  const rows = data?.results ?? []
  const created = (cell: Cell) => (cell.createdAt && language !== "ru" ? formatStatementDate(cell.createdAt, language, false).replace(/\s*г\.$/, "") : cell.createdDate)

  return (
    <DictionaryPage>
      <DictionaryToolbar addLabel={canEdit ? t("добавить оборудование") : null} onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={data?.count ?? 0} />
      <div className="px-[30px]">

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[14px]">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-4 py-4 pl-6 font-semibold">Barcode</th>
              <th className="px-4 py-4 font-semibold">{t("Наименование")}</th>
              <th className="px-4 py-4 font-semibold">{t("Тип ячейки")}</th>
              <th className="px-4 py-4 text-right font-semibold">{t("Дата создания")}</th>
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
              rows.map((cell) => (
                <tr key={cell.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="py-3 pl-6 pr-4">{cell.barcode}</td>
                  <td className="px-4 py-3">{cell.name}</td>
                  <td className="px-4 py-3">{cell.cellType}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{created(cell)}</td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <div className="flex items-center justify-end gap-3 text-slate-500 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <button type="button" onClick={() => setDialog({ kind: "update", id: cell.id })} title={t("Изменить")} aria-label={t("Изменить")} className="hover:text-[#4f70e7]">
                          <Pencil className="h-5 w-5" />
                        </button>
                        <button type="button" onClick={() => setDialog({ kind: "delete", id: cell.id, name: cell.name })} title={t("Удалить")} aria-label={t("Удалить")} className="hover:text-rose-600">
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(dialog?.kind === "create" || dialog?.kind === "update") && (
        <CellFormDialog
          key={dialog.kind === "update" ? `update-${dialog.id}` : "create"}
          cellId={dialog.kind === "update" ? dialog.id : null}
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
          api={CELLS_API}
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
      </div>
    </DictionaryPage>
  )
}

type Draft = { name: string; barcode: string; cellType: string }

function CellFormDialog({ cellId, onClose, onSaved }: { cellId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const isEdit = cellId !== null
  const [types, setTypes] = useState<CellType[]>([])
  const [draft, setDraft] = useState<Draft | null>(isEdit ? null : { name: "", barcode: "", cellType: "" })
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    fetch(CELL_TYPES_API, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<CellType[]>) : []))
      .then(setTypes)
      .catch(() => undefined)
    if (cellId !== null) {
      fetch(`${CELLS_API}/${cellId}`, { signal: controller.signal, cache: "no-store" })
        .then(async (response) => {
          const body = (await response.json().catch(() => ({}))) as Cell & DictionaryErrorBody
          if (!response.ok) throw new Error(body.error || "Ячейка не найдена")
          setDraft({ name: body.name, barcode: body.barcode, cellType: body.cellTypeId ? String(body.cellTypeId) : "" })
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
        })
    }
    return () => controller.abort()
  }, [cellId])

  const nameError = touched && draft && !draft.name.trim() ? "Обязательное поле" : serverErrors.name

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || saving) return
    setTouched(true)
    if (!draft.name.trim()) return
    setSaving(true)
    setServerErrors({})
    setError("")
    try {
      const response = await fetch(isEdit ? `${CELLS_API}/${cellId}` : CELLS_API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), barcode: draft.barcode.trim(), cellTypeId: draft.cellType ? Number(draft.cellType) : null }),
      })
      const body = (await response.json().catch(() => ({}))) as DictionaryErrorBody
      if (!response.ok) {
        const errors = requestErrors(body, "Не удалось сохранить ячейку")
        setServerErrors(errors.fields)
        setError(errors.general)
        return
      }
      onSaved()
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <DictionaryFormShell title={isEdit ? t("Изменить оборудование") : t("Добавить оборудование")} busy={saving || (!draft && !loadError)} saving={saving} loadError={loadError} error={error} onClose={onClose} onSubmit={save} linkSave bodyMinHeight={226}>
      {draft && (
        <>
          <Field className="-mt-[5px]" label={t("Наименование")} filled={Boolean(draft.name)} error={nameError ? t(nameError) : ""}>
            <input
              aria-label={t("Наименование")}
              value={draft.name}
              maxLength={255}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className={`${dictionaryInputClass} ${nameError ? "border-[#e57373]" : ""}`}
            />
          </Field>
          <Field className="mt-[9px]" label={t("Баркод")} filled={Boolean(draft.barcode)} error={serverErrors.barcode ? t(serverErrors.barcode) : ""}>
            <input aria-label={t("Баркод")} value={draft.barcode} maxLength={255} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} className={dictionaryInputClass} />
          </Field>
          <Field select className="-mb-[5px] mt-[35px]" label={t("Тип ячейки")} filled={Boolean(draft.cellType)} error={serverErrors.cellType ? t(serverErrors.cellType) : ""}>
            <SearchSelect variant="underline" value={draft.cellType} onChange={(value) => setDraft({ ...draft, cellType: value })} options={types.map((type) => ({ value: String(type.id), label: type.name }))} />
          </Field>
        </>
      )}
    </DictionaryFormShell>
  )
}
