// lib/botSite.ts — fetch a DJ's own website ONCE (on save) and reduce it to a
// plain-text snapshot used as a LAST-RESORT fallback source for the booking bot.
// SERVER-ONLY (uses node:dns). Never fetch on every chat turn — the snapshot is
// stored and reused.
//
// SSRF-safe: we only allow public http(s) URLs. We resolve the hostname and
// reject any address that lands on localhost, link-local, or private/internal
// ranges (incl. the cloud metadata IP) so a DJ can't point the fetcher at an
// internal service.

import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { BOT_SITE_TEXT_MAX } from '@/lib/bookingBot';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000; // cap the download so a huge page can't blow memory
export const BOT_SITE_URL_MAX = 300;

export interface SiteFetchResult {
  ok: boolean;
  text: string;
  error?: string;
}

// Is this resolved IP address in a range we must never connect to?
function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b] = p;
    if (a === 10) return true;
    if (a === 127) return true;                 // loopback
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;    // link-local + metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                  // multicast/reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // IPv4-mapped (::ffff:a.b.c.d) — check the embedded v4.
    const m = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true; // not a valid IP → refuse
}

// Validate the URL shape and confirm every resolved address is public.
async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('That doesn\'t look like a valid web address.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Use a web address starting with http:// or https://.');
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('That address can\'t be used.');
  }
  // If the host is a literal IP, check it directly; otherwise resolve it.
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('That address can\'t be used.');
    return u;
  }
  let addrs: { address: string }[];
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error('Couldn\'t reach that website.'); }
  if (!addrs.length) throw new Error('Couldn\'t reach that website.');
  for (const a of addrs) { if (isPrivateIp(a.address)) throw new Error('That address can\'t be used.'); }
  return u;
}

// Strip an HTML document down to readable text: drop script/style/head, remove
// tags, decode a few common entities, collapse whitespace.
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<\/(p|div|section|article|li|h[1-6]|br|tr|table)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/gm, '');
  return s.trim();
}

// Fetch + reduce. Returns { ok:false, error } on any problem — the caller stores
// an empty snapshot and surfaces the message. Never throws.
export async function fetchSiteText(rawUrl: string): Promise<SiteFetchResult> {
  const url = (rawUrl || '').trim().slice(0, BOT_SITE_URL_MAX);
  if (!url) return { ok: false, text: '', error: 'No website address given.' };
  let u: URL;
  try { u = await assertSafeUrl(url); } catch (e) { return { ok: false, text: '', error: e instanceof Error ? e.message : 'That address can\'t be used.' }; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(u.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'GlobalDJConnect-BookingAssistant/1.0', accept: 'text/html,application/xhtml+xml' },
    });
    if (!resp.ok) return { ok: false, text: '', error: `The website returned an error (${resp.status}).` };
    const ctype = (resp.headers.get('content-type') || '').toLowerCase();
    if (ctype && !ctype.includes('text/html') && !ctype.includes('text/plain') && !ctype.includes('xml')) {
      return { ok: false, text: '', error: 'That link isn\'t a web page we can read.' };
    }
    // Read with a byte cap so a giant page can't exhaust memory.
    const reader = resp.body?.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) { received += value.length; chunks.push(value); if (received > MAX_BYTES) { try { await reader.cancel(); } catch { /* ignore */ } break; } }
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const html = buf.toString('utf8');
    const text = htmlToText(html).slice(0, BOT_SITE_TEXT_MAX);
    if (!text) return { ok: false, text: '', error: 'We couldn\'t read any text from that page (it may load its content with JavaScript).' };
    return { ok: true, text };
  } catch (e) {
    const msg = (e as { name?: string })?.name === 'AbortError' ? 'The website took too long to respond.' : 'Couldn\'t load that website.';
    return { ok: false, text: '', error: msg };
  } finally {
    clearTimeout(timer);
  }
}
