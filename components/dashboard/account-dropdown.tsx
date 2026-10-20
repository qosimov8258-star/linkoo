"use client"

import { KeyRound, LogOut, Plus, X } from "lucide-react"
import { useState, type FormEvent } from "react"

import { PASSWORD_MIN, passwordProblem } from "@/lib/auth-policy"
import { useLanguage } from "@/lib/i18n/language-context"

export type AccountUser = { displayName: string; username: string; role: "admin" | "manager" | "viewer" }

export const ROLE_LABELS: Record<AccountUser["role"], string> = {
  admin: "Администратор",
  manager: "Менеджер",
  viewer: "Только просмотр",
}

interface AccountDropdownProps {
  user: AccountUser | null
  signingOut: boolean
  onSignOut: () => void
  onAddAccount: () => void
  onChangePassword: () => void
}

// The account menu: who is signed in, the server this browser talks to, and the
// account actions. (The demo's hard-coded branch picker is gone: data is not
// scoped by branch, so picking one changed nothing but the label.)
export function AccountDropdown({ user, signingOut, onSignOut, onAddAccount, onChangePassword }: AccountDropdownProps) {
  const { t } = useLanguage()
  // Rendered only after a click (never on the server), so window is available.
  const [host] = useState(() => (typeof window === "undefined" ? "" : window.location.host))

  return (
    <div className="absolute right-0 top-full z-50 w-[254px] rounded-b-[5px] bg-white font-sans text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      {user && (
        <div className="border-b border-[#efefef] px-[15px] py-[12px]">
          <p className="truncate text-[14px] font-semibold text-[#1c1d21]">{user.displayName}</p>
          <p className="truncate text-[12px] text-[#4a5568]" data-no-translate>
            {user.username}
          </p>
          <p className="mt-1 text-[12px] text-[#4a5568]">{t(ROLE_LABELS[user.role])}</p>
        </div>
      )}

      <div className="border-b border-[#efefef] px-[15px] py-[14px] text-[14px] text-[#4a5568]">
        {t("Сервер")}: <span data-no-translate>{host}</span>
      </div>

      <div className="border-b border-[#efefef] px-[15px] py-[12px]">
        <button type="button" onClick={onChangePassword} className="flex items-center gap-2 text-[14px] font-semibold text-[#1c1d21] hover:opacity-80">
          <KeyRound className="h-5 w-5" />
          {t("Сменить пароль")}
        </button>
      </div>

      <div className="border-b border-[#efefef] px-[15px] py-[14px]">
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="flex items-center gap-2 text-[14px] font-semibold text-[#e5000f] hover:opacity-80 disabled:opacity-50"
        >
          <LogOut className="h-5 w-5" />
          {t("Выйти")}
        </button>
      </div>

      <div className="px-[20px] pb-[10px] pt-[10px]">
        <button
          type="button"
          onClick={onAddAccount}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-[5px] border border-[#e0e0e0] text-[14px] font-semibold text-[#333] hover:bg-[#f5f7ff]"
        >
          <Plus className="h-5 w-5" />
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
