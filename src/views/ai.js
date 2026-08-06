import { get } from '../api.js';
import { esc, mount, empty, rel, toast } from '../ui.js';
import { askAI, pickerHTML, bindPicker, providers } from '../aiPref.js';

const msgs = [];

export async function render(el) {
  const load = async () => {
    const d = await get('/ai/tasks');
    await providers(true);
    return d;
  };

  const draw = (d) => {
    const list = d.providers || [];
    const real = list.filter(p => p.key !== 'mock' && p.configured);
    return `<div class="page-head">
    <div class="grow"><h2>🤖 AI Trợ lý bán hàng</h2>
      <p>Soạn email/proposal · xử lý từ chối · tra giá & hoa hồng · research khách hàng</p></div>
  </div>

  <div class="card mb">${pickerHTML(d)}
    <div class="xs mut mt">${real.length
      ? 'Đã kết nối: ' + real.map(p => esc(p.label + ' (' + p.model + ')')).join(' · ')
      : 'Chưa có API key nào — đang dùng nội dung mẫu. Nhập <code>GEMINI_API_KEY</code> hoặc <code>ANTHROPIC_API_KEY</code> trong Secrets của app là chạy ngay.'}</div>
  </div>

  <div class="seg mb">${d.tasks.map(t => `<button data-task="${esc(t.key)}">${esc(t.label)}</button>`).join('')}</div>

  <div class="card" data-chat style="min-height:180px">
    ${msgs.length ? msgs.map(m => `<div class="ai-bubble ${m.me ? 'me' : ''} mb">${esc(m.text)}${m.src ? `<div class="xs mut mt">${esc(m.src)}</div>` : ''}</div>`).join('')
      : empty('💬', 'Hỏi bất cứ điều gì: "báo giá TVC AI bao nhiêu?", "soạn email cho Sữa Việt Xanh", "khách chê giá cao thì trả lời sao?"')}
  </div>

  <div class="row mt" style="gap:8px">
    <input data-input placeholder="Nhập câu hỏi cho AI…" class="grow">
    <button class="btn primary" data-send>Gửi</button>
  </div>

  <div class="sec-title">Lịch sử gần đây</div>
  <div class="card">${(d.history || []).length ? d.history.slice(0, 8).map(h => `<div class="item">
      <div class="dot-i">🧠</div><div class="grow"><div class="t">${esc((h.prompt || h.kind).slice(0, 70))}</div>
      <div class="d xs">${esc(h.kind)} · ${rel(h.created_at)}</div></div>
      <button class="btn sm" data-replay="${esc(h.id)}">Xem</button></div>`).join('') : empty('🗒️', 'Chưa có lượt hỏi nào.')}</div>`;
  };

  const bind = (d) => {
    bindPicker(el, () => render(el));
    const input = el.querySelector('[data-input]');
    const send = async (kind) => {
      const text = input.value.trim();
      if (!text && !kind) { toast('Nhập nội dung trước nhé', 'err'); return; }
      msgs.push({ me: true, text: text || ('[Tác vụ nhanh] ' + kind) });
      const btn = el.querySelector('[data-send]');
      btn.disabled = true;
      input.value = '';
      const chat = el.querySelector('[data-chat]');
      if (chat) chat.insertAdjacentHTML('beforeend', '<div class="ai-bubble mb" data-typing>⏳ AI đang soạn nội dung…</div>');
      try {
        const r = await askAI({ kind, prompt: text });
        msgs.push({
          me: false, text: r.text,
          src: 'Nguồn: ' + (r.providerLabel || r.provider) + (r.model && r.model !== 'rule-based' ? ' · ' + r.model : ''),
        });
        if (r.notice) toast(r.notice, 'err');
      } catch (e) {
        msgs.push({ me: false, text: '⚠️ ' + e.message });
      } finally {
        btn.disabled = false;
        render(el);
      }
    };
    el.querySelector('[data-send]').onclick = () => send(null);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(null); });
    el.querySelectorAll('[data-task]').forEach(b => b.onclick = () => {
      const t = d.tasks.find(x => x.key === b.dataset.task);
      if (!input.value) input.placeholder = t.hint;
      send(b.dataset.task);
    });
    el.querySelectorAll('[data-replay]').forEach(b => b.onclick = () => {
      const h = d.history.find(x => x.id === b.dataset.replay);
      if (h) { msgs.push({ me: true, text: h.prompt || h.kind }); msgs.push({ me: false, text: h.response }); render(el); }
    });
    const chat = el.querySelector('[data-chat]');
    if (chat) chat.scrollTop = chat.scrollHeight;
  };

  await mount(el, load, draw, bind);
}
