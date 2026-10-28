"use client"

import { Pencil, Trash2 } from "lucide-react"
import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react"

import { CashSnackbar, SearchSelect, useCanWrite, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { formatStatementDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { CELL_TYPES_API, type CellType, type CellTypeNode, type CellTypeTreeResult } from "./cells-data"
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
  useDictionaryList,
  useDictionaryUrlState,
} from "./dictionaries-shared"

// "Тип ячейки" (demo #/cell-type, Settings → Тип ячейки; API stock/cell_type/hierarchy/).
// Settings side menu + "+ добавить тип ячеек", search and a tree grid Категории | Дата создания
// (a type with children is followed by them, indented) with hover ✎ / 🗑. The dialog keeps the demo
// titles "Добавить / Изменить тип продукта" with Родительская категория + Наименование категории.
// URL state: ?search ?openCreateDialog=true, ?cellType=<id>&openUpdateDialog=true | openDeleteDialog=true.

const COLUMNS = 3
const REQUIRED = "Обязательное поле"

export function CellTypesView({ embedded = false }: { embedded?: boolean }) {
  if (embedded) return <CellTypesGrid />
  return (
    <CatalogPageLayout>
      <CellTypesGrid />
    </CatalogPageLayout>
  )
}

function flatten(nodes: CellTypeNode[], level = 0): { node: CellTypeNode; level: number }[] {
  return nodes.flatMap((node) => [{ node, level }, ...flatten(node.children, level + 1)])
}

function CellTypesGrid() {
  const { t, language } = useLanguage()
  const { state, update, dialog, setDialog } = useDictionaryUrlState("cellType", [], 25)
  const { data, loading, error, reload } = useDictionaryList<CellTypeTreeResult>(dictionaryListUrl(CELL_TYPES_API, { ...state, page: 1 }, true))
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const canEdit = useCanWrite()
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [setDialog])

  const rows = data?.results ?? []
  const created = (node: CellType) => (node.createdAt && language !== "ru" ? formatStatementDate(node.createdAt, language, false).replace(/\s*г\.$/, "") : node.createdDate)

  function renderNode(node: CellTypeNode, level: number) {
    const group = level === 0 && node.children.length > 0
    return (
      <Fragment key={node.id}>
        <tr className={`group border-b border-dashed border-slate-300 hover:bg-slate-50 ${group ? "bg-[#f8f9fb]" : ""}`}>
          <td className="py-3 pr-4" style={{ paddingLeft: 24 + level * 30 }}>
            <span className={group ? "font-semibold" : level === 0 ? "font-medium" : ""}>{node.name}</span>
          </td>
          <td className="whitespace-nowrap px-4 py-3">{created(node)}</td>
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
    <DictionaryPage>
      <DictionaryToolbar addLabel={canEdit ? t("добавить тип ячеек") : null} onAdd={() => setDialog({ kind: "create" })} state={state} update={update} count={rows.length} hidePagination />
      <div className="px-[30px]">

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-[14px]">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="w-[45%] px-4 py-4 pl-6 font-semibold">{t("Категории")}</th>
              <th className="px-4 py-4 font-semibold">{t("Дата создания")}</th>
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
        <CellTypeFormDialog
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
          api={CELL_TYPES_API}
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

function CellTypeFormDialog({ typeId, onClose, onSaved }: { typeId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const isEdit = typeId !== null
  const [all, setAll] = useState<CellTypeNode[] | null>(null)
  const [draft, setDraft] = useState<{ parent: string; name: string } | null>(null)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${CELL_TYPES_API}?view=tree`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as CellTypeTreeResult & DictionaryErrorBody
        if (!response.ok) throw new Error(body.error || "Тип ячейки не найден")
        const flat = flatten(body.results).map((item) => item.node)
        const current = typeId === null ? null : flat.find((node) => node.id === typeId)
        if (typeId !== null && !current) throw new Error("Тип ячейки не найден")
        setAll(body.results)
        setDraft({ parent: current?.parentId ? String(current.parentId) : "", name: current?.name ?? "" })
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [typeId])

  // A type cannot become its own (or its descendant's) child.
  const options = useMemo(() => {
    const skip = new Set<number>()
    const collect = (node: CellTypeNode) => {
      skip.add(node.id)
      node.children.forEach(collect)
    }
    const own = typeId === null ? undefined : flatten(all ?? []).find((item) => item.node.id === typeId)?.node
    if (own) collect(own)
    return flatten(all ?? [])
      .filter((item) => !skip.has(item.node.id))
      .map((item) => ({ value: String(item.node.id), label: `${"— ".repeat(item.level)}${item.node.name}` }))
  }, [all, typeId])

  const nameError = touched && draft && !draft.name.trim() ? REQUIRED : serverErrors.name
  const parentError = serverErrors.parent

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || saving) return
    setTouched(true)
    if (!draft.name.trim()) return
    setSaving(true)
    setServerErrors({})
    setError("")
    try {
      const response = await fetch(isEdit ? `${CELL_TYPES_API}/${typeId}` : CELL_TYPES_API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), parentId: draft.parent ? Number(draft.parent) : null }),
      })
      const body = (await response.json().catch(() => ({}))) as DictionaryErrorBody
      if (!response.ok) {
        const errors = requestErrors(body, "Не удалось сохранить тип ячейки")
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
    <DictionaryFormShell title={isEdit ? t("Изменить тип продукта") : t("Добавить тип продукта")} busy={saving || (!draft && !loadError)} saving={saving} loadError={loadError} error={error} onClose={onClose} onSubmit={save} linkSave bodyMinHeight={154}>
      {draft && (
        <>
          <Field select label={t("Родительская категория")} filled={Boolean(draft.parent)} error={parentError ? t(parentError) : ""}>
            <SearchSelect variant="underline" value={draft.parent} onChange={(value) => setDraft({ ...draft, parent: value })} options={options} />
          </Field>
          <Field label={t("Наименование категории")} filled={Boolean(draft.name)} error={nameError ? t(nameError) : ""}>
            <input
              aria-label={t("Наименование категории")}
              value={draft.name}
              maxLength={255}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className={`${dictionaryInputClass} ${nameError ? "border-[#e57373]" : ""}`}
            />
          </Field>
        </>
      )}
    </DictionaryFormShell>
  )
}
