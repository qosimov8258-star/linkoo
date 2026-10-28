import { cookies } from "next/headers"

import { getDb } from "@/lib/db"

/** Cookie the account menu sets when a branch is picked ("" / absent = «Все филиалы»); the reference sends it as the `branch` header of every API call. */
export const BRANCH_COOKIE = "linko-branch"

/** Name of the branch picked in the account menu ("" for all branches). Safe outside a request (scripts): returns "". */
export async function selectedBranchName(): Promise<string> {
  try {
    const id = Number((await cookies()).get(BRANCH_COOKIE)?.value)
    if (!Number.isInteger(id) || id <= 0) return ""
    const row = (await getDb().prepare("SELECT name FROM branches WHERE id = ?").get(id)) as { name: string } | undefined
    return row?.name ?? ""
  } catch {
    return ""
  }
}
