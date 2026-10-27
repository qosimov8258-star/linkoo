"use client"

import { X } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { LineField, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import {
  ConfirmDeleteDialog,
  EmptyRows,
  LinePick,
  PAGE_SIZES,
  ROW_ICONS,
  RowActions,
  SettingsToolbar,
  kitRow,
  useListControls,
  usePaged,
} from "@/components/analytics/settings-list-kit"
import { Check } from "@/components/staff/staff-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import type { AccessRight, Capability, Permission } from "./access-rights-data"
import { notify } from "@/lib/notify"
import { UsersPanel } from "./users-view"

// "Права доступа" (demo #/position, Settings → Персонал; API main/position/, main/group/gcrud/ and billing permission/):
// grid Права доступа | Возможности (chips), ✎ / 🗑 on hover; "+ создать права доступа" opens "Добавление должности"
// (name + every capability with a ✎), "+ создать возможности" opens the full-screen permission transfer list.

const PENCIL = ROW_ICONS.pencil
const COLUMNS = "235px 1fr"

function PermissionList({ items, onPick, selected }: { items: Permission[]; onPick: (id: number) => void; selected?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="min-h-0 flex-1 overflow-y-auto border border-[#e0e0e0]">
      {items.map((item) => (
        <div key={item.id} className="flex min-h-[36px] items-center justify-between border-b border-[#e0e0e0] px-[8px] py-[2px] text-[12px] font-semibold leading-[15px]">
          <span className="pr-4">{item.label}</span>
          <button type="button" onClick={() => onPick(item.id)} aria-label={selected ? t("Убрать") : t("Добавить")} className="mr-[2px] flex h-6 w-6 shrink-0 items-center justify-center text-[#4f71dc]">
            {selected ? (
              <X className="h-[22px] w-[22px]" />
            ) : (
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
            )}
          </button>
        </div>
      ))}
    </div>
  )
}

function PermissionFilters({
  categories,
  types,
  category,
  type,
  query,
  onCategory,
  onType,
  onQuery,
  placeholder,
}: {
  categories: string[]
  types: string[]
  category: string
  type: string
  query: string
  onCategory: (value: string) => void
  onType: (value: string) => void
  onQuery: (value: string) => void
  placeholder: string
}) {
  const { t } = useLanguage()
  return (
    <div className="mb-[20px] flex items-end gap-[12px]">
      <div className="w-[220px]"><LinePick label={t("Категория")} value={category} options={categories.map((name) => ({ value: name, label: name }))} onChange={onCategory} /></div>
      <div className="w-[195px]"><LinePick label={t("Тип")} value={type} options={types.map((name) => ({ value: name, label: name }))} onChange={onType} /></div>
      <label className="relative min-w-0 flex-1 border-b border-[#e0e0e0]">
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} className="h-[40px] w-full bg-transparent pr-8 pt-[8px] text-[13px] outline-none placeholder:text-[#b9c0cc]" />
        <svg viewBox="0 0 24 24" className="absolute right-1 top-[10px] h-[20px] w-[20px] fill-[#c4cad4]"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
      </label>
    </div>
  )
}

function matches(permission: Permission, category: string, type: string, query: string) {
  if (category && !permission.categories.includes(category)) return false
  if (type && permission.type !== type) return false
  return !query || permission.label.toLowerCase().includes(query.toLowerCase())
}

function CapabilityDialog({
  capability,
  permissions,
  categories,
  onClose,
  onSaved,
}: {
  capability: Capability | null
  permissions: Permission[]
  categories: string[]
  onClose: () => void
  onSaved: (capability: Capability) => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(capability?.name ?? "")
  const [selectedIds, setSelectedIds] = useState<number[]>(capability?.permissionIds ?? [])
  const [saving, setSaving] = useState(false)
  const [leftFilter, setLeftFilter] = useState({ category: "", type: "", query: "" })
  const [rightFilter, setRightFilter] = useState({ category: "", type: "", query: "" })
  const types = useMemo(() => Array.from(new Set(permissions.map((item) => item.type))).filter(Boolean), [permissions])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const available = useMemo(() => permissions.filter((item) => !selectedSet.has(item.id) && matches(item, leftFilter.category, leftFilter.type, leftFilter.query)), [permissions, selectedSet, leftFilter])
  const selected = useMemo(() => permissions.filter((item) => selectedSet.has(item.id) && matches(item, rightFilter.category, rightFilter.type, rightFilter.query)), [permissions, selectedSet, rightFilter])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function save() {
    if (saving || !name.trim()) return
    setSaving(true)
    try {
      const response = await fetch(capability ? `/api/capabilities/${capability.id}` : "/api/capabilities", {
        method: capability ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), permissionIds: selectedIds }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(body.error || "Не удалось сохранить возможность"))
        return
      }
      onSaved((await response.json()) as Capability)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-white text-[13px] text-[#333]">
      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[32px]">
        <h3 className="text-[15px] font-bold uppercase">{capability ? t("Изменить возможность") : t("Создать возможности")}</h3>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-6 w-6 text-slate-500" /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-[20px] pt-[4px]">
        <LineField label={t("Наименование")} required value={name} onChange={setName} />
        <div className="mt-[26px] grid min-h-0 flex-1 grid-cols-2 gap-[17px]">
          <div className="flex min-h-0 flex-col">
            <PermissionFilters categories={categories} types={types} {...leftFilter} onCategory={(category) => setLeftFilter((v) => ({ ...v, category }))} onType={(type) => setLeftFilter((v) => ({ ...v, type }))} onQuery={(query) => setLeftFilter((v) => ({ ...v, query }))} placeholder={t("Поиск из разрешения")} />
            <PermissionList items={available} onPick={(id) => setSelectedIds((current) => [...current, id])} />
          </div>
          <div className="flex min-h-0 flex-col">
            <PermissionFilters categories={categories} types={types} {...rightFilter} onCategory={(category) => setRightFilter((v) => ({ ...v, category }))} onType={(type) => setRightFilter((v) => ({ ...v, type }))} onQuery={(query) => setRightFilter((v) => ({ ...v, query }))} placeholder={t("Поиск из выбранных разрешения")} />
            <PermissionList selected items={selected} onPick={(id) => setSelectedIds((current) => current.filter((value) => value !== id))} />
          </div>
        </div>
      </div>
      <footer className="flex h-[67px] shrink-0 items-center justify-end border-t border-[#e8ebf0] pr-[15px]">
        <SaveButton disabled={saving || !name.trim()} onClick={() => void save()}>{t("Сохранить")}</SaveButton>
      </footer>
    </div>
  )
}

function AccessRightDialog({
  role,
  capabilities,
  onEditCapability,
  onClose,
  onSaved,
}: {
  role: AccessRight | null
  capabilities: Capability[]
  onEditCapability: (capability: Capability) => void
  onClose: () => void
  onSaved: (role: AccessRight) => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(role?.name ?? "")
  const [ids, setIds] = useState<number[]>(role?.capabilityIds ?? [])
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving) return
    // The reference keeps "Сохранить" enabled here and answers an empty name with the API field error.
    if (!name.trim()) {
      notify(`name: ${t("Это поле обязательно к заполнению")}`)
      return
    }
    setSaving(true)
    try {
      const response = await fetch(role ? `/api/access-rights/${role.id}` : "/api/access-rights", {
        method: role ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), capabilityIds: ids }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        notify(t(body.error || "Не удалось сохранить права доступа"))
        return
      }
      onSaved((await response.json()) as AccessRight)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={role ? t("Изменить должность") : t("Добавление должности")}
      width={1000}
      anchorTop={50}
      onClose={onClose}
      bodyClassName="flex h-[640px] flex-col px-[20px] pt-[4px]"
      headerClassName="pl-[30px]"
      footerClassName="mb-[3px]"
      footer={<SaveButton disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
    >
      <div className="-mt-px"><LineField label={t("Наименование")} required value={name} onChange={setName} /></div>
      <div className="mb-[12px] mt-[9px] grid min-h-0 flex-1 grid-cols-2 content-start overflow-y-auto">
        {capabilities.map((capability) => (
          <div key={capability.id} className="relative flex h-[40px] items-center">
            <Check checked={ids.includes(capability.id)} onChange={(checked) => setIds((current) => (checked ? [...current, capability.id] : current.filter((id) => id !== capability.id)))} label={capability.name} />
            <button type="button" onClick={() => onEditCapability(capability)} aria-label={`${t("Изменить")} ${capability.name}`} className="absolute right-[45.5px] top-[calc(50%-1.5px)] -translate-y-1/2 text-[#666] hover:text-[#222]">
              <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current"><path d={PENCIL} /></svg>
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function AccessRightsView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [roles, setRoles] = useState<AccessRight[] | null>(null)
  const [capabilities, setCapabilities] = useState<Capability[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [dialog, setDialog] = useState<{ role: AccessRight | null } | null>(null)
  const [capabilityDialog, setCapabilityDialog] = useState<{ capability: Capability | null } | null>(null)
  const [deleting, setDeleting] = useState<AccessRight | null>(null)
  // The sidebar link of the reference opens this list with ?page=1&pageSize=100, the top menu without a size (25).
  const requestedSize = Number(useSearchParams().get("pageSize"))
  const controls = useListControls(PAGE_SIZES.includes(requestedSize) ? requestedSize : 25)

  const load = useCallback(async () => {
    try {
      const [rolesResponse, capabilitiesResponse] = await Promise.all([
        fetch("/api/access-rights", { cache: "no-store" }),
        fetch("/api/capabilities", { cache: "no-store" }),
      ])
      if (!rolesResponse.ok || !capabilitiesResponse.ok) throw new Error("load")
      setRoles((await rolesResponse.json()) as AccessRight[])
      setCapabilities((await capabilitiesResponse.json()) as Capability[])
    } catch {
      setRoles([])
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // Permission catalogue is only needed by the capability dialog; load it on first use.
  const ensurePermissions = useCallback(async () => {
    if (permissions.length) return
    try {
      const response = await fetch("/api/permissions", { cache: "no-store" })
      if (!response.ok) return
      const data = (await response.json()) as { permissions: Permission[]; categories: string[] }
      setPermissions(data.permissions)
      setCategories(data.categories)
    } catch {
      /* the dialog shows an empty list */
    }
  }, [permissions.length])

  function openCapability(capability: Capability | null) {
    void ensurePermissions()
    setCapabilityDialog({ capability })
  }

  const capabilityById = useMemo(() => new Map(capabilities.map((item) => [item.id, item])), [capabilities])
  const needle = controls.query.trim().toLowerCase()
  const filtered = (roles ?? []).filter((role) => role.name.toLowerCase().includes(needle))
  const paged = usePaged(filtered, controls.page, controls.pageSize)

  async function remove(role: AccessRight) {
    const response = await fetch(`/api/access-rights/${role.id}`, { method: "DELETE" })
    if (!response.ok) {
      // 409 while users or dashboard widgets are linked to it (the usage list names them).
      const body = (await response.json().catch(() => ({}))) as { error?: string; usage?: { label: string; count: number }[] }
      const usage = body.usage?.map((item) => `${item.label}: ${item.count}`).join(", ")
      notify(`${t(body.error || "Не удалось удалить права доступа")}${usage ? ` (${usage})` : ""}`)
      return
    }
    setDeleting(null)
    await load()
  }

  const body = (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <SettingsToolbar
        left={
          <>
            <button type="button" onClick={() => setDialog({ role: null })} className="ml-[42px] flex h-[36px] items-center pt-[3px] text-[13px] leading-[36px] text-[#4f71dc] hover:underline"><svg viewBox="0 0 24 24" className="mr-[2px] h-[14px] w-[14px] fill-[#4f71dc]" aria-hidden><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>{t("создать права доступа")}</button>
            <button type="button" onClick={() => openCapability(null)} className="ml-[28px] flex h-[36px] items-center pt-[3px] text-[13px] leading-[36px] text-[#4f71dc] hover:underline"><svg viewBox="0 0 24 24" className="mr-[2px] h-[14px] w-[14px] fill-[#4f71dc]" aria-hidden><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>{t("создать возможности")}</button>
          </>
        }
        query={controls.query}
        onQuery={controls.setQuery}
        searchClassName="left-[596.4px] top-[23px] !w-[250.5px]"
        className="h-[67px] pr-[26px] pt-[7px]"
        pager={{
          pageSize: controls.pageSize,
          onPageSize: controls.setPageSize,
          from: paged.from,
          to: paged.to,
          total: paged.total,
          onPrev: paged.page > 1 ? () => controls.setPage(paged.page - 1) : undefined,
          onNext: paged.page < paged.pageCount ? () => controls.setPage(paged.page + 1) : undefined,
        }}
      />
      <div className="grid h-[48px] items-center border-b-2 border-dotted border-[#d9e0e5] font-semibold leading-[18px] text-[#333]" style={{ gridTemplateColumns: COLUMNS }}>
        <span className="pl-[30px]">{t("Права доступа")}</span>
        <span>{t("Возможности")}</span>
      </div>
      {paged.rows.map((role) => (
        <div key={role.id} className={`${kitRow} !min-h-[50px] py-[5px] hover:!bg-transparent after:!left-[30px] after:!right-[31px]`} style={{ gridTemplateColumns: COLUMNS }}>
          <span className="pl-[30px] pr-2">{role.name}</span>
          <div className="flex flex-wrap gap-y-[10px] pr-[133.5px]">
            {role.capabilityIds.map((id) => {
              const capability = capabilityById.get(id)
              return capability ? <span key={id} className="mr-[10px] rounded-[2px] bg-[#e9ecef] px-[10px] py-[5px] text-[13px] leading-[18px] text-[#333]">{capability.name}</span> : null
            })}
          </div>
          <RowActions right={60.5} gap={6} onEdit={() => setDialog({ role })} onDelete={() => setDeleting(role)} />
        </div>
      ))}
      {roles && paged.rows.length === 0 && <EmptyRows />}

      {dialog && (
        <AccessRightDialog
          key={dialog.role?.id ?? "new"}
          role={dialog.role}
          capabilities={capabilities}
          onEditCapability={(capability) => openCapability(capability)}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load() }}
        />
      )}
      {capabilityDialog && (
        <CapabilityDialog
          key={capabilityDialog.capability?.id ?? "new"}
          capability={capabilityDialog.capability}
          permissions={permissions}
          categories={categories}
          onClose={() => setCapabilityDialog(null)}
          onSaved={() => { setCapabilityDialog(null); void load() }}
        />
      )}
      {roles && <UsersPanel accessRights={roles} />}
      {deleting && <ConfirmDeleteDialog name={`${t("Права доступа")}: ${deleting.name}`} onConfirm={() => void remove(deleting)} onClose={() => setDeleting(null)} />}
    </section>
  )
  return embedded ? body : <main className="min-h-[calc(100vh-4rem)] bg-white">{body}</main>
}
