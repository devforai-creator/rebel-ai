const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

function getSupabaseCspOrigins(rawUrl) {
  if (!rawUrl) {
    return { resourceOrigin: null, realtimeOrigin: null }
  }

  try {
    const url = new URL(rawUrl)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname.includes('*')) {
      return { resourceOrigin: null, realtimeOrigin: null }
    }

    const realtimeUrl = new URL(url.origin)
    realtimeUrl.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

    return {
      resourceOrigin: url.origin,
      realtimeOrigin: realtimeUrl.origin,
    }
  } catch {
    return { resourceOrigin: null, realtimeOrigin: null }
  }
}

function buildCspDirective(name, ...sources) {
  return [name, ...sources.filter(Boolean)].join(' ')
}

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
    const { resourceOrigin, realtimeOrigin } = getSupabaseCspOrigins(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    )

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
              "script-src-attr 'none'", // React event handlers do not require inline HTML event attributes
              "style-src 'self' 'unsafe-inline'", // Framework/runtime inline styles still exist
              buildCspDirective('img-src', "'self'", 'data:', 'blob:', resourceOrigin),
              "font-src 'self' data:",
              buildCspDirective('connect-src', "'self'", resourceOrigin, realtimeOrigin),
              buildCspDirective('media-src', "'self'", 'blob:', resourceOrigin),
              "frame-src 'none'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'none'",
              "object-src 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = withBundleAnalyzer(nextConfig)
