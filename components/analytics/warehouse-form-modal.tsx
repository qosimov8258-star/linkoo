"use client"

import { X } from "lucide-react"
import { FormEvent, useEffect, useState } from "react"

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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
        <header className="flex items-center justify-between border-b p-6">
          <b className="uppercase">{isEdit ? t("Изменить склад") : t("Добавить склад")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-5 p-8">
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Наименование")} <span className="text-red-500">*</span>
            <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
            {touched && !draft.name.trim() && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
          </label>
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Адрес")} <span className="text-red-500">*</span>
            <input value={draft.address} onChange={(event) => setDraft((value) => ({ ...value, address: event.target.value }))} className="mt-2 block w-full outline-none" />
            {touched && !draft.address.trim() && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
          </label>
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Филиал")}
            <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
              <option value="">{t("Выберите...")}</option>
              {branchOptions.map((branch) => <option key={branch}>{branch}</option>)}
            </select>
          </label>
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Зав. склад")}
            <select value={draft.manager} onChange={(event) => setDraft((value) => ({ ...value, manager: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
              <option value="">{t("Выберите...")}</option>
              {managerOptions.map((manager) => <option key={manager}>{manager}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={draft.online} onChange={(event) => setDraft((value) => ({ ...value, online: event.target.checked }))} className="h-5 w-5" />
            {t("Вэнсел подключен")}
          </label>
          {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
        </div>
        <footer className="flex justify-end border-t p-5">
          <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </footer>
      </form>
    </div>
  )
}
