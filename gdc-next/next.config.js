/** @type {import('next').NextConfig} */

// Next.js project config.
//
// images.remotePatterns: required when using <Image> with src URLs that
// point to external hosts. Without this, <Image src="https://...supabase.co/..."/>
// throws a runtime error in production. We allow the Supabase storage host
// because that's where DJ avatars and other user uploads live.

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
};

module.exports = nextConfig;
