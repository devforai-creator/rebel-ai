const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb', // Large CharX files with many images (100+ assets)
    },
    middlewareClientMaxBodySize: '100mb', // For API routes
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/sign/character-assets/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              process.env.NODE_ENV === 'production'
                ? "script-src 'self' 'unsafe-inline'" // Next.js App Router still emits inline bootstrap/Flight scripts in production
                : "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Dev only: require by Next.js dev runtime (react-refresh / webpack module eval). MUST NEVER appear in production CSP.
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // Framework/runtime inline styles still exist; Google Fonts remains allowlisted
              "img-src 'self' data: blob: https://*.supabase.co",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "media-src 'self' blob: https://*.supabase.co",
              "frame-src 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = withBundleAnalyzer(nextConfig)
