import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { TopNav } from '@/components/dashboard/top-nav'
import { BrandCornerLogo } from '@/components/dashboard/brand-corner-logo'
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru" className="bg-background">
      <body className="font-sans antialiased">
        <div className="min-h-screen bg-slate-100">
          <TopNav />
          {children}
          <BrandCornerLogo />
        </div>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
