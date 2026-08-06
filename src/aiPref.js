/**
 * Lựa chọn nhà cung cấp AI (Gemini / Claude / mẫu offline).
 * Lựa chọn của người dùng lưu ở localStorage (chỉ là trạng thái UI của thiết bị),
 * trạng thái API key lấy từ server qua /api/ai/providers.
 */
import { get, post } from './api.js';
import { esc, toast, modal } from './ui.js';

const KEY = 'nv_ai_provider';
let cache = null;

export const getProvider = () => localStorage.getItem(KEY) || 'auto';
export const setProvider = (v) => v && v !== 'auto' ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY);

export async function providers(force) {
  if (cache && !force) return cache;
  try {
    const d = await get('/ai/providers');
    cache = d;
  } catch (e) {
    cache = { providers: [{ key: 'mock', label: 'AI mẫu (offline)', icon: '🧪', configured: true }], active: 'mock' };
  }
  return cache;
}

export const providerName = (key) => {
  const p = (cache?.providers || []).find((x) => x.key === key);
  return p ? p.icon + ' ' + p.label : key;
};

/** Danh sách option cho <select> — dùng trong modal form */
export function providerOptions(d) {
  const list = (d || cache)?.providers || [];
  const auto = list.find((x) => x.key !== 'mock' && x.configured);
  return [
    { v: 'auto', n: 'Tự động' + (auto ? ' (' + auto.label + ')' : ' (AI mẫu)') },
    ...list.map((p) => ({ v: p.key, n: p.icon + ' ' + p.label + (p.configured ? '' : ' — chưa có API key') })),
  ];
}

/** Thanh chọn nhà cung cấp AI (HTML). Gọi bindPicker() sau khi render. */
export function pickerHTML(d) {
  const list = (d || cache)?.providers || [];
  const cur = getProvider();
  return `<div class="ai-picker row wrap" style="gap:6px;align-items:center">
    <span class="xs mut">Chạy bằng:</span>
    ${list.map((p) => `<button class="btn sm ${cur === p.key ? 'primary' : ''}" data-aiprov="${esc(p.key)}"
      title="${esc(p.configured ? (p.model || '') : 'Chưa nhập ' + (p.secret || 'API key'))}">
      ${p.icon} ${esc(p.label.replace('Google ', '').replace('Anthropic ', ''))}${p.configured ? '' : ' 🔒'}</button>`).join('')}
    ${cur === 'auto' ? '<span class="xs mut">· đang ở chế độ tự động</span>' : `<button class="btn sm" data-aiprov="auto">Tự động</button>`}
  </div>`;
}

export function bindPicker(el, after) {
  el.querySelectorAll('[data-aiprov]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.aiprov;
      const p = (cache?.providers || []).find((x) => x.key === k);
      if (p && !p.configured) {
        toast('Chưa cấu hình ' + p.secret + ' — vào Secrets của app để nhập API key', 'err');
        return;
      }
      setProvider(k);
      toast('Đang dùng ' + (k === 'auto' ? 'chế độ tự động' : p.label), 'ok');
      if (after) after(k);
    };
  });
}

/** Gọi AI kèm nhà cung cấp đang chọn. */
export async function askAI(body) {
  const r = await post('/ai/chat', { provider: getProvider(), ...body });
  if (r.providers) cache = { providers: r.providers, active: cache?.active };
  return r;
}

/** Khối hiển thị kết quả AI + nguồn AI đã dùng */
export function answerHTML(r) {
  return `<div class="ai-bubble">${esc(r.text)}</div>
    <div class="xs mut mt">Nguồn: ${esc((r.providerLabel || r.provider || 'AI') + (r.model && r.model !== 'rule-based' ? ' · ' + r.model : ''))}</div>
    ${r.notice ? `<div class="xs mt" style="color:#F59E0B">⚠️ ${esc(r.notice)}</div>` : ''}`;
}

export async function testProvider(key) {
  return post('/ai/test', { provider: key });
}

/**
 * Modal AI dùng chung cho mọi tính năng cần AI:
 * cho phép chọn Gemini / Claude / AI mẫu trước khi tạo nội dung.
 */
export async function aiModal({ title, kind, prompt, customerId, extra, promptLabel, submitText }) {
  const d = await providers();
  modal({
    title: title || '🤖 AI trợ lý',
    wide: true,
    fields: [
      { name: 'provider', label: 'Chọn AI xử lý', type: 'select', value: getProvider(), options: providerOptions(d) },
      { name: 'prompt', label: promptLabel || 'Nội dung yêu cầu', type: 'textarea', rows: 3, value: prompt || '' },
    ],
    submitText: submitText || 'Tạo bằng AI',
    html: '<div data-airesult class="mt"></div>',
    onSubmit: async (v, root) => {
      const out = root.querySelector('[data-airesult]');
      out.innerHTML = '<div class="ai-bubble">⏳ AI đang xử lý, vui lòng chờ…</div>';
      setProvider(v.provider);
      try {
        const r = await post('/ai/chat', { kind, provider: v.provider, prompt: v.prompt, customerId, extra });
        if (r.providers) cache = { providers: r.providers, active: cache?.active };
        out.innerHTML = answerHTML(r) + '<button type="button" class="btn sm mt" data-copy>📋 Sao chép</button>';
        const c = out.querySelector('[data-copy]');
        c.onclick = () => { try { navigator.clipboard.writeText(r.text); toast('Đã sao chép', 'ok'); } catch (e) { toast('Không sao chép được', 'err'); } };
      } catch (e) {
        out.innerHTML = `<div class="err-box">⚠️ ${esc(e.message)}</div>`;
      }
      return false;
    },
  });
}
