// Shared image utilities for the public DJ profile (ProfileView and its
// extracted modal/editor components). Pure functions — no React, no styles.

// ─────────────────────────────────────────────────────────────────────────
// thumbUrl — rewrite a Supabase Storage public URL to use the image
// transform endpoint so we get a small thumbnail instead of the full
// multi-MB original. Used by the photo manager modal so opening doesn't
// stall while 4 full-resolution photos download.
//
// Pattern: /storage/v1/object/public/<bucket>/<path> →
//          /storage/v1/render/image/public/<bucket>/<path>?width=N&resize=cover&quality=70
//
// Falls back to the original URL if the input doesn't match the
// Supabase public-object pattern (e.g. external URLs from older data).
// Preserves any cache-busting `?t=` query so updated images still
// invalidate the browser cache.
// ─────────────────────────────────────────────────────────────────────────
export function thumbUrl(originalUrl: string, size: number): string {
  try {
    const u = new URL(originalUrl);
    if (!u.pathname.includes('/storage/v1/object/public/')) {
      return originalUrl;
    }
    const transformedPath = u.pathname.replace(
      '/storage/v1/object/public/',
      '/storage/v1/render/image/public/'
    );
    // Preserve cache-busting timestamp if present
    const t = u.searchParams.get('t');
    const params = new URLSearchParams();
    params.set('width', String(size));
    params.set('height', String(size));
    params.set('resize', 'cover');
    params.set('quality', '70');
    if (t) params.set('t', t);
    return `${u.origin}${transformedPath}?${params.toString()}`;
  } catch {
    return originalUrl;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// validateImageFile — defence-in-depth checks before any upload to
// Supabase Storage. Returns null if the file is OK, or an error string
// to show the user.
//
// Layered checks:
//   1. MIME whitelist — user's File.type must be a real raster image
//      type. Excludes image/svg+xml on purpose because SVGs can carry
//      executable JavaScript via embedded <script> tags.
//   2. Extension match — defends against MIME spoofing where a file
//      has type 'image/png' but a .exe extension or vice-versa.
//   3. Size limit — 10MB cap so people can't accidentally (or
//      maliciously) upload huge files that hammer storage and
//      bandwidth. Modern phone photos are ~3-5MB so this is generous.
//   4. Magic-byte check — reads the first few bytes of the file and
//      compares to known image signatures. Catches the classic trick
//      of renaming `virus.exe` to `pic.jpg` because the bytes won't
//      match. async because FileReader is async.
//
// All checks run client-side and are best-effort; a determined attacker
// can bypass them. Server-side bucket restrictions in Supabase are the
// real gate — these just give faster feedback and a cleaner UX.
// ─────────────────────────────────────────────────────────────────────────
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
export const ALLOWED_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function validateImageFile(file: File): Promise<string | null> {
  // 1. MIME whitelist — explicitly reject SVG even if the OS reports
  //    it as image/svg+xml because SVGs are XML and can contain scripts.
  if (file.type === 'image/svg+xml') {
    return 'SVG files are not supported.';
  }
  if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
    return 'Only JPG, PNG, WebP, GIF, and HEIC images are allowed.';
  }

  // 2. Extension match — defends against .exe renamed to .jpg etc.
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_IMAGE_EXT.includes(ext)) {
    return 'File extension does not look like a valid image.';
  }

  // 3. Size cap — prevents abuse of storage bandwidth.
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return `File is too large (${mb} MB). Max is 10 MB.`;
  }
  if (file.size === 0) {
    return 'File appears to be empty.';
  }

  // 4. Magic-byte check — read first 16 bytes and confirm they match
  //    one of our allowed image signatures. Bypassing this requires
  //    crafting a polyglot file which is beyond casual users.
  const bytes = await readFirstBytes(file, 16);
  if (!isImageMagicBytes(bytes)) {
    return 'File does not appear to be a valid image.';
  }
  return null;
}

function readFirstBytes(file: File, n: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      resolve(new Uint8Array(buf));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file.slice(0, n));
  });
}

function isImageMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return true;
  // GIF87a / GIF89a: 47 49 46 38 (37|39) 61
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) return true;
  // WebP: starts with RIFF (52 49 46 46) and at byte 8 has WEBP (57 45 42 50)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return true;
  // HEIC/HEIF: 'ftyp' box at offset 4 — bytes 4-7 are 66 74 79 70
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  ) return true;
  return false;
}
