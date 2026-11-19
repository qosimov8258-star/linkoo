// Where to go after signing in: only a path of this site. A protocol-relative
// value ("//evil.example", "/\evil.example", tabs/newlines in between) or an
// absolute URL would make the router leave the site (open redirect), so the
// value is resolved against a fixed origin and accepted only if it stays there.
//
// Resolving also collapses dot segments and turns "\" into "/": "/.//evil",
// "/..//evil", "/a/..//evil", "/%2e//evil" and "/./\evil" all become the path
// "//evil", which the browser (and Location) reads as another host. So the
// resolved path itself must start with exactly one "/".
import { HOME_PAGE } from "@/lib/home-page"

const ORIGIN = "http://linko.invalid"

/** A path that stays on this site: one leading "/" not followed by "/" or "\". */
const SAME_SITE_PATH = /^\/(?![/\\])/

/** Anything unusable, and the bare address "/", lands on the home page (lib/home-page.ts). */
export function safeRedirectPath(from: string | null | undefined): string {
  if (!from || !SAME_SITE_PATH.test(from)) return HOME_PAGE
  try {
    const url = new URL(from, ORIGIN)
    if (url.origin !== ORIGIN) return HOME_PAGE
    if (!SAME_SITE_PATH.test(url.pathname)) return HOME_PAGE
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return HOME_PAGE
    const path = `${url.pathname}${url.search}${url.hash}`
    if (path === "/") return HOME_PAGE
    return SAME_SITE_PATH.test(path) ? path : HOME_PAGE
  } catch {
    return HOME_PAGE
  }
}
