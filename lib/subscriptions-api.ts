import "server-only"

import { NextResponse } from "next/server"

import type { BillingResult } from "@/lib/subscriptions-repo"

const MESSAGES = {
  insufficient_funds: { status: 402, message: "Недостаточно средств на балансе" },
  nothing_selected: { status: 400, message: "Выберите одного пользователя !" },
  no_license: { status: 409, message: "Нет доступных лицензий этого типа" },
  bad_period: { status: 400, message: "Выберите период подписки" },
  bad_date: { status: 400, message: "Укажите дату начала подписки" },
} as const

export function billingResponse(result: BillingResult, nothingSelected?: string): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true })
  const info = result.error === "nothing_selected" && nothingSelected ? { status: 400, message: nothingSelected } : MESSAGES[result.error]
  return NextResponse.json({ error: info.message }, { status: info.status })
}
