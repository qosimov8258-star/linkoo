import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { notSignedInResponse } from "@/lib/validation"
import { writeOffOptions } from "@/lib/write-offs-repo"

/** Filter / dialog lookups: warehouses and creators. */
export async function GET() {
  if (!(await getCurrentUser())) return notSignedInResponse()
  return NextResponse.json(await writeOffOptions())
}
