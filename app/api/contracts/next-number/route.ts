import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { optionalNumberParam } from "@/lib/contracts-api"
import { getNextContractNumber } from "@/lib/contracts-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/contracts/next-number?year&prefix&suffix → ContractNextNumber (demo /sales/contract/contract_number/).
// Without prefix / suffix params the ones of the latest numbered contract are used.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const search = new URL(request.url).searchParams
  return NextResponse.json(
    await getNextContractNumber({
      year: optionalNumberParam(search, "year"),
      prefix: search.has("prefix") ? (search.get("prefix") ?? "").slice(0, 20) : null,
      suffix: search.has("suffix") ? (search.get("suffix") ?? "").slice(0, 20) : null,
    }),
  )
}
