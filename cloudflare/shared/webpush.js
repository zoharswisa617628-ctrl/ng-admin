// Web Push (RFC 8291 / 8292) with WebCrypto only — used by the site (test notification) and by the cron worker.
// sendPush(env, sub, payloadObject) → { ok, gone } ; gone = the phone unsubscribed (delete the subscription)
const enc = new TextEncoder();
const b64u = bytes => { let s = ''; new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const concat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out; };

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// Encrypt the message so only that phone's browser can read it (aes128gcm)
async function encrypt(sub, plaintext) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(16 + 4 + 1 + asPub.length);
  header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPub.length; header.set(asPub, 21);
  return concat(header, ct);
}

// Signed "who is sending" token (VAPID), so push services accept the message
async function vapidAuth(env, endpoint) {
  const jwk = JSON.parse(String(env.VAPID_PRIVATE).replace(/^﻿/, '').trim());   // a secret saved from PowerShell can start with an invisible BOM
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'https://YOUR-PROJECT.pages.dev' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

export async function sendPush(env, sub, payload) {
  try {
    const body = await encrypt(sub, enc.encode(JSON.stringify(payload)));
    const r = await fetch(sub.endpoint, { method: 'POST', body, headers: {
      Authorization: await vapidAuth(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: '86400', Urgency: 'high' } });   // no Topic header: Apple (iPhone) refuses ours (BadWebPushTopic)
    return { ok: r.ok, gone: r.status === 404 || r.status === 410, status: r.status, ...(r.ok ? {} : { error: (await r.text().catch(() => '')).slice(0, 200) }) };
  } catch (e) { return { ok: false, gone: false, error: String(e) }; }
}
