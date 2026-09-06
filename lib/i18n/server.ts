import { cookies } from "next/headers"

import { translate } from "./translate"
import { DEFAULT_LANGUAGE, isLanguageCode, LANGUAGE_COOKIE, type LanguageCode } from "./types"

export async function getServerLanguage(): Promise<LanguageCode> {
  const store = await cookies()
  const value = store.get(LANGUAGE_COOKIE)?.value
  return isLanguageCode(value) ? value : DEFAULT_LANGUAGE
}

export async function getServerT() {
  const lang = await getServerLanguage()
  return (text: string) => translate(lang, text)
}
