import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { transferOptions } from "@/lib/internal-transfers-list"
import { notSignedInResponse } from "@/lib/validation"

/** Lookups of the transfer dialog / filter: warehouses (with address and
 * manager), creators, price lists (+ currency), currencies, organizations. */
export async function GET() {
  if (!(await getCurrentUser())) return notSignedInResponse()
  return NextResponse.json(await transferOptions())
}
