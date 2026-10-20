"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Phone, Send, X } from "lucide-react"

import { LoginIllustration } from "@/components/login-illustration"
import { PASSWORD_MIN, passwordProblem } from "@/lib/auth-policy"
import { useLanguage } from "@/lib/i18n/language-context"

import { safeRedirectPath } from "./safe-redirect"

const SAVED_SERVERS_KEY = "linko_saved_servers"

type SavedServer = { login: string; server: string }

function loadSavedServers(): SavedServer[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(SAVED_SERVERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is SavedServer =>
        entry && typeof entry.login === "string" && typeof entry.server === "string",
    )
  } catch {
    return []
  }
}

function saveSavedServers(servers: SavedServer[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(SAVED_SERVERS_KEY, JSON.stringify(servers))
}

function InfoModal({ title, onClose }: { title: string; onClose: () => void }) {
  const { t } = useLanguage()
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{t(title)}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-5 w-5 text-slate-500" /></button>
        </div>
        <p className="text-sm leading-6 text-slate-600">
          {t("Эта функция недоступна в демо-версии. Обратитесь к администратору системы.")}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-md bg-[#4f71dc] py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          {t("Понятно")}
        </button>
      </div>
    </div>
  )
}

const INPUT_CLASS =
  "h-10 w-full rounded-[8px] border border-[#D0D5DD] px-3.5 text-base leading-[normal] text-[#1D2939] outline-none placeholder:text-[#667085] focus:border-[#444CE7] focus:shadow-[0_1px_2px_0_rgba(16,24,40,0.05)]"

/** Shown right after signing in with a password that must be replaced (set by
 * an administrator, the first seeded password, or one weaker than the policy). */
function ChangePasswordForm({ currentPassword: knownCurrent, username, target }: { currentPassword: string; username: string; target: string }) {
  const { t } = useLanguage()
  const [currentPassword, setCurrentPassword] = useState(knownCurrent)
  const [newPassword, setNewPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError("")
    const problem = passwordProblem(newPassword, username)
    if (problem) return setError(t(problem))
    if (newPassword !== confirm) return setError(t("Пароли не совпадают"))
    setSubmitting(true)
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
      window.location.assign(target)
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <p className="rounded-md bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-800">
        {t("Для продолжения работы задайте новый пароль.")} {t("Не менее 8 символов; пароль не может состоять только из цифр.")}
      </p>
      {!knownCurrent && (
        <label className="block">
          <span className="mb-2 block text-sm font-medium leading-[17.5px] text-black">
            {t("Текущий пароль")} <span className="text-red-500">*</span>
          </span>
          <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required className={INPUT_CLASS} autoComplete="current-password" />
        </label>
      )}
      <label className="block">
        <span className="mb-2 block text-sm font-medium leading-[17.5px] text-black">
          {t("Новый пароль")} <span className="text-red-500">*</span>
        </span>
        <input
          type="password"
          autoFocus
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          minLength={PASSWORD_MIN}
          className={INPUT_CLASS}
          autoComplete="new-password"
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-sm font-medium leading-[17.5px] text-black">
          {t("Повторите новый пароль")} <span className="text-red-500">*</span>
        </span>
        <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required className={INPUT_CLASS} autoComplete="new-password" />
      </label>
      {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="flex h-12 w-full items-center justify-center rounded-[5px] bg-[#4243FF] px-5 text-base font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {submitting ? t("Сохранение...") : t("Сменить пароль")}
      </button>
    </form>
  )
}

type LoginScreenProps = {
  /** "add" (Добавить аккаунт) signs in another account without leaving the current one first. */
  mode?: "login" | "add"
  /** Post-sign-in path requested by the link (validated again before use). */
  from?: string
  /** "session": the previous session ended (revoked, expired or signed out elsewhere). */
  reason?: string
  /** Already signed in but the password must be changed first. */
  mustChangeFor?: string
}

function LoginForm({ from, reason, mustChangeFor }: LoginScreenProps) {
  const { t } = useLanguage()
  const target = safeRedirectPath(from)
  const [changeFor, setChangeFor] = useState<{ username: string; currentPassword: string } | null>(
    mustChangeFor ? { username: mustChangeFor, currentPassword: "" } : null,
  )
  const [server, setServer] = useState("time3")
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [infoModal, setInfoModal] = useState<string | null>(null)
  const [savedServers, setSavedServers] = useState<SavedServer[]>([])

  useEffect(() => {
    setSavedServers(loadSavedServers())
  }, [])

  const canSubmit = server.trim().length > 0 && login.trim().length > 0 && password.length > 0 && !submitting

  function selectSavedServer(entry: SavedServer) {
    setServer(entry.server)
    setLogin(entry.login)
    setError("")
  }

  function removeSavedServer(entry: SavedServer) {
    setSavedServers((current) => {
      const next = current.filter((item) => !(item.login === entry.login && item.server === entry.server))
      saveSavedServers(next)
      return next
    })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setError("")
    setSubmitting(true)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: login.trim(), password, remember }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error ? t(data.error) : t("Не удалось войти"))
        return
      }
      const data = (await response.json().catch(() => ({}))) as { username?: string; mustChangePassword?: boolean }

      const entry: SavedServer = { login: login.trim(), server: server.trim() }
      const next = [entry, ...savedServers.filter((item) => !(item.login === entry.login && item.server === entry.server))]
      saveSavedServers(next)
      setSavedServers(next)

      if (data.mustChangePassword) {
        setChangeFor({ username: data.username ?? login.trim(), currentPassword: password })
        setPassword("")
        return
      }
      // A full page load, so nothing from the previous account's screens survives.
      window.location.assign(target)
    } catch {
      setError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSubmitting(false)
    }
  }

  if (changeFor) {
    return <ChangePasswordForm currentPassword={changeFor.currentPassword} username={changeFor.username} target={target} />
  }

  return (
    <>
      {reason === "session" && (
        <p className="mb-6 rounded-md bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-800">{t("Ваша сессия завершена. Войдите снова.")}</p>
      )}
      {savedServers.length > 0 && (
        <div className="mb-6">
          <span className="mb-2 block text-[15px] text-slate-800">{t("Сохранённые серверы")}</span>
          <div className="flex flex-wrap gap-3">
            {savedServers.map((entry) => (
              <div
                key={`${entry.login}@${entry.server}`}
                className="relative flex w-[190px] items-start justify-between rounded-md border border-slate-200 px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() => selectSavedServer(entry)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-[15px] font-semibold text-slate-800">{entry.login}</span>
                  <span className="block truncate text-[13px] text-slate-500">{entry.server}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeSavedServer(entry)}
                  aria-label={t("Удалить сохранённый сервер")}
                  className="shrink-0 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-medium leading-[17.5px] text-black">
            {t("Сервер")} <span className="text-red-500">*</span>
          </span>
          <input
            value={server}
            onChange={(event) => setServer(event.target.value)}
            placeholder={t("Введите")}
            required
            className="h-10 w-full rounded-[8px] border border-[#D0D5DD] px-3.5 text-base leading-[normal] text-[#1D2939] outline-none placeholder:text-[#667085] focus:border-[#444CE7] focus:shadow-[0_1px_2px_0_rgba(16,24,40,0.05)]"
            autoComplete="off"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium leading-[17.5px] text-black">
            {t("Логин")} <span className="text-red-500">*</span>
          </span>
          <input
            autoFocus
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            placeholder={t("Введите")}
            required
            className="h-10 w-full rounded-[8px] border border-[#D0D5DD] px-3.5 text-base leading-[normal] text-[#1D2939] outline-none placeholder:text-[#667085] focus:border-[#444CE7] focus:shadow-[0_1px_2px_0_rgba(16,24,40,0.05)]"
            autoComplete="username"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium leading-[17.5px] text-black">
            {t("Пароль")} <span className="text-red-500">*</span>
          </span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("Введите")}
            required
            className="h-10 w-full rounded-[8px] border border-[#D0D5DD] px-3.5 text-base leading-[normal] text-[#1D2939] outline-none placeholder:text-[#667085] focus:border-[#444CE7] focus:shadow-[0_1px_2px_0_rgba(16,24,40,0.05)]"
            autoComplete="current-password"
          />
        </label>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-4 text-[13px] text-[#333333]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-5 w-5 accent-[#333333]"
            />
            {t("Запомнить меня")}
          </label>
          <button
            type="button"
            onClick={() => setInfoModal(t("Восстановление пароля"))}
            className="text-[13px] font-semibold text-[#3538CD] hover:underline"
          >
            {t("Забыли пароль?")}
          </button>
        </div>

        {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="flex h-12 w-full items-center justify-center rounded-[5px] bg-[#4243FF] px-5 text-base font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? t("Вход...") : t("Войти")}
        </button>
      </form>

      <div className="mt-[25px] text-center text-[13px]">
        <p className="text-[#475467]">
          {t("У вас нет доступа?")}{" "}
          <button type="button" onClick={() => setInfoModal(t("Регистрация"))} className="font-semibold text-[#3538CD] hover:underline">
            {t("Регистрация")}
          </button>
        </p>
      </div>

      {infoModal && <InfoModal title={infoModal} onClose={() => setInfoModal(null)} />}
    </>
  )
}

export function LoginScreen(props: LoginScreenProps) {
  const { t } = useLanguage()
  return (
    <main className="flex min-h-screen">
      <div className="flex w-full flex-col lg:w-1/2">
        <div className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-12 lg:px-0">
          <div className="mx-auto w-full max-w-[500px]">
            <div className="inline-flex flex-col items-start">
              <span className="h-3 w-16 rounded-t-full border-t-[5px] border-[#4f37c8]" />
              <span className="-mt-px text-4xl font-extrabold tracking-tight text-[#1c2758]">
                l<span className="text-[#4f71dc]">i</span>nko
              </span>
            </div>

            <h1 className="mt-[60px] mb-3 text-[36px] font-bold leading-[44px] text-[#333333]">{t("Войти в систему")}</h1>
            <p className="text-base leading-5 text-[#475467]">
              {t("Выберите тип авторизации и заполните данные для входа в аккаунт")}
            </p>

            <div className="mt-8">
              <LoginForm {...props} />
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-between bg-[#F3F4F6] px-8 py-6">
          <a
            href="https://t.me/Linko_tech_support"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-[13px] text-[#129FDD] underline"
          >
            <Send className="h-4 w-4" />
            {t("Онлайн поддержка")}
          </a>
          <div className="flex items-center gap-2 text-sm text-[#475467] underline">
            <Phone className="h-4 w-4" />
            +998 78 555-55-25
          </div>
        </footer>
      </div>

      <div className="relative hidden lg:block lg:w-1/2">
        <LoginIllustration />
      </div>
    </main>
  )
}
