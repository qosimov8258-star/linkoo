"use client"

import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import { CheckBox, LineField, Modal, SaveLink } from "./catalog-ui"
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

  async function save() {
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
    <Modal
      title={isEdit ? t("Изменить организацию") : t("Добавить организацию")}
      onClose={onClose}
      bodyClassName="min-h-[300px] pl-[30px] pr-[52px] pt-[18px]"
      footer={<SaveLink disabled={busy || !draft.name.trim()} onClick={() => void save()}>{saving ? t("Сохранение...") : t("Сохранить")}</SaveLink>}
    >
      <LineField
        autoFocus
        label={t("Наименование")}
        required
        value={draft.name}
        onChange={(name) => {
          setDraft((value) => ({ ...value, name }))
          setNameError("")
        }}
      />
      {shownNameError && <p className="mt-1 text-[12px] text-rose-500">{t(shownNameError)}</p>}
      <div className="mt-[20px]">
        <CheckBox checked={draft.limitByDebt} onChange={(limitByDebt) => setDraft((value) => ({ ...value, limitByDebt }))} label={t("Ограничить по долгу клиента")} />
      </div>
      {error && <p className="mt-4 text-sm font-medium text-rose-600">{t(error)}</p>}
    </Modal>
  )
}
