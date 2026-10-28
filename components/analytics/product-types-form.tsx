"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"

import { SearchSelect, useJsonList, type PickOption } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { DictionaryFormShell, Field, dictionaryInputClass, ImageField, Toggle, requestErrors, useOrganizationOptions } from "./dictionaries-shared"
import type { DictionaryErrorBody } from "./dictionaries-data"
import { PRODUCT_TYPES_API, type ProductType, type ProductTypeDetail, type ProductTypePayload } from "./product-types-data"

// "Добавить тип продукта" / "Изменить тип продукта" (demo module 4349, form
// ProductTypeCreateForm): Родительская категория (top-level types; a type with children
// stays on top), Наименование категории ★, Организация ★ (once organizations exist),
// Порядок, the picture drop zone and "Показывать в боте" / "Показывать в телеграм боте".

const REQUIRED = "Обязательное поле"

type Draft = { parentId: string; name: string; organization: string; position: string; showInBot: boolean; image: string | null | undefined }
type FieldName = "parent" | "name" | "organization" | "position" | "image"

const EMPTY: Draft = { parentId: "", name: "", organization: "", position: "", showInBot: false, image: undefined }

export function ProductTypeFormDialog({ typeId, onClose, onSaved }: { typeId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const isEdit = typeId !== null
  const [stored, setStored] = useState<ProductTypeDetail | null>(null)
  const [draft, setDraft] = useState<Draft | null>(isEdit ? null : EMPTY)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [error, setError] = useState("")
  const types = useJsonList<ProductType>(PRODUCT_TYPES_API)
  const organizations = useOrganizationOptions(stored?.organization ?? "")

  useEffect(() => {
    if (typeId === null) return
    const controller = new AbortController()
    fetch(`${PRODUCT_TYPES_API}/${typeId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as ProductTypeDetail & DictionaryErrorBody
        if (!response.ok) throw new Error(body.error || "Тип продукта не найден")
        setStored(body)
        setDraft({
          parentId: body.parentId === null ? "" : String(body.parentId),
          name: body.name,
          organization: body.organization,
          position: String(body.position ?? 0),
          showInBot: body.showInBot,
          image: undefined,
        })
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [typeId])

  const parentOptions = useMemo<PickOption[]>(() => {
    const list = types.items.filter((type) => type.parentId === null && type.id !== typeId).map((type) => ({ value: String(type.id), label: type.name }))
    if (stored?.parentId && !list.some((option) => option.value === String(stored.parentId))) list.unshift({ value: String(stored.parentId), label: stored.parentName })
    return list
  }, [types.items, typeId, stored])

  function validate(value: Draft): Partial<Record<FieldName, string>> {
    const errors: Partial<Record<FieldName, string>> = {}
    if (!value.name.trim()) errors.name = REQUIRED
    if (organizations.required && !value.organization && !(isEdit && stored && !stored.organization)) errors.organization = REQUIRED
    if (value.position.trim() && !/^-?\d+$/.test(value.position.trim())) errors.position = "Введите целое число"
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
    const payload: ProductTypePayload = {
      name: draft.name.trim(),
      organization: draft.organization,
      parentId: draft.parentId ? Number(draft.parentId) : null,
      showInBot: draft.showInBot,
      position: draft.position.trim() ? Number(draft.position.trim()) : 0,
      ...(draft.image === undefined ? {} : { image: draft.image }),
    }
    setSaving(true)
    setServerErrors({})
    setError("")
    try {
      const response = await fetch(isEdit ? `${PRODUCT_TYPES_API}/${typeId}` : PRODUCT_TYPES_API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as DictionaryErrorBody
      if (!response.ok) {
        const errors = requestErrors(body, "Не удалось сохранить тип продукта")
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
  const hasChildren = (stored?.childCount ?? 0) > 0

  return (
    <DictionaryFormShell bodyMinHeight={541}
      title={isEdit ? t("Изменить тип продукта") : t("Добавить тип продукта")}
      busy={saving || (!draft && !loadError)}
      saving={saving}
      loadError={loadError}
      error={error}
      onClose={onClose}
      onSubmit={save}
    >
      {draft && (
        <>
          <Field select label={t("Родительская категория")} filled={Boolean(draft.parentId)} error={fieldError("parent")}>
            <SearchSelect
              variant="underline"
              value={draft.parentId}
              onChange={(value) => change({ parentId: value }, "parent")}
              options={parentOptions}
              disabled={hasChildren}
              loading={types.loading}
              invalid={Boolean(fieldError("parent"))}
            />
            {hasChildren && <span className="text-[12px] text-[#9aa3b6]">{t("Тип с подкатегориями не может быть подкатегорией")}</span>}
          </Field>
          <Field label={t("Наименование категории")} filled={Boolean(draft.name)} required error={fieldError("name")}>
            <input
              autoFocus
              aria-label={t("Наименование категории")}
              value={draft.name}
              maxLength={255}
              onChange={(event) => change({ name: event.target.value }, "name")}
              className={`${dictionaryInputClass} ${fieldError("name") ? "border-[#e57373]" : ""}`}
            />
          </Field>
          <Field select className="mt-[34px]" label={t("Организация")} filled={Boolean(draft.organization)} required={organizations.required} error={fieldError("organization")}>
            <SearchSelect
              variant="underline"
              value={draft.organization}
              onChange={(value) => change({ organization: value }, "organization")}
              options={organizations.options}
              loading={organizations.loading}
              invalid={Boolean(fieldError("organization"))}
            />
          </Field>
          <Field label={t("Порядок")} filled={Boolean(draft.position)} error={fieldError("position")}>
            <input
              aria-label={t("Порядок")}
              inputMode="numeric"
              value={draft.position}
              onChange={(event) => change({ position: event.target.value }, "position")}
              className={`${dictionaryInputClass} ${fieldError("position") ? "border-[#e57373]" : ""}`}
            />
          </Field>
          <ImageField className="mt-[11px]" value={stored?.imageUrl ?? null} pending={draft.image} onChange={(image) => change({ image }, "image")} error={fieldError("image")} />
          <div className="mt-[3px]"><Toggle title={t("Показывать в боте")} subTitle={t("Показывать в телеграм боте")} checked={draft.showInBot} onChange={(showInBot) => setDraft((current) => (current ? { ...current, showInBot } : current))} /></div>
        </>
      )}
    </DictionaryFormShell>
  )
}
