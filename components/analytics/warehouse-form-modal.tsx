"use client"

import { FormEvent, useEffect, useState } from "react"

import { CheckBox, LineField, LineSelect, Modal, SaveLink } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"
import type { Warehouse } from "./warehouses-data"

type Draft = { name: string; address: string; branch: string; manager: string; online: boolean }

function draftFromWarehouse(warehouse: Warehouse | null): Draft {
  if (!warehouse) return { name: "", address: "", branch: "", manager: "", online: true }
  return { name: warehouse.name, address: warehouse.address, branch: warehouse.branch, manager: warehouse.manager, online: warehouse.online }
}

// Shared by the dedicated "Склады" page and every "+добавить" shortcut
// elsewhere (Возврат поставщика, Приход от поставщика, ...) so a warehouse
// created from any entry point has the exact same fields and hits the same
// /api/warehouses endpoint.
export function WarehouseFormModal({
  warehouse = null,
  onClose,
  onSaved,
}: {
  warehouse?: Warehouse | null
  onClose: () => void
  onSaved: (warehouse: Warehouse) => void
}) {
  const { t } = useLanguage()
  const isEdit = warehouse !== null
  const [draft, setDraft] = useState<Draft>(() => draftFromWarehouse(warehouse))
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  const [managerOptions, setManagerOptions] = useState<string[]>([])
  const [fullName, setFullName] = useState("")
  const [warehouseType, setWarehouseType] = useState("")
  const [comment, setComment] = useState("")
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      const [branchesRes, employeesRes] = await Promise.all([
        fetch("/api/branches").catch(() => null),
        fetch("/api/employees").catch(() => null),
      ])
      if (cancelled) return
      if (branchesRes?.ok) setBranchOptions(((await branchesRes.json()) as { name: string }[]).map((item) => item.name))
      if (employeesRes?.ok) setManagerOptions(((await employeesRes.json()) as { name: string }[]).map((item) => item.name))
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!draft.name.trim() || !draft.address.trim()) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(isEdit ? `/api/warehouses/${warehouse.id}` : "/api/warehouses", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          address: draft.address.trim(),
          branch: draft.branch,
          manager: draft.manager,
          online: draft.online,
          active: true,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || t("Не удалось сохранить склад"))
        return
      }
      const saved = (await response.json()) as Warehouse
      onSaved(saved)
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={isEdit ? t("Изменить склад") : t("Добавить склад")}
      onClose={onClose}
      footer={<SaveLink disabled={saving} onClick={() => void save({ preventDefault() {} } as FormEvent)}>{saving ? t("Сохранение...") : t("Сохранить")}</SaveLink>}
    >
      <LineField label={t("Наименование")} required autoFocus value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} />
      {touched && !draft.name.trim() && <p className="mt-1 text-[12px] text-rose-500">{t("Обязательное поле")}</p>}
      <div className="mt-[10px]"><LineField label={t("Полное наименование")} value={fullName} onChange={setFullName} /></div>
      <div className="mt-[10px]"><LineField label={t("Адрес")} required value={draft.address} onChange={(value) => setDraft((current) => ({ ...current, address: value }))} /></div>
      {touched && !draft.address.trim() && <p className="mt-1 text-[12px] text-rose-500">{t("Обязательное поле")}</p>}
      <div className="mt-[10px]"><LineSelect label={t("Филиал")} required value={draft.branch} onChange={(value) => setDraft((current) => ({ ...current, branch: value }))} options={branchOptions} /></div>
      <div className="mt-[10px]"><LineSelect label={t("Завсклад")} required value={draft.manager} onChange={(value) => setDraft((current) => ({ ...current, manager: value }))} options={managerOptions} /></div>
      <div className="mt-[10px]"><LineSelect label={t("Тип склада")} required value={warehouseType} onChange={setWarehouseType} options={[t("Основной"), t("Транзитный"), t("Вансел")]} /></div>
      <div className="mt-[10px]"><LineField label={t("Комментарий...")} value={comment} onChange={setComment} /></div>
      <div className="mt-[16px]"><CheckBox checked={draft.online} onChange={(value) => setDraft((current) => ({ ...current, online: value }))} label={t("Вэнсел подключен")} /></div>
      {error && <p className="mt-3 text-[13px] font-medium text-rose-600">{error}</p>}
    </Modal>
  )
}
