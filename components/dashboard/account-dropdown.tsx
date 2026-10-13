"use client"

import { LogOut, Plus } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

const branches = ["Все филиалы", "Samarqand", "Buxoro", "777", "Bobomotors", "agent"]

interface AccountDropdownProps {
  selected: string
  onSelect: (branch: string) => void
  onSignOut: () => void
  onAddAccount: () => void
}

export function AccountDropdown({ selected, onSelect, onSignOut, onAddAccount }: AccountDropdownProps) {
  const { t } = useLanguage()
  return (
    <div className="absolute right-0 top-full z-50 w-[254px] rounded-b-[5px] bg-white font-sans text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <ul className="max-h-[310px] overflow-y-auto p-1">
        {branches.map((branch) => (
          <li key={branch} className="mb-[4px]">
            <button
              type="button"
              onClick={() => onSelect(branch)}
              className={`flex min-h-[43px] w-full items-center rounded-[5px] border border-[#eaecf0] px-3 text-left text-[14px] font-semibold text-[#1c1d21] transition-colors ${
                branch === selected ? "bg-[#e0eaff]" : "bg-white hover:bg-[#f5f7ff]"
              }`}
            >
              {t(branch)}
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t border-[#efefef] px-[15px] py-[14px] text-[14px] text-[#4a5568]">
        {t("Сервер")}: time3
      </div>

      <div className="border-t border-[#efefef] px-[15px] py-[14px]">
        <button type="button" onClick={onSignOut} className="flex items-center gap-2 text-[14px] font-semibold text-[#e5000f] hover:opacity-80">
          <LogOut className="h-5 w-5" />
          {t("Выйти")}
        </button>
      </div>

      <div className="px-[20px] pb-[10px] pt-[6px]">
        <button
          type="button"
          onClick={onAddAccount}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-[5px] border border-[#e0e0e0] text-[14px] font-semibold text-[#333] hover:bg-[#f5f7ff]"
        >
          <Plus className="h-5 w-5" />
          {t("Добавить аккаунт")}
        </button>
      </div>
    </div>
  )
}
