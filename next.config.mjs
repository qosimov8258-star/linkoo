// Sent with every page, API answer and asset. The app is never meant to be
// shown inside another site's frame (clickjacking, e.g. a hidden "Принять"
// button), so framing is refused both the old way (X-Frame-Options) and the
// CSP way. HSTS is ignored by browsers on plain-HTTP responses (local dev) and
// pins HTTPS once the site has been opened over TLS (nginx in production).
// The pages get a fuller Content-Security-Policy with a per-response script
// nonce from proxy.ts (it replaces the one below on every page). The browser
// features the app never uses are switched off for it and for anything it
// embeds, and a window the app opens (or is opened from) on another site gets
// no handle on it (Cross-Origin-Opener-Policy).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), serial=(), bluetooth=(), geolocation=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // A second local instance (e.g. the factory simulation DB) needs its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false,
  // `next dev` would write an AGENTS.md into the repository whenever an AI coding tool starts it.
  agentRules: false,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  // Extra hosts allowed to load the dev server (comma-separated, e.g. a LAN IP).
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API answers are per user and change all the time: a browser must not keep them on disk.
      // The routes that serve a picture or a file (…/image, …/images/7, …/photo, …/photos/7,
      // …/files/7) are left out: they set their own Cache-Control, and a header from here
      // would replace it.
      { source: "/api/:rest((?!.*/(?:image|photo|images/\\d+|photos/\\d+|files/\\d+)$).*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ]
  },
}

export default nextConfig
