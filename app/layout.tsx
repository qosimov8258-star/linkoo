import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { TopNav } from '@/components/dashboard/top-nav'
import { BrandCornerLogo } from '@/components/dashboard/brand-corner-logo'
import { getServerLanguage } from '@/lib/i18n/server'
import { ConfirmHost } from '@/components/ref/confirm-host'
import { AlertHost } from '@/components/ref/alert-host'
import { TableFitter } from '@/components/ref/table-fitter'
import { TableSorter } from '@/components/ref/table-sorter'
import { TitleTooltips } from '@/components/ref/title-tooltips'
import { DomTranslator } from '@/lib/i18n/dom-translator'
import { LanguageProvider } from '@/lib/i18n/language-context'
import './globals.css'

export const metadata: Metadata = {
  title: 'Linko — Дистрибуция',
  description: 'Панель управления дистрибуцией Linko',
  generator: 'v0.app',
  icons: {
    icon: '/icon.svg',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: 'white',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const language = await getServerLanguage()

  return (
    <html lang={language} className="bg-background">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700&subset=cyrillic,latin&display=swap"
        />
      </head>
      <body className="font-sans">
        <LanguageProvider initialLanguage={language}>
          <div className="min-h-screen bg-[#f2f5f8]">
            <TopNav />
            {children}
            <BrandCornerLogo />
          </div>
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
