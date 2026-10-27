// Sent with every page, API answer and asset. The app is never meant to be
// shown inside another site's frame (clickjacking, e.g. a hidden "Принять"
// button), so framing is refused both the old way (X-Frame-Options) and the
// CSP way. HSTS is ignored by browsers on plain-HTTP responses (local dev) and
// pins HTTPS once the site has been opened over TLS (nginx in production).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  devIndicators: false,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ["26.225.180.79"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
