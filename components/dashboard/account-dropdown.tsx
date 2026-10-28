"use client"

import { KeyRound, X } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"

import { PASSWORD_MIN, passwordProblem } from "@/lib/auth-policy"
import { useLanguage } from "@/lib/i18n/language-context"

const ALL_BRANCHES = "Все филиалы"


/** The signed-in employee's branches in id order (the reference's `user.branch`); every branch when the login has none. */
function useBranchNames() {
  const [names, setNames] = useState<{ id: number; name: string }[]>([])
  useEffect(() => {
    let cancelled = false
    const sorted = (rows: { id: number; name: string }[]) => rows.slice().sort((a, b) => a.id - b.id).map((row) => ({ id: row.id, name: row.name }))
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response): Promise<{ branches?: { id: number; name: string }[] }> => (response.ok ? response.json() : Promise.resolve({})))
      .then(async (me) => {
        const own = me.branches
        if (own && own.length) return sorted(own)
        const response = await fetch("/api/branches", { cache: "no-store" })
        return response.ok ? sorted((await response.json()) as { id: number; name: string }[]) : []
      })
      .then((list) => {
        if (!cancelled) setNames(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return names
}

export type AccountUser = { displayName: string; username: string; role: "admin" | "manager" | "viewer" }

export const ROLE_LABELS: Record<AccountUser["role"], string> = {
  admin: "Администратор",
  manager: "Менеджер",
  viewer: "Только просмотр",
}

interface AccountDropdownProps {
  selected: string
  onSelect: (branch: string, id?: number) => void
  /** The signed-in user (shown in the top bar, not repeated here). */
  user?: AccountUser | null
  signingOut?: boolean
  onSignOut: () => void
  onAddAccount: () => void
  onChangePassword?: () => void
}

export function AccountDropdown({ selected, onSelect, signingOut = false, onSignOut, onAddAccount, onChangePassword }: AccountDropdownProps) {
  const { t } = useLanguage()
  const branches = useBranchNames()
  // Rendered only after a click (never on the server), so window is available.
  const [host] = useState(() => (typeof window === "undefined" ? "" : window.location.host))
  return (
    <div className="absolute right-0 top-full z-50 w-[254px] overflow-hidden rounded-[8px] bg-white font-sans text-[13px] text-[#333] shadow-[0_4px_6px_-2px_rgba(16,24,40,0.08),0_12px_16px_-4px_rgba(16,24,40,0.08)]">
      <div className="h-[300px] overflow-y-auto p-[4px]">
        {[{ id: 0, name: ALL_BRANCHES }, ...branches].map(({ id, name: branch }, index) => (
          <button
            key={`${branch}-${index}`}
            type="button"
            onClick={() => onSelect(branch, id || undefined)}
            className={`mb-[4px] flex h-[43.5px] w-full items-center rounded-[8px] border border-[#eaecf0] p-[12px] text-left text-[14px] font-semibold text-[#1c1d21] ${branch === selected ? "bg-[#e0eaff]" : "bg-white hover:bg-[#f5f7ff]"}`}
          >
            <span className="truncate">{t(branch)}</span>
          </button>
        ))}
      </div>
      <div className="h-[8px]" />

      <div className="border-t border-[#eaecf0] px-[16px] py-[14px] text-[14px] font-medium leading-[17.5px] text-[#344054]">
        {t("Сервер")}: <span data-no-translate>{host}</span>
      </div>

      {onChangePassword && (
        <div className="border-t border-[#eaecf0] px-[16px] py-[14px]">
          <button type="button" onClick={onChangePassword} className="flex items-center text-[14px] font-medium leading-[20px] text-[#344054] hover:opacity-80">
            <KeyRound className="mr-[8px] h-5 w-5" />
            {t("Сменить пароль")}
          </button>
        </div>
      )}

      <div className="border-t border-[#eaecf0] px-[16px] py-[14px]">
        <button type="button" onClick={onSignOut} disabled={signingOut} className="flex items-center text-[14px] font-medium leading-[20px] text-[#f00] disabled:opacity-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nav/logout-red.svg" alt="" className="mr-[8px] h-5 w-5" />
          {t("Выйти")}
        </button>
      </div>

      <div className="border-t border-[#eaecf0] bg-[#f9fafb] px-[16px] py-[14px]">
        <button type="button" onClick={onAddAccount} className="mx-auto flex h-[38px] w-[212px] items-center justify-center rounded-[8px] border border-[#d0d5dd] bg-white text-[14px] font-semibold text-[#344054] hover:bg-[#f5f7ff]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nav/plus-dark.svg" alt="" className="mr-[8px] h-5 w-5" />
          {t("Добавить аккаунт")}
        </button>
      </div>
    </div>
  )
}

/** "Сменить пароль": the signed-in user replaces their own password (other sessions are ended).
 * `required`: the account must change its password first — the dialog cannot be
 * dismissed (only "Выйти") until the change succeeded. */
export function ChangePasswordDialog({
  username,
  required = false,
  onChanged,
  onSignOut,
  onClose,
}: {
  username: string
  required?: boolean
  onChanged?: () => void
  onSignOut?: () => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    const problem = passwordProblem(newPassword, username)
    if (problem) return setError(t(problem))
    if (newPassword !== confirm) return setError(t("Пароли не совпадают"))
    setSaving(true)
    try {
      const response = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ? t(data.error) : t("Не удалось сменить пароль"))
        return
      }
      setDone(true)
      onChanged?.()
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  const inputClass = "mt-1 block w-full border-b border-slate-300 py-2 text-[15px] text-slate-800 outline-none focus:border-[#4f71dc]"
  const locked = required && !done

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={locked ? undefined : onClose}>
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="w-[440px] max-w-[92vw] rounded-md bg-white p-7 text-foreground shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{t("Сменить пароль")}</h2>
          {!locked && (
            <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
              <X className="h-5 w-5 text-slate-500" />
            </button>
          )}
        </div>
        {locked && (
          <p className="mb-4 rounded-md bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-800">{t("Для продолжения работы задайте новый пароль.")}</p>
        )}
        {done ? (
          <p className="mb-6 text-sm text-emerald-700">{t("Пароль изменен. Остальные сессии завершены.")}</p>
        ) : (
          <div className="mb-6 space-y-4 text-[13px] font-medium text-slate-500">
            <label className="block">
              {t("Текущий пароль")}
              <input type="password" autoFocus value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required className={inputClass} autoComplete="current-password" />
            </label>
            <label className="block">
              {t("Новый пароль")}
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                minLength={PASSWORD_MIN}
                className={inputClass}
                autoComplete="new-password"
              />
            </label>
            <label className="block">
              {t("Повторите новый пароль")}
              <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required className={inputClass} autoComplete="new-password" />
            </label>
            <p className="text-[12px] font-normal text-slate-400">{t("Не менее 8 символов; пароль не может состоять только из цифр.")}</p>
            {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
          </div>
        )}
        <div className="flex justify-end gap-3">
          {locked ? (
            onSignOut && (
              <button type="button" onClick={onSignOut} className="rounded-md border border-slate-200 px-5 py-2.5 font-semibold text-[#e5000f]">
                {t("Выйти")}
              </button>
            )
          ) : (
            <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-5 py-2.5 font-semibold text-slate-600">
              {done ? t("Закрыть") : t("Отмена")}
            </button>
          )}
          {!done && (
            <button type="submit" disabled={saving} className="rounded-md bg-[#4f71dc] px-5 py-2.5 font-semibold text-white disabled:opacity-60">
              {saving ? t("Сохранение...") : t("Сохранить")}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
