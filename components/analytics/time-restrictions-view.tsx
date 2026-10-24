"use client"

import { useEffect, useMemo, useState } from "react"

import { grayHead, LineField, LineSelect, listRow, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { RadioRow, RowPencil, SettingsPager, SettingsSearch, SettingsToolbar } from "@/components/settings/settings-list-ui"
import { useLanguage } from "@/lib/i18n/language-context"

type Status = "1" | "2" | "3" | "4"
type TimeRestriction = { id: number; name: string; status: Status; from: string | null; to: string | null; isAll: boolean }

const STATUS_LABELS: Record<Status, string> = {
  "1": "Работает полный день",
  "2": "Не работает в течении дня",
  "3": "Работает в данные часы",
  "4": "Не работает в данные часы",
}
const STATUSES = Object.keys(STATUS_LABELS) as Status[]

function maskTime(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits
}

export function TimeRestrictionsView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState<TimeRestriction[]>([])
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [editing, setEditing] = useState<TimeRestriction | null>(null)
  const [draft, setDraft] = useState<{ status: Status | ""; from: string; to: string; isAll: boolean }>({ status: "1", from: "", to: "", isAll: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    fetch("/api/order-time-restrictions", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: TimeRestriction[]) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => !needle || t(row.name).toLowerCase().includes(needle) || t(STATUS_LABELS[row.status]).toLowerCase().includes(needle))
  }, [rows, query, t])
  const lastPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, lastPage)
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize)
  const hours = draft.status === "3" || draft.status === "4"
  const valid = draft.status !== "" && (!hours || (draft.from.length === 5 && draft.to.length === 5))

  function openEdit(row: TimeRestriction) {
    setDraft({ status: row.status, from: row.from ?? "", to: row.to ?? "", isAll: row.isAll })
    setError("")
    setEditing(row)
  }

  async function save() {
    if (!editing || !valid || saving) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/order-time-restrictions/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: draft.status, from: hours ? draft.from : null, to: hours ? draft.to : null, isAll: draft.isAll }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error || "Не удалось сохранить ограничение")
        return
      }
      const saved = (await response.json()) as TimeRestriction
      setRows((list) => list.map((row) => (row.id === saved.id ? saved : row)))
      setEditing(null)
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function timeText(row: TimeRestriction) {
    const label = t(STATUS_LABELS[row.status])
    return (row.status === "3" || row.status === "4") && row.from && row.to ? `${label} ${row.from} - ${row.to}` : label
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      <SettingsToolbar
        search={<SettingsSearch value={query} onChange={(value) => { setQuery(value); setPage(1) }} />}
        pager={<SettingsPager page={current} pageSize={pageSize} count={filtered.length} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} />}
      />
      <div className={`${grayHead} grid-cols-[41.3%_1fr]`}>
        <span>{t("Наименование")}</span>
        <span>{t("Время работы")}</span>
      </div>
      {visible.map((row) => (
        <div key={row.id} className={`${listRow} grid-cols-[41.3%_1fr] last:border-b-0`}>
          <span>{t(row.name)}</span>
          <span>{timeText(row)}</span>
          <RowPencil onClick={() => openEdit(row)} label={t("Изменить")} />
        </div>
      ))}

      {editing && (
        <Modal title={t("Время работы")} onClose={() => setEditing(null)} footer={<SaveButton disabled={!valid || saving} onClick={() => void save()}>{t("Применить")}</SaveButton>}>
          <LineSelect
            tall
            label={t("Тип")}
            value={draft.status ? t(STATUS_LABELS[draft.status]) : ""}
            options={STATUSES.map((status) => t(STATUS_LABELS[status]))}
            onChange={(label) => setDraft((value) => ({ ...value, status: STATUSES.find((status) => t(STATUS_LABELS[status]) === label) ?? value.status }))}
            onClear={() => setDraft((value) => ({ ...value, status: "" }))}
          />
          <div className="mt-[14px] grid h-[40px] grid-cols-2 gap-[18px]">
            {hours && (
              <>
                <LineField label={t("Начало")} value={draft.from} onChange={(value) => setDraft((state) => ({ ...state, from: maskTime(value) }))} />
                <LineField label={t("Конец")} value={draft.to} onChange={(value) => setDraft((state) => ({ ...state, to: maskTime(value) }))} />
              </>
            )}
          </div>
          <div className="ml-[2px] mt-[11px] flex flex-col gap-[14px]">
            <RadioRow checked={draft.isAll} onChange={() => setDraft((value) => ({ ...value, isAll: true }))} label={t("Действует для всех")} />
            <RadioRow checked={!draft.isAll} onChange={() => setDraft((value) => ({ ...value, isAll: false }))} label={t("Действует только для выбранных агентов")} />
          </div>
          {error && <p className="mt-3 text-[13px] text-red-500">{t(error)}</p>}
        </Modal>
      )}
    </main>
  )
}
