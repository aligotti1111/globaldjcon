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
    // Serve AVIF (≈30% smaller than WebP) when the browser supports it, WebP
    // otherwise — so a multi-MB uploaded banner ships as a small, fast image.
    formats: ['image/avif', 'image/webp'],
    // Keep each optimized banner in the CDN for a year. This is safe because a
    // replaced banner always gets a NEW source URL (the upload appends
    // ?t=<timestamp>), so a fresh banner is a fresh cache key and never serves
    // a stale image — only the very first viewer of a given banner waits for
    // the one-time optimization; everyone after gets it straight from cache.
    minimumCacheTTL: 31536000,
  },
};

module.exports = nextConfig;
