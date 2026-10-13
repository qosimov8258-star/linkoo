"use client"

import { Check, ChevronRight, FileText, Plus, ShoppingBasket, Truck } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

export type WorkspaceId = "distribution" | "store" | "edo"

export type CustomServer = {
  id: string
  name: string
}

const workspaces: { id: WorkspaceId; label: string; icon: typeof Truck; iconClass: string }[] = [
  { id: "distribution", label: "Управление дистрибуцией", icon: Truck, iconClass: "text-[#4f71dc]" },
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
    <div className="absolute left-0 top-full z-50 mt-[5px] w-[280px] rounded-[10px] bg-white p-2 font-sans text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.16),0_2px_10px_rgba(0,0,0,0.12)]">
      <ul className="space-y-1">
        {workspaces.map((workspace) => {
          const isSelected = workspace.id === selected
          const Icon = workspace.icon
          return (
            <li key={workspace.id}>
              <button
                type="button"
                onClick={() => onSelect(workspace.id)}
                className={`flex w-full items-center gap-3 rounded-[8px] border px-3 py-[13px] text-left text-[13px] font-normal transition-colors ${
                  isSelected
                    ? "border-[#4f71dc] bg-[#eef2ff] text-[#333]"
                    : "border-transparent text-[#333] hover:bg-slate-50"
                }`}
              >
                <Icon className={`h-6 w-6 shrink-0 ${workspace.iconClass}`} />
                <span className="flex-1 whitespace-nowrap">{t(workspace.label)}</span>
                {isSelected ? (
                  <Check className="h-5 w-5 shrink-0 text-[#4f71dc]" />
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
                className={`flex w-full items-center gap-3 rounded-[8px] border px-3 py-[13px] text-left text-[13px] font-normal transition-colors ${
                  isSelected
                    ? "border-[#4f71dc] bg-[#eef2ff] text-[#333]"
                    : "border-transparent text-[#333] hover:bg-slate-50"
                }`}
              >
                <Truck className="h-5 w-5 shrink-0 text-[#3aa76d]" />
                <span className="flex-1 truncate">{server.name}</span>
                {isSelected ? (
                  <Check className="h-5 w-5 shrink-0 text-[#4f71dc]" />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" />
                )}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="mt-2 border-t border-[#efefef] pt-2">
        <button
          type="button"
          onClick={onCreateServer}
          className="flex w-full items-center gap-3 rounded-[8px] border border-[#4f71dc] bg-[#eef2ff] px-3 py-[13px] text-left text-[13px] font-normal text-[#333] transition-colors hover:bg-[#e3eaff]"
        >
          <Plus className="h-5 w-5 shrink-0 text-[#4f71dc]" />
          <span className="flex-1">{t("Создать сервер")}</span>
          <ChevronRight className="h-5 w-5 shrink-0 text-[#4f71dc]" />
        </button>
      </div>
    </div>
  )
}
