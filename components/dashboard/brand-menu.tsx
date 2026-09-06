"use client"

import { Check, ChevronRight, FileText, Plus, ShoppingBasket, Truck } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

export type WorkspaceId = "distribution" | "store" | "edo"

export type CustomServer = {
  id: string
  name: string
}

const workspaces: { id: WorkspaceId; label: string; icon: typeof Truck; iconClass: string }[] = [
  { id: "distribution", label: "Управление дистрибуцией", icon: Truck, iconClass: "text-[#4f70e7]" },
  { id: "store", label: "Управление магазином", icon: ShoppingBasket, iconClass: "text-[#e0952e]" },
  { id: "edo", label: "ЭДО & ЭДИ", icon: FileText, iconClass: "text-[#586174]" },
]

interface BrandMenuProps {
  selected: string
  customServers: CustomServer[]
  onSelect: (id: WorkspaceId) => void
  onSelectServer: (id: string) => void
  onCreateServer: () => void
}

export function BrandMenu({ selected, customServers, onSelect, onSelectServer, onCreateServer }: BrandMenuProps) {
  const { t } = useLanguage()
  return (
    <div className="absolute left-2 top-full z-50 w-[320px] rounded-lg bg-white p-3 text-foreground shadow-2xl">
      <ul className="space-y-2">
        {workspaces.map((workspace) => {
          const isSelected = workspace.id === selected
          const Icon = workspace.icon
          return (
            <li key={workspace.id}>
              <button
                type="button"
                onClick={() => onSelect(workspace.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-[15px] font-semibold transition-colors ${
                  isSelected
                    ? "border-[#4f70e7] bg-[#eef2ff] text-[#17233b]"
                    : "border-transparent text-[#17233b] hover:bg-slate-50"
                }`}
              >
                <Icon className={`h-5 w-5 shrink-0 ${workspace.iconClass}`} />
                <span className="flex-1">{t(workspace.label)}</span>
                {isSelected ? (
                  <Check className="h-5 w-5 shrink-0 text-[#4f70e7]" />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                )}
              </button>
            </li>
          )
        })}

        {customServers.map((server) => {
          const isSelected = server.id === selected
          return (
            <li key={server.id}>
              <button
                type="button"
                onClick={() => onSelectServer(server.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-[15px] font-semibold transition-colors ${
                  isSelected
                    ? "border-[#4f70e7] bg-[#eef2ff] text-[#17233b]"
                    : "border-transparent text-[#17233b] hover:bg-slate-50"
                }`}
              >
                <Truck className="h-5 w-5 shrink-0 text-[#3aa76d]" />
                <span className="flex-1 truncate">{server.name}</span>
                {isSelected ? (
                  <Check className="h-5 w-5 shrink-0 text-[#4f70e7]" />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={onCreateServer}
          className="flex w-full items-center gap-3 rounded-lg border border-[#4f70e7] px-4 py-3 text-left text-[15px] font-semibold text-[#4f70e7] transition-colors hover:bg-[#eef2ff]"
        >
          <Plus className="h-5 w-5 shrink-0" />
          <span className="flex-1">{t("Создать сервер")}</span>
          <ChevronRight className="h-5 w-5 shrink-0" />
        </button>
      </div>
    </div>
  )
}
