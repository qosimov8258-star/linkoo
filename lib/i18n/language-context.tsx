"use client"

import { useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

import { translate } from "./translate"
import { LANGUAGE_COOKIE, type LanguageCode } from "./types"

interface LanguageContextValue {
  language: LanguageCode
  setLanguage: (lang: LanguageCode) => void
  t: (text: string) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({
  initialLanguage,
  children,
}: {
  initialLanguage: LanguageCode
  children: ReactNode
}) {
  const [language, setLanguageState] = useState<LanguageCode>(initialLanguage)
  const router = useRouter()

  const setLanguage = useCallback(
    (lang: LanguageCode) => {
      setLanguageState(lang)
      document.cookie = `${LANGUAGE_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`
      // Server components (page.tsx files that read the language cookie
      // directly) only pick up the new value after the router refreshes.
      router.refresh()
    },
    [router],
  )

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (text: string) => translate(language, text),
    }),
    [language, setLanguage],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider")
  return ctx
}
