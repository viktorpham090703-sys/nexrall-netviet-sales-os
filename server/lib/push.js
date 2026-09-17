/* Web Push delivery for the Workers runtime.  This deliberately uses Web Crypto
 * instead of a Node-only web-push package, so it runs in Cloudflare Workers. */

const now = () => Math.floor(Date.now() / 1000);

const encoder = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const fromB64url = (value) => {
  const text = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = text + '='.repeat((4 - text.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
const concat = (...parts) => {
  const size = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(size);
  let pos = 0;
  for (const part of parts) { out.set(part, pos); pos += part.length; }
  return out;
};
const hmac = async (key, data) => new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
const importHmac = (raw) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const label = (text) => concat(encoder.encode(text), new Uint8Array([0, 1]));

/** Lý do cấu hình VAPID chưa dùng được (null = hợp lệ). Kiểm tra cả ĐỊNH DẠNG, không chỉ có/không:
 * khoá dán sai (thiếu ký tự, nhầm PEM, nhầm cặp) trước đây vẫn báo configured=true, rồi mọi lần gửi
 * đều hỏng âm thầm. Thông điệp chỉ nêu TÊN biến, không bao giờ chứa giá trị khoá. */
export function vapidConfigError(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return 'Thiếu VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY hoặc VAPID_SUBJECT';
  }
  if (!/^(mailto:|https:\/\/)/.test(String(env.VAPID_SUBJECT))) return 'VAPID_SUBJECT phải bắt đầu bằng mailto: hoặc https://';
  let pub, priv;
  try { pub = fromB64url(env.VAPID_PUBLIC_KEY); priv = fromB64url(env.VAPID_PRIVATE_KEY); } catch (e) { return 'VAPID key không phải base64url hợp lệ'; }
  if (pub.length !== 65 || pub[0] !== 4) return 'VAPID_PUBLIC_KEY phải là khoá P-256 dạng raw 65 byte (base64url)';
  if (priv.length !== 32) return 'VAPID_PRIVATE_KEY phải là khoá riêng P-256 32 byte (base64url)';
  return null;
}

export function pushConfigured(env) {
  return vapidConfigError(env) === null;
}

/* Bảo đảm bảng subscription tồn tại trước khi đọc/ghi. Migration 73-76 đã lo việc này khi Worker khởi
 * động, nhưng số thứ tự migration là theo CHỈ MỤC mảng: CSDL từng chạy một bản code có danh sách
 * migration dài hơn sẽ có schema_version vượt quá và bỏ qua các mục này. Dùng prepare().run() (chạy
 * được SQL bất kỳ, không bị exec() tách dòng) và chỉ chạy 1 lần mỗi isolate. */
let pushSchemaReady = null;
export function ensurePushSchema(env) {
  if (!pushSchemaReady) {
    pushSchemaReady = (async () => {
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS nv_push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, user_agent TEXT, platform TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_used_at INTEGER)').run();
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user ON nv_push_subscriptions(user_id)').run();
    })().catch((e) => { pushSchemaReady = null; throw e; });   // lỗi tạm thời → lần sau thử lại
  }
  return pushSchemaReady;
}

/** Normalise user-facing data so scheduled business alerts never put CRM data in push payloads. */
export function safePushPayload({ title, body, link, tag }) {
  return {
    title: String(title || 'NetViet Sales OS').slice(0, 120),
    body: String(body || 'Bạn có thông báo mới trong NetViet Sales OS.').slice(0, 220),
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: String(tag || 'netviet-sales-os').slice(0, 80),
    timestamp: Date.now(),
    data: { url: normaliseAppUrl(link) },
  };
}

export async function sendPushToUser(env, userId, payload) {
  if (!pushConfigured(env)) return { configured: false, total: 0, sent: 0, removed: 0, failed: 0 };
  await ensurePushSchema(env);
  const { results } = await env.DB.prepare(
    'SELECT id,endpoint,p256dh,auth FROM nv_push_subscriptions WHERE user_id=?'
  ).bind(userId).all();
  // failedStatuses / errors: để chẩn đoán vì sao KHÔNG gửi được (vd 403 = subscription tạo bằng cặp
  // VAPID khác). Chỉ có mã HTTP và thông điệp lỗi ngắn — không có endpoint, p256dh hay auth.
  const output = { configured: true, total: (results || []).length, sent: 0, removed: 0, failed: 0, failedStatuses: [], errors: [] };
  await Promise.all((results || []).map(async (subscription) => {
    try {
      const result = await sendPushToSubscription(env, subscription, payload);
      if (result.expired) {
        await env.DB.prepare('DELETE FROM nv_push_subscriptions WHERE id=? AND user_id=?').bind(subscription.id, userId).run();
        output.removed++;
      } else if (result.ok) {
        await env.DB.prepare('UPDATE nv_push_subscriptions SET last_used_at=? WHERE id=? AND user_id=?').bind(now(), subscription.id, userId).run();
        output.sent++;
      } else {
        output.failed++;
        output.failedStatuses.push(result.status);
      }
    } catch (e) {
      // A malformed/temporary failed device must never prevent another device receiving push.
      output.failed++;
      const msg = String((e && e.message) || 'Lỗi không xác định').slice(0, 120);
      if (!output.errors.includes(msg)) output.errors.push(msg);
    }
  }));
  return output;
}

export async function sendPushToSubscription(env, subscription, payload) {
  const endpoint = new URL(subscription.endpoint);
  const body = await encryptPayload(subscription, JSON.stringify(safePushPayload(payload)));
  const token = await vapidToken(env, endpoint.origin);
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'normal',
    },
    body,
  });
  return { ok: response.ok, status: response.status, expired: response.status === 404 || response.status === 410 };
}

async function encryptPayload(subscription, text) {
  const receiverPublic = fromB64url(subscription.p256dh);
  const auth = fromB64url(subscription.auth);
  if (receiverPublic.length !== 65 || auth.length < 16) throw new Error('Invalid push subscription keys');
  const receiverKey = await crypto.subtle.importKey('raw', receiverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sender = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, sender.privateKey, 256));

  const authKey = await importHmac(auth);
  const prkKey = await hmac(authKey, shared);
  const ikm = await hmac(await importHmac(prkKey), concat(encoder.encode('WebPush: info\0'), receiverPublic, senderPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(await importHmac(salt), ikm);
  // RFC 8188 §2.2-2.3: info = "Content-Encoding: aes128gcm" || 0x00, rồi HMAC trên info || 0x01.
  // label() đã tự nối đúng 0x00 0x01 — KHÔNG thêm "\0" vào chuỗi: thừa 1 byte 0x00 làm sai CEK/nonce,
  // dịch vụ push vẫn nhận (201) nhưng trình duyệt giải mã thất bại và bỏ qua thông báo.
  const cek = (await hmac(await importHmac(prk), label('Content-Encoding: aes128gcm'))).slice(0, 16);
  const nonce = (await hmac(await importHmac(prk), label('Content-Encoding: nonce'))).slice(0, 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const plain = concat(encoder.encode(text), new Uint8Array([2]));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plain));
  const recordSize = new Uint8Array([0, 0, 16, 0]); // 4096 bytes
  return concat(salt, recordSize, new Uint8Array([senderPublic.length]), senderPublic, encrypted);
}

async function vapidToken(env, audience) {
  const header = b64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(encoder.encode(JSON.stringify({ aud: audience, exp: now() + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const privateKey = fromB64url(env.VAPID_PRIVATE_KEY);
  const publicKey = fromB64url(env.VAPID_PUBLIC_KEY);
  if (privateKey.length !== 32 || publicKey.length !== 65) throw new Error('VAPID keys must be base64url P-256 keys');
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: b64url(privateKey),
    x: b64url(publicKey.slice(1, 33)), y: b64url(publicKey.slice(33)), ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signed = encoder.encode(`${header}.${payload}`);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed));
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Chỉ cho phép route NỘI BỘ của app. Thông báo nghiệp vụ ghi link dạng "#/plans/..." (xem các lời
 * gọi notify()), còn trang cài đặt/test dùng "/#/cockpit" — trước đây chỉ nhận dạng thứ hai nên mọi
 * thông báo nghiệp vụ khi bấm vào đều rơi về Cockpit thay vì đúng màn hình. Mọi thứ khác (URL tuyệt
 * đối, "//host", "javascript:") → Cockpit. */
export function normaliseAppUrl(value) {
  const text = String(value || '').trim();
  if (/^#\/[^\s]*$/.test(text)) return '/' + text;
  if (/^\/#\/[^\s]*$/.test(text)) return text;
  return '/#/cockpit';
}
