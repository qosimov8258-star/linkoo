"use client"

import { Minus, Plus } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { CatalogPageLayout } from "@/components/dashboard/catalog-sidebar"
import { useLanguage } from "@/lib/i18n/language-context"
import { CheckBox, ConfirmDelete, EmptyState, ErrorAlert, HoverActions, LineField, LineSelect, ListToolbar, Modal, SaveButton, grayHead, listRow } from "./catalog-ui"
import { dictionaryListUrl, useClampPage, useDictionaryList, useDictionaryUrlState } from "./dictionaries-shared"
import { RECEIPT_ORDERINGS, RECEIPT_POSITIONS, RECEIPT_TEMPLATES_API, type ReceiptLine, type ReceiptPosition, type ReceiptTemplate, type ReceiptTemplateListResult } from "./receipt-templates-data"

// "Настройка чека" (demo #/receipt-setup/, Settings → Склад). List Категории | Автопечать (green
// dot) with the pencil / trash on row hover, "+ добавить", search, page size and paginator.
// Dialog "Добавить" / "Изменить": Названия, text lines Сверху / Снизу (Текст, Жирный шрифт,
// Расположение; the round button adds / removes a line) and Автопечать.
// URL state: ?search ?ordering ?page ?pageSize ?openCreateDialog=true,
// ?receiptSetupId=<id>&openUpdateDialog=true | openDeleteDialog=true.

const GRID = "grid-cols-[911px_1fr]"
const EMPTY_LINE: ReceiptLine = { name: "", isBold: false, position: "" }

export function ReceiptTemplatesView() {
  const { t } = useLanguage()
  const { state, update, dialog, setDialog } = useDictionaryUrlState("receiptSetupId", RECEIPT_ORDERINGS, 25)
  const { data, loading, error, reload } = useDictionaryList<ReceiptTemplateListResult>(dictionaryListUrl(RECEIPT_TEMPLATES_API, state, false))
  const [search, setSearch] = useState(state.search)
  const searchTimer = useRef(0)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const [notice, setNotice] = useState<SnackbarMessage | null>(null)
  const [deleting, setDeleting] = useState(false)
  const closeNotice = useCallback(() => setNotice(null), [])
  const closeDialog = useCallback(() => setDialog(null), [setDialog])
  useClampPage(data?.count, loading, state, update)

  const rows = data?.results ?? []
  const count = data?.count ?? 0
  const from = (state.page - 1) * state.pageSize + 1
  const to = Math.min(state.page * state.pageSize, count)
  const lastPage = Math.max(1, Math.ceil(count / state.pageSize))
  const sort = (field: string) => update({ ordering: state.ordering === field ? `-${field}` : state.ordering === `-${field}` ? "" : field, page: 1 })
  const target = dialog && dialog.kind !== "create" ? rows.find((row) => row.id === dialog.id) : undefined

  async function remove(id: number) {
    setDeleting(true)
    try {
      const response = await fetch(`${RECEIPT_TEMPLATES_API}/${id}`, { method: "DELETE" })
      if (!response.ok) throw new Error("failed")
      setNotice({ text: "Успешно удалено", tone: "success" })
      reload()
    } catch {
      setNotice({ text: "Удаление невозможно из-за связи с другими данными", tone: "error" })
    } finally {
      setDeleting(false)
      setDialog(null)
    }
  }

  return (
    <CatalogPageLayout>
      <div className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
        <div className="-mb-[3px] mt-[3px]">
          <ListToolbar
            addLabel={t("добавить")}
            onAdd={() => setDialog({ kind: "create" })}
            query={search}
            onQuery={(value) => {
              setSearch(value)
              window.clearTimeout(searchTimer.current)
              searchTimer.current = window.setTimeout(() => update({ search: value.trim(), page: 1 }), 500)
            }}
            searchPos={{ left: 335, top: 17 }}
            pageSize={state.pageSize}
            onPageSize={(size) => update({ pageSize: size, page: 1 })}
            from={from}
            to={to}
            total={count}
            onPrev={state.page > 1 ? () => update({ page: state.page - 1 }) : undefined}
            onNext={state.page < lastPage ? () => update({ page: state.page + 1 }) : undefined}
          />
        </div>
        <div className={`${grayHead} ${GRID}`}>
          <button type="button" onClick={() => sort("name")} className="text-left font-bold">{t("Категории")}</button>
          <button type="button" onClick={() => sort("print_auto_check")} className="pl-[8px] text-left font-bold">{t("Автопечать")}</button>
        </div>
        <div className={loading && data ? "opacity-60" : undefined}>
          {rows.map((row) => (
            <div key={row.id} className={`${listRow} ${GRID}`}>
              <span className="truncate pr-4">{row.name}</span>
              <span className="pl-[8px]"><i className="block h-[10px] w-[10px] rounded-full bg-[#81c784]" /></span>
              <HoverActions onEdit={() => setDialog({ kind: "update", id: row.id })} onDelete={() => setDialog({ kind: "delete", id: row.id, name: row.name })} />
            </div>
          ))}
        </div>
        {!rows.length && (loading && !data ? <p className="py-10 text-center text-slate-400">{t("Загрузка...")}</p> : error ? <p className="py-10 text-center text-red-600">{t(error)}</p> : <EmptyState />)}
      </div>

      {mounted && dialog?.kind === "create" && <ReceiptFormDialog key="create" onClose={closeDialog} onSaved={() => { setDialog(null); setNotice({ text: "Успешно сохранено", tone: "success" }); reload() }} />}
      {mounted && dialog?.kind === "update" && target && <ReceiptFormDialog key={`update-${dialog.id}`} template={target} onClose={closeDialog} onSaved={() => { setDialog(null); setNotice({ text: "Успешно сохранено", tone: "success" }); reload() }} />}
      {mounted && dialog?.kind === "delete" && <ConfirmDelete name={target?.name ?? dialog.name ?? ""} busy={deleting} onConfirm={() => void remove(dialog.id)} onClose={closeDialog} />}
      <CashSnackbar message={notice} onClose={closeNotice} />
    </CatalogPageLayout>
  )
}

function LinesBlock({ title, lines, onChange }: { title: string; lines: ReceiptLine[]; onChange: (lines: ReceiptLine[]) => void }) {
  const { t } = useLanguage()
  const patch = (index: number, change: Partial<ReceiptLine>) => onChange(lines.map((line, at) => (at === index ? { ...line, ...change } : line)))
  return (
    <div className="-mx-[30px] bg-[#f1f5f8] px-[30px] pb-[10px] pt-[20px]">
      <p className="text-[13px]">{title}</p>
      {lines.map((line, index) => {
        const last = index === lines.length - 1
        return (
          <div key={index} className="relative pb-[32px]">
            <button
              type="button"
              onClick={() => onChange(last ? [...lines, { ...EMPTY_LINE }] : lines.filter((_, at) => at !== index))}
              aria-label={last ? t("Добавить") : t("Удалить")}
              className="absolute right-0 top-[-21px] z-10 flex h-[40px] w-[40px] items-center justify-center rounded-[2px] bg-[#4f70e7] text-white shadow hover:brightness-95"
            >
              {last ? <Plus className="h-6 w-6" /> : <Minus className="h-6 w-6" />}
            </button>
            <LineField label={t("Текст")} value={line.name} onChange={(value) => patch(index, { name: value })} />
            <div className="mt-[27px] grid grid-cols-[220px_1fr] items-end">
              <div className="pb-[16px]"><CheckBox checked={line.isBold} onChange={(value) => patch(index, { isBold: value })} label={t("Жирный шрифт")} /></div>
              <LineSelect
                label={t("Расположение")}
                value={RECEIPT_POSITIONS.find((item) => item.id === line.position)?.name ? t(RECEIPT_POSITIONS.find((item) => item.id === line.position)!.name) : ""}
                options={RECEIPT_POSITIONS.map((item) => t(item.name))}
                onChange={(label) => patch(index, { position: (RECEIPT_POSITIONS.find((item) => t(item.name) === label)?.id ?? "") as ReceiptPosition | "" })}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ReceiptFormDialog({ template, onClose, onSaved }: { template?: ReceiptTemplate; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(template?.name ?? "")
  const [auto, setAuto] = useState(template?.printAutoCheck ?? false)
  const [headers, setHeaders] = useState<ReceiptLine[]>(template?.headers.length ? template.headers : [{ ...EMPTY_LINE }])
  const [footers, setFooters] = useState<ReceiptLine[]>(template?.footers.length ? template.footers : [{ ...EMPTY_LINE }])
  const [saving, setSaving] = useState(false)
  const [alert, setAlert] = useState("")

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const response = await fetch(template ? `${RECEIPT_TEMPLATES_API}/${template.id}` : RECEIPT_TEMPLATES_API, {
        method: template ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, printAutoCheck: auto, headers, footers }),
      })
      if (response.ok) return onSaved()
      const body = (await response.json().catch(() => ({}))) as { error?: string; fields?: Record<string, string> }
      setAlert(body.fields && Object.keys(body.fields).length ? Object.entries(body.fields).map(([field, message]) => `${field}: ${t(message)}`).join("\n") : t(body.error || "Не удалось сохранить"))
    } catch {
      setAlert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal
        title={template ? t("Изменить") : t("Добавить")}
        onClose={onClose}
        bodyClassName="max-h-[calc(100vh-200px)] overflow-y-auto px-[30px] pb-0 pt-[18px]"
        footer={<SaveButton disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
      >
        <LineField label={t("Названия")} value={name} onChange={setName} />
        <div className="mt-[21px]">
          <LinesBlock title={t("Сверху")} lines={headers} onChange={setHeaders} />
          <div className="h-[15px]" />
          <LinesBlock title={t("Снизу")} lines={footers} onChange={setFooters} />
        </div>
        <div className="pb-[29px] pt-[15px]"><CheckBox checked={auto} onChange={setAuto} label={t("Автопечать")} /></div>
      </Modal>
      {alert && <ErrorAlert message={alert} onClose={() => setAlert("")} />}
    </>
  )
}
