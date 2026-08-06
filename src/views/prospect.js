import { get, post, patch } from '../api.js';
import { isLead } from '../state.js';
import { esc, money, mount, chip, empty, fmtDate, toast, modal, stat } from '../ui.js';
import { CHANNELS } from '../const.js';
import { aiModal } from '../aiPref.js';

let tab = 'tenders';

export async function render(el) {
  const load = async () => {
    const [t, l] = await Promise.all([get('/tenders'), get('/leads')]);
    return { tenders: t.items || [], leads: l.items || [] };
  };

  const draw = (d) => {
    const hot = d.tenders.filter(x => x.status === 'new' && x.score >= 70);
    const soon = d.tenders.filter(x => x.status === 'new' && x.deadline_at < Date.now() / 1000 + 7 * 86400);
    return `<div class="page-head">
      <div class="grow"><h2>Tìm khách & Research thầu</h2><p>7 kênh nguồn khách · AI chấm điểm lead · quét cơ hội đấu thầu (mock)</p></div>
      <button class="btn primary sm" data-scan>🔎 Quét thầu</button>
    </div>

    <div class="grid g3 mb">
      ${stat('Cơ hội thầu mới', d.tenders.filter(x => x.status === 'new').length, hot.length + ' gói điểm ≥70', 'red')}
      ${stat('Sắp hết hạn ≤7 ngày', soon.length, soon.length ? 'Ưu tiên làm hồ sơ' : 'Không gấp', soon.length ? 'amber' : '')}
      ${stat('Lead đang có', d.leads.length, d.leads.filter(x => x.status === 'new').length + ' chưa tiếp cận', 'blue')}
    </div>

    <div class="seg mb">
      <button data-tab="tenders" class="${tab === 'tenders' ? 'on' : ''}">Cơ hội đấu thầu</button>
      <button data-tab="leads" class="${tab === 'leads' ? 'on' : ''}">Danh sách lead</button>
      <button data-tab="channels" class="${tab === 'channels' ? 'on' : ''}">7 kênh nguồn khách</button>
    </div>

    ${tab === 'tenders' ? (d.tenders.length ? `<div class="card">${d.tenders.map(t => `<div class="item">
        <div class="dot-i">${t.score >= 75 ? '🔥' : '📑'}</div>
        <div class="grow"><div class="t">${esc(t.title)}</div>
          <div class="d">${esc(t.org || '')} · ${money(t.value)} · ${esc(t.service_tag || '')}</div>
          <div class="d xs">Hạn nộp ${fmtDate(t.deadline_at)} · nguồn ${esc(t.source || '')}</div>
          <div class="d xs">${esc(t.summary || '')}</div>
          <div class="row wrap mt" style="gap:6px">${chip('AI score ' + t.score, t.score >= 75 ? 'green' : t.score >= 60 ? 'amber' : 'grey')}
          ${t.status === 'converted' ? chip('Đã chuyển thành deal', 'blue') : t.status === 'ignored' ? chip('Bỏ qua', 'grey') : ''}</div>
        </div>
        <div class="right">
          ${t.status === 'new' ? `<button class="btn sm amber" data-conv="${esc(t.id)}">Chuyển deal</button>
            <div class="mt"><button class="btn sm" data-ign="${esc(t.id)}">Bỏ qua</button></div>` : ''}
          <div class="mt"><button class="btn sm" data-aitender="${esc(t.id)}">🤖 Phân tích</button></div>
        </div></div>`).join('')}</div>` : empty('📑', 'Chưa có cơ hội thầu nào.'))
      : tab === 'leads' ? `<button class="btn block mb" data-addlead>+ Thêm lead thủ công</button>
        ${d.leads.length ? `<div class="card">${d.leads.map(l => `<div class="item">
          <div class="dot-i">${l.score >= 75 ? '⭐' : '👤'}</div>
          <div class="grow"><div class="t">${esc(l.name)} — ${esc(l.company || '')}</div>
            <div class="d">${esc(l.channel || '')} · ${esc(l.phone || '')}</div>
            <div class="d xs">${esc(l.need || '')}</div></div>
          <div class="right">${chip('Score ' + l.score, l.score >= 75 ? 'green' : l.score >= 55 ? 'amber' : 'grey')}
            <div class="mt">${l.status === 'new' ? `<button class="btn sm amber" data-app="${esc(l.id)}">Tiếp cận</button>` : chip('Đã tiếp cận', 'blue')}</div>
            <div class="mt"><button class="btn sm" data-ailead="${esc(l.id)}">🤖 Research</button></div></div>
        </div>`).join('')}</div>` : empty('👤', 'Chưa có lead nào.')}`
      : `<div class="card">${CHANNELS.map(c => {
        const n = d.leads.filter(l => l.channel === c).length;
        return `<div class="item"><div class="dot-i">📡</div>
          <div class="grow"><div class="t">${esc(c)}</div><div class="d">${n} lead từ kênh này</div></div>
          <button class="btn sm" data-ch="${esc(c)}">+ Lead</button></div>`;
      }).join('')}</div>`}`;
  };

  const bind = (d) => {
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(el); });
    el.querySelectorAll('[data-aitender]').forEach(b => b.onclick = () => {
      const t = d.tenders.find(x => x.id === b.dataset.aitender);
      aiModal({
        title: '🤖 Phân tích cơ hội thầu',
        kind: 'coach',
        promptLabel: 'Yêu cầu phân tích',
        prompt: `Phân tích cơ hội thầu "${t.title}" của ${t.org || 'chủ đầu tư'}: nên theo hay bỏ, chiến lược làm hồ sơ và các bước trong 7 ngày tới.`,
        extra: `Giá trị gói: ${t.value}đ; mảng: ${t.service_tag || ''}; hạn nộp: ${fmtDate(t.deadline_at)}; điểm AI: ${t.score}; mô tả: ${t.summary || ''}`,
      });
    });
    el.querySelectorAll('[data-ailead]').forEach(b => b.onclick = () => {
      const l = d.leads.find(x => x.id === b.dataset.ailead);
      aiModal({
        title: '🤖 Research khách hàng tiềm năng',
        kind: 'research',
        promptLabel: 'Thông tin lead',
        prompt: `${l.company || l.name}`,
        extra: `Người liên hệ: ${l.name}; kênh: ${l.channel || ''}; nhu cầu: ${l.need || 'chưa rõ'}; điểm lead: ${l.score}`,
      });
    });
    el.querySelector('[data-scan]').onclick = async (e) => {
      e.target.disabled = true;
      try { await post('/tenders/scan', {}); toast('Đã quét & bổ sung cơ hội thầu mới (mock)', 'ok'); tab = 'tenders'; render(el); }
      catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
    };
    el.querySelectorAll('[data-conv]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await post('/tenders/' + b.dataset.conv + '/convert', {}); toast('Đã tạo khách hàng + deal từ gói thầu', 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); b.disabled = false; }
    });
    el.querySelectorAll('[data-ign]').forEach(b => b.onclick = async () => {
      try { await patch('/tenders/' + b.dataset.ign, { status: 'ignored' }); render(el); } catch (e) { toast(e.message, 'err'); }
    });
    el.querySelectorAll('[data-app]').forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await post('/leads/' + b.dataset.app + '/approach', {}); toast('Đã tiếp cận: tạo khách hàng + ghi hoạt động + tính định mức', 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); b.disabled = false; }
    });
    const add = el.querySelector('[data-addlead]');
    if (add) add.onclick = () => newLead('', () => render(el));
    el.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => newLead(b.dataset.ch, () => { tab = 'leads'; render(el); }));
  };

  await mount(el, load, draw, bind);
}

function newLead(channel, after) {
  modal({
    title: 'Thêm lead mới',
    fields: [
      { name: 'name', label: 'Người liên hệ', required: true },
      { name: 'company', label: 'Công ty' },
      { name: 'channel', label: 'Kênh', type: 'select', value: channel, options: CHANNELS },
      { name: 'phone', label: 'Điện thoại' }, { name: 'email', label: 'Email' },
      { name: 'need', label: 'Nhu cầu', type: 'textarea', rows: 2, placeholder: 'VD: cần TVC ra mắt sản phẩm Q4' },
    ],
    submitText: 'Thêm & chấm điểm AI',
    onSubmit: async (v) => { const r = await post('/leads', v); toast('Đã thêm lead — AI chấm ' + r.score + ' điểm', 'ok'); after(); },
  });
}
