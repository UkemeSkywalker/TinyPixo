/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['sharp'],
  experimental: {
    serverComponentsExternalPackages: ['sharp'],
  },
  // Increase the body parser size limit
  api: {
    bodyParser: {
      sizeLimit: process.env.BODY_SIZE_LIMIT || '500mb',
    },
    responseLimit: false,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
    ]
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      }
    }
    return config
  },

}

module.exports = nextConfig