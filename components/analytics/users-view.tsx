"use client"

import { KeyRound, Pencil, Trash2, X } from "lucide-react"
import { FormEvent, useEffect, useMemo, useState } from "react"

import { PASSWORD_MIN, normalizeUsername, passwordProblem, usernameProblem } from "@/lib/auth-policy"
import { useLanguage } from "@/lib/i18n/language-context"

import type { AccessRight } from "./access-rights-data"

type Role = "admin" | "manager" | "viewer"

type AccountRow = {
  id: number
  username: string
  displayName: string
  role: Role
  accessRightId: number | null
  mustChangePassword: boolean
  employeeId: number | null
  employeeName: string | null
  /** False when the linked employee is deactivated or has no system access. */
  canSignIn: boolean
  createdAt: string
}

type EmployeeOption = { id: number; name: string; position: string; active: boolean; systemAccess: boolean }

const ROLE_LABELS: Record<Role, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  viewer: "Только просмотр",
}

type Draft = { username: string; displayName: string; password: string; role: Role; accessRightId: string; employeeId: string }

const emptyDraft = (): Draft => ({ username: "", displayName: "", password: "", role: "manager", accessRightId: "", employeeId: "" })

/**
 * "Пользователи": the accounts that sign in to the system. Each account has a
 * role (admin / manager / viewer) and, optionally, an access right (Права
 * доступа): a restricted account may only change the resources that the access
 * right's capabilities allow (e.g. a sales agent without "Касса" cannot move or
 * delete cash). An administrator can also reset a password here; the user must
 * then choose a new one at the next sign-in (so must a new account).
 *
 * An account can be tied to an employee (Сотрудники): while the employee is
 * deactivated or "Доступ к системе" is off, the account cannot sign in.
 */
export function UsersPanel({ accessRights }: { accessRights: AccessRight[] }) {
  const { t } = useLanguage()
  const [users, setUsers] = useState<AccountRow[]>([])
  const [loadError, setLoadError] = useState("")
  const [editing, setEditing] = useState<AccountRow | "new" | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])

  useEffect(() => {
    let cancelled = false
    fetch("/api/users")
      .then((response) => (response.ok ? (response.json() as Promise<AccountRow[]>) : Promise.reject()))
      .then((rows) => {
        if (!cancelled) setUsers(rows)
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить пользователей")
      })
    fetch("/api/employees")
      .then((response) => (response.ok ? (response.json() as Promise<EmployeeOption[]>) : []))
      .then((rows) => {
        if (!cancelled) setEmployees(rows.map(({ id, name, position, active, systemAccess }) => ({ id, name, position, active, systemAccess })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const accessRightName = useMemo(() => new Map(accessRights.map((item) => [item.id, item.name])), [accessRights])
  const sortedEmployees = useMemo(() => [...employees].sort((a, b) => a.name.localeCompare(b.name)), [employees])

  // Employees already tied to another account cannot be chosen again.
  function linkedElsewhere(employeeId: number): boolean {
    const ownId = editing && editing !== "new" ? editing.id : null
    return users.some((user) => user.employeeId === employeeId && user.id !== ownId)
  }

  function employeeLabel(employee: EmployeeOption): string {
    const note = !employee.active ? t("Удален") : !employee.systemAccess ? t("Нет доступа к системе") : ""
    return `${employee.name}${employee.position ? ` — ${employee.position}` : ""}${note ? ` (${note})` : ""}`
  }

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditing("new")
  }

  function openEdit(user: AccountRow) {
    setDraft({
      username: user.username,
      displayName: user.displayName,
      password: "",
      role: user.role,
      accessRightId: user.accessRightId ? String(user.accessRightId) : "",
      employeeId: user.employeeId ? String(user.employeeId) : "",
    })
    setFormError("")
    setEditing(user)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    setFormError("")
    const isNew = editing === "new"
    const username = normalizeUsername(draft.username)
    if (isNew) {
      const loginProblem = usernameProblem(username)
      if (loginProblem) return setFormError(t(loginProblem))
    }
    if (!draft.displayName.trim()) return setFormError(t("Введите имя пользователя"))
    if (isNew || draft.password) {
      const weak = passwordProblem(draft.password, isNew ? username : (editing as AccountRow).username)
      if (weak) return setFormError(t(weak))
    }
    const accessRightId = draft.accessRightId ? Number(draft.accessRightId) : null
    const employeeId = draft.employeeId ? Number(draft.employeeId) : null
    const body = isNew
      ? { username, displayName: draft.displayName.trim(), password: draft.password, role: draft.role, accessRightId, employeeId }
      : {
          displayName: draft.displayName.trim(),
          role: draft.role,
          accessRightId,
          employeeId,
          ...(draft.password ? { password: draft.password } : {}),
        }
    setSaving(true)
    try {
      const response = await fetch(isNew ? "/api/users" : `/api/users/${(editing as AccountRow).id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await response.json().catch(() => ({}))) as AccountRow & { error?: string }
      if (!response.ok) {
        setFormError(data.error ? t(data.error) : t("Не удалось сохранить пользователя"))
        return
      }
      setUsers((list) => (isNew ? [...list, data] : list.map((item) => (item.id === data.id ? data : item))))
      setEditing(null)
    } catch {
      setFormError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  async function remove(user: AccountRow) {
    if (!window.confirm(`${t("Удалить пользователя?")} ${user.username}`)) return
    try {
      const response = await fetch(`/api/users/${user.id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        window.alert(data.error ? t(data.error) : t("Не удалось удалить пользователя"))
        return
      }
      setUsers((list) => list.filter((item) => item.id !== user.id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  const isNew = editing === "new"
  const fieldClass = "mt-[6px] block h-[28px] w-full bg-white text-[13px] font-normal outline-none"

  return (
    <section className="mt-8 border-t border-slate-200">
      <div className="flex flex-wrap items-center gap-6 px-5 py-4">
        <h2 className="text-[16px] font-bold text-black">{t("Пользователи")}</h2>
        <button type="button" onClick={openCreate} className="text-[16px] text-[#4f71dc] hover:underline">
          + {t("создать пользователя")}
        </button>
      </div>
      {loadError && <p className="px-5 pb-3 text-sm text-red-500">{t(loadError)}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="px-5 py-3 text-[13px] font-bold text-black">{t("Логин")}</th>
              <th className="px-5 py-3 text-[13px] font-bold text-black">{t("Имя")}</th>
              <th className="px-5 py-3 text-[13px] font-bold text-black">{t("Сотрудник")}</th>
              <th className="px-5 py-3 text-[13px] font-bold text-black">{t("Роль")}</th>
              <th className="px-5 py-3 text-[13px] font-bold text-black">{t("Права доступа")}</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="group border-b border-dashed border-slate-200 hover:bg-slate-50">
                <td className="whitespace-nowrap px-5 py-[12px] text-[13px]" data-no-translate>
                  {user.username}
                </td>
                <td className="px-5 py-[12px] text-[13px]" data-no-translate>
                  {user.displayName}
                </td>
                <td className="px-5 py-[12px] text-[13px]">
                  {user.employeeId ? (
                    <>
                      <span data-no-translate>{user.employeeName ?? `#${user.employeeId}`}</span>
                      {!user.canSignIn && <span className="block text-[12px] text-rose-600">{t("Доступ к системе отключен")}</span>}
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-[12px] text-[13px]">
                  {t(ROLE_LABELS[user.role])}
                  {user.mustChangePassword && (
                    <span title={t("Пароль нужно сменить при следующем входе")} className="ml-2 inline-flex align-middle text-amber-500">
                      <KeyRound className="h-4 w-4" />
                    </span>
                  )}
                </td>
                <td className="px-5 py-[12px] text-[13px]">
                  {user.role === "admin" ? (
                    <span className="text-slate-400">{t("Без ограничений")}</span>
                  ) : user.accessRightId ? (
                    <span data-no-translate>{accessRightName.get(user.accessRightId) ?? `#${user.accessRightId}`}</span>
                  ) : (
                    <span className="text-slate-400">{t("Без ограничений")}</span>
                  )}
                </td>
                <td className="px-5 py-[10px]">
                  <div className="flex items-center justify-end gap-3 text-slate-500 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                    <button type="button" onClick={() => openEdit(user)} aria-label={t("Изменить")}>
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => void remove(user)} aria-label={t("Удалить")}>
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loadError && users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                  {t("Ничего не найдено")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[92vh] w-[520px] max-w-full flex-col bg-white text-[13px]">
            <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[#e8ebf0] pl-[30px] pr-[28px]">
              <b className="uppercase">{isNew ? t("Новый пользователь") : t("Изменить пользователя")}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label={t("Закрыть")}>
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 space-y-[18px] overflow-y-auto px-[30px] py-[20px]">
              <label className="block border-b border-[#d5dae1] pb-[4px] text-[10px] font-semibold">
                {t("Логин")} {isNew && <span className="text-red-500">*</span>}
                <input
                  autoFocus={isNew}
                  disabled={!isNew}
                  value={draft.username}
                  onChange={(event) => setDraft((value) => ({ ...value, username: event.target.value }))}
                  className={`${fieldClass} disabled:text-slate-500`}
                  autoComplete="off"
                />
              </label>
              <label className="block border-b border-[#d5dae1] pb-[4px] text-[10px] font-semibold">
                {t("Имя")} <span className="text-red-500">*</span>
                <input
                  autoFocus={!isNew}
                  value={draft.displayName}
                  onChange={(event) => setDraft((value) => ({ ...value, displayName: event.target.value }))}
                  className={fieldClass}
                />
              </label>
              <label className="block border-b border-[#d5dae1] pb-[4px] text-[10px] font-semibold">
                {t("Роль")} <span className="text-red-500">*</span>
                <select value={draft.role} onChange={(event) => setDraft((value) => ({ ...value, role: event.target.value as Role }))} className={fieldClass}>
                  {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                    <option key={role} value={role}>
                      {t(ROLE_LABELS[role])}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block border-b border-[#d5dae1] pb-[4px] text-[10px] font-semibold">
                {t("Права доступа")}
                <select
                  value={draft.accessRightId}
                  disabled={draft.role === "admin"}
                  onChange={(event) => setDraft((value) => ({ ...value, accessRightId: event.target.value }))}
                  className={`${fieldClass} disabled:text-slate-400`}
                >
                  <option value="">{t("Без ограничений")}</option>
                  {accessRights.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[12px] text-slate-400">
                {t("Пользователь с правами доступа может изменять только разделы, разрешенные его возможностями. Администратор не ограничивается.")}
              </p>
              <label className="block border-b border-[#d5dae1] pb-[4px] text-[10px] font-semibold">
                {t("Сотрудник")}
                <select
                  value={draft.employeeId}
                  onChange={(event) => setDraft((value) => ({ ...value, employeeId: event.target.value }))}
                  className={fieldClass}
                >
                  <option value="">{t("Не указано")}</option>
                  {sortedEmployees.map((employee) => (
                    <option key={employee.id} value={String(employee.id)} disabled={linkedElsewhere(employee.id)} data-no-translate>
                      {employeeLabel(employee)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[12px] text-slate-400">
                {t("Пользователь, привязанный к сотруднику, не сможет войти, пока сотрудник удален или у него отключен доступ к системе.")}
              </p>
              <label className="block border-b border-[#d5dae1] pb-[4px] text-[10px] font-semibold">
                {isNew ? t("Пароль") : t("Новый пароль")} {isNew && <span className="text-red-500">*</span>}
                <input
                  type="password"
                  value={draft.password}
                  onChange={(event) => setDraft((value) => ({ ...value, password: event.target.value }))}
                  minLength={PASSWORD_MIN}
                  className={fieldClass}
                  autoComplete="new-password"
                />
              </label>
              <p className="text-[12px] text-slate-400">
                {isNew
                  ? `${t("Не менее 8 символов; пароль не может состоять только из цифр.")} ${t("Этот пароль нужно будет сменить при первом входе.")}`
                  : t("Оставьте пустым, чтобы не менять. Новый пароль нужно будет сменить при следующем входе.")}
              </p>
              {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
            </div>
            <footer className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#e8ebf0] pr-[10px]">
              <button
                type="submit"
                disabled={saving}
                className="h-9 min-w-[111px] rounded-[3px] bg-[#71ce87] px-[16px] text-[12px] font-bold uppercase text-white hover:brightness-95 disabled:opacity-60"
              >
                {saving ? t("Сохранение...") : t("Сохранить")}
              </button>
            </footer>
          </form>
        </div>
      )}
    </section>
  )
}
