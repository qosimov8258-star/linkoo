"use client"

import { useEffect, useState, type FormEvent } from "react"

import { SearchSelect, inputClass } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { DictionaryFormShell, Field, ImageField, requestErrors, useOrganizationOptions } from "./dictionaries-shared"
import type { DictionaryErrorBody } from "./dictionaries-data"
import { BRANDS_API, type BrandDetail, type BrandPayload } from "./brands-data"

// "Добавить бренд" / "Изменить бренд" (demo module 4354, form BrandCreateForm):
// Наименование ★, Организация ★ (once organizations exist) and the picture drop zone.

const REQUIRED = "Обязательное поле"

type Draft = { name: string; organization: string; image: string | null | undefined }
type FieldName = "name" | "organization" | "image"

export function BrandFormDialog({ brandId, onClose, onSaved }: { brandId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const isEdit = brandId !== null
  const [stored, setStored] = useState<BrandDetail | null>(null)
  const [draft, setDraft] = useState<Draft | null>(isEdit ? null : { name: "", organization: "", image: undefined })
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [error, setError] = useState("")
  const organizations = useOrganizationOptions(stored?.organization ?? "")

  useEffect(() => {
    if (brandId === null) return
    const controller = new AbortController()
    fetch(`${BRANDS_API}/${brandId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as BrandDetail & DictionaryErrorBody
        if (!response.ok) throw new Error(body.error || "Бренд не найден")
        setStored(body)
        setDraft({ name: body.name, organization: body.organization, image: undefined })
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [brandId])

  function validate(value: Draft): Partial<Record<FieldName, string>> {
    const errors: Partial<Record<FieldName, string>> = {}
    if (!value.name.trim()) errors.name = REQUIRED
    if (organizations.required && !value.organization) errors.organization = REQUIRED
    return errors
  }

  function change(patch: Partial<Draft>, field: FieldName) {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    setServerErrors((current) => ({ ...current, [field]: undefined }))
    setError("")
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || saving) return
    setTouched(true)
    if (Object.keys(validate(draft)).length) return
    const payload: BrandPayload = { name: draft.name.trim(), organization: draft.organization, ...(draft.image === undefined ? {} : { image: draft.image }) }
    setSaving(true)
    setServerErrors({})
    setError("")
    try {
      const response = await fetch(isEdit ? `${BRANDS_API}/${brandId}` : BRANDS_API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as DictionaryErrorBody
      if (!response.ok) {
        const errors = requestErrors(body, "Не удалось сохранить бренд")
        setServerErrors(errors.fields)
        setError(errors.general)
        return
      }
      onSaved()
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  const clientErrors = touched && draft ? validate(draft) : {}
  const fieldError = (field: FieldName) => {
    const message = clientErrors[field] || serverErrors[field]
    return message ? t(message) : ""
  }

  return (
    <DictionaryFormShell
      title={isEdit ? t("Изменить бренд") : t("Добавить бренд")}
      busy={saving || (!draft && !loadError)}
      saving={saving}
      loadError={loadError}
      error={error}
      onClose={onClose}
      onSubmit={save}
    >
      {draft && (
        <>
          <Field label={t("Наименование")} required error={fieldError("name")}>
            <input
              autoFocus
              aria-label={t("Наименование")}
              value={draft.name}
              maxLength={255}
              onChange={(event) => change({ name: event.target.value }, "name")}
              className={`${inputClass} ${fieldError("name") ? "border-[#e57373]" : ""}`}
            />
          </Field>
          <Field label={t("Организация")} required={organizations.required} error={fieldError("organization")}>
            <SearchSelect
              value={draft.organization}
              onChange={(value) => change({ organization: value }, "organization")}
              options={organizations.options}
              placeholder={t("Не указано")}
              loading={organizations.loading}
              invalid={Boolean(fieldError("organization"))}
            />
          </Field>
          <ImageField value={stored?.photoUrl ?? null} pending={draft.image} onChange={(image) => change({ image }, "image")} error={fieldError("image")} />
        </>
      )}
    </DictionaryFormShell>
  )
}
