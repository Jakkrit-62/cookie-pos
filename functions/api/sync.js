/**
 * Cloudflare Pages Function — /api/sync
 * Secure middle layer between the POS and Google Apps Script.
 *
 *   iPad ──(Cloudflare Access login: email OTP)──▶ /api/sync ──(+ secret key)──▶ Apps Script /exec
 *
 * • The Apps Script URL and the shared secret live only in Cloudflare (Settings ▸ Variables and Secrets):
 *     GAS_URL            https://script.google.com/macros/s/XXXX/exec
 *     SYNC_SECRET        same value as Script Property SYNC_SECRET in Apps Script
 *     ACCESS_TEAM_DOMAIN e.g. myshop.cloudflareaccess.com
 *     ACCESS_AUD         "Application Audience (AUD) Tag" of the Access application
 *   (local dev only: ALLOW_NO_ACCESS=true to skip the Access check)
 * • Every request must carry a valid Cloudflare Access JWT — so even a preview URL that Access
 *   does not cover cannot reach the sheet.
 * • The body is forwarded as-is (no JSON parsing → stays far below the Workers CPU limit).
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });

export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'POST') return reply({ ok: false, error: 'Method not allowed' }, 405);
  if (!env.GAS_URL || !env.SYNC_SECRET) {
    return reply({ ok: false, code: 'SERVER_CONFIG', error: 'ยังไม่ได้ตั้งค่า GAS_URL / SYNC_SECRET ใน Cloudflare Pages' }, 500);
  }

  const auth = await verifyAccess(request, env);
  if (!auth.ok) return reply({ ok: false, code: auth.code, error: auth.error }, auth.status);

  const target = new URL(env.GAS_URL);
  const incoming = new URL(request.url);
  for (const [k, v] of incoming.searchParams) if (k !== 'key') target.searchParams.set(k, v);
  target.searchParams.set('key', env.SYNC_SECRET);
  if (auth.email) target.searchParams.set('user', auth.email);

  const init = { method: request.method, redirect: 'follow' };
  if (request.method === 'POST') {
    init.body = await request.arrayBuffer();
    init.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  }

  let res;
  try {
    res = await fetch(target.toString(), init);
  } catch (e) {
    return reply({ ok: false, code: 'UPSTREAM', error: `ติดต่อ Google Apps Script ไม่ได้: ${e.message || e}` }, 502);
  }
  const text = await res.text();
  if (!text.trim().startsWith('{')) {
    return reply({ ok: false, code: 'UPSTREAM', error: `Apps Script ตอบกลับไม่ใช่ JSON (HTTP ${res.status}) — ตรวจสอบ GAS_URL และการ Deploy` }, 502);
  }
  return new Response(text, { status: 200, headers: JSON_HEADERS });
}

/* ---------------- Cloudflare Access JWT verification ---------------- */

let certCache = { at: 0, team: '', keys: [] };

async function accessKeys(team) {
  if (certCache.team === team && Date.now() - certCache.at < 3600_000 && certCache.keys.length) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs HTTP ${res.status}`);
  const { keys } = await res.json();
  certCache = { at: Date.now(), team, keys: keys || [] };
  return certCache.keys;
}

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

function cookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : '';
}

async function verifyAccess(request, env) {
  if (env.ALLOW_NO_ACCESS === 'true') return { ok: true, email: 'dev' };
  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!team || !env.ACCESS_AUD) {
    return { ok: false, status: 500, code: 'SERVER_CONFIG', error: 'ยังไม่ได้ตั้งค่า ACCESS_TEAM_DOMAIN / ACCESS_AUD ใน Cloudflare Pages' };
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || cookie(request, 'CF_Authorization');
  // No token → this hostname is not protected by Cloudflare Access (e.g. a preview URL) — refuse.
  if (!token) return { ok: false, status: 403, code: 'NO_ACCESS', error: 'โดเมนนี้ไม่ได้อยู่หลัง Cloudflare Access — ใช้ URL หลักของร้าน' };
  try {
    const [h, p, sig] = token.split('.');
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
    const jwk = (await accessKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('unknown key');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const now = Math.floor(Date.now() / 1000);
    if (!valid) throw new Error('bad signature');
    if (!aud.includes(env.ACCESS_AUD)) throw new Error('wrong audience');
    if (payload.iss !== `https://${team}`) throw new Error('wrong issuer');
    if (payload.exp && payload.exp < now) return { ok: false, status: 401, code: 'AUTH_EXPIRED', error: 'เซสชันหมดอายุ' };
    return { ok: true, email: payload.email || '' };
  } catch (e) {
    return { ok: false, status: 403, code: 'BAD_TOKEN', error: `ตรวจสอบ Cloudflare Access ไม่ผ่าน: ${e.message}` };
  }
}
