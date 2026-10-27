import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { lookupInn } from "@/lib/contracts-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/contracts/inn?inn → ContractInnInfo ("Проверить данные по ИНН", local lookup).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const inn = (new URL(request.url).searchParams.get("inn") ?? "").trim()
  if (!/^\d{1,20}$/.test(inn.replace(/\s/g, ""))) return NextResponse.json({ error: "ИНН должен содержать только цифры", field: "inn" }, { status: 400 })
  return NextResponse.json(await lookupInn(inn))
}
