"use client"

import { useEffect, useMemo, useState, type FormEvent } from "react"

import { SearchSelect, inputClass, useJsonList, type PickOption } from "@/components/analytics/cash-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import { DictionaryFormShell, Field, requestErrors } from "./dictionaries-shared"
import type { DictionaryErrorBody } from "./dictionaries-data"
import { UNITS_OF_MEASURE_API, type UnitOfMeasure, type UnitOfMeasureDetail, type UnitOfMeasurePayload } from "./units-of-measure-data"

// "Добавить измерение" / "Изменить измерение" (demo module 4355, form
// MeasurementCreateForm): Родительская категория (top-level units, demo params {parent: 0}),
// Наименование ★ and the "Развесной товар" checkbox (demo is_weighted).

const REQUIRED = "Обязательное поле"

type Draft = { parentId: string; name: string; isWeighted: boolean }
type FieldName = "parent" | "name"

export function UnitFormDialog({ unitId, onClose, onSaved }: { unitId: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const isEdit = unitId !== null
  const [stored, setStored] = useState<UnitOfMeasureDetail | null>(null)
  const [draft, setDraft] = useState<Draft | null>(isEdit ? null : { parentId: "", name: "", isWeighted: false })
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [error, setError] = useState("")
  const units = useJsonList<UnitOfMeasure>(UNITS_OF_MEASURE_API)

  useEffect(() => {
    if (unitId === null) return
    const controller = new AbortController()
    fetch(`${UNITS_OF_MEASURE_API}/${unitId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as UnitOfMeasureDetail & DictionaryErrorBody
        if (!response.ok) throw new Error(body.error || "Единица измерения не найдена")
        setStored(body)
        setDraft({ parentId: body.parentId === null ? "" : String(body.parentId), name: body.name, isWeighted: body.isWeighted })
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [unitId])

  const parentOptions = useMemo<PickOption[]>(() => {
    const list = units.items.filter((unit) => unit.parentId === null && unit.id !== unitId).map((unit) => ({ value: String(unit.id), label: unit.name }))
    if (stored?.parentId && !list.some((option) => option.value === String(stored.parentId))) list.unshift({ value: String(stored.parentId), label: stored.parentName })
    return list
  }, [units.items, unitId, stored])

  function change(patch: Partial<Draft>, field: FieldName | null) {
    setDraft((current) => (current ? { ...current, ...patch } : current))
    if (field) setServerErrors((current) => ({ ...current, [field]: undefined }))
    setError("")
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || saving) return
    setTouched(true)
    if (!draft.name.trim()) return
    const payload: UnitOfMeasurePayload = { name: draft.name.trim(), parentId: draft.parentId ? Number(draft.parentId) : null, isWeighted: draft.isWeighted }
    setSaving(true)
    setServerErrors({})
    setError("")
    try {
      const response = await fetch(isEdit ? `${UNITS_OF_MEASURE_API}/${unitId}` : UNITS_OF_MEASURE_API, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as DictionaryErrorBody
      if (!response.ok) {
        const errors = requestErrors(body, "Не удалось сохранить единицу измерения")
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

  const fieldError = (field: FieldName) => {
    const message = (field === "name" && touched && draft && !draft.name.trim() ? REQUIRED : "") || serverErrors[field]
    return message ? t(message) : ""
  }
  const hasChildren = (stored?.childCount ?? 0) > 0

  return (
    <DictionaryFormShell
      title={isEdit ? t("Изменить измерение") : t("Добавить измерение")}
      busy={saving || (!draft && !loadError)}
      saving={saving}
      loadError={loadError}
      error={error}
      onClose={onClose}
      onSubmit={save}
    >
      {draft && (
        <>
          <Field label={t("Родительская категория")} error={fieldError("parent")}>
            <SearchSelect
              value={draft.parentId}
              onChange={(value) => change({ parentId: value }, "parent")}
              options={parentOptions}
              placeholder={t("Не указано")}
              disabled={hasChildren}
              loading={units.loading}
              invalid={Boolean(fieldError("parent"))}
            />
            {hasChildren && <span className="text-[12px] text-[#9aa3b6]">{t("Единица с дочерними единицами не может быть дочерней")}</span>}
          </Field>
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
          <label className="flex cursor-pointer items-center gap-3 pt-1 text-[14px] text-[#333]">
            <input type="checkbox" checked={draft.isWeighted} onChange={(event) => change({ isWeighted: event.target.checked }, null)} className="h-[18px] w-[18px] accent-[#4f70e7]" />
            {t("Развесной товар")}
          </label>
        </>
      )}
    </DictionaryFormShell>
  )
}
