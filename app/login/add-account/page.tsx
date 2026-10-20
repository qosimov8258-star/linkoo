import { LoginScreen } from "../login-screen"

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> }

// "Добавить аккаунт": the sign-in form for another account, shown even while signed in.
export default async function AddAccountPage({ searchParams }: PageProps) {
  const params = await searchParams
  const from = Array.isArray(params.from) ? params.from[0] : params.from
  return <LoginScreen mode="add" from={from} />
}
