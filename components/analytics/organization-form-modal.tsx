"use client"

import { Loader2, X } from "lucide-react"
import { FormEvent, useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import { ORGANIZATIONS_API, type Organization, type OrganizationDetail, type OrganizationErrorBody } from "./organization-data"

// "Добавить организацию" / "Изменить организацию" (demo module 4407, form
// DivisionCreateForm): Наименование ★ + "Ограничить по долгу клиента", "Сохранить".
// Shared by the "Организация" page and every "+добавить" shortcut elsewhere
// (Возврат поставщику, Приход от поставщика, …) so an organization created from any
// entry point has the same fields and goes through the same /api/organizations
// validation (unique name; a rename is carried over to the documents).

type Draft = { name: string; limitByDebt: boolean }

function draftFromOrganization(organization: Organization | null): Draft {
  if (!organization) return { name: "", limitByDebt: false }
  return { name: organization.name, limitByDebt: organization.limitByDebt }
}

/** Inline `name` error and general error of a failed organization request. */
export function organizationRequestErrors(body: OrganizationErrorBody, fallback: string): { name: string; general: string } {
  const name = body.fields?.name ?? body.details?.fieldErrors?.name?.[0] ?? ""
  return { name, general: name ? "" : body.error || fallback }
}

export function OrganizationFormModal({
  organization = null,
  organizationId = null,
  onClose,
  onSaved,
}: {
  /** Prefill of the edit mode (no request). */
  organization?: Organization | null
  /** Edit mode that first loads GET /api/organizations/[id] (demo update dialog). */
  organizationId?: number | null
  onClose: () => void
  onSaved: (organization: Organization) => void
}) {
  const { t } = useLanguage()
  const editId = organization?.id ?? organizationId
  const isEdit = editId !== null && editId !== undefined
  const [draft, setDraft] = useState<Draft>(() => draftFromOrganization(organization))
  const [detailLoading, setDetailLoading] = useState(!organization && Boolean(organizationId))
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (organization || !organizationId) return
    const controller = new AbortController()
    fetch(`${ORGANIZATIONS_API}/${organizationId}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as OrganizationDetail & OrganizationErrorBody
        if (!response.ok) throw new Error(data.error || "Организация не найдена")
        setDraft(draftFromOrganization(data))
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false)
      })
    return () => controller.abort()
  }, [organization, organizationId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function save(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    const name = draft.name.trim()
    if (!name || saving || detailLoading) return
    setSaving(true)
    setNameError("")
    setError("")
    try {
      const response = await fetch(isEdit ? `${ORGANIZATIONS_API}/${editId}` : ORGANIZATIONS_API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, limitByDebt: draft.limitByDebt }),
      })
      const data = (await response.json().catch(() => ({}))) as Organization & OrganizationErrorBody
      if (!response.ok) {
        const errors = organizationRequestErrors(data, "Не удалось сохранить организацию")
        setNameError(errors.name)
        setError(errors.general)
        return
      }
      onSaved(data)
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  const requiredError = touched && !draft.name.trim() ? "Обязательное поле" : ""
  const shownNameError = requiredError || nameError
  const busy = saving || detailLoading

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" onMouseDown={onClose}>
      <form
        onSubmit={save}
        onMouseDown={(event) => event.stopPropagation()}
        className="relative w-full max-w-[500px] rounded bg-white shadow-2xl"
        aria-busy={busy}
      >
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-3">
          <b className="text-[14px] uppercase text-[#333]">{isEdit ? t("Изменить организацию") : t("Добавить организацию")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="rounded-full p-2 text-[#666] hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="relative min-h-[300px] space-y-6 px-[30px] pb-6 pt-5">
          {busy && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
              <Loader2 className="h-8 w-8 animate-spin text-[#4f70e7]" />
            </div>
          )}
          <label className="block">
            <span className="text-[13px] text-[#999]">
              {t("Наименование")} <span className="text-red-500">*</span>
            </span>
            <input
              autoFocus
              value={draft.name}
              maxLength={255}
              onChange={(event) => {
                setDraft((value) => ({ ...value, name: event.target.value }))
                setNameError("")
              }}
              className={`mt-1 block w-full border-b py-1.5 text-[15px] text-[#333] outline-none ${
                shownNameError ? "border-rose-500" : "border-[#e0e0e0] focus:border-[#4f70e7]"
              }`}
            />
            {shownNameError && <p className="mt-1 text-[12px] text-rose-500">{t(shownNameError)}</p>}
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-[14px] text-[#333]">
            <input
              type="checkbox"
              checked={draft.limitByDebt}
              onChange={(event) => setDraft((value) => ({ ...value, limitByDebt: event.target.checked }))}
              className="h-[18px] w-[18px] accent-[#4f70e7]"
            />
            {t("Ограничить по долгу клиента")}
          </label>
          {error && <p className="text-sm font-medium text-rose-600">{t(error)}</p>}
        </div>
        <footer className="flex justify-end border-t border-[#efefef] p-4">
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60"
          >
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </footer>
      </form>
    </div>
  )
}
