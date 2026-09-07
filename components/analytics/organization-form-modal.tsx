"use client"

import { X } from "lucide-react"
import { FormEvent, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import type { Organization } from "./organization-data"

type Draft = { name: string; limitByDebt: boolean }

function draftFromOrganization(organization: Organization | null): Draft {
  if (!organization) return { name: "", limitByDebt: false }
  return { name: organization.name, limitByDebt: organization.limitByDebt }
}

// Shared by the dedicated "Организации" page and every "+добавить" shortcut
// elsewhere (Возврат поставщика, Приход от поставщика, ...) so an
// organization created from any entry point has the exact same fields and
// hits the same /api/organizations endpoint.
export function OrganizationFormModal({
  organization = null,
  onClose,
  onSaved,
}: {
  organization?: Organization | null
  onClose: () => void
  onSaved: (organization: Organization) => void
}) {
  const { t } = useLanguage()
  const isEdit = organization !== null
  const [draft, setDraft] = useState<Draft>(() => draftFromOrganization(organization))
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function save(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    const name = draft.name.trim()
    if (!name) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(isEdit ? `/api/organizations/${organization.id}` : "/api/organizations", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, limitByDebt: draft.limitByDebt }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || t("Не удалось сохранить организацию"))
        return
      }
      const saved = (await response.json()) as Organization
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
          <b className="uppercase">{isEdit ? t("Изменить организацию") : t("Добавить организацию")}</b>
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
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.limitByDebt} onChange={(event) => setDraft((value) => ({ ...value, limitByDebt: event.target.checked }))} className="h-4 w-4 accent-[#4f70e7]" />
            {t("Ограничить по долгу клиента")}
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
