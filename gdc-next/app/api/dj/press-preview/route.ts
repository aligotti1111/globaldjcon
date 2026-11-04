// /api/dj/press-preview — turn a pasted article URL into a link preview
// (title / publication / image), the way Google/social cards do, by fetching
// the page and reading its OpenGraph + <title> meta tags.
//
//   POST { url }  →  { title, publication, image }
//
// DJ-authed and Pro-gated (the Press tab is a subscription-only feature). The
// fetch is hardened against SSRF: http/https only, and the resolved IP must be
// a public address (no localhost, link-local, or private ranges — blocks cloud
// metadata endpoints too). Size- and time-capped so a hostile/huge page can't
// hang or balloon memory. A failed scrape is NOT an error — it returns empty
// fields so the DJ can still save the link and upload their own image.

import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { createClient } from '@/lib/supabase/server';
import { getActingContext, canEditProfile } from '@/lib/acting';
import { canUsePro, type AccessFields } from '@/lib/access';
import { normalizeUrl } from '@/lib/staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 1_500_000; // 1.5 MB of HTML is plenty for <head> meta tags

// True for any IP we must never fetch (SSRF guard): loopback, link-local,
// private (RFC1918 / unique-local), and the cloud metadata address.
function isBlockedIp(ip: string): boolean {
  const v = ip.toLowerCase();
  // IPv6
  if (v.includes(':')) {
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true; // link-local / unique-local
    // IPv4-mapped (::ffff:a.b.c.d) → check the embedded v4
    const m = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedIp(m[1]);
    return false;
  }
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 127) return true;             // this-host / loopback
  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
  if (a === 192 && b === 168) return true;            // 192.168.0.0/16
  if (a === 169 && b === 254) return true;            // link-local + 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true;  // carrier-grade NAT
  return false;
}

function pickMeta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    // property="og:image" content="..."  OR  content="..." property="og:image"
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`,
      'i',
    );
    const m = re.exec(html);
    if (m && m[1]) return decodeEntities(m[1].trim());
    const reRev = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`,
      'i',
    );
    const mr = reRev.exec(html);
    if (mr && mr[1]) return decodeEntities(mr[1].trim());
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&#38;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

interface Preview { title: string; publication: string; image: string | null }

// Primary: a hosted preview service that actually RENDERS the page (headless
// browser), so it reads OpenGraph tags on JS-heavy / bot-blocking news sites
// that a raw server fetch can't see. Microlink has a free tier; set
// MICROLINK_API_KEY in env to lift the rate limit. Returns null on any failure
// so the caller can fall back to the raw-HTML parse.
async function fetchViaMicrolink(url: string): Promise<Preview | null> {
  try {
    const endpoint = `https://api.microlink.io/?url=${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (process.env.MICROLINK_API_KEY) headers['x-api-key'] = process.env.MICROLINK_API_KEY;
    let res: Response;
    try {
      res = await fetch(endpoint, { signal: controller.signal, headers });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | { status?: string; data?: { title?: string; publisher?: string; image?: { url?: string }; logo?: { url?: string } } }
      | null;
    if (!json || json.status !== 'success' || !json.data) return null;
    const d = json.data;
    let image = d.image?.url || null;
    if (image) {
      try { const p = new URL(image).protocol; if (p !== 'http:' && p !== 'https:') image = null; } catch { image = null; }
    }
    return {
      title: (d.title || '').slice(0, 200),
      publication: (d.publisher || '').slice(0, 80),
      image,
    };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const acting = await getActingContext(user.id);
    if (!canEditProfile(acting.role)) {
      return NextResponse.json({ error: 'You do not have permission to edit this profile.' }, { status: 403 });
    }

    // Pro gate — Press is a subscription-only feature. Read the OWNER's row.
    const { data: owner } = await supabase
      .from('users')
      .select('*')
      .eq('id', acting.djId)
      .single();
    if (!owner || !canUsePro(owner as unknown as AccessFields)) {
      return NextResponse.json({ error: 'Press is a subscription feature.' }, { status: 402 });
    }

    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const url = normalizeUrl(body?.url);
    if (!url) return NextResponse.json({ error: 'Enter a valid article link.' }, { status: 400 });

    const parsed = new URL(url);
    // SSRF: resolve the hostname and reject any private / loopback target.
    try {
      const addrs = await lookup(parsed.hostname, { all: true });
      if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) {
        return NextResponse.json({ error: 'That link can’t be previewed.' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: 'That link can’t be reached.' }, { status: 400 });
    }

    // ── Attempt 1: raw-HTML parse (fast, free). Works for sites that serve
    // OpenGraph tags in the initial HTML. Uses a real browser UA so fewer sites
    // 403 us. Never throws / early-returns — on any miss we fall through to the
    // rendering service below.
    const direct = await (async (): Promise<Preview> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let html = '';
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('text/html') || !res.body) return { title: '', publication: '', image: null };
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          html += decoder.decode(value, { stream: true });
          if (bytes >= MAX_BYTES || /<\/head>/i.test(html)) { try { await reader.cancel(); } catch { /* ignore */ } break; }
        }
      } catch {
        return { title: '', publication: '', image: null };
      } finally {
        clearTimeout(timer);
      }

      const titleTag = (() => {
        const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
        return m ? decodeEntities(m[1].trim()) : '';
      })();
      let image = pickMeta(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
      if (image) {
        try { image = new URL(image, parsed.origin).href; } catch { image = null; }
        if (image) { try { const p = new URL(image).protocol; if (p !== 'http:' && p !== 'https:') image = null; } catch { image = null; } }
      }
      return {
        title: pickMeta(html, ['og:title', 'twitter:title']) || titleTag || '',
        publication: pickMeta(html, ['og:site_name', 'application-name']) || '',
        image: image || null,
      };
    })();

    // ── Attempt 2: a rendering preview service (Microlink) fills whatever the
    // raw parse missed — the common case for JS-rendered or bot-blocking news
    // sites (e.g. edm.com), where the initial HTML has no usable OG tags.
    let title = direct.title;
    let publication = direct.publication;
    let image = direct.image;
    if (!image || !title) {
      const ml = await fetchViaMicrolink(url);
      if (ml) {
        if (!title && ml.title) title = ml.title;
        if (!publication && ml.publication) publication = ml.publication;
        if (!image && ml.image) image = ml.image;
      }
    }

    return NextResponse.json({
      title: title.slice(0, 200),
      publication: (publication || parsed.hostname.replace(/^www\./, '')).slice(0, 80),
      image: image || null,
    });
  } catch {
    // Never surface a 502 (Cloudflare eats the body) — always 500 with a body.
    return NextResponse.json({ error: 'Could not preview that link right now.' }, { status: 500 });
  }
}
