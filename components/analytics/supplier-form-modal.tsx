"use client"

import { Minus, PlusCircle, X } from "lucide-react"
import { FormEvent, useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import type { Supplier } from "./suppliers-data"

type DraftContact = { id: number; name: string; email: string; phone: string }

type Draft = { name: string; category: string; address: string; branch: string; organization: string }

function draftFromSupplier(supplier: Supplier | null): Draft {
  if (!supplier) return { name: "", category: "", address: "", branch: "", organization: "" }
  return { name: supplier.name, category: supplier.category, address: supplier.address, branch: supplier.branch, organization: supplier.organization }
}

function contactsFromSupplier(supplier: Supplier | null): DraftContact[] {
  if (!supplier || supplier.contacts.length === 0) return [{ id: 1, name: "", email: "", phone: "" }]
  return supplier.contacts.map((contact) => ({ ...contact }))
}

// Shared by the dedicated "Поставщики" page and every "+добавить" shortcut
// elsewhere (Возврат поставщика, Приход от поставщика, ...) so a supplier
// created from any entry point has the exact same fields and hits the same
// /api/suppliers endpoint.
export function SupplierFormModal({
  supplier = null,
  onClose,
  onSaved,
}: {
  supplier?: Supplier | null
  onClose: () => void
  onSaved: (supplier: Supplier) => void
}) {
  const { t } = useLanguage()
  const isEdit = supplier !== null
  const [draft, setDraft] = useState<Draft>(() => draftFromSupplier(supplier))
  const [contacts, setContacts] = useState<DraftContact[]>(() => contactsFromSupplier(supplier))
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  const [organizationOptions, setOrganizationOptions] = useState<string[]>([])
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      const [categoriesRes, branchesRes, organizationsRes] = await Promise.all([
        fetch("/api/supplier-categories").catch(() => null),
        fetch("/api/branches").catch(() => null),
        fetch("/api/organizations").catch(() => null),
      ])
      if (cancelled) return
      if (categoriesRes?.ok) setCategoryOptions(((await categoriesRes.json()) as { name: string }[]).map((item) => item.name))
      if (branchesRes?.ok) setBranchOptions(((await branchesRes.json()) as { name: string }[]).map((item) => item.name))
      if (organizationsRes?.ok) setOrganizationOptions(((await organizationsRes.json()) as { name: string }[]).map((item) => item.name))
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  function addContact() {
    setContacts((current) => [...current, { id: Math.max(0, ...current.map((contact) => contact.id)) + 1, name: "", email: "", phone: "" }])
  }

  function removeContact(id: number) {
    setContacts((current) => (current.length > 1 ? current.filter((contact) => contact.id !== id) : current))
  }

  function updateContact(id: number, patch: Partial<DraftContact>) {
    setContacts((current) => current.map((contact) => (contact.id === id ? { ...contact, ...patch } : contact)))
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault()
    const trimmed = newCategoryName.trim()
    if (!trimmed) return
    try {
      await fetch("/api/supplier-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
    } catch {
      // Category creation is best-effort here; the form still uses it locally.
    }
    setCategoryOptions((current) => (current.includes(trimmed) ? current : [...current, trimmed]))
    setDraft((current) => ({ ...current, category: trimmed }))
    setNewCategoryName("")
    setCategoryModalOpen(false)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!draft.name.trim() || !draft.category || !draft.address.trim()) return
    const payloadContacts = contacts.filter((contact) => contact.name.trim() || contact.phone.trim()).map((contact) => ({ ...contact }))
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
          contacts: payloadContacts,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || t("Не удалось сохранить поставщика"))
        return
      }
      const saved = (await response.json()) as Supplier
      onSaved(saved)
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-lg flex-col rounded bg-white">
        <header className="flex items-center justify-between border-b p-6">
          <b className="uppercase">{isEdit ? t("Изменить поставщика") : t("Добавление поставщика")}</b>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-8">
          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Название")} <span className="text-red-500">*</span>
            <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
            {touched && !draft.name.trim() && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
          </label>

          <div className="flex items-end gap-3">
            <label className="block flex-1 border-b border-slate-200 pb-2 font-medium">
              {t("Категория")} <span className="text-red-500">*</span>
              <select value={draft.category} onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                <option value="">{t("Выберите...")}</option>
                {categoryOptions.map((item) => <option key={item}>{item}</option>)}
              </select>
              {touched && !draft.category && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
            </label>
            <button type="button" onClick={() => setCategoryModalOpen(true)} aria-label={t("Добавить категорию")} className="mb-2 text-emerald-500 hover:text-emerald-600">
              <PlusCircle className="h-6 w-6" />
            </button>
          </div>

          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Местоположение")} <span className="text-red-500">*</span>
            <input value={draft.address} onChange={(event) => setDraft((value) => ({ ...value, address: event.target.value }))} className="mt-2 block w-full outline-none" />
            {touched && !draft.address.trim() && <p className="mt-1 text-sm text-rose-500">{t("Обязательное поле")}</p>}
          </label>

          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Филиал")}
            <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
              <option value="">{t("Выберите...")}</option>
              {branchOptions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>

          <label className="block border-b border-slate-200 pb-2 font-medium">
            {t("Организация")}
            <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
              <option value="">{t("Выберите...")}</option>
              {organizationOptions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>

          <div className="rounded bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-medium text-slate-500">{t("Контактные данные")}</p>
              {contacts.length > 1 && (
                <button type="button" onClick={() => removeContact(contacts[contacts.length - 1].id)} aria-label={t("Убрать контакт")} className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-400 text-white hover:bg-rose-500">
                  <Minus className="h-4 w-4" />
                </button>
              )}
            </div>
            {contacts.map((contact) => (
              <div key={contact.id} className="mb-4 space-y-3 border-b border-slate-200 pb-4 last:mb-0 last:border-b-0 last:pb-0">
                <label className="block border-b border-slate-200 pb-2 text-sm font-medium">
                  {t("Контактное лицо")} <span className="text-red-500">*</span>
                  <input value={contact.name} onChange={(event) => updateContact(contact.id, { name: event.target.value })} className="mt-2 block w-full bg-transparent outline-none" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block border-b border-slate-200 pb-2 text-sm font-medium">
                    Email
                    <input value={contact.email} onChange={(event) => updateContact(contact.id, { email: event.target.value })} className="mt-2 block w-full bg-transparent outline-none" />
                  </label>
                  <label className="block border-b border-slate-200 pb-2 text-sm font-medium">
                    {t("Телефон номер")} <span className="text-red-500">*</span>
                    <input value={contact.phone} onChange={(event) => updateContact(contact.id, { phone: event.target.value })} className="mt-2 block w-full bg-transparent outline-none" />
                  </label>
                </div>
              </div>
            ))}
            <button type="button" onClick={addContact} className="mt-3 text-sm text-[#4f71dc] hover:underline">
              + {t("добавить контакт")}
            </button>
          </div>

          {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
        </div>

        <footer className="flex justify-end border-t p-5">
          <button type="submit" disabled={saving} className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
            {saving ? t("Сохранение...") : t("Сохранить")}
          </button>
        </footer>
      </form>

      {categoryModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={saveCategory} className="w-full max-w-sm rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">{t("Добавить категорию")}</b>
              <button type="button" onClick={() => setCategoryModalOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <label className="block border-b border-slate-200 pb-2 text-sm font-medium">
              {t("Наименование категории")} <span className="text-red-500">*</span>
              <input autoFocus value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} className="mt-2 block w-full outline-none" />
            </label>
            <div className="mt-5 flex justify-end">
              <button type="submit" className="rounded bg-[#71ce87] px-5 py-2.5 font-semibold text-white hover:brightness-95">{t("Сохранить")}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
