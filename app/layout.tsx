import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { TopNav } from '@/components/dashboard/top-nav'
import { BrandCornerLogo } from '@/components/dashboard/brand-corner-logo'
import { getCurrentUser } from '@/lib/current-user'
import { getServerLanguage } from '@/lib/i18n/server'
import { ConfirmHost } from '@/components/ref/confirm-host'
import { AlertHost } from '@/components/ref/alert-host'
import { translate } from '@/lib/i18n/translate'
import { routeTitle } from '@/lib/route-titles'
import { SESSION_COOKIE, verifySession } from '@/lib/session'
import { SessionGuard } from '@/lib/session-guard'
import { TableFitter } from '@/components/ref/table-fitter'
import { TableSorter } from '@/components/ref/table-sorter'
import { TitleTooltips } from '@/components/ref/title-tooltips'
import { DomTranslator } from '@/lib/i18n/dom-translator'
import { LanguageProvider } from '@/lib/i18n/language-context'
import './globals.css'

// Set (and overwritten) by middleware.ts on every request it handles.
const PATH_HEADER = 'x-linko-path'
const URL_HEADER = 'x-linko-url'

const DEFAULT_TITLE = 'Linko — Дистрибуция'

// Titles are rendered on the server in the UI language: pages without metadata
// of their own get their menu name (lib/route-titles.ts) instead of the generic
// app title; pages that set a title override this.
export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage()
  const store = await headers()
  const key = routeTitle(store.get(PATH_HEADER) ?? '')
  return {
    title: key ? `${translate(language, key)} — Linko` : translate(language, DEFAULT_TITLE),
    description: translate(language, 'Панель управления дистрибуцией Linko'),
    generator: 'v0.app',
    icons: {
      icon: '/icon.svg',
    },
  }
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: 'white',
}

function isLoginPath(path: string) {
  return path === '/login' || path.startsWith('/login/')
}

/** A cookie whose token still verifies but whose session was revoked (signed
 * out elsewhere, "Завершить", password change) or whose user is gone: send the
 * browser to the login page instead of rendering an app full of zeros. */
async function redirectStaleSession() {
  const store = await headers()
  const path = store.get(PATH_HEADER)
  if (!path || isLoginPath(path)) return
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token || !(await verifySession(token))) return
  if (await getCurrentUser()) return
  const from = store.get(URL_HEADER) ?? path
  redirect(`/login?reason=session&from=${encodeURIComponent(from)}`)
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const language = await getServerLanguage()
  await redirectStaleSession()

  return (
    <html lang={language} className="bg-background">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600;700&subset=cyrillic,latin&display=swap"
        />
      </head>
      <body className="font-sans">
        <LanguageProvider initialLanguage={language}>
          <div className="min-h-screen bg-[#f2f5f8]">
            <TopNav />
            {children}
            <BrandCornerLogo />
          </div>
          <SessionGuard />
          <DomTranslator />
          <TableSorter />
          <TableFitter />
          <TitleTooltips />
          <ConfirmHost />
          <AlertHost />
        </LanguageProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
