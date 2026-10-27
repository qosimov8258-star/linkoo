import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { searchContractClients } from "@/lib/contracts-repo"
import { notSignedInResponse, parseIdSegment } from "@/lib/validation"

// GET /api/contracts/clients?q&ids=1,2 → [{id, name, zone, inn}] (client picker of the form and the filter).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const search = new URL(request.url).searchParams
  // Out-of-range ids (above int4, "1.5", "abc") are dropped: they never reach Postgres.
  const ids = [...new Set((search.get("ids") ?? "").split(/[-,]/).map((value) => parseIdSegment(value.trim())).filter((id): id is number => id !== null))].slice(0, 500)
  return NextResponse.json(await searchContractClients({ q: (search.get("q") ?? "").slice(0, 200), ids }))
}
