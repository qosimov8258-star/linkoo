"use client"

import { X } from "lucide-react"
import { useRef, useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"
import type { RestrictionApplyResult, RestrictionItem, RestrictionMode, RestrictionTab } from "@/lib/product-restrictions-types"

import { RestrictionPicker } from "./product-restrictions-picker"
import { apiErrorText, DemoCheckbox, SET_LIST_HINT, TAB_COPY, useEscapeLayer, type ApiErrorBody } from "./product-restrictions-shared"

// The full-screen dialog of "Ограничение продуктов" (demo UserProductCreateForm):
//   ADD / REMOVE / SET for the employees selected in the list ("Добавить продукты", "Убрать
//   продукты", "Стереть и добавить"), and "Изменение" (the detail's pencil: SET for one employee,
//   prefilled with the current list, items can only be unchecked).
// Items come from the picker; an unchecked row stays but is not sent. "Сохранить" asks
// "Выполнить / Подтверждение запроса / Да" and then POSTs /api/product-restrictions.

type Row = { item: RestrictionItem; included: boolean }

export type RestrictionDialogMode = RestrictionMode | "update"

export function RestrictionDialog({
  tab,
  mode,
  employeeIds,
  initialItems = [],
  onClose,
  onSaved,
}: {
  tab: RestrictionTab
  mode: RestrictionDialogMode
  employeeIds: number[]
  initialItems?: RestrictionItem[]
  onClose: () => void
  onSaved: (result: RestrictionApplyResult) => void
}) {
  const { t } = useLanguage()
  const copy = TAB_COPY[tab]
  const update = mode === "update"
  // Update: the current list, deleted products unchecked (saving drops them).
  const [rows, setRows] = useState<Row[]>(() => initialItems.map((item) => ({ item, included: !item.deleted })))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const busy = useRef(false)

  useEscapeLayer(onClose)

  const included = rows.filter((row) => row.included).map((row) => row.item.id)
  const requestMode: RestrictionMode = update ? "set" : mode
  const title = update ? "Изменение" : copy.titles[mode]

  function askSave() {
    if (!employeeIds.length) return setError(t("Выберите хотя бы одного сотрудника"))
    if (requestMode !== "set" && !included.length) return setError(t(copy.selectOne))
    setError("")
    setConfirmOpen(true)
  }

  async function save() {
    if (busy.current) return
    busy.current = true
    setSaving(true)
    try {
      const response = await fetch("/api/product-restrictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: requestMode, tab, employeeIds, itemIds: included }),
      })
      const body = (await response.json().catch(() => null)) as (RestrictionApplyResult & ApiErrorBody) | null
      if (!response.ok || !body) {
        setConfirmOpen(false)
        setError(apiErrorText(body, "Не удалось сохранить", t))
        return
      }
      setConfirmOpen(false)
      onSaved(body)
    } catch {
      setConfirmOpen(false)
      setError(t("Не удалось сохранить"))
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  function setPicked(items: RestrictionItem[]) {
    // The picker's selection becomes the list: kept rows first (in their order), then the new ones.
    const picked = new Map(items.map((item) => [item.id, item]))
    const kept = rows.filter((row) => picked.has(row.item.id)).map((row) => ({ item: row.item, included: true }))
    const keptIds = new Set(kept.map((row) => row.item.id))
    const added = items.filter((item) => !keptIds.has(item.id)).map((item) => ({ item, included: true }))
    setRows([...kept, ...added])
    setPickerOpen(false)
    setError("")
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t(title)} className="fixed inset-0 z-[100] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-4 pr-3 sm:pl-[30px] sm:pr-[22px]">
        <h2 className="truncate text-[13px] font-bold uppercase">{t(title)}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800">
          <X className="h-6 w-6" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-[31px] sm:px-[30px]">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-semibold">{t(copy.list)}</h3>
          {!update && (
            <button type="button" onClick={() => setPickerOpen(true)} title={t(SET_LIST_HINT)} className="text-[13px] text-[#4f6fe0] hover:underline sm:pr-[16px]">
              {t("добавить из списка")}
            </button>
          )}
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-[3px] border border-[#f44336] bg-[#ffebee] px-4 py-3 text-[#c62828]">
            {error}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="mt-[35px] flex flex-col items-center text-center leading-[18px] text-[#9e9e9e]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/empty-basket.svg" alt="" className="mb-[20px] h-[72px] w-[72px]" />
            <p>{t(copy.nothing)}</p>
            {!update && (
              <button type="button" onClick={() => setPickerOpen(true)} className="mt-1 text-[#0a9bd9] hover:underline">
                {t(copy.addLink)}
              </button>
            )}
          </div>
        ) : (
          <div className="mt-[30px] max-w-[900px]">
            <div className="grid grid-cols-[minmax(0,1fr)_96px] text-[12px] font-bold">
              <span>{t("Наименование")}</span>
              <span>{t("Статус")}</span>
            </div>
            {rows.map((row, index) => (
              <div key={row.item.id} className="grid min-h-[34px] grid-cols-[minmax(0,1fr)_96px] items-center border-b border-dashed border-[#eef0f4]">
                <span className={`break-words pr-3 ${row.included ? "" : "text-[#9e9e9e]"}`}>
                  <b className="mr-[8px]">{index + 1}.</b>
                  {row.item.name}
                  {row.item.deleted && <span className="ml-2 rounded-[3px] bg-[#ffebee] px-[6px] py-[1px] text-[11px] text-[#c62828]">{t("Удален")}</span>}
                </span>
                <span>
                  <DemoCheckbox
                    checked={row.included}
                    disabled={Boolean(row.item.deleted) && requestMode !== "remove"}
                    onChange={(checked) => {
                      setError("")
                      setRows((current) => current.map((other) => (other.item.id === row.item.id ? { ...other, included: checked } : other)))
                    }}
                    label={row.item.name}
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
        <button
          type="button"
          onClick={askSave}
          disabled={saving}
          className="rounded-[3px] px-[16px] py-[8px] text-[13px] font-bold uppercase text-[#0a9bd9] hover:bg-[#ececec] disabled:opacity-50"
        >
          {t(update ? "Изменить" : "Сохранить")}
        </button>
      </footer>

      {confirmOpen && (
        <ConfirmRequest
          clears={requestMode === "set" && included.length === 0}
          saving={saving}
          onClose={() => {
            if (!busy.current) setConfirmOpen(false)
          }}
          onConfirm={save}
        />
      )}

      {pickerOpen && (
        <RestrictionPicker tab={tab} initial={rows.filter((row) => row.included).map((row) => row.item)} onClose={() => setPickerOpen(false)} onSave={setPicked} />
      )}
    </div>,
    document.body,
  )
}

/** "Выполнить / Подтверждение запроса / Да" (a SET with an empty list also says it lifts the restriction). */
function ConfirmRequest({ clears, saving, onClose, onConfirm }: { clears: boolean; saving: boolean; onClose: () => void; onConfirm: () => void }) {
  const { t } = useLanguage()
  useEscapeLayer(onClose)
  return (
    <div className="fixed inset-0 z-[130] flex items-start justify-center bg-black/50 px-4 pt-[20vh]" onClick={onClose}>
      <div role="alertdialog" aria-modal="true" aria-label={t("Выполнить")} className="w-full max-w-[340px] bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-[60px] items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[22px]">
          <h3 className="text-[13px] font-bold uppercase">{t("Выполнить")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-slate-500 hover:text-slate-800">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="min-h-[120px] px-[30px] pt-[20px] text-[13px]">
          <p>{t("Подтверждение запроса")}</p>
          {clears && <p className="mt-3 text-[#c62828]">{t("Список будет очищен, ограничение будет снято")}</p>}
        </div>
        <div className="flex h-[57px] items-center justify-end gap-6 border-t border-[#e8ebf0] px-[30px]">
          <button type="button" onClick={onClose} disabled={saving} className="text-[13px] font-bold uppercase text-[#757575] hover:underline disabled:opacity-50">
            {t("Отмена")}
          </button>
          <button type="button" onClick={onConfirm} disabled={saving} autoFocus className="text-[13px] font-bold uppercase text-[#0a9bd9] hover:underline disabled:opacity-50">
            {t("Да")}
          </button>
        </div>
      </div>
    </div>
  )
}
