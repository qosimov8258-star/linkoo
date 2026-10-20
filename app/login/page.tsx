import { redirect } from "next/navigation"

import { getCurrentUser } from "@/lib/current-user"

import { LoginScreen } from "./login-screen"
import { safeRedirectPath } from "./safe-redirect"

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

// The login page always renders for a missing, expired or revoked session (the
// middleware no longer bounces /login on a merely well-signed cookie). A live
// session goes straight on to the requested page, unless its password must be
// changed first.
export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams
  const from = single(params.from)
  const user = await getCurrentUser()
  if (user && !user.mustChangePassword) redirect(safeRedirectPath(from))
  return <LoginScreen mode="login" from={from} reason={single(params.reason)} mustChangeFor={user?.username} />
}
