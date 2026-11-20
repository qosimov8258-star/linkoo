"use client"

import { X } from "lucide-react"
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
  usePaged,
} from "@/components/analytics/settings-list-kit"
import { queryInt, useLinkoUrlState } from "@/components/orders/linko-url-state"
import { Check } from "@/components/staff/staff-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import type { AccessRight, Capability, Permission } from "./access-rights-data"
import { notify } from "@/lib/notify"
import { UsersPanel } from "./users-view"

// "Права доступа" (demo #/position, Settings → Персонал; API main/position/, main/group/gcrud/ and billing permission/):
// grid Права доступа | Возможности (chips), ✎ / 🗑 on hover; "+ создать права доступа" opens "Добавление должности"
// (name + every capability with a ✎), "+ создать возможности" opens the full-screen permission transfer list.
// Like Linko the address keeps the list (page, pageSize, listSearch) and the dialogs: ?openCreateDialog=true,
// ?openOpportunityDialog=true, #/position/100?openUpdateDialog=true[&openUpdateOpportunityDialog=true&opportunity=204],
// #/position/100 for the delete confirmation → /analytics/access-rights[/100]?…; a closed dialog stays "=false".

const PENCIL = ROW_ICONS.pencil
const BASE = "/analytics/access-rights"
/** Linko's rows: 30px page padding, a `row` with -8px margins (the list is 1px narrower than the page) and columns of
 * 2 / 9 / 1 twelfths: Права доступа | Возможности (chips 8px into the column) | the row pencil / bin. */
const COLUMNS = "calc(22px + (100% - 45px) / 6) calc((100% - 45px) * 3 / 4) minmax(0, 1fr)"
const ACTIONS_LEFT = "calc(33px + (100% - 45px) * 11 / 12)"
/** The dotted line under the header and each row runs inside the 30px page padding. */
const ROW_LINE = "relative after:pointer-events-none after:absolute after:left-[30px] after:right-[31px] after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-['']"

function PermissionList({ items, onPick, selected }: { items: Permission[]; onPick: (id: number) => void; selected?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className="h-[72vh] overflow-y-auto border border-[#e0e0e0]">
      {items.map((item) => (
        <div key={item.id} className="flex min-h-[36px] items-center justify-between border-b border-[#e0e0e0] px-[8px] py-[2px] text-[12px] font-semibold leading-[15px]">
          <span className="pr-4">{item.label}</span>
          <button type="button" onClick={() => onPick(item.id)} aria-label={selected ? t("Убрать") : t("Добавить")} className="mr-[2px] flex h-6 w-6 shrink-0 items-center justify-center text-[#1E4A9A]">
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
  // Linko's filter row: Категория and the search share the free width 4 : 5, Тип is 200px, 2px margins around each.
  return (
    <div className="mb-[20px] flex items-end">
      <div className="mx-[2px] min-w-0 flex-[4_4_0%]"><LinePick label={t("Категория")} value={category} options={categories.map((name) => ({ value: name, label: name }))} onChange={onCategory} /></div>
      <div className="mx-[2px] w-[200px] shrink-0"><LinePick label={t("Тип")} value={type} options={types.map((name) => ({ value: name, label: name }))} onChange={onType} /></div>
      <label className="relative mx-[2px] min-w-0 flex-[5_5_0%] border-b border-[#e0e0e0]">
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} className="h-[40px] w-full bg-transparent pr-8 pt-[8px] text-[13px] outline-none placeholder:text-[#b9c0cc]" />
        <svg viewBox="0 0 24 24" className="absolute right-[2px] top-[13px] h-6 w-6 fill-[#c4cad4]"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
      </label>
    </div>
  )
}

function matches(permission: Permission, category: string, type: string, query: string) {
  if (category && !permission.categories.includes(category)) return false
  // Linko's «Тип» is the permission's tag (Мобильный, Десктоп, Общее, CONFIGURATION).
  if (type && !(permission.tags ?? []).includes(type)) return false
  return !query || permission.label.toLowerCase().includes(query.toLowerCase())
}

function CapabilityDialog({
  capability,
  permissions,
  categories,
  types,
  onClose,
  onSaved,
}: {
  capability: Capability | null
  permissions: Permission[]
  categories: string[]
  /** Linko's «Тип» options: the permission tags (billing permission_tag/). */
  types: string[]
  onClose: () => void
  onSaved: (capability: Capability) => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(capability?.name ?? "")
  const [selectedIds, setSelectedIds] = useState<number[]>(capability?.permissionIds ?? [])
  const [saving, setSaving] = useState(false)
  const [leftFilter, setLeftFilter] = useState({ category: "", type: "", query: "" })
  const [rightFilter, setRightFilter] = useState({ category: "", type: "", query: "" })

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
        <div className="mt-[26px] grid min-h-0 flex-1 grid-cols-2 gap-[16px]">
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

export function AccessRightsView({ embedded = false, initialId = null }: { embedded?: boolean; initialId?: number | null }) {
  const { t } = useLanguage()
  const [roles, setRoles] = useState<AccessRight[] | null>(null)
  const [capabilities, setCapabilities] = useState<Capability[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [deleting, setDeleting] = useState<AccessRight | null>(null)
  // The sidebar link of the reference opens this list with ?page=1&pageSize=100, the top menu without a size (25).
  const { state: url, update: updateUrl } = useLinkoUrlState(BASE, { id: initialId ? String(initialId) : null, query: {} })
  const requestedSize = queryInt(url.query.pageSize, 25)
  const controls = {
    query: url.query.listSearch ?? "",
    setQuery: (value: string) => updateUrl({ query: { listSearch: value, page: null } }),
    page: queryInt(url.query.page, 1, 1_000_000),
    setPage: (value: number) => updateUrl({ query: { page: value } }),
    pageSize: PAGE_SIZES.includes(requestedSize) ? requestedSize : 25,
    setPageSize: (value: number) => updateUrl({ query: { pageSize: value, page: null } }),
  }
  const current = url.id ? roles?.find((role) => String(role.id) === url.id) : undefined
  const dialog = url.query.openCreateDialog === "true" ? { role: null } : url.query.openUpdateDialog === "true" && current ? { role: current } : null
  const editedCapability = url.query.openUpdateOpportunityDialog === "true" ? capabilities.find((item) => String(item.id) === url.query.opportunity) : undefined
  const capabilityDialog = editedCapability ? { capability: editedCapability } : url.query.openOpportunityDialog === "true" ? { capability: null } : null

  const load = useCallback(async () => {
    try {
      const [rolesResponse, capabilitiesResponse] = await Promise.all([
        fetch("/api/access-rights", { cache: "no-store" }),
        fetch("/api/capabilities", { cache: "no-store" }),
      ])
      if (!rolesResponse.ok || !capabilitiesResponse.ok) {
        const failed = rolesResponse.ok ? capabilitiesResponse : rolesResponse
        const body = (await failed.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error || "Не удалось загрузить данные с сервера")
      }
      setRoles((await rolesResponse.json()) as AccessRight[])
      setCapabilities((await capabilitiesResponse.json()) as Capability[])
    } catch (error) {
      // A failed load says so instead of passing for an empty list.
      setRoles([])
      // fetch itself fails with a TypeError when the server cannot be reached.
      notify(t(error instanceof Error && !(error instanceof TypeError) ? error.message : "Сервер недоступен, попробуйте ещё раз"))
    }
  }, [t])
  useEffect(() => { void load() }, [load])

  // Permission catalogue is only needed by the capability dialog; load it on first use (also when the address opens it).
  const needPermissions = capabilityDialog !== null
  useEffect(() => {
    if (!needPermissions || permissions.length) return
    let cancelled = false
    fetch("/api/permissions", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ permissions: Permission[]; categories: string[]; tags?: string[] }>) : null))
      .then((data) => {
        if (cancelled || !data) return
        setPermissions(data.permissions)
        setCategories(data.categories)
        setTags(data.tags ?? [])
      })
      .catch(() => undefined /* the dialog shows an empty list */)
    return () => {
      cancelled = true
    }
  }, [needPermissions, permissions.length])

  const openCapability = (capability: Capability | null) =>
    updateUrl({ query: capability ? { openUpdateOpportunityDialog: "true", opportunity: capability.id } : { openOpportunityDialog: "true" } })
  const closeCapability = () =>
    updateUrl({ query: capabilityDialog?.capability ? { openUpdateOpportunityDialog: "false", opportunity: null } : { openOpportunityDialog: "false" } })

  const capabilityById = useMemo(() => new Map(capabilities.map((item) => [item.id, item])), [capabilities])
  const needle = controls.query.trim().toLowerCase()
  const filtered = (roles ?? []).filter((role) => role.name.toLowerCase().includes(needle))
  const paged = usePaged(filtered, controls.page, controls.pageSize)

  async function remove(role: AccessRight) {
    try {
      const response = await fetch(`/api/access-rights/${role.id}`, { method: "DELETE" })
      if (!response.ok) {
        // 409 while users or dashboard widgets are linked to it (the usage list names them; labels are i18n keys).
        const body = (await response.json().catch(() => ({}))) as { error?: string; usage?: { label: string; count: number }[] }
        const usage = body.usage?.map((item) => `${t(item.label)}: ${item.count}`).join(", ")
        notify(`${t(body.error || "Не удалось удалить права доступа")}${usage ? ` (${usage})` : ""}`)
        return
      }
      setDeleting(null)
      updateUrl({ id: null })
      await load()
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const body = (
    <section className="min-w-0 flex-1 bg-white text-[13px] text-[#333]">
      <SettingsToolbar
        left={
          <>
            <button type="button" onClick={() => updateUrl({ query: { openCreateDialog: "true" } })} className="ml-[42px] flex h-[36px] items-center pt-[3px] text-[13px] leading-[36px] text-[#1E4A9A] hover:underline"><svg viewBox="0 0 24 24" className="mr-[2px] h-[14px] w-[14px] fill-[#1E4A9A]" aria-hidden><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>{t("создать права доступа")}</button>
            <button type="button" onClick={() => openCapability(null)} className="ml-[28px] flex h-[36px] items-center pt-[3px] text-[13px] leading-[36px] text-[#1E4A9A] hover:underline"><svg viewBox="0 0 24 24" className="mr-[2px] h-[14px] w-[14px] fill-[#1E4A9A]" aria-hidden><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>{t("создать возможности")}</button>
            {/* Linko's toolbar ends in a light rule inside the page padding. */}
            <span className="pointer-events-none absolute left-[30px] right-[31px] top-[64px] h-px bg-[#efefef]" />
          </>
        }
        query={controls.query}
        onQuery={controls.setQuery}
        // The toolbar is a space-between row in Linko: the 250px search sits 41px left of the middle.
        searchClassName="left-[calc(50%_-_41.1px)] top-[23px] !w-[250px]"
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
      <div className={`grid h-[48px] items-center pb-[2px] font-semibold leading-[18px] text-[#333] ${ROW_LINE}`} style={{ gridTemplateColumns: COLUMNS }}>
        <span className="pl-[30px]">{t("Права доступа")}</span>
        <span className="pl-[8px]">{t("Возможности")}</span>
      </div>
      {paged.rows.map((role) => (
        <div key={role.id} className={`${kitRow} !min-h-[50px] py-[5px] hover:!bg-transparent after:!left-[30px] after:!right-[31px]`} style={{ gridTemplateColumns: COLUMNS }}>
          <span className="pl-[30px] pr-2">{role.name}</span>
          <div className="flex flex-wrap gap-y-[10px] px-[8px]">
            {/* A right without capabilities shows Linko's «Нет доступа» chip. */}
            {(role.capabilityIds.some((id) => capabilityById.has(id)) ? role.capabilityIds.flatMap((id) => capabilityById.get(id)?.name ?? []) : [t("Нет доступа")]).map((name, index) => (
              <span key={index} className="mr-[10px] rounded-[2px] bg-[#e9ecef] px-[10px] py-[5px] text-[13px] leading-[18px] text-[#333]">{name}</span>
            ))}
          </div>
          <RowActions left={ACTIONS_LEFT} gap={6} onEdit={() => updateUrl({ id: String(role.id), query: { openUpdateDialog: "true" } })} onDelete={() => {
            // Linko's bin opens the confirmation on the record's own address (#/position/100) without a dialog flag.
            setDeleting(role)
            updateUrl({ id: String(role.id), query: { openUpdateDialog: null } })
          }} />
        </div>
      ))}
      {roles && paged.rows.length === 0 && <EmptyRows />}

      {dialog && (
        <AccessRightDialog
          key={dialog.role?.id ?? "new"}
          role={dialog.role}
          capabilities={capabilities}
          onEditCapability={(capability) => openCapability(capability)}
          onClose={() => updateUrl({ query: dialog.role ? { openUpdateDialog: "false" } : { openCreateDialog: "false" } })}
          onSaved={() => { updateUrl({ query: dialog.role ? { openUpdateDialog: "false" } : { openCreateDialog: "false" } }); void load() }}
        />
      )}
      {capabilityDialog && (
        <CapabilityDialog
          key={capabilityDialog.capability?.id ?? "new"}
          capability={capabilityDialog.capability}
          permissions={permissions}
          categories={categories}
          types={tags}
          onClose={closeCapability}
          onSaved={() => { closeCapability(); void load() }}
        />
      )}
      {roles && <UsersPanel accessRights={roles} />}
      {deleting && <ConfirmDeleteDialog name={`${t("Права доступа")}: ${deleting.name}`} onConfirm={() => void remove(deleting)} onClose={() => { setDeleting(null); updateUrl({ id: null }) }} />}
    </section>
  )
  return embedded ? body : <main className="min-h-[calc(100vh-4rem)] bg-white">{body}</main>
}
