"use client"

import { Suspense, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Eye, EyeOff, ShieldAlert, X } from "lucide-react"

import { LoginIllustration } from "@/components/login-illustration"

function formatPhoneDisplay(digits: string) {
  if (digits.length <= 2) return digits
  if (digits.length <= 5) return `${digits.slice(0, 2)} ${digits.slice(2)}`
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)}-${digits.slice(5, 9)}`
}

function InfoModal({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-full max-w-sm rounded-lg bg-white p-6 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Закрыть"><X className="h-5 w-5 text-slate-500" /></button>
        </div>
        <p className="text-sm leading-6 text-slate-600">
          Эта функция недоступна в демо-версии. Обратитесь к администратору системы.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-md bg-[#4f70e7] py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Понятно
        </button>
      </div>
    </div>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [authTab, setAuthTab] = useState<"phone" | "ecp">("phone")
  const [phoneDigits, setPhoneDigits] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [infoModal, setInfoModal] = useState<string | null>(null)

  const phoneValid = phoneDigits.length === 9
  const canSubmit = phoneValid && password.length > 0 && !submitting

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setError("")
    setSubmitting(true)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: `998${phoneDigits}`, password, remember }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || "Не удалось войти")
        return
      }
      const from = searchParams.get("from")
      router.push(from && from.startsWith("/") ? from : "/")
      router.refresh()
    } catch {
      setError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="mb-8 flex overflow-hidden rounded-md border border-slate-200">
        {(
          [
            ["phone", "Вход с телефоном"],
            ["ecp", "Вход через ЭЦП"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setAuthTab(key)}
            className={`flex-1 border-b-2 px-4 py-3 text-[15px] font-semibold transition-colors ${
              authTab === key ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {authTab === "ecp" ? (
        <div className="flex flex-col items-center gap-4 rounded-md border border-dashed border-slate-300 px-6 py-10 text-center">
          <ShieldAlert className="h-10 w-10 text-slate-400" />
          <p className="text-sm text-slate-500">Вход через ЭЦП временно недоступен в этой версии.</p>
          <button type="button" onClick={() => setAuthTab("phone")} className="text-sm font-semibold text-[#4f70e7] hover:underline">
            Вернуться к входу по телефону
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-[15px] text-slate-800">
              <span className="text-red-500">*</span> Телефон
            </span>
            <div className="flex overflow-hidden rounded-md border border-slate-300 focus-within:border-[#4f70e7]">
              <span className="flex items-center bg-slate-50 px-3 text-[15px] text-slate-500">+998</span>
              <input
                autoFocus
                inputMode="numeric"
                value={formatPhoneDisplay(phoneDigits)}
                onChange={(event) => setPhoneDigits(event.target.value.replace(/\D/g, "").slice(0, 9))}
                placeholder="XX XXX-XXXX"
                className="w-full px-3 py-2.5 text-[15px] outline-none"
                autoComplete="tel-national"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[15px] text-slate-800">
              <span className="text-red-500">*</span> Пароль
            </span>
            <div className="flex items-center rounded-md border border-slate-300 px-3 focus-within:border-[#4f70e7]">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Введите пароль"
                className="w-full py-2.5 text-[15px] outline-none"
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                className="shrink-0 text-slate-400 hover:text-slate-600"
              >
                {showPassword ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
              </button>
            </div>
          </label>

          <label className="flex items-center gap-2 text-[15px] text-slate-700">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-4 w-4 accent-[#4f70e7]"
            />
            Запомнить аккаунт
          </label>

          {error && <p className="text-sm font-medium text-rose-600">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className={`w-full rounded-md py-3 font-semibold text-white transition-colors ${
              canSubmit ? "bg-[#4f70e7] hover:opacity-90" : "cursor-not-allowed bg-[#c7d2f7]"
            }`}
          >
            {submitting ? "Вход..." : "Войти"}
          </button>
        </form>
      )}

      <div className="mt-6 space-y-2 text-center text-[15px]">
        <p className="text-slate-600">
          Нет доступа?{" "}
          <button type="button" onClick={() => setInfoModal("Регистрация")} className="font-semibold text-[#4f70e7] hover:underline">
            Регистрация
          </button>
        </p>
        <button type="button" onClick={() => setInfoModal("Восстановление пароля")} className="font-semibold text-[#4f70e7] hover:underline">
          Забыли пароль?
        </button>
      </div>

      {infoModal && <InfoModal title={infoModal} onClose={() => setInfoModal(null)} />}
    </>
  )
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen">
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-1/2 lg:px-20">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-10 inline-flex flex-col items-start">
            <span className="h-3 w-16 rounded-t-full border-t-[5px] border-[#4f37c8]" />
            <span className="-mt-px text-4xl font-extrabold tracking-tight text-[#1c2758]">
              l<span className="text-[#4f70e7]">i</span>nko
            </span>
          </div>

          <h1 className="text-3xl font-extrabold text-slate-900 sm:text-[34px]">Войти в систему</h1>
          <p className="mt-3 text-[15px] leading-6 text-slate-500">
            Выберите тип авторизации и заполните данные для входа в аккаунт
          </p>

          <div className="mt-8">
            <Suspense fallback={<div className="h-96" />}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>

      <div className="relative hidden lg:block lg:w-1/2">
        <div className="absolute right-6 top-6 z-10 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 shadow-md">
          RU
        </div>
        <LoginIllustration />
      </div>
    </main>
  )
}
