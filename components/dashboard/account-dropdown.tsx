"use client"

import { LogOut, Plus } from "lucide-react"

const branches = ["Все филиалы", "Samarqand", "Buxoro", "777", "Bobomotors", "agent"]

interface AccountDropdownProps {
  selected: string
  onSelect: (branch: string) => void
  onSignOut: () => void
  onAddAccount: () => void
}

export function AccountDropdown({ selected, onSelect, onSignOut, onAddAccount }: AccountDropdownProps) {
  return (
    <div className="absolute right-2 top-full z-50 w-[360px] rounded-b-md bg-white text-foreground shadow-2xl">
      <ul className="max-h-[420px] overflow-y-auto py-1">
        {branches.map((branch, i) => (
          <li key={branch}>
            <button
              onClick={() => onSelect(branch)}
              className={`w-full px-6 py-4 text-left text-[15px] transition-colors ${
                branch === selected
                  ? "bg-slate-100 font-semibold text-slate-800"
                  : "font-medium text-slate-700 hover:bg-slate-50"
              }`}
            >
              {branch}
            </button>
            {i < branches.length - 1 && <div className="mx-4 border-b border-slate-100" />}
          </li>
        ))}
      </ul>

      <div className="border-t border-slate-100 px-6 py-4">
        <p className="text-[15px] text-slate-600">
          Сервер: <span className="font-medium">time3</span>
        </p>
      </div>

      <div className="border-t border-slate-100 px-6 py-4">
        <button
          type="button"
          onClick={onSignOut}
          className="flex items-center gap-2 text-[15px] font-semibold text-brand-red transition-opacity hover:opacity-80"
        >
          <LogOut className="h-5 w-5" />
          Выйти
        </button>
      </div>

      <div className="px-6 pb-5 pt-1">
        <button
          type="button"
          onClick={onAddAccount}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 py-3 text-[15px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Plus className="h-5 w-5" />
          Добавить аккаунт
        </button>
      </div>
    </div>
  )
}
