/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow Supabase storage images for DJ profile photos, email logo, etc.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'hwqvzuusquruhwguqole.supabase.co',
      },
    ],
  },
};

module.exports = nextConfig;
