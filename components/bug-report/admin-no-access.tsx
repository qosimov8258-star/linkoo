import { getServerT } from "@/lib/i18n/server"

/** What a signed-in user without the admin role sees on the «Xato xabarlari» pages: the refusal, no data. */
export async function BugReportsNoAccess() {
  const t = await getServerT()
  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#f2f5f8] px-4 pt-16 font-sans text-[13px] text-[#333]">
      <div className="mx-auto max-w-[480px] bg-white px-6 py-10 text-center shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <svg viewBox="0 0 24 24" aria-hidden className="mx-auto mb-3 h-10 w-10 fill-[#5d6474]">
          <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
        </svg>
        <p className="text-[15px] font-semibold">{t("У вас нет прав на это действие")}</p>
      </div>
    </main>
  )
}
