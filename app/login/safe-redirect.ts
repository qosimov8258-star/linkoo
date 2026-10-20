// Where to go after signing in: only a path of this site. A protocol-relative
// value ("//evil.example", "/\evil.example", tabs/newlines in between) or an
// absolute URL would make the router leave the site (open redirect), so the
// value is resolved against a fixed origin and accepted only if it stays there.
const ORIGIN = "http://linko.invalid"

export function safeRedirectPath(from: string | null | undefined): string {
  if (!from || !from.startsWith("/")) return "/"
  try {
    const url = new URL(from, ORIGIN)
    if (url.origin !== ORIGIN) return "/"
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return "/"
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return "/"
  }
}
