/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  /**
   * Rewrites lets me proxy API calls directly to the backend, so I don’t need to create API routes 
   * for basic CRUD.
   */
  async rewrites() {
    return [
      {
        source: '/api/:path*', // intercepts all /api/* requests and forwards them to the backend.
        destination: `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
