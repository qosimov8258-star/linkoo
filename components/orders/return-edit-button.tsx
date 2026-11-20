"use client"

import { useEffect, useState, type ReactNode } from "react"

import { RI, RefButton } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import type { ClientReturnRow } from "./returns-view"

// The return card's «Изменить» (Linko: shown with change_orderreturn; disabled for an accepted, cancelled or
// «со старой базы» return unless the user also has can_change_completed_return_product_price, here an
// administrator — the rule PUT /api/client-returns/[id] applies). A return without an order reads «Со старой базы
// нельзя изменять», as in Linko, even where it can be opened. ReturnEditGate applies the same rule to the form opened
// from the address (?openUpdateDialog=true).

type Access = { canEdit: boolean; canChangeCompleted: boolean }
type EditedRow = Pick<ClientReturnRow, "status" | "fromOrder" | "orderId">

let cached: Promise<Access> | null = null

function loadAccess(): Promise<Access> {
  cached ??= fetch("/api/auth/me", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((user: { role?: string; permissions?: string[] | null } | null) => {
      const role = user?.role ?? ""
      const manager = role === "admin" || (role === "manager" && (user?.permissions == null || user.permissions.includes("orders.manage")))
      return { canEdit: manager, canChangeCompleted: role === "admin" }
    })
    .catch(() => {
      cached = null
      return { canEdit: false, canChangeCompleted: false }
    })
  return cached
}

function useAccess(): Access | null {
  const [access, setAccess] = useState<Access | null>(null)
  useEffect(() => {
    let alive = true
    void loadAccess().then((value) => alive && setAccess(value))
    return () => {
      alive = false
    }
  }, [])
  return access
}

const isOldBase = (row: EditedRow) => !row.orderId && row.fromOrder === false
/** Whether the user may change this return (what enables «Изменить»). */
const editable = (row: EditedRow, access: Access) => access.canEdit && (access.canChangeCompleted || (row.status === "pending" && !isOldBase(row)))

export function ReturnEditButton({ row, disabled, onOpen }: { row: EditedRow; disabled?: boolean; onOpen: () => void }) {
  const { t } = useLanguage()
  const access = useAccess()
  if (!access?.canEdit) return null
  return <RefButton icon={RI.edit} label={isOldBase(row) ? t("Со старой базы нельзя изменять") : t("Изменить")} disabled={disabled || !editable(row, access)} onClick={onOpen} exact />
}

/** The edit form only for a user whose «Изменить» is enabled (the address alone does not open it). */
export function ReturnEditGate({ row, children }: { row: EditedRow; children: ReactNode }) {
  const access = useAccess()
  return access && editable(row, access) ? <>{children}</> : null
}
