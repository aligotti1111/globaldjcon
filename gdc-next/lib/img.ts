// Small helper to serve a remote image through Next's built-in image optimizer
// (/_next/image) instead of the raw original. Next resizes it to the requested
// width and returns WebP/AVIF when the browser supports it, cached at the edge —
// so a multi-MB uploaded banner becomes a small, fast image on first load.
//
// The source host must be allowlisted in next.config images.remotePatterns
// (the Supabase storage host already is). Use for CSS background-image / preload
// URLs where <Image> can't be used directly.

export function optimizedImageUrl(url: string, width = 1920, quality = 75): string {
  if (!url) return url;
  // Only optimize http(s) sources; leave data: / blob: / already-optimized URLs.
  if (!/^https?:\/\//i.test(url) || url.startsWith('/_next/image')) return url;
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=${quality}`;
}
