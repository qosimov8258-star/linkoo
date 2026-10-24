"use client"

import { useCallback, useEffect, useState } from "react"

import { EmptyState, grayHead, listRow, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { ConfirmDeleteDialog, SettingsPager, SettingsSearch, SettingsToolbar } from "@/components/settings/settings-list-ui"
import { UserSelect, useUserOptions } from "@/components/settings/user-select"
import { useLanguage } from "@/lib/i18n/language-context"

type TemplateUser = { id: number; name: string }
type Template = { id: number; name: string; title: string; text: string; keywords: string; status: "on" | "off"; users: TemplateUser[] }

const COLS = "grid-cols-[312px_1fr_70px]"

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="relative inline-block h-[14px] w-[34px] cursor-pointer">
      <span className={`absolute inset-0 rounded-full ${checked ? "bg-[#9fb1f5]" : "bg-[#c8c8c8]"}`} />
      <span className={`absolute top-[-3px] h-[20px] w-[20px] rounded-full shadow ${checked ? "left-[16px] bg-[#4f71dc]" : "left-[-2px] bg-[#f1f1f1]"}`} />
      <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
    </label>
  )
}

function AttachUserDialog({ template, onClose, onSaved }: { template: Template; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage()
  const { users, loading } = useUserOptions()
  const [userId, setUserId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function save() {
    if (saving) return
    if (userId === null) {
      setError("Обязательное поле")
      return
    }
    setSaving(true)
    setError("")
    try {
      const response = await fetch(`/api/notification-templates/${template.id}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error || "Не удалось привязать пользователя")
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
    <Modal
      title={t("Привязать пользователя")}
      onClose={onClose}
      bodyClassName="px-[30px] pb-[24px] pt-[30px]"
      footer={<SaveButton disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}
    >
      <div className="min-h-[158px]">
        <UserSelect label={t("Пользователь")} value={userId} onChange={setUserId} users={users} loading={loading} />
        <p className="mt-[28px] text-[13px] leading-4 text-[#e53935]">
          {t("При изменении агентов зоны агенты которые видят клиенты в своих зонах должны будут выйти с программы и заново синхронизироваться для корректного отображения списка клиентов")}
        </p>
        {error && <p className="mt-3 text-[13px] text-red-500">{t(error)}</p>}
      </div>
    </Modal>
  )
}

export function NotificationsView() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<Template[]>([])
  const [count, setCount] = useState(0)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [version, setVersion] = useState(0)
  const [attach, setAttach] = useState<Template | null>(null)
  const [detach, setDetach] = useState<{ template: Template; user: TemplateUser } | null>(null)
  const [detachError, setDetachError] = useState("")

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim())
      setPage(1)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search) params.set("search", search)
    fetch(`/api/notification-templates?${params}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { count: 0, results: [] }))
      .then((data: { count: number; results: Template[] }) => {
        setRows(data.results)
        setCount(data.count)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [page, pageSize, search, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])

  async function toggle(template: Template, on: boolean) {
    const status = on ? "on" : "off"
    setRows((list) => list.map((row) => (row.id === template.id ? { ...row, status } : row)))
    try {
      const response = await fetch(`/api/notification-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!response.ok) reload()
    } catch {
      reload()
    }
  }

  async function confirmDetach() {
    if (!detach) return
    setDetachError("")
    try {
      const response = await fetch(`/api/notification-templates/${detach.template.id}/users/${detach.user.id}`, { method: "DELETE" })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setDetachError(body.error || "Не удалось отвязать пользователя")
        return
      }
      setDetach(null)
      reload()
    } catch {
      setDetachError("Сервер недоступен, попробуйте ещё раз")
    }
  }

  return (
    <div className="min-w-0 flex-1">
      <SettingsToolbar
        search={<SettingsSearch value={query} onChange={setQuery} />}
        pager={<SettingsPager page={page} pageSize={pageSize} count={count} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1) }} />}
      />
      <div className={`${grayHead} ${COLS} pr-[30px]`}>
        <span>{t("Наименование")}</span>
        <span>{t("Пользователи")}</span>
        <span className="justify-self-end">{t("Статус")}</span>
      </div>
      {rows.length === 0 && <EmptyState />}
      {rows.map((row) => (
        <div key={row.id} className={`${listRow} ${COLS} items-center py-[10px] pr-[30px] last:border-b-0`}>
          <span className="pr-4">{t(row.title)}</span>
          <div className="flex flex-wrap items-center gap-[10px]">
            {row.users.map((user) => (
              <span key={user.id} className="group/chip relative flex h-[28px] items-center rounded-[2px] bg-[#eceff1] px-[10px]">
                {user.name}
                <button
                  type="button"
                  aria-label={t("Удалить")}
                  onClick={() => {
                    setDetachError("")
                    setDetach({ template: row, user })
                  }}
                  className="absolute -left-[7px] -top-[7px] hidden h-[18px] w-[18px] items-center justify-center rounded-full bg-[#5d6474] group-hover/chip:flex"
                >
                  <svg viewBox="0 0 12 12" className="h-[8px] w-[8px]"><path d="M2 2l8 8M10 2l-8 8" stroke="#fff" strokeWidth="1.8" fill="none" /></svg>
                </button>
              </span>
            ))}
            <button type="button" onClick={() => setAttach(row)} className="h-[28px] rounded-[2px] bg-[#4f71dc] px-[15px] text-[13px] text-white hover:brightness-95">
              {t("добавить")}
            </button>
          </div>
          <span className="justify-self-end">
            <Switch checked={row.status === "on"} onChange={(on) => void toggle(row, on)} label={row.title} />
          </span>
        </div>
      ))}

      {attach && (
        <AttachUserDialog
          template={attach}
          onClose={() => setAttach(null)}
          onSaved={() => {
            setAttach(null)
            reload()
          }}
        />
      )}
      {detach && <ConfirmDeleteDialog name={detach.user.name} error={detachError} onConfirm={() => void confirmDetach()} onClose={() => setDetach(null)} />}
    </div>
  )
}
