/** @type {import('next').NextConfig} */

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'hwqvzuusquruhwguqole.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async rewrites() {
    return [
      { source: '/', destination: '/site/landing.html' },
    ];
  },
};

module.exports = nextConfig;
