"use client"

import { useCallback, useEffect, useState } from "react"

import { LineField, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import {
  AddLink,
  ConfirmDeleteDialog,
  EmptyRows,
  RowActions,
  SettingsToolbar,
  SortHead,
  kitHead,
  kitRow,
  sortRows,
  toggleOrdering,
  useListControls,
  usePaged,
} from "@/components/analytics/settings-list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// "Должности" (demo #/post, Settings → Персонал; API main/jobs/): Id | Наименование | Дата создания,
// newest first, Id and Дата создания sortable (multi-key like the demo's ?ordering=id,created_date),
// ✎ / 🗑 appear on row hover. Dialog = one required field "Наименование".

type Position = { id: number; name: string; date: string; createdAt: string }

const COLUMNS = "240.5fr 607.5fr 427fr"

function PositionDialog({ position, onClose, onSaved }: { position: Position | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [name, setName] = useState(position?.name ?? "")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving) return
    // The reference keeps "Сохранить" enabled and answers an empty name with the API field error.
    if (!name.trim()) {
      notify(`name: ${t("Это поле обязательно к заполнению")}`)
      return
    }
    setSaving(true)
    try {
      const response = await fetch(position ? `/api/job-positions/${position.id}` : "/api/job-positions", {
        method: position ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(data.error || "Не удалось сохранить должность"))
        return
      }
      onSaved()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={position ? t("Изменить должность") : t("Добавить должность")}
      titleClassName="text-[15px]"
      closeInset="pr-[10px]"
      onClose={onClose}
      bodyClassName="px-[30px] pb-[42px] pt-[18px]"
      footer={<SaveButton disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
    >
      <LineField label={t("Наименование")} required value={name} onChange={setName} />
    </Modal>
  )
}

export function PositionsView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [positions, setPositions] = useState<Position[] | null>(null)
  const [dialog, setDialog] = useState<{ position: Position | null } | null>(null)
  const [deleting, setDeleting] = useState<Position | null>(null)
  const [ordering, setOrdering] = useState<string[]>([])
  const controls = useListControls()

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/job-positions", { cache: "no-store" })
      if (!response.ok) throw new Error("load")
      setPositions((await response.json()) as Position[])
    } catch {
      setPositions([])
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const needle = controls.query.trim().toLowerCase()
  const filtered = sortRows((positions ?? []).filter((position) => position.name.toLowerCase().includes(needle)), ordering, {
    id: (position) => position.id,
    created_date: (position) => position.createdAt,
  })
  const paged = usePaged(filtered, controls.page, controls.pageSize)

  async function remove(position: Position) {
    const response = await fetch(`/api/job-positions/${position.id}`, { method: "DELETE" })
    if (!response.ok) {
      // 409 while other records use it: the usage list says where.
      const data = (await response.json().catch(() => ({}))) as { error?: string; usage?: { label: string; count: number }[] }
      const usage = data.usage?.map((item) => `${item.label}: ${item.count}`).join(", ")
      notify(`${t(data.error || "Не удалось удалить должность")}${usage ? ` (${usage})` : ""}`)
      return
    }
    setDeleting(null)
    await load()
  }

  const body = (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <SettingsToolbar
        left={<AddLink onClick={() => setDialog({ position: null })}>{t("добавить должность")}</AddLink>}
        query={controls.query}
        onQuery={controls.setQuery}
        pager={{
          pageSize: controls.pageSize,
          onPageSize: controls.setPageSize,
          from: paged.from,
          to: paged.to,
          total: paged.total,
          onPrev: paged.page > 1 ? () => controls.setPage(paged.page - 1) : undefined,
          onNext: paged.page < paged.pageCount ? () => controls.setPage(paged.page + 1) : undefined,
        }}
      />
      <div className={kitHead} style={{ gridTemplateColumns: COLUMNS }}>
        <span className="pl-[30px]"><SortHead className="!font-semibold" label="Id" field="id" ordering={ordering} onSort={(field) => setOrdering(toggleOrdering(ordering, field))} /></span>
        <span>{t("Наименование")}</span>
        <SortHead className="!font-semibold" label={t("Дата создания")} field="created_date" ordering={ordering} onSort={(field) => setOrdering(toggleOrdering(ordering, field))} />
      </div>
      {paged.rows.map((position) => (
        <div key={position.id} className={kitRow} style={{ gridTemplateColumns: COLUMNS }}>
          <span className="pl-[30px]">{position.id}</span>
          <span className="pr-4">{position.name}</span>
          <span>{position.date}</span>
          <RowActions onEdit={() => setDialog({ position })} onDelete={() => setDeleting(position)} />
        </div>
      ))}
      {positions && paged.rows.length === 0 && <EmptyRows />}

      {dialog && (
        <PositionDialog
          key={dialog.position?.id ?? "new"}
          position={dialog.position}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load() }}
        />
      )}
      {deleting && <ConfirmDeleteDialog name={deleting.name} onConfirm={() => void remove(deleting)} onClose={() => setDeleting(null)} />}
    </section>
  )
  return embedded ? body : <main className="min-h-[calc(100vh-4rem)] bg-white">{body}</main>
}
