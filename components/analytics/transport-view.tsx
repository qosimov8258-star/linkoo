"use client"

import { useCallback, useEffect, useState } from "react"

import { LineField, LineSelect, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import {
  AddLink,
  ConfirmDeleteDialog,
  EmptyRows,
  RowActions,
  SettingsToolbar,
  kitHead,
  kitRow,
  useListControls,
  usePaged,
} from "@/components/analytics/settings-list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

// "Транспорт" (demo #/transport/, Settings → Персонал; API main/transport/): № | Модель | Номер |
// Водитель | Объем (л) | Грузоподъёмность (кг) | Филиал, newest first, ✎ / 🗑 on row hover.
// Dialog: Модель, Номер, Водитель, Объем (л), Грузоподъёмность (кг) (all required) and the Филиал select.

type Vehicle = {
  id: number
  model: string
  number: string
  driver: string
  capacity: number
  loadLimit: number
  branch: { id: number; name: string } | null
}
type Branch = { id: number; name: string }

const COLUMNS = "139fr 203fr 101fr 202fr 203fr 202fr 225fr"

const amount = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 9 }).format(value).replace(/[  ]/g, " ")

/** "2000" → "2 000" while typing; keeps one decimal separator. */
function maskAmount(raw: string) {
  const [int, frac] = raw.replace(/[^\d.,]/g, "").replace(",", ".").split(".")
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

const unmask = (masked: string) => masked.replace(/\s/g, "")

function VehicleDialog({ vehicle, branches, onClose, onSaved }: { vehicle: Vehicle | null; branches: Branch[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState({
    model: vehicle?.model ?? "",
    number: vehicle?.number ?? "",
    driver: vehicle?.driver ?? "",
    capacity: vehicle ? maskAmount(String(vehicle.capacity)) : "",
    loadLimit: vehicle ? maskAmount(String(vehicle.loadLimit)) : "",
    branchId: vehicle?.branch?.id ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const invalid = !draft.model.trim() || !draft.number.trim() || !draft.driver.trim() || !draft.capacity || !draft.loadLimit
  const branchName = branches.find((branch) => branch.id === draft.branchId)?.name ?? ""

  async function save() {
    setTouched(true)
    if (saving || invalid) return
    setSaving(true)
    try {
      const response = await fetch(vehicle ? `/api/transport/${vehicle.id}` : "/api/transport", {
        method: vehicle ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, capacity: unmask(draft.capacity), loadLimit: unmask(draft.loadLimit) }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(data.error || "Не удалось сохранить транспорт"))
        return
      }
      onSaved()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  const gap = "mt-[32px]"
  const error = (value: string) => (touched && !value.trim() ? "[&>div]:border-[#e57373]" : "")
  return (
    <Modal
      title={vehicle ? t("Изменить транспорт") : t("Добавить транспорт")}
      titleClassName="text-[14px]"
      headerClassName="pl-[12px]"
      width={400}
      onClose={onClose}
      bodyClassName="max-h-[70vh] overflow-y-auto px-[30px] pb-[29px] pt-[43px]"
      footer={<SaveButton disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
    >
      <div className={error(draft.model)}><LineField label={t("Модель")} value={draft.model} onChange={(model) => setDraft({ ...draft, model })} /></div>
      <div className={`${gap} ${error(draft.number)}`}><LineField label={t("Номер")} value={draft.number} onChange={(number) => setDraft({ ...draft, number })} /></div>
      <div className={`${gap} ${error(draft.driver)}`}><LineField label={t("Водитель")} value={draft.driver} onChange={(driver) => setDraft({ ...draft, driver })} /></div>
      <div className={`${gap} ${error(draft.capacity)}`}><LineField label={t("Объем (л)")} value={draft.capacity} onChange={(value) => setDraft({ ...draft, capacity: maskAmount(value) })} /></div>
      <div className={`${gap} ${error(draft.loadLimit)}`}><LineField label={t("Грузоподъёмность (кг)")} value={draft.loadLimit} onChange={(value) => setDraft({ ...draft, loadLimit: maskAmount(value) })} /></div>
      <div className="mt-[27px]">
        <LineSelect
          label={t("Филиал")}
          value={branchName}
          options={branches.map((branch) => branch.name)}
          onChange={(name) => setDraft({ ...draft, branchId: branches.find((branch) => branch.name === name)?.id ?? null })}
          onClear={() => setDraft({ ...draft, branchId: null })}
        />
      </div>
    </Modal>
  )
}

export function TransportView() {
  const { t } = useLanguage()
  const [items, setItems] = useState<Vehicle[] | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [dialog, setDialog] = useState<{ vehicle: Vehicle | null } | null>(null)
  const [deleting, setDeleting] = useState<Vehicle | null>(null)
  const controls = useListControls()

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/transport", { cache: "no-store" })
      if (!response.ok) throw new Error("load")
      setItems((await response.json()) as Vehicle[])
    } catch {
      setItems([])
    }
  }, [])
  useEffect(() => {
    void load()
    fetch("/api/branches", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<Branch[]>) : []))
      .then((list) => setBranches(list.map(({ id, name }) => ({ id, name }))))
      .catch(() => {})
  }, [load])

  const needle = controls.query.trim().toLowerCase()
  const filtered = (items ?? []).filter((item) => [item.model, item.number, item.driver, item.branch?.name ?? ""].some((value) => value.toLowerCase().includes(needle)))
  const paged = usePaged(filtered, controls.page, controls.pageSize)

  async function remove(item: Vehicle) {
    const response = await fetch(`/api/transport/${item.id}`, { method: "DELETE" })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      notify(t(data.error || "Не удалось удалить транспорт"))
      return
    }
    setDeleting(null)
    await load()
  }

  return (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <SettingsToolbar
        left={<AddLink onClick={() => setDialog({ vehicle: null })}>{t("добавить транспорт")}</AddLink>}
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
        <span className="pl-[30px]">№</span>
        <span>{t("Модель")}</span>
        <span>{t("Номер")}</span>
        <span>{t("Водитель")}</span>
        <span>{t("Объем (л)")}</span>
        <span>{t("Грузоподъёмность (кг)")}</span>
        <span>{t("Филиал")}</span>
      </div>
      {paged.rows.map((item) => (
        <div key={item.id} className={kitRow} style={{ gridTemplateColumns: COLUMNS }}>
          <span className="pl-[30px]">{item.id}</span>
          <span className="pr-2">{item.model}</span>
          <span className="pr-2">{item.number}</span>
          <span className="pr-2">{item.driver}</span>
          <span>{amount(item.capacity)}</span>
          <span>{amount(item.loadLimit)}</span>
          <span className="w-[120px] text-center">{item.branch?.name}</span>
          <RowActions right={56} gap={17} onEdit={() => setDialog({ vehicle: item })} onDelete={() => setDeleting(item)} />
        </div>
      ))}
      {items && paged.rows.length === 0 && <EmptyRows />}

      {dialog && (
        <VehicleDialog
          key={dialog.vehicle?.id ?? "new"}
          vehicle={dialog.vehicle}
          branches={branches}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load() }}
        />
      )}
      {deleting && <ConfirmDeleteDialog onConfirm={() => void remove(deleting)} onClose={() => setDeleting(null)} />}
    </section>
  )
}
