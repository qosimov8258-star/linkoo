"use client"

import { Plus } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { CheckBox, EmptyState, grayHead, HoverActions, LineField, listRow, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { ConfirmDeleteDialog, DateLineField, SettingsPager, SettingsSearch, SettingsToolbar } from "@/components/settings/settings-list-ui"
import { LineSearchSelect, UserSelect, useUserOptions, type UserOption } from "@/components/settings/user-select"
import { FilterSelect, RefFilterPanel } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import type { IntegrationType } from "@/lib/integrations-types"

type Integration = {
  id: number
  type: string
  typeDisplay: string
  userId: number | null
  userName: string
  comment: string
  isActive: boolean
  token: string
  validUntil: string | null
  extraFields: Record<string, string>
  extraUserIds: number[]
}

type Tab = "active" | "inactive" | "catalog"
const TABS: { key: Tab; label: string }[] = [
  { key: "active", label: "Активные" },
  { key: "inactive", label: "Не активные" },
  { key: "catalog", label: "Каталог" },
]
const COLS = "grid-cols-[110px_405px_1fr]"

/** Select options as unique labels (duplicate user names get their id appended). */
function userLabels(users: UserOption[]) {
  const counts = new Map<string, number>()
  users.forEach((user) => counts.set(user.name, (counts.get(user.name) ?? 0) + 1))
  return users.map((user) => ({ id: user.id, label: (counts.get(user.name) ?? 0) > 1 ? `${user.name} (${user.id})` : user.name }))
}

function TokenField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [focused, setFocused] = useState(false)
  const [shown, setShown] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className="relative h-[40px] border-b border-[#d5dae1]">
      <span className={`pointer-events-none absolute left-0 transition-all ${floating ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>{label}</span>
      <input type={shown ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent pr-8 text-[13px] outline-none" />
      <button type="button" onClick={() => setShown((current) => !current)} aria-label={label} className="absolute bottom-[4px] right-0 text-[#555]">
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${shown ? "fill-[#999]" : "fill-[#444]"}`}><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" /></svg>
      </button>
    </div>
  )
}

function IntegrationDialog({ item, initialType, types, users, usersLoading, onClose, onSaved }: { item: Integration | null; initialType: string; types: IntegrationType[]; users: UserOption[]; usersLoading: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const [type, setType] = useState(item?.type ?? initialType)
  const [userId, setUserId] = useState<number | null>(item?.userId ?? null)
  const [comment, setComment] = useState(item?.comment ?? "")
  const [isActive, setIsActive] = useState(item?.isActive ?? true)
  const [token, setToken] = useState(item?.token ?? "")
  const [validUntil, setValidUntil] = useState(item?.validUntil ?? "")
  const [extra, setExtra] = useState<Record<string, string>>(item?.extraFields ?? {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const selectedType = types.find((entry) => entry.name === type)
  const valid = Boolean(selectedType) && userId !== null && token.trim() !== ""

  async function save() {
    if (saving) return
    if (!valid) {
      setError("Обязательное поле")
      return
    }
    setSaving(true)
    setError("")
    try {
      const fields: Record<string, string> = {}
      selectedType?.extraFields.forEach((field) => {
        fields[field.key] = extra[field.key] ?? ""
      })
      const response = await fetch(item ? `/api/integrations/${item.id}` : "/api/integrations", {
        method: item ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, userId, comment, isActive, token, validUntil: validUntil || null, extraFields: fields, extraUserIds: item?.extraUserIds ?? [] }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error || "Не удалось сохранить интеграцию")
        return
      }
      onSaved()
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal width={400} bodyClassName="min-h-[400px] px-[30px] pb-[24px] pt-[29px]" title={t(item ? "Изменить интеграцию" : "Добавить интеграцию")} onClose={onClose} footer={<SaveButton disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}>
      <div>
        <LineSearchSelect
          label={t("Тип")}
          value={selectedType?.name ?? null}
          options={types.map((entry) => ({ value: entry.name, label: entry.nameDisplay }))}
          onChange={(value) => setType(value ?? "")}
        />
        <div className="mt-[14px]">
          <UserSelect label={t("Пользователь")} value={userId} onChange={setUserId} users={users} loading={usersLoading} />
        </div>
        <div className="mt-[31px]">
          <LineField label={t("Комментарий...")} value={comment} onChange={setComment} />
        </div>
        <div className="mt-[20px]">
          <CheckBox checked={isActive} onChange={setIsActive} label={t("Активный")} />
        </div>
      </div>
      {selectedType && (
        <div className="-mx-[30px] -mb-[3px] mt-[10px] bg-[#f2f5f8] px-[30px] pb-[18px] pt-[12px]">
          <TokenField label={t("Токен")} value={token} onChange={setToken} />
          <div className="mt-[17px]">
            <DateLineField label={t("Действует до")} value={validUntil} onChange={setValidUntil} />
          </div>
          {selectedType.extraFields.map((field) => (
            <div key={field.key} className="mt-[12px]">
              <LineField label={t(field.name)} value={extra[field.key] ?? ""} onChange={(value) => setExtra((current) => ({ ...current, [field.key]: value }))} />
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-[13px] text-red-500">{t(error)}</p>}
    </Modal>
  )
}

export function IntegrationsView() {
  const { t } = useLanguage()
  const [tab, setTab] = useState<Tab>("active")
  const [types, setTypes] = useState<IntegrationType[]>([])
  const { users, loading: usersLoading } = useUserOptions()
  const [rows, setRows] = useState<Integration[]>([])
  const [count, setCount] = useState(0)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [filterOpen, setFilterOpen] = useState(false)
  const [draft, setDraft] = useState({ type: "", user: "", extra: "" })
  const [applied, setApplied] = useState({ type: "", user: "", extra: "" })
  const [dialog, setDialog] = useState<{ item: Integration | null; type: string } | null>(null)
  const [removing, setRemoving] = useState<Integration | null>(null)
  const [removeError, setRemoveError] = useState("")
  const [version, setVersion] = useState(0)

  const labels = useMemo(() => userLabels(users), [users])
  const idOf = useCallback((label: string) => labels.find((entry) => entry.label === label)?.id ?? null, [labels])

  useEffect(() => {
    let cancelled = false
    fetch("/api/integrations/types", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((data: IntegrationType[]) => {
        if (!cancelled) setTypes(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim())
      setPage(1)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (tab === "catalog") return
    const controller = new AbortController()
    const params = new URLSearchParams({ is_active: String(tab === "active"), page: String(page), pageSize: String(pageSize) })
    if (search) params.set("search", search)
    if (applied.type) params.set("type", applied.type)
    const userId = idOf(applied.user)
    if (userId !== null) params.set("user", String(userId))
    const extraId = idOf(applied.extra)
    if (extraId !== null) params.set("extra_user", String(extraId))
    fetch(`/api/integrations?${params}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { count: 0, results: [] }))
      .then((data: { count: number; results: Integration[] }) => {
        setRows(data.results)
        setCount(data.count)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [tab, page, pageSize, search, applied, version, idOf])

  async function confirmRemove() {
    if (!removing) return
    setRemoveError("")
    try {
      const response = await fetch(`/api/integrations/${removing.id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setRemoveError(body.error || "Не удалось удалить интеграцию")
        return
      }
      setRemoving(null)
      setVersion((value) => value + 1)
    } catch {
      setRemoveError("Сервер недоступен, попробуйте ещё раз")
    }
  }

  const filtersOn = Boolean(applied.type || applied.user || applied.extra)

  return (
    <div className={`min-w-0 flex-1 bg-white ${tab === "catalog" ? "min-h-[calc(100vh-50px)]" : "self-start"}`}>
      <div className="relative flex h-[51px] border-b border-[#eceff1] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        {TABS.map((entry) => (
          <button key={entry.key} type="button" onClick={() => { setTab(entry.key); setPage(1) }} className="flex-1 pt-[3px] text-center text-[13px] text-black">
            {t(entry.label)}
          </button>
        ))}
        <span
          className="absolute bottom-0 left-0 h-[3px] bg-[#4f71dc] shadow-[0_-3px_10px_0_#5869f0] transition-transform duration-300"
          style={{ width: `${100 / TABS.length}%`, transform: `translateX(${TABS.findIndex((entry) => entry.key === tab) * 100}%)` }}
        />
      </div>

      {tab === "catalog" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(430px,430px))] gap-[20px] p-[31px] pt-[21px]">
          {types.map((entry) => (
            <button key={entry.name} type="button" onClick={() => setDialog({ item: null, type: entry.name })} className="flex h-[99px] items-center rounded-[4px] border border-[#e3e7ec] bg-white px-[18px] pb-[10px] text-left hover:shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={entry.logo} alt="" className="h-[40px] w-[70px] object-contain" />
              <span className="ml-[18px] min-w-0">
                <span className="block text-[15px] font-bold">{entry.nameDisplay}</span>
                <span className="mt-[6px] block text-[15px] leading-[19px] text-[#777]">{t(entry.description)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="relative">
            <SettingsToolbar
              className="h-[50px] pl-[6px]"
              left={
                <div className="w-[329px] shrink-0">
                  <button type="button" onClick={() => { setDraft(applied); setFilterOpen(true) }} className="text-[13px] text-[#4f71dc]">
                    {t("Показать фильтр")} ⌄
                  </button>
                  {filtersOn && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[#4f71dc]" />}
                </div>
              }
              search={<SettingsSearch value={query} onChange={setQuery} className="w-[295px]" />}
              pager={
                <>
                  <SettingsPager page={page} pageSize={pageSize} count={count} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} />
                  <button type="button" onClick={() => setDialog({ item: null, type: "" })} className="ml-[10px] mr-[8px] flex h-[30px] items-center gap-2 whitespace-nowrap rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95">
                    <Plus className="h-[18px] w-[18px] rounded-full bg-white p-[2px] text-[#4f71dc]" />
                    {t("Добавить")}
                  </button>
                </>
              }
            />
            {filterOpen && (
              <div className="absolute left-0 top-0 z-30">
                <RefFilterPanel narrow onClose={() => setFilterOpen(false)} onApply={() => { setApplied(draft); setPage(1); setFilterOpen(false) }}>
                  <FilterSelect label={t("Тип")} value={types.find((entry) => entry.name === draft.type)?.nameDisplay ?? ""} options={types.map((entry) => entry.nameDisplay)} onChange={(label) => setDraft((value) => ({ ...value, type: types.find((entry) => entry.nameDisplay === label)?.name ?? "" }))} />
                  <FilterSelect label={t("Ответственный пользователи")} value={draft.user} options={labels.map((entry) => entry.label)} onChange={(label) => setDraft((value) => ({ ...value, user: label }))} />
                  <FilterSelect label={t("Дополнительные пользователи")} value={draft.extra} options={labels.map((entry) => entry.label)} onChange={(label) => setDraft((value) => ({ ...value, extra: label }))} />
                </RefFilterPanel>
              </div>
            )}
          </div>
          <div className={`${grayHead} ${COLS}`}>
            <span>№</span>
            <span>{t("Тип")}</span>
            <span>{t("Комментарий")}</span>
          </div>
          {rows.length === 0 ? (
            <EmptyState />
          ) : (
            rows.map((row) => (
              <div key={row.id} onClick={() => setDialog({ item: row, type: row.type })} className={`${listRow} ${COLS} cursor-pointer`}>
                <span>{row.id}</span>
                <span>{row.typeDisplay}</span>
                <span className="truncate pr-20">{row.comment}</span>
                <HoverActions onEdit={() => setDialog({ item: row, type: row.type })} onDelete={() => { setRemoveError(""); setRemoving(row) }} />
              </div>
            ))
          )}
        </>
      )}

      {dialog && (
        <IntegrationDialog
          item={dialog.item}
          initialType={dialog.type}
          types={types}
          users={users}
          usersLoading={usersLoading}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            setVersion((value) => value + 1)
          }}
        />
      )}
      {removing && <ConfirmDeleteDialog name={removing.typeDisplay} error={removeError} onConfirm={() => void confirmRemove()} onClose={() => setRemoving(null)} />}
    </div>
  )
}
