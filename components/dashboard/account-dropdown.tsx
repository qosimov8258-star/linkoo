"use client"

import { useEffect, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

const ALL_BRANCHES = "Все филиалы"

interface AccountDropdownProps {
  selected: string
  onSelect: (branch: string, id?: number) => void
  onSignOut: () => void
  onAddAccount: () => void
}

/** The signed-in employee's branches in id order (the reference's `user.branch`); every branch when the login has none. */
function useBranchNames() {
  const [names, setNames] = useState<{ id: number; name: string }[]>([])
  useEffect(() => {
    let cancelled = false
    const sorted = (rows: { id: number; name: string }[]) => rows.slice().sort((a, b) => a.id - b.id).map((row) => ({ id: row.id, name: row.name }))
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response): Promise<{ branches?: { id: number; name: string }[] }> => (response.ok ? response.json() : Promise.resolve({})))
      .then(async (me) => {
        const own = me.branches
        if (own && own.length) return sorted(own)
        const response = await fetch("/api/branches", { cache: "no-store" })
        return response.ok ? sorted((await response.json()) as { id: number; name: string }[]) : []
      })
      .then((list) => {
        if (!cancelled) setNames(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return names
}

export function AccountDropdown({ selected, onSelect, onSignOut, onAddAccount }: AccountDropdownProps) {
  const { t } = useLanguage()
  const branches = useBranchNames()
  return (
    <div className="absolute right-0 top-full z-50 w-[254px] overflow-hidden rounded-[8px] bg-white font-sans text-[13px] text-[#333] shadow-[0_4px_6px_-2px_rgba(16,24,40,0.08),0_12px_16px_-4px_rgba(16,24,40,0.08)]">
      <div className="h-[300px] overflow-y-auto p-[4px]">
        {[{ id: 0, name: ALL_BRANCHES }, ...branches].map(({ id, name: branch }, index) => (
          <button
            key={`${branch}-${index}`}
            type="button"
            onClick={() => onSelect(branch, id || undefined)}
            className={`mb-[4px] flex h-[43.5px] w-full items-center rounded-[8px] border border-[#eaecf0] p-[12px] text-left text-[14px] font-semibold text-[#1c1d21] ${branch === selected ? "bg-[#e0eaff]" : "bg-white hover:bg-[#f5f7ff]"}`}
          >
            <span className="truncate">{t(branch)}</span>
          </button>
        ))}
      </div>
      <div className="h-[8px]" />

      <div className="border-t border-[#eaecf0] px-[16px] py-[14px] text-[14px] font-medium leading-[17.5px] text-[#344054]">
        {t("Сервер")}: time3
      </div>

      <div className="border-t border-[#eaecf0] px-[16px] py-[14px]">
        <button type="button" onClick={onSignOut} className="flex items-center text-[14px] font-medium leading-[20px] text-[#f00]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nav/logout-red.svg" alt="" className="mr-[8px] h-5 w-5" />
          {t("Выйти")}
        </button>
      </div>

      <div className="border-t border-[#eaecf0] bg-[#f9fafb] px-[16px] py-[14px]">
        <button type="button" onClick={onAddAccount} className="mx-auto flex h-[38px] w-[212px] items-center justify-center rounded-[8px] border border-[#d0d5dd] bg-white text-[14px] font-semibold text-[#344054] hover:bg-[#f5f7ff]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nav/plus-dark.svg" alt="" className="mr-[8px] h-5 w-5" />
          {t("Добавить аккаунт")}
        </button>
      </div>
    </div>
  )
}
