/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  devIndicators: false,
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ["26.225.180.79"],
}

export default nextConfig
