import { get, post, patch } from '../api.js';
import { isLead, isAdmin, salesUsers, assigneeField } from '../state.js';
import { esc, money, mount, chip, empty, stat, toast, modal, fmtDate } from '../ui.js';
import { STAGES, TENDER_STAGES, TERMINAL_STAGES, SERVICES, stageName, PA_OPTIONS, EXEC_SOURCE_OPTIONS } from '../const.js';
import { logActivity } from './crm.js';
import { quickContact } from './cockpit.js';
import { icon } from '../icons.js';

let view = 'kanban';
let owner = 'all';
let procType = 'all';
/* 4 giai đoạn cuối dùng chung cho cả 2 quy trình (xem const.js TENDER_STAGES) — lấy {k,n,ic} từ
 * STAGES để hiển thị đúng trong select "Chuyển giai đoạn" của deal đấu thầu. */
const TERMINAL_STAGE_DEFS = STAGES.filter(s => TERMINAL_STAGES.includes(s.k));

export async function render(el) {
  const load = async () => {
    const [d, cus] = await Promise.all([
      get('/deals' + (isLead() && owner !== 'all' ? '?userId=' + owner : '')),
      get('/customers'),
    ]);
    return { ...d, customers: cus.items || [] };
  };

  const draw = (d) => {
    const open = d.items.filter(x => x.status === 'open');
    const expected = open.reduce((s, x) => s + x.expected, 0);
    const breach = d.items.filter(x => x.slaBreach);
    const tenders = d.items.filter(x => x.process_type === 'dau_thau');
    const shown = procType === 'dau_thau' ? tenders : d.items;
    const shownBreach = procType === 'dau_thau' ? breach.filter(x => x.process_type === 'dau_thau') : breach;
    return `<div class="page-head">
      <div class="grow"><h2>Pipeline & Deal</h2><p>14 giai đoạn · giá trị kỳ vọng tự tính · cờ SLA chống lead nguội</p></div>
      <div class="right">
        <button class="btn primary sm" data-add>+ Deal</button>
        <div class="mt"><button class="btn amber sm" data-quickcontact>+ Liên hệ mới hôm nay</button></div>
      </div>
    </div>

    <div class="grid g3 mb">
      ${stat('Deal đang mở', open.length, money(open.reduce((s, x) => s + x.value, 0)) + ' tổng giá trị', 'blue')}
      ${stat('Giá trị kỳ vọng', money(expected), 'Σ giá trị × xác suất', 'red')}
      ${stat('Vi phạm SLA', breach.length, breach.length ? 'Cần xử lý ngay' : 'Sạch SLA', breach.length ? 'amber' : '')}
    </div>

    <div class="seg mb">
      <button data-proc="all" class="${procType === 'all' ? 'on' : ''}">Toàn bộ</button>
      <button data-proc="dau_thau" class="${procType === 'dau_thau' ? 'on' : ''}">Đấu thầu (${tenders.length})</button>
    </div>
    ${procType === 'dau_thau' ? tenderStats(tenders) : ''}

    <div class="seg mb">
      <button data-view="kanban" class="${view === 'kanban' ? 'on' : ''}">Kanban</button>
      <button data-view="list" class="${view === 'list' ? 'on' : ''}">Danh sách</button>
      <button data-view="sla" class="${view === 'sla' ? 'on' : ''}">Cảnh báo SLA (${shownBreach.length})</button>
      ${isLead() ? `<button data-owner class="${owner !== 'all' ? 'on' : ''}">Lọc: ${owner === 'all' ? 'Toàn đội' : esc((salesUsers().find(u => u.id === owner) || {}).name || '')}</button>` : ''}
    </div>

    ${view === 'kanban' ? kanban(shown, procType === 'dau_thau' ? [...TENDER_STAGES, ...TERMINAL_STAGE_DEFS] : STAGES, d.sla)
      : view === 'list' ? list(shown) : list(shownBreach)}`;
  };

  const bind = (d) => {
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; render(el); });
    el.querySelectorAll('[data-proc]').forEach(b => b.onclick = () => { procType = b.dataset.proc; render(el); });
    // FR-M3-4: ghi nhanh liên hệ mới trong ngày ngay trên màn Pipeline
    const qc = el.querySelector('[data-quickcontact]');
    if (qc) qc.onclick = () => quickContact(() => render(el));
    const ob = el.querySelector('[data-owner]');
    if (ob) ob.onclick = () => modal({
      title: 'Lọc theo nhân sự',
      fields: [{ name: 'owner', label: 'Nhân sự', type: 'select', value: owner, options: [{ v: 'all', n: 'Toàn đội' }, ...salesUsers().map(u => ({ v: u.id, n: u.name }))] }],
      submitText: 'Áp dụng', onSubmit: (v) => { owner = v.owner; render(el); },
    });
    el.querySelector('[data-add]').onclick = () => addDeal(d.customers, () => render(el));
    el.querySelectorAll('[data-deal]').forEach(b => b.onclick = () => openDeal(d.items.find(x => x.id === b.dataset.deal), () => render(el)));
  };

  await mount(el, load, draw, bind);
}

const kanban = (items, stages, sla) => `<div class="kanban">${stages.map(s => {
  const arr = items.filter(x => x.stage === s.k);
  const sum = arr.reduce((a, x) => a + x.value, 0);
  return `<div class="kcol"><h4>${s.ic} ${esc(s.n)}</h4>
    <div class="xs mut">${arr.length} deal · ${money(sum)} · SLA ${sla[s.k] || 5} ngày</div>
    ${arr.map(x => `<div class="kcard ${x.slaBreach ? 'breach' : ''}" data-deal="${esc(x.id)}">
      ${x.process_type === 'dau_thau' ? '<span class="chip amber">Tập đoàn</span>' : ''}
      <div class="n">${esc(x.title)}</div>
      <div class="m">${esc(x.customer_name || '—')}${x.owner_name ? ' · ' + esc(x.owner_name) : ''}</div>
      <div class="row mt" style="gap:6px"><span class="chip blue">${money(x.value)}</span>
        <span class="chip grey">${x.probability}%</span>
        ${x.slaBreach ? `<span class="chip red">${x.idleDays}d</span>` : ''}</div>
    </div>`).join('') || '<div class="xs mut mt">— trống —</div>'}
  </div>`;
}).join('')}</div>`;

const tenderStats = (tenders) => {
  const decided = tenders.filter(x => x.status !== 'open');
  const won = decided.filter(x => x.status === 'won').length;
  const winRate = decided.length ? Math.round(won / decided.length * 100) : 0;
  return `<div class="grid g4 mb">
    ${stat('Chờ duyệt hồ sơ', tenders.filter(x => x.stage === 'cho_duyet_ho_so').length, 'Cần Giám đốc duyệt', 'amber')}
    ${stat('Thương thảo vòng ≥ 2', tenders.filter(x => x.stage === 'thuong_thao' && (x.negotiation_round || 0) >= 1).length, 'Khách mời thương thảo lại', 'blue')}
    ${stat('MOU đang chờ', tenders.filter(x => x.stage === 'mou').length, 'Chờ khách phản hồi', '')}
    ${stat('Tỷ lệ thắng thầu', winRate + '%', decided.length + ' gói đã có kết quả', winRate >= 50 ? '' : 'red')}
  </div>`;
};

const list = (items) => items.length ? `<div class="card">${items.map(x => `<div class="item">
    <div class="dot-i">${icon(x.status === 'won' ? 'trophy' : x.slaBreach ? 'flame' : 'trendingUp')}</div>
    <div class="grow"><div class="t">${esc(x.title)}</div>
      <div class="d">${esc(x.customer_name || '—')} · ${stageName(x.stage)} · KV ${money(x.expected)}</div>
      <div class="d xs">Cập nhật ${x.idleDays} ngày trước · SLA ${x.slaLimit} ngày${x.owner_name ? ' · ' + esc(x.owner_name) : ''}</div></div>
    <div class="right">${chip(money(x.value), 'blue')}
      <div class="mt"><button class="btn sm" data-deal="${esc(x.id)}">Mở</button></div></div>
  </div>`).join('')}</div>` : empty('inbox', 'Không có deal nào ở nhóm này.');

function addDeal(customers, after) {
  modal({
    title: 'Tạo cơ hội mới',
    fields: [
      { name: 'title', label: 'Tên cơ hội', required: true, placeholder: 'VD: TVC AI ra mắt sản phẩm X' },
      { name: 'customerId', label: 'Khách hàng', type: 'select', options: customers.map(c => ({ v: c.id, n: c.name })) },
      { name: 'service', label: 'Dịch vụ', type: 'select', options: SERVICES },
      { name: 'value', label: 'Giá trị (đ)', type: 'number', value: 50000000 },
      { name: 'stage', label: 'Giai đoạn', type: 'select', options: STAGES.map(s => ({ v: s.k, n: s.n })) },
      { name: 'phuongAnHopTac', label: 'Phương án hợp tác (nếu qua Partner)', type: 'select', options: [{ v: '', n: '— không —' }, ...PA_OPTIONS] },
      ...(isLead() ? [assigneeField('ownerId')] : []),
    ],
    onSubmit: async (v) => { await post('/deals', v); toast('Đã tạo cơ hội', 'ok'); after(); },
  });
}

export function openDeal(x, after) {
  if (!x) return;
  const isTender = x.process_type === 'dau_thau';
  const stageOptions = (isTender ? [...TENDER_STAGES, ...TERMINAL_STAGE_DEFS] : STAGES).map(s => ({ v: s.k, n: s.n }));
  const { close } = modal({
    title: x.title,
    wide: true,
    html: `<div class="sm mut mb">${isTender ? '<span class="chip amber">Tập đoàn · Đấu thầu</span> ' : ''}${esc(x.customer_name || '')} · ${money(x.value)} · ${stageName(x.stage)}
      ${x.slaBreach ? `<span class="chip red">Quá SLA ${x.idleDays}/${x.slaLimit} ngày</span>` : `<span class="chip green">Trong SLA</span>`}
      · Dự kiến chốt ${fmtDate(x.expected_close_at)}</div>`,
    fields: [
      { name: 'stage', label: 'Chuyển giai đoạn', type: 'select', value: x.stage, options: stageOptions },
      { name: 'value', label: 'Giá trị (đ)', type: 'number', value: x.value },
      { name: 'probability', label: 'Xác suất (%)', type: 'number', value: x.probability },
      { name: 'phuongAnHopTac', label: 'Phương án hợp tác', type: 'select', value: x.phuong_an_hop_tac || '', options: [{ v: '', n: '— không —' }, ...PA_OPTIONS] },
      { name: 'nguonThucHien', label: 'Nguồn thực hiện (bước 1-3)', type: 'select', value: x.nguon_thuc_hien || '', options: [{ v: '', n: '— chưa rõ —' }, ...EXEC_SOURCE_OPTIONS] },
      { name: 'note', label: 'Ghi chú cập nhật', type: 'textarea', rows: 2, value: x.note || '' },
    ],
    submitText: 'Cập nhật deal',
    onSubmit: async (v) => { await patch('/deals/' + x.id, v); toast('Đã cập nhật pipeline', 'ok'); after(); },
  });
  // các nút phụ trong modal
  const root = document.getElementById('modal-root');
  const extra = document.createElement('div');
  extra.className = 'row mt';
  extra.style.gap = '8px';
  extra.innerHTML = `<button type="button" class="btn sm grow" data-x-act>+ Hoạt động</button>
    <button type="button" class="btn sm grow" data-x-contact>+ Liên hệ mới</button>
    <button type="button" class="btn sm grow" data-x-lost>Đánh dấu thua</button>`;
  const form = root.querySelector('[data-form]');
  if (form) form.appendChild(extra);
  extra.querySelector('[data-x-act]').onclick = () => logActivity({ customerId: x.customer_id, dealId: x.id }, after);
  extra.querySelector('[data-x-contact]').onclick = () => quickContact(after);
  extra.querySelector('[data-x-lost]').onclick = () => modal({
    title: 'Đánh dấu deal thua', fields: [{ name: 'lostReason', label: 'Lý do', required: true }],
    submitText: 'Xác nhận', onSubmit: async (v) => { await patch('/deals/' + x.id, { status: 'lost', lostReason: v.lostReason }); toast('Đã cập nhật', 'ok'); after(); },
  });

  if (isTender && x.stage === 'thuong_thao' && form) {
    const round = document.createElement('div');
    round.className = 'row mt';
    round.style.gap = '8px';
    round.innerHTML = `<span class="sm mut grow">Vòng thương thảo hiện tại: <b>${(x.negotiation_round || 0) + 1}</b></span>
      <button type="button" class="btn sm" data-x-round>+ Vòng thương thảo mới</button>`;
    form.appendChild(round);
    round.querySelector('[data-x-round]').onclick = async () => {
      await patch('/deals/' + x.id, { negotiationRound: (x.negotiation_round || 0) + 1 });
      toast('Đã ghi nhận vòng thương thảo mới', 'ok');
      close();
      logActivity({ customerId: x.customer_id, dealId: x.id }, after);
    };
  }
  if (isTender && x.stage === 'cho_duyet_ho_so' && form) {
    const approve = document.createElement('div');
    approve.className = 'row mt';
    approve.style.gap = '8px';
    approve.innerHTML = isAdmin()
      ? `<button type="button" class="btn sm primary grow" data-x-approve>Duyệt hồ sơ dự thầu</button>`
      : `<span class="sm mut">Đang chờ Giám đốc duyệt hồ sơ trước khi nộp.</span>`;
    form.appendChild(approve);
    const ab = approve.querySelector('[data-x-approve]');
    if (ab) ab.onclick = async () => { await patch('/deals/' + x.id, { stage: 'da_nop_ho_so' }); toast('Đã duyệt hồ sơ dự thầu', 'ok'); close(); after(); };
  }
}
