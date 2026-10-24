"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"
import { settingsNavGroups } from "@/lib/settings-nav"

export const catalogSidebarHrefs: string[] = settingsNavGroups.flatMap((group) => group.items.flatMap((item) => (item.href ? [item.href] : [])))

export function CatalogSidebar({ width = 225 }: { width?: number }) {
  const pathname = usePathname()
  const { t } = useLanguage()

  return (
    <aside style={{ width }} className="hidden shrink-0 bg-[#f2f5f8] pb-6 pt-[30px] text-[13px] text-[#333] lg:block">
      {settingsNavGroups.map((group) => (
        <ul key={group.title} className="mx-[30px] mb-[20px] leading-[16.25px]">
          <li className="font-bold">{t(group.title)}</li>
          {group.items.map((item, index) => {
            const active = item.href !== undefined && pathname === item.href
            const cls = `block px-[6px] py-px font-[Arial,sans-serif] leading-[15px] ${active ? "text-[#4f71dc]" : "text-[#333]"}`
            return (
              <li key={`${item.label}-${index}`} className="pl-[20px] pt-[10px] last:pb-[10px]">
                {item.href ? (
                  <Link href={item.href} className={`${cls} hover:text-[#4f71dc]`}>
                    {t(item.label)}
                  </Link>
                ) : (
                  <span className={cls}>{t(item.label)}</span>
                )}
              </li>
            )
          })}
        </ul>
      ))}
    </aside>
  )
}

export function CatalogPageLayout({ children, sidebarWidth }: { children: ReactNode; sidebarWidth?: number }) {
  return (
    <main className="min-h-[calc(100vh-50px)] bg-white">
      <div className="flex min-h-[calc(100vh-50px)]">
        <CatalogSidebar width={sidebarWidth} />
        {children}
      </div>
    </main>
  )
}
