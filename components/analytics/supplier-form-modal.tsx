"use client"

import { useCallback, useEffect, useState } from "react"

import { LineField, LineSelect, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { useLanguage } from "@/lib/i18n/language-context"

import type { Supplier } from "./suppliers-data"

// «Добавление поставщика» / «Изменение поставщика» (Linko's ProviderCreateForm, a 400 px dialog), shared by the
// «Поставщики» page and every quick-add of a supplier (Приход от поставщиков …), so a supplier made anywhere has the same
// fields and goes through /api/suppliers:
// - Название *, Категория * (a select; the green ⊕ opens «Добавить тип поставщика» of Категории поставщиков in a new tab,
//   as Linko's link does, and the list is read again when the select opens), Местоположение *, Филиал, Организация;
// - «Контактные данные» on grey: per contact the red − (removes it), Контактное лицо *, Email, Телефон номер *, and the
//   blue «Добавить» for one more;
// - «Сохранить». An empty contact is left out; a started one needs its name and phone.
// Linko also draws a stray «Название» field and an empty dashed box under the contacts (left over from another form,
// saved nowhere); they are not repeated here.

type DraftContact = { key: number; id?: number; name: string; email: string; phone: string }
type Draft = { name: string; category: string; address: string; branch: string; organization: string }

const namesOf = (data: unknown): string[] =>
  Array.isArray(data) ? [...new Set(data.map((item) => (item && typeof item.name === "string" ? item.name.trim() : "")).filter(Boolean))] : []

const ADD_CIRCLE_OUTLINE = "M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7zm-1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
const isSet = (value: string) => value.trim() !== "" && value.trim() !== "Не указано"

export function SupplierFormModal({ supplier = null, onClose, onSaved }: { supplier?: Supplier | null; onClose: () => void; onSaved: (supplier: Supplier) => void }) {
  const { t } = useLanguage()
  const isEdit = supplier !== null
  const [draft, setDraft] = useState<Draft>(() => ({
    name: supplier?.name ?? "",
    category: supplier?.category ?? "",
    address: supplier?.address ?? "",
    branch: supplier && isSet(supplier.branch) ? supplier.branch : "",
    organization: supplier && isSet(supplier.organization) ? supplier.organization : "",
  }))
  const [contacts, setContacts] = useState<DraftContact[]>(() =>
    supplier?.contacts.length ? supplier.contacts.map((contact, index) => ({ key: index + 1, ...contact })) : isEdit ? [] : [{ key: 1, name: "", email: "", phone: "" }],
  )
  const [categories, setCategories] = useState<string[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [organizations, setOrganizations] = useState<string[]>([])
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))

  const loadCategories = useCallback(async () => {
    const response = await fetch("/api/supplier-categories", { cache: "no-store" }).catch(() => null)
    if (response?.ok) setCategories(namesOf(await response.json().catch(() => [])))
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadCategories()
    Promise.all([fetch("/api/branches").catch(() => null), fetch("/api/organizations").catch(() => null)]).then(async ([branchesRes, organizationsRes]) => {
      if (cancelled) return
      if (branchesRes?.ok) setBranches(namesOf(await branchesRes.json().catch(() => [])))
      if (organizationsRes?.ok) setOrganizations(namesOf(await organizationsRes.json().catch(() => [])))
    })
    return () => {
      cancelled = true
    }
  }, [loadCategories])

  const updateContact = (key: number, patch: Partial<DraftContact>) => setContacts((current) => current.map((contact) => (contact.key === key ? { ...contact, ...patch } : contact)))
  const started = (contact: DraftContact) => Boolean(contact.name.trim() || contact.email.trim() || contact.phone.trim())
  const required = (value: string) => touched && !value.trim()

  async function save() {
    setTouched(true)
    const filled = contacts.filter(started)
    if (!draft.name.trim() || !draft.category || !draft.address.trim() || filled.some((contact) => !contact.name.trim() || !contact.phone.trim())) return
    setSaving(true)
    setError("")
    try {
      const response = await fetch(isEdit ? `/api/suppliers/${supplier.id}` : "/api/suppliers", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          category: draft.category,
          address: draft.address.trim(),
          branch: draft.branch || "Не указано",
          organization: draft.organization || "Не указано",
          contacts: filled.map((contact) => ({ id: contact.id, name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone.trim() })),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ? t(data.error) : t("Не удалось сохранить поставщика"))
        return
      }
      onSaved((await response.json()) as Supplier)
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (show: boolean) => (show ? <p className="mt-[2px] text-[12px] text-[#f44336]">{t("Обязательное поле")}</p> : null)

  return (
    <Modal
      title={isEdit ? t("Изменение поставщика") : t("Добавление поставщика")}
      onClose={onClose}
      width={400}
      bodyClassName="max-h-[75vh] overflow-y-auto px-[30px] pt-[10px]"
      footer={
        <SaveButton disabled={saving} onClick={() => void save()}>
          {t("Сохранить")}
        </SaveButton>
      }
    >
      {/* Linko's field pitch: Категория 60.5 px under Название, Местоположение 58.5, Филиал 85, Организация 62. */}
      <div className="flex flex-col">
        <div>
          <LineField label={t("Название")} required value={draft.name} onChange={(name) => set({ name })} />
          {fieldError(required(draft.name))}
        </div>
        <div className="mt-[20.5px]">
          <div className="flex items-end gap-[5px]" onMouseDownCapture={() => void loadCategories()}>
            <div className="min-w-0 flex-1">
              <LineSelect label={t("Категория")} required value={draft.category} options={categories} onChange={(category) => set({ category })} onClear={() => set({ category: "" })} />
            </div>
            <a href="/analytics/supplier-categories?openCreateDialog=true" target="_blank" rel="noreferrer" title={t("Добавить категорию поставщика")} aria-label={t("Добавить категорию поставщика")} className="mb-[16px] flex h-6 w-6 items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#92ce95]" aria-hidden>
                <path d={ADD_CIRCLE_OUTLINE} />
              </svg>
            </a>
          </div>
          {fieldError(touched && !draft.category)}
        </div>
        <div className="mt-[18.5px]">
          <LineField label={t("Местоположение")} required value={draft.address} onChange={(address) => set({ address })} />
          {fieldError(required(draft.address))}
        </div>
        <div className="mt-[27px]">
          <LineSelect label={t("Филиал")} value={draft.branch} options={branches} onChange={(branch) => set({ branch })} onClear={() => set({ branch: "" })} />
        </div>
        <div className="mt-[22px]">
          <LineSelect label={t("Организация")} value={draft.organization} options={organizations} onChange={(organization) => set({ organization })} onClear={() => set({ organization: "" })} />
        </div>
      </div>

      <div className="-mx-[30px] mt-[13px] bg-[#f1f5f8] px-[30px] pb-[60px] pt-[20px] text-[#333]">
        {t("Контактные данные")}
        <div className="flex flex-col">
          {contacts.map((contact) => (
            <div key={contact.key} className="relative mb-[15px] pb-[27px] last:mb-0">
              <button
                type="button"
                aria-label={t("Убрать контакт")}
                onClick={() => setContacts((current) => current.filter((item) => item.key !== contact.key))}
                className="absolute -top-[19px] right-0 z-[1] flex h-10 w-10 items-center justify-center rounded-[2px] bg-[#e57373] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden>
                  <path d="M19 13H5v-2h14v2z" />
                </svg>
              </button>
              <LineField label={t("Контактное лицо")} required value={contact.name} onChange={(name) => updateContact(contact.key, { name })} />
              {fieldError(touched && started(contact) && !contact.name.trim())}
              <div className="mt-[12px] flex gap-[10px]">
                <div className="min-w-0 flex-1">
                  <LineField label="Email" value={contact.email} onChange={(email) => updateContact(contact.key, { email })} />
                </div>
                <div className="min-w-0 flex-1">
                  <LineField label={t("Телефон номер")} required value={contact.phone} onChange={(phone) => updateContact(contact.key, { phone })} />
                  {fieldError(touched && started(contact) && !contact.phone.trim())}
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setContacts((current) => [...current, { key: Math.max(0, ...current.map((item) => item.key)) + 1, name: "", email: "", phone: "" }])}
          className="mt-[20px] h-[35px] w-full rounded-[2px] bg-[#1E4A9A] text-[13px] text-white hover:brightness-110"
        >
          {t("Добавить")}
        </button>
        {error && <p className="mt-[10px] rounded-[2px] bg-[#ffebee] px-[15px] py-[10px] text-center text-[13px] text-[#f44336]">{error}</p>}
      </div>
    </Modal>
  )
}
