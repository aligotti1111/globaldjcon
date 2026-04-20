// netlify/functions/send-email.js
const FROM = 'Global DJ Connect <info@globaldjconnect.com>';
const REPLY_TO_DEFAULT = 'info@globaldjconnect.com';
const ADMIN_EMAIL = 'info@globaldjconnect.com';
const SITE_URL = 'https://globaldjconnect.com';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { type } = body;
  let emailPayload;

  // ── 1. WELCOME (after signup confirmation) ────────────────────────
  if (type === 'welcome') {
    const { name, email, role, slug } = body;
    if (!name || !email) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
    let profileBtn = '';
    if (role === 'dj' && slug) {
      profileBtn = `<a href="${SITE_URL}/${slug}" style="display:inline-block;background:#00f5c4;color:#050507;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:monospace;font-size:13px;lett
