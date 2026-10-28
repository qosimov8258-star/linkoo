"use client"

import { useEffect, useMemo, useState } from "react"

import { grayHead, LineField, listRow, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { DateLineField, RadioRow, RowPencil, SettingsPager, SettingsSearch, SettingsToolbar } from "@/components/settings/settings-list-ui"
import { useLanguage } from "@/lib/i18n/language-context"
import { refDate } from "@/lib/ref-date"

type Closing = { id: number; className: string; name: string; isAuto: boolean; date: string | null; days: number }

// Reference grid: Наименование 3 | Тип 3 | Дата 3 | Дни 2 of 12 parts.
const COLS = "grid-cols-[3fr_3fr_3fr_2fr_1fr]"

export function PeriodClosingsView() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<Closing[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editing, setEditing] = useState<Closing | null>(null)
  const [draft, setDraft] = useState({ isAuto: true, date: "", days: "" })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/period-closings", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Closing[]) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => !needle || t(row.name).toLowerCase().includes(needle))
  }, [rows, query, t])
  const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, lastPage)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)

  const dirty = editing ? draft.isAuto !== editing.isAuto || (draft.isAuto ? Number(draft.days) !== editing.days : draft.date !== (editing.date ?? "")) : false
  const valid = draft.isAuto ? draft.days !== "" && Number(draft.days) >= 0 : draft.date !== ""

  function openEdit(row: Closing) {
    setDraft({ isAuto: row.isAuto, date: row.date ?? "", days: String(row.days) })
    setError("")
    setEditing(row)
  }

  async function save() {
    if (!editing || !valid || saving) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/period-closings/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft.isAuto ? { isAuto: true, days: Number(draft.days) } : { isAuto: false, date: draft.date }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error || "Не удалось сохранить архив")
        return
      }
      const saved = (await response.json()) as Closing
      setRows((list) => list.map((row) => (row.id === saved.id ? saved : row)))
      setEditing(null)
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-[calc(100vh-50px)] min-w-0 flex-1 overflow-x-clip bg-white">
      <SettingsToolbar
        className="-mr-[14px] h-[50px] pl-[15px] pt-[4px]"
        search={<SettingsSearch value={query} onChange={(value) => { setQuery(value); setPage(1) }} />}
        pager={<SettingsPager page={current} pageSize={pageSize} count={filtered.length} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} />}
      />
      <div className={`${grayHead} ${COLS} pr-[30px] pt-[2px]`}>
        <span>{t("Наименование")}</span>
        <span className="pl-[8px]">{t("Тип")}</span>
        <span className="pl-[8px]">{t("Дата")}</span>
        <span className="pl-[8px]">{t("Дни")}</span>
      </div>
      {visible.map((row) => (
        <div key={row.id} className={`${listRow} ${COLS} pr-[30px] pt-[4px] last:border-b-0`}>
          <span data-no-translate>{row.name}</span>
          <span className="pl-[8px]">{row.isAuto ? t("Авто по дням") : t("По дате")}</span>
          <span className="pl-[8px]">{row.date ? refDate(row.date) : "-"}</span>
          <span className="pl-[8px]">{row.isAuto ? row.days : "-"}</span>
          <RowPencil onClick={() => openEdit(row)} label={t("Изменить")} />
        </div>
      ))}

      {editing && (
        <Modal title={t("Изменить архив")} onClose={() => setEditing(null)} footer={<SaveButton disabled={!dirty || !valid || saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}>
          <div className="min-h-[260px]">
            <div className="ml-[2px] mt-[19px] grid grid-cols-2">
              <RadioRow checked={!draft.isAuto} onChange={() => setDraft((value) => ({ ...value, isAuto: false }))} label={t("По дате")} />
              <RadioRow checked={draft.isAuto} onChange={() => setDraft((value) => ({ ...value, isAuto: true }))} label={t("Авто по дням")} />
            </div>
            <div className="mt-[8px]">
              {draft.isAuto ? (
                <LineField label={t("Дни")} value={draft.days} onChange={(value) => setDraft((state) => ({ ...state, days: value.replace(/\D/g, "").slice(0, 4) }))} />
              ) : (
                <DateLineField label={t("Дата")} value={draft.date} onChange={(value) => setDraft((state) => ({ ...state, date: value }))} />
              )}
            </div>
            {error && <p className="mt-3 text-[13px] text-red-500">{t(error)}</p>}
          </div>
        </Modal>
      )}
    </main>
  )
}
