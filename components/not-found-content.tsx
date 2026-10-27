import Link from "next/link"

import { getServerT } from "@/lib/i18n/server"

/**
 * The localized "page not found" screen (server component). app/not-found.tsx shows it for unmatched
 * URLs, and the /analytics/<slug> and /clients/<slug> pages render it themselves for a slug that is
 * not in their catalog: a notFound() thrown while a page renders gives only Next's bare error shell
 * (<html id="__next_error__">, empty body) in the server HTML.
 */
export async function NotFoundContent() {
  const t = await getServerT()
  return (
    <main className="flex min-h-[calc(100vh-50px)] flex-col items-center justify-center bg-[#f2f5f8] px-4 pb-16 text-center font-sans text-[#333]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/robot-empty.png" alt="" className="w-[157px]" />
      <p className="mt-4 text-[44px] font-bold leading-none text-[#5d6474]">404</p>
      <h1 className="mt-3 text-[20px] font-bold text-[#333]">{t("Страница не найдена")}</h1>
      <p className="mt-2 max-w-[420px] text-[13px] text-[#666]">{t("Такой страницы нет. Проверьте адрес или откройте нужный раздел через меню.")}</p>
      <Link href="/" className="mt-6 rounded-[3px] bg-[#4f71dc] px-5 py-2 text-[13px] font-semibold text-white hover:brightness-95">
        {t("На главную")}
      </Link>
    </main>
  )
}

/** Metadata of that screen: the localized title, and never indexed. */
export async function notFoundMetadata() {
  const t = await getServerT()
  return { title: `${t("Страница не найдена")} — Linko`, robots: { index: false, follow: false } }
}
