import { NextRequest, NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { clientErrorResponse, clientInputOf, clientSchema } from "@/lib/client-schema"
import { createClient, listClients } from "@/lib/clients-repo"
import { getCurrentUser } from "@/lib/current-user"
import { createAccountForClient } from "@/lib/financial-accounts-repo"
import { requireRole } from "@/lib/rbac"

// GET /api/clients[?q=] → Client[] with the current ledger balance (balanceLines / currentBalances).
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const search = request.nextUrl.searchParams.get("q")?.trim().slice(0, 200) || undefined
  const withBalances = request.nextUrl.searchParams.get("balances") !== "0"
  return NextResponse.json(await listClients(search, { withBalances }))
}

// POST /api/clients — 400 for an unknown client type / employee or impossible
// coordinates, 409 for a client with the same name and phone / INN (allowDuplicate: true overrides).
export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, clientSchema)
  if (parsed.error) return parsed.error

  try {
    const client = await createClient(clientInputOf(parsed.data), auth.user)
    await createAccountForClient({ id: client.id, name: client.name, address: client.address, agent: client.agent, type: client.type })
    return NextResponse.json(client, { status: 201 })
  } catch (error) {
    return clientErrorResponse(error)
  }
}
