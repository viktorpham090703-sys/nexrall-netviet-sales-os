import { get, post, patch } from '../api.js';
import { state, isLead, isAdmin } from '../state.js';
import { esc, money, mount, chip, empty, fmtDate, toast, modal, stat, bindTabs } from '../ui.js';
import { CHANNELS, SERVICES, APPROVAL_TONE } from '../const.js';
import { aiModal } from '../aiPref.js';
import { icon } from '../icons.js';

let tab = 'tenders';
const isHR = () => state.me?.role === 'hr';

/* HCNS chỉ xét duyệt hồ sơ thầu — không có nhiệm vụ tìm khách/quét thầu/quản lý lead của phòng
 * kinh doanh, nên trang "Duyệt Thầu" của HCNS chỉ còn đúng 1 danh sách chờ duyệt. */
async function renderHR(el) {
  const load = async () => {
    const d = await get('/deals');
    return { pending: (d.items || []).filter(x => x.process_type === 'dau_thau' && x.stage === 'cho_duyet_ho_so') };
  };
  const draw = (d) => {
    const t = APPROVAL_TONE.tender;
    return `<div class="page-head">
      <div class="grow"><h2>Duyệt Thầu</h2><p>Hồ sơ dự thầu chờ duyệt trước khi nộp</p></div>
    </div>
    <div class="grid g4 mb">${stat('Hồ sơ chờ duyệt', d.pending.length, 'Giám đốc duyệt trước khi nộp', t.chip)}</div>
    <div>${d.pending.length ? `<div class="card">${d.pending.map(x => `<div class="item">
        <div class="dot-i" style="background:transparent;color:${t.color};border:1.5px solid ${t.color}">${icon('trophy')}</div>
        <div class="grow"><div class="t">${esc(x.title)}</div>
          <div class="d">${esc(x.customer_name || '')} · ${esc(x.owner_name || '')}</div>
          <div class="d xs">Giá trị ${money(x.value)}</div></div>
        <div class="right">${isAdmin() ? `<button class="btn sm amber" data-ok-tender="${esc(x.id)}">Duyệt hồ sơ</button>` : `<span class="xs" style="color:${t.color}">Chờ Giám đốc duyệt</span>`}</div>
      </div>`).join('')}</div>` : empty('circleCheck', 'Không có hồ sơ thầu chờ duyệt.')}</div>`;
  };
  const bind = () => {
    el.querySelectorAll('[data-ok-tender]').forEach(b => b.onclick = async () => {
      try { await patch('/deals/' + b.dataset.okTender, { stage: 'da_nop_ho_so' }); toast('Đã duyệt hồ sơ dự thầu', 'ok'); render(el); }
      catch (e) { toast(e.message, 'err'); }
    });
  };
  await mount(el, load, draw, bind);
}

export async function render(el) {
  if (isHR()) return renderHR(el);

  const load = async () => {
    const [t, l] = await Promise.all([get('/tenders'), get('/leads')]);
    return { tenders: t.items || [], leads: l.items || [] };
  };

  const draw = (d) => {
    const hot = d.tenders.filter(x => x.status === 'new' && x.score >= 70);
    const soon = d.tenders.filter(x => x.status === 'new' && x.deadline_at < Date.now() / 1000 + 7 * 86400);
    return `<div class="page-head">
      <div class="grow"><h2>Tìm khách & Research thầu</h2><p>7 kênh nguồn khách · AI chấm điểm lead · quét cơ hội đấu thầu (mock)</p></div>
      <div class="row" style="gap:8px">
        <button class="btn primary sm" data-scan>${icon('search', 14)} Quét thầu</button>
        ${isLead() ? `<button class="btn amber sm" data-add-tender>${icon('userPlus', 14)} Thêm thầu</button>` : ''}
      </div>
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
        <div class="dot-i">${icon(t.score >= 75 ? 'flame' : 'files')}</div>
        <div class="grow"><div class="t">${esc(t.title)}</div>
          <div class="d">${esc(t.org || '')} · ${money(t.value)} · ${esc(t.service_tag || '')}</div>
          <div class="d xs">Hạn nộp ${fmtDate(t.deadline_at)} · nguồn ${esc(t.source || '')}</div>
          <div class="d xs">${esc(t.summary || '')}</div>
          <div class="row wrap mt" style="gap:6px">${chip('AI score ' + t.score, t.score >= 75 ? 'green' : t.score >= 60 ? 'amber' : 'grey')}
          ${t.source === 'Quan hệ trực tiếp' ? chip('Quan hệ trực tiếp', 'amber') : chip('Quét tự động', 'grey')}
          ${t.status === 'converted' ? chip('Đã chuyển thành deal', 'blue') : t.status === 'ignored' ? chip('Bỏ qua', 'grey') : ''}</div>
        </div>
        <div class="right">
          ${t.status === 'new' ? `<button class="btn sm amber" data-conv="${esc(t.id)}">Chuyển deal</button>
            <div class="mt"><button class="btn sm" data-ign="${esc(t.id)}">Bỏ qua</button></div>` : ''}
          <div class="mt"><button class="btn sm" data-aitender="${esc(t.id)}">${icon('bot', 14)} Phân tích</button></div>
        </div></div>`).join('')}</div>` : empty('files', 'Chưa có cơ hội thầu nào.'))
      : tab === 'leads' ? `<button class="btn block mb" data-addlead>+ Thêm lead thủ công</button>
        ${d.leads.length ? `<div class="card">${d.leads.map(l => `<div class="item">
          <div class="dot-i">${icon(l.score >= 75 ? 'star' : 'user')}</div>
          <div class="grow"><div class="t">${esc(l.name)} — ${esc(l.company || '')}</div>
            <div class="d">${esc(l.channel || '')} · ${esc(l.phone || '')}</div>
            <div class="d xs">${esc(l.need || '')}</div></div>
          <div class="right">${chip('Score ' + l.score, l.score >= 75 ? 'green' : l.score >= 55 ? 'amber' : 'grey')}
            <div class="mt">${l.status === 'new' ? `<button class="btn sm amber" data-app="${esc(l.id)}">Tiếp cận</button>` : chip('Đã tiếp cận', 'blue')}</div>
            <div class="mt"><button class="btn sm" data-ailead="${esc(l.id)}">${icon('bot', 14)} Research</button></div></div>
        </div>`).join('')}</div>` : empty('user', 'Chưa có lead nào.')}`
      : `<div class="card">${CHANNELS.map(c => {
        const n = d.leads.filter(l => l.channel === c).length;
        return `<div class="item"><div class="dot-i">${icon('radio')}</div>
          <div class="grow"><div class="t">${esc(c)}</div><div class="d">${n} lead từ kênh này</div></div>
          <button class="btn sm" data-ch="${esc(c)}">+ Lead</button></div>`;
      }).join('')}</div>`}`;
  };

  const bind = (d) => {
    bindTabs(el, t => tab = t, render);
    el.querySelectorAll('[data-aitender]').forEach(b => b.onclick = () => {
      const t = d.tenders.find(x => x.id === b.dataset.aitender);
      aiModal({
        title: 'Phân tích cơ hội thầu', titleIcon: 'bot',
        kind: 'coach',
        promptLabel: 'Yêu cầu phân tích',
        prompt: `Phân tích cơ hội thầu "${t.title}" của ${t.org || 'chủ đầu tư'}: nên theo hay bỏ, chiến lược làm hồ sơ và các bước trong 7 ngày tới.`,
        extra: `Giá trị gói: ${t.value}đ; mảng: ${t.service_tag || ''}; hạn nộp: ${fmtDate(t.deadline_at)}; điểm AI: ${t.score}; mô tả: ${t.summary || ''}`,
      });
    });
    el.querySelectorAll('[data-ailead]').forEach(b => b.onclick = () => {
      const l = d.leads.find(x => x.id === b.dataset.ailead);
      aiModal({
        title: 'Research khách hàng tiềm năng', titleIcon: 'bot',
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
    const addT = el.querySelector('[data-add-tender]');
    if (addT) addT.onclick = () => addTender(() => { tab = 'tenders'; render(el); });
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

/* Ghi nhận thủ công cơ hội thầu đến từ quan hệ trực tiếp (GĐ/BLĐ tiếp cận trước, khách chủ động
 * gửi mời thầu) — khác luồng vào với "Quét thầu" (cổng công khai, mock). Xem quy-trinh-dau-thau-
 * tap-doan-lon.md bước 1-2. */
function addTender(after) {
  modal({
    title: 'Thêm cơ hội thầu (quan hệ trực tiếp)',
    fields: [
      { name: 'title', label: 'Tên gói thầu', required: true, placeholder: 'VD: Gói thầu sản xuất TVC quý 4' },
      { name: 'org', label: 'Chủ đầu tư / Tập đoàn' },
      { name: 'serviceTag', label: 'Dịch vụ', type: 'select', options: SERVICES },
      { name: 'value', label: 'Giá trị ước tính (đ)', type: 'number', value: 500000000 },
      { name: 'deadlineAt', label: 'Hạn nộp hồ sơ', type: 'date' },
      { name: 'summary', label: 'Ghi chú', type: 'textarea', rows: 2, placeholder: 'Bối cảnh tiếp cận, yêu cầu hồ sơ...' },
    ],
    submitText: 'Thêm cơ hội thầu',
    onSubmit: async (v) => {
      await post('/tenders', { ...v, deadlineAt: v.deadlineAt ? new Date(v.deadlineAt).getTime() / 1000 : undefined });
      toast('Đã thêm cơ hội thầu', 'ok'); after();
    },
  });
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
