import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { optionalNumberParam } from "@/lib/contracts-api"
import { listContractOptions } from "@/lib/contracts-repo"

// GET /api/contracts/options?clientId&client=<name>&includeId → ContractOption[] — active contracts covering
// the client (contract select of the Kirim / group income / pay-order dialogs; demo clientContract field).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const search = new URL(request.url).searchParams
  return NextResponse.json(
    await listContractOptions({
      clientId: optionalNumberParam(search, "clientId"),
      client: (search.get("client") ?? "").slice(0, 300),
      includeId: optionalNumberParam(search, "includeId"),
    }),
  )
}
