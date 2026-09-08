import { get, post, patch } from '../api.js';
import { state, isLead } from '../state.js';
import { esc, money, mount, chip, empty, rel, fmtDT, toast, modal, stat } from '../ui.js';
import { planKindName, PLAN_ITEM_STATUS, PLAN_APPROVERS } from '../const.js';
import { icon } from '../icons.js';

/**
 * Phương án kinh doanh — luồng trình duyệt 4 hạng mục (Báo giá · Hợp đồng · Nghiệm thu · Thanh lý)
 * của một thương vụ. Kinh doanh trình từng hạng mục lên TPKD hoặc Giám đốc; phản hồi của người
 * duyệt hiện ngay tại hạng mục đó và trong nhật ký trao đổi bên dưới.
 */

/** Người đang xem có quyền duyệt hạng mục `it` không — Admin/BGĐ duyệt được mọi hạng mục, TPKD
 * chỉ duyệt hạng mục được trình cho Trưởng phòng. Khớp điều kiện ở server/routes/plans.js. */
const canDecide = (it) => it.status === 'pending'
  && (state.me.role === 'admin' || (state.me.role === 'manager' && it.approver_role === 'manager'));
/** Chủ phương án được trình hạng mục chưa trình hoặc đang bị trả lại. */
const canSubmit = (it, plan) => ['todo', 'revise'].includes(it.status)
  && (plan.owner_id === state.me.id || isLead());

export async function render(el, params) {
  if (params && params.id) return detail(el, params.id);

  const load = () => get('/plans');
  const draw = (d) => {
    const pending = d.items.reduce((s, x) => s + x.pending_n, 0);
    const revise = d.items.reduce((s, x) => s + x.revise_n, 0);
    return `<div class="page-head">
      <div class="grow"><h2>Phương án kinh doanh</h2>
        <p>Báo giá · Hợp đồng · Nghiệm thu · Thanh lý — trình duyệt và nhận phản hồi trên cùng một luồng</p></div>
    </div>

    <div class="grid g3 mb">
      ${stat('Phương án đang theo dõi', d.items.length, isLead() ? 'Toàn đội' : 'Của bạn', 'blue')}
      ${stat('Hạng mục chờ duyệt', pending, isLead() ? 'Cần bạn xử lý' : 'Đang chờ TP/GĐ', pending ? 'amber' : '')}
      ${stat('Hạng mục cần chỉnh sửa', revise, 'Bị trả lại, cần sửa và trình lại', revise ? 'red' : '')}
    </div>

    <div class="note mb">Tạo phương án từ <b>CRM 360° → mở khách hàng → Tạo phương án kinh doanh</b>.
      Mỗi phương án có sẵn 4 hạng mục theo đúng thứ tự vòng đời thương vụ.</div>

    ${d.items.length ? `<div class="card">${d.items.map(pl => `<a class="item" href="#/plans/${esc(pl.id)}">
        <div class="dot-i">${icon('clipboardList')}</div>
        <div class="grow"><div class="t">${esc(pl.title)}</div>
          <div class="d">${esc(pl.customer_name || '—')}${isLead() ? ' · ' + esc(pl.owner_name || '') : ''}</div>
          <div class="d xs">${pl.approved_n}/4 hạng mục đã duyệt · cập nhật ${rel(pl.updated_at)}</div></div>
        <div class="right">
          ${pl.revise_n ? chip(pl.revise_n + ' cần sửa', 'red') : ''}
          ${pl.pending_n ? chip(pl.pending_n + ' chờ duyệt', 'amber') : ''}
          ${!pl.revise_n && !pl.pending_n && pl.approved_n === 4 ? chip('Hoàn tất', 'green') : ''}
        </div>
      </a>`).join('')}</div>` : empty('clipboardList', 'Chưa có phương án nào. Tạo từ CRM 360° trên trang khách hàng.')}`;
  };
  await mount(el, load, draw, () => { });
}

async function detail(el, id) {
  const load = () => get('/plans/' + id);

  const draw = (d) => `<div class="page-head">
    <a class="btn sm" href="#/plans">${icon('arrowLeft', 15)}</a>
    <div class="grow"><h2>${esc(d.plan.title)}</h2>
      <p>${esc(d.customer?.name || '—')}${d.customer?.industry ? ' · ' + esc(d.customer.industry) : ''}</p></div>
    <a class="btn sm" href="#/crm/${esc(d.plan.customer_id)}">Hồ sơ khách</a>
  </div>

  ${d.plan.note ? `<div class="note mb">${esc(d.plan.note)}</div>` : ''}

  <div class="card">
    <div class="b sm mb">Luồng trình duyệt</div>
    ${d.items.map((it, i) => flowStep(it, i === d.items.length - 1, d.plan)).join('')}
  </div>

  <div class="sec-title">Nhật ký trao đổi</div>
  <div class="card">
    <div class="row mb" style="gap:8px">
      <input placeholder="Viết phản hồi hoặc cập nhật cho phương án này…" data-msg class="grow">
      <button class="btn sm primary" data-send>Gửi</button>
    </div>
    ${d.events.length ? d.events.map(e => `<div class="item">
      <div class="dot-i">${icon(eventIcon(e.kind))}</div>
      <div class="grow"><div class="t">${esc(e.user_name || '—')} ${chip(eventLabel(e.kind), eventTone(e.kind))}</div>
        <div class="d">${esc(e.message || '')}</div>
        <div class="d xs">${fmtDT(e.created_at)}${e.item_id ? ' · ' + esc(planKindName((d.items.find(x => x.id === e.item_id) || {}).kind || '')) : ''}</div></div>
    </div>`).join('') : empty('messageSquare', 'Chưa có trao đổi nào.')}
  </div>`;

  const bind = (d) => {
    el.querySelectorAll('[data-submit]').forEach(b => b.onclick = () => {
      const it = d.items.find(x => x.id === b.dataset.submit);
      submitModal(id, it, () => detail(el, id));
    });
    el.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => decideModal(id, d.items.find(x => x.id === b.dataset.ok), 'approved', () => detail(el, id)));
    el.querySelectorAll('[data-revise]').forEach(b => b.onclick = () => decideModal(id, d.items.find(x => x.id === b.dataset.revise), 'revise', () => detail(el, id)));

    const input = el.querySelector('[data-msg]');
    const send = async () => {
      const message = input.value.trim();
      if (!message) return;
      try {
        await post('/plans/' + id + '/comment', { message });
        input.value = '';
        detail(el, id);
      } catch (e) { toast(e.message, 'err'); }
    };
    el.querySelector('[data-send]').onclick = send;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
  };
  await mount(el, load, draw, bind);
}

/** Một mốc trong luồng: trạng thái, nội dung đã trình, phản hồi của người duyệt, và nút hành động. */
function flowStep(it, last, plan) {
  const st = PLAN_ITEM_STATUS[it.status] || PLAN_ITEM_STATUS.todo;
  const mark = it.status === 'approved' ? '✓' : it.status === 'revise' ? '!' : it.status === 'pending' ? '…' : '·';
  const approverLabel = (PLAN_APPROVERS.find(a => a.v === it.approver_role) || {}).n || 'Trưởng phòng KD';
  return `<div class="flow-step">
    <div class="flow-rail">
      <div class="flow-dot ${esc(it.status)}">${mark}</div>
      ${last ? '' : '<div class="flow-line"></div>'}
    </div>
    <div class="flow-body">
      <div class="row wrap" style="gap:7px">
        <b style="font-size:13.7px">${esc(planKindName(it.kind))}</b>${chip(st.n, st.c)}
        ${it.status === 'pending' ? `<span class="xs mut">chờ ${esc(approverLabel)}</span>` : ''}
        ${it.approver_name && it.status !== 'pending' ? `<span class="xs mut">${esc(it.approver_name)} · ${fmtDT(it.decided_at)}</span>` : ''}
      </div>
      ${it.summary ? `<div class="sm mut" style="margin-top:3px">${esc(it.summary)}${it.value ? ' · ' + money(it.value) : ''}</div>` : ''}
      ${it.decision_note ? `<div class="note ${it.status === 'revise' ? 'red' : 'blue'}" style="margin-top:7px"><b>Phản hồi:</b> ${esc(it.decision_note)}</div>` : ''}
      <div class="row wrap mt" style="gap:6px">
        ${canSubmit(it, plan) ? `<button class="btn sm ${it.status === 'revise' ? 'amber' : 'primary'}" data-submit="${esc(it.id)}">${it.status === 'revise' ? 'Sửa & trình lại' : 'Trình duyệt'}</button>` : ''}
        ${canDecide(it) ? `<button class="btn sm amber" data-ok="${esc(it.id)}">Duyệt</button>
          <button class="btn sm" data-revise="${esc(it.id)}">Yêu cầu điều chỉnh</button>` : ''}
        ${it.status === 'pending' && !canDecide(it) ? `<span class="xs mut">Đã trình ${fmtDT(it.submitted_at)}</span>` : ''}
      </div>
    </div>
  </div>`;
}

function submitModal(planId, it, after) {
  modal({
    title: (it.status === 'revise' ? 'Sửa & trình lại: ' : 'Trình duyệt: ') + planKindName(it.kind),
    html: it.decision_note ? `<div class="note red mb"><b>Yêu cầu điều chỉnh lần trước:</b> ${esc(it.decision_note)}</div>` : '',
    fields: [
      { name: 'summary', label: 'Nội dung ' + planKindName(it.kind).toLowerCase(), type: 'textarea', rows: 3, required: true, value: it.summary || '', placeholder: placeholderFor(it.kind) },
      { name: 'value', label: 'Giá trị (đ) — bỏ trống nếu không có', type: 'number', value: it.value || '' },
      { name: 'approverRole', label: 'Trình cho ai duyệt', type: 'select', value: it.approver_role || 'manager', options: PLAN_APPROVERS },
    ],
    submitText: 'Gửi duyệt',
    onSubmit: async (v) => {
      try {
        await patch(`/plans/${planId}/items/${it.id}`, { summary: v.summary, value: Number(v.value) || 0, approverRole: v.approverRole });
        toast('Đã trình duyệt — người duyệt đã nhận được thông báo.', 'ok');
        after();
      } catch (e) { toast(e.message, 'err'); return false; }
    },
  });
}

function decideModal(planId, it, decision, after) {
  modal({
    title: (decision === 'approved' ? 'Duyệt: ' : 'Yêu cầu điều chỉnh: ') + planKindName(it.kind),
    html: `<div class="sm mut mb">${esc(it.summary || '')}${it.value ? ' · ' + money(it.value) : ''}</div>`,
    fields: [{
      name: 'note', label: decision === 'approved' ? 'Ghi chú cho kinh doanh (tuỳ chọn)' : 'Cần điều chỉnh gì',
      type: 'textarea', rows: 3, required: decision === 'revise',
      placeholder: decision === 'revise' ? 'VD: Thiếu biên bản bàn giao đợt 1, bổ sung trước 10/09.' : '',
    }],
    submitText: decision === 'approved' ? 'Duyệt' : 'Trả lại để sửa',
    onSubmit: async (v) => {
      try {
        await patch(`/plans/${planId}/items/${it.id}`, { decision, note: v.note });
        toast(decision === 'approved' ? 'Đã duyệt' : 'Đã trả lại kèm yêu cầu điều chỉnh', 'ok');
        after();
      } catch (e) { toast(e.message, 'err'); return false; }
    },
  });
}

const placeholderFor = (kind) => ({
  bao_gia: 'VD: 850.000.000 đ, chiết khấu 8%, hiệu lực 30 ngày.',
  hop_dong: 'VD: 40% tạm ứng · 40% sau ghi hình · 20% sau nghiệm thu.',
  nghiem_thu: 'VD: Biên bản nghiệm thu đợt 1 — 6/12 tập, kèm file gốc.',
  thanh_ly: 'VD: Thanh lý hợp đồng, đã bàn giao đủ 12/12 tập.',
}[kind] || '');

const eventIcon = (k) => k === 'approved' ? 'circleCheck' : k === 'revise' ? 'triangleAlert'
  : k === 'submit' ? 'inbox' : k === 'create' ? 'sparkles' : 'messageSquare';
const eventLabel = (k) => ({ approved: 'Đã duyệt', revise: 'Yêu cầu điều chỉnh', submit: 'Trình duyệt', create: 'Tạo phương án' }[k] || 'Trao đổi');
const eventTone = (k) => ({ approved: 'green', revise: 'red', submit: 'amber', create: 'blue' }[k] || 'grey');
