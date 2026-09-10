import { get, post, patch } from '../api.js';
import { state, isLead } from '../state.js';
import { esc, money, mount, chip, empty, rel, fmtDT, toast, modal, stat, bindTabs } from '../ui.js';
import { planKindName, PLAN_ITEM_STATUS, PLAN_APPROVERS } from '../const.js';
import {
  canDecide, canDecideContract, needsResubmit,
  quoteItem, contractItem, bindDocActions, quoteBuilder, contractBuilder,
} from '../salesDocs.js';
import { aiModal } from '../aiPref.js';
import { icon } from '../icons.js';

/**
 * Phương án kinh doanh — nơi chạy trọn vòng đời một thương vụ: Báo giá · Hợp đồng · Nghiệm thu ·
 * Thanh lý.
 *
 * Bước 1 & 2 gắn thẳng vào CHỨNG TỪ THẬT (nv_quotes / nv_contracts) với luồng duyệt 2 vòng sẵn có
 * — trước đây hai bước này bắt kinh doanh gõ lại số tiền vào ô summary rồi trình duyệt lần nữa,
 * nên cùng một báo giá tồn tại hai bản và TPKD phải duyệt hai lần. Bước 3 & 4 không có chứng từ
 * nào trong hệ thống nên giữ nguyên cách nhập tay + duyệt 1 vòng.
 */

let tab = 'plans';

/** Hạng mục còn nhập tay — khớp MANUAL_KINDS ở server/routes/plans.js. */
const MANUAL_KINDS = ['nghiem_thu', 'thanh_ly'];
/** Ai duyệt bước nào — ghi rõ ngay trên từng bước vì hai nhóm bước có số vòng duyệt khác nhau,
 * để người dùng không phải đoán vì sao bước 1-2 đi qua nhiều người hơn bước 3-4. */
const DOC_APPROVERS = { bao_gia: 'TPKD (V1) → Giám đốc (V2)', hop_dong: 'TPKD (V1) → HCNS (V2)' };

/** Chứng từ thuộc bước `kind` của phương án đang mở. */
const docsFor = (d, kind) => (kind === 'bao_gia' ? d.quotes : d.contracts) || [];
/** Báo giá dưới ngưỡng chiết khấu được lưu thẳng ở 'draft' — không ai phải duyệt, nên tính là
 * bước đã xong (xem POST /api/quotes ở server/routes/deals.js). Hợp đồng luôn phải qua đủ 2 vòng. */
const docDone = (x, kind) => kind === 'bao_gia' ? ['approved', 'draft'].includes(x.status) : x.status === 'approved';

/** Trạng thái hiển thị của bước 1/bước 2, suy ra từ chứng từ đã gắn. Dùng lại đúng 4 khoá của
 * PLAN_ITEM_STATUS để chip trông y hệt hai bước nhập tay. Ưu tiên: cần sửa > chờ duyệt > xong. */
function docStepStatus(docs, kind) {
  if (!docs.length) return 'todo';
  if (docs.some(needsResubmit)) return 'revise';
  if (docs.some(x => ['pending_v1', 'pending_v2'].includes(x.status))) return 'pending';
  if (docs.some(x => docDone(x, kind))) return 'approved';
  return 'todo';
}

/** Chủ phương án được trình hạng mục chưa trình hoặc đang bị trả lại. */
const canSubmit = (it, plan) => ['todo', 'revise'].includes(it.status)
  && (plan.owner_id === state.me.id || isLead());
/** Người đang xem có quyền duyệt hạng mục nhập tay `it` không — Admin/BGĐ duyệt được mọi hạng mục,
 * TPKD chỉ duyệt hạng mục được trình cho Trưởng phòng. Khớp điều kiện ở server/routes/plans.js. */
const canDecideItem = (it) => it.status === 'pending'
  && (state.me.role === 'admin' || (state.me.role === 'manager' && it.approver_role === 'manager'));

/* ================================ Danh sách ================================ */

export async function render(el, params) {
  if (params && params.id) return detail(el, params.id);

  const load = async () => {
    const [pl, pr, q, c, cus, dl] = await Promise.all([
      get('/plans'), get('/products'), get('/quotes'), get('/contracts'), get('/customers'), get('/deals'),
    ]);
    return {
      plans: pl.items || [], products: pr.items || [], threshold: pr.discountThreshold,
      quotes: q.items || [], contracts: c.items || [],
      customers: cus.items || [], deals: dl.items || [],
    };
  };

  const draw = (d) => {
    const pending = d.plans.reduce((s, x) => s + x.pending_n, 0);
    const revise = d.plans.reduce((s, x) => s + x.revise_n, 0);
    return `<div class="page-head">
      <div class="grow"><h2>Phương án kinh doanh</h2>
        <p>Báo giá · Hợp đồng · Nghiệm thu · Thanh lý — lập chứng từ, trình duyệt và nhận phản hồi trên cùng một luồng</p></div>
      <div class="right"><button class="btn primary sm" data-new>+ Báo giá</button>
        <div class="mt"><button class="btn sm" data-newcontract>+ Hợp đồng</button></div>
        <div class="mt"><button class="btn sm" data-aiprop>${icon('bot', 14)} AI soạn proposal</button></div></div>
    </div>

    <div class="grid g3 mb">
      ${stat('Phương án đang theo dõi', d.plans.length, isLead() ? 'Toàn đội' : 'Của bạn', 'blue')}
      ${stat('Hạng mục chờ duyệt', pending, isLead() ? 'Cần bạn xử lý' : 'Đang chờ TP/GĐ/HCNS', pending ? 'amber' : '')}
      ${stat('Hạng mục cần chỉnh sửa', revise, 'Bị trả lại, cần sửa và trình lại', revise ? 'red' : '')}
    </div>

    <div class="seg mb">
      <button data-tab="plans" class="${tab === 'plans' ? 'on' : ''}">Phương án (${d.plans.length})</button>
      <button data-tab="quotes" class="${tab === 'quotes' ? 'on' : ''}">Báo giá (${d.quotes.length})</button>
      ${isLead() ? `<button data-tab="approve" class="${tab === 'approve' ? 'on' : ''}">Chờ duyệt giá (${d.quotes.filter(canDecide).length})</button>` : ''}
      <button data-tab="contracts" class="${tab === 'contracts' ? 'on' : ''}">Hợp đồng (${d.contracts.length})</button>
      ${isLead() ? `<button data-tab="approveContracts" class="${tab === 'approveContracts' ? 'on' : ''}">Chờ duyệt HĐ (${d.contracts.filter(canDecideContract).length})</button>` : ''}
    </div>

    ${tab === 'plans' ? `<div class="note mb">Tạo phương án từ <b>CRM 360° → mở khách hàng → Tạo phương án kinh doanh</b>.
      Mỗi phương án có sẵn 4 hạng mục theo đúng thứ tự vòng đời thương vụ; báo giá và hợp đồng lập ngay tại bước 1 và bước 2.
      Cần báo giá nhanh chưa gắn phương án nào thì dùng nút <b>+ Báo giá</b> ở trên.</div>

      ${d.plans.length ? `<div class="card">${d.plans.map(pl => `<a class="item" href="#/plans/${esc(pl.id)}">
        <div class="dot-i">${icon('clipboardList')}</div>
        <div class="grow"><div class="t">${esc(pl.title)}</div>
          <div class="d">${esc(pl.customer_name || '—')}${isLead() ? ' · ' + esc(pl.owner_name || '') : ''}</div>
          <div class="d xs">${pl.approved_n}/4 hạng mục đã duyệt · cập nhật ${rel(pl.updated_at)}</div></div>
        <div class="right">
          ${pl.revise_n ? chip(pl.revise_n + ' cần sửa', 'red') : ''}
          ${pl.pending_n ? chip(pl.pending_n + ' chờ duyệt', 'amber') : ''}
          ${!pl.revise_n && !pl.pending_n && pl.approved_n === 4 ? chip('Hoàn tất', 'green') : ''}
        </div>
      </a>`).join('')}</div>` : empty('clipboardList', 'Chưa có phương án nào. Tạo từ CRM 360° trên trang khách hàng.')}` : ''}

    ${tab === 'quotes' || tab === 'approve' ? (() => {
      const arr = tab === 'approve' ? d.quotes.filter(canDecide) : d.quotes;
      return arr.length ? `<div class="card">${arr.map(quoteItem).join('')}</div>` : empty('fileText', 'Chưa có báo giá nào.');
    })() : ''}

    ${tab === 'contracts' || tab === 'approveContracts' ? (() => {
      const arr = tab === 'approveContracts' ? d.contracts.filter(canDecideContract) : d.contracts;
      return arr.length ? `<div class="card">${arr.map(contractItem).join('')}</div>` : empty('penLine', 'Chưa có hợp đồng nào.');
    })() : ''}`;
  };

  const bind = (d) => {
    bindTabs(el, t => tab = t, render);
    el.querySelector('[data-new]').onclick = () => quoteBuilder(d, {}, () => { tab = 'quotes'; render(el); });
    el.querySelector('[data-newcontract]').onclick = () => contractBuilder(d, {}, () => { tab = 'contracts'; render(el); });
    el.querySelector('[data-aiprop]').onclick = () => aiModal({
      title: 'AI soạn proposal', titleIcon: 'bot',
      kind: 'proposal',
      promptLabel: 'Mô tả khách hàng & ngân sách',
      prompt: 'Khách hàng ngành FMCG, ngân sách 300 triệu, muốn TVC AI + chuỗi video viền TikTok cho Q4.',
    });
    bindDocActions(el, d, () => render(el));
  };

  await mount(el, load, draw, bind);
}

/* ================================ Chi tiết ================================ */

async function detail(el, id) {
  const load = async () => {
    const [pl, pr] = await Promise.all([get('/plans/' + id), get('/products')]);
    return { ...pl, products: pr.items || [], threshold: pr.discountThreshold };
  };

  const draw = (d) => `<div class="page-head">
    <a class="btn sm" href="#/plans">${icon('arrowLeft', 15)}</a>
    <div class="grow"><h2>${esc(d.plan.title)}</h2>
      <p>${esc(d.customer?.name || '—')}${d.customer?.industry ? ' · ' + esc(d.customer.industry) : ''}</p></div>
    <a class="btn sm" href="#/crm/${esc(d.plan.customer_id)}">Hồ sơ khách</a>
  </div>

  ${d.plan.note ? `<div class="note mb">${esc(d.plan.note)}</div>` : ''}

  <div class="card">
    <div class="b sm mb">Luồng trình duyệt</div>
    ${d.items.map((it, i) => flowStep(it, i === d.items.length - 1, d)).join('')}
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
    const reload = () => detail(el, id);
    // Chung một preset cho cả báo giá lẫn hợp đồng lập từ trong phương án: khách hàng và cơ hội
    // đã biết nên không hỏi lại, và planId để chứng từ gắn đúng bước của phương án này.
    const preset = {
      lockTarget: true, planId: d.plan.id, planTitle: d.plan.title,
      customerId: d.plan.customer_id, customerName: d.customer?.name || '', dealId: d.plan.deal_id || '',
    };
    const newQuote = el.querySelector('[data-newquote]');
    if (newQuote) newQuote.onclick = () => quoteBuilder(d, preset, reload);
    const newContract = el.querySelector('[data-newcontract]');
    if (newContract) newContract.onclick = () => contractBuilder(d, preset, reload);
    const aiProp = el.querySelector('[data-aiprop]');
    if (aiProp) aiProp.onclick = () => aiModal({
      title: 'AI soạn proposal', titleIcon: 'bot',
      kind: 'proposal',
      customerId: d.plan.customer_id,
      promptLabel: 'Mô tả nhu cầu & ngân sách',
      prompt: `Soạn proposal cho ${d.customer?.name || 'khách hàng'} theo phương án "${d.plan.title}".`,
      extra: d.plan.note || '',
    });

    el.querySelectorAll('[data-submit]').forEach(b => b.onclick = () => {
      const it = d.items.find(x => x.id === b.dataset.submit);
      submitModal(id, it, reload);
    });
    el.querySelectorAll('[data-ok-item]').forEach(b => b.onclick = () => decideModal(id, d.items.find(x => x.id === b.dataset.okItem), 'approved', reload));
    el.querySelectorAll('[data-revise-item]').forEach(b => b.onclick = () => decideModal(id, d.items.find(x => x.id === b.dataset.reviseItem), 'revise', reload));

    bindDocActions(el, d, reload);

    const input = el.querySelector('[data-msg]');
    const send = async () => {
      const message = input.value.trim();
      if (!message) return;
      try {
        await post('/plans/' + id + '/comment', { message });
        input.value = '';
        reload();
      } catch (e) { toast(e.message, 'err'); }
    };
    el.querySelector('[data-send]').onclick = send;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
  };
  await mount(el, load, draw, bind);
}

/** Một mốc trong luồng. Hai bước đầu (báo giá, hợp đồng) vẽ từ chứng từ thật; hai bước cuối
 * (nghiệm thu, thanh lý) giữ nguyên ô nhập tay + duyệt 1 vòng vì không có chứng từ tương ứng. */
function flowStep(it, last, d) {
  const isDoc = !MANUAL_KINDS.includes(it.kind);
  const docs = isDoc ? docsFor(d, it.kind) : [];
  const statusKey = isDoc ? docStepStatus(docs, it.kind) : it.status;
  const st = PLAN_ITEM_STATUS[statusKey] || PLAN_ITEM_STATUS.todo;
  const mark = statusKey === 'approved' ? '✓' : statusKey === 'revise' ? '!' : statusKey === 'pending' ? '…' : '·';

  return `<div class="flow-step">
    <div class="flow-rail">
      <div class="flow-dot ${esc(statusKey)}">${mark}</div>
      ${last ? '' : '<div class="flow-line"></div>'}
    </div>
    <div class="flow-body">
      <div class="row wrap" style="gap:7px">
        <b style="font-size:13.7px">${esc(planKindName(it.kind))}</b>${chip(st.n, st.c)}
        <span class="xs mut">duyệt: ${esc(isDoc ? DOC_APPROVERS[it.kind] : approverLabel(it))}</span>
      </div>
      ${isDoc ? docStepBody(it, docs) : manualStepBody(it, d.plan)}
    </div>
  </div>`;
}

/** Thân bước Báo giá / Hợp đồng: danh sách chứng từ đã gắn + nút lập chứng từ mới. Các nút Xem ·
 * AI · Tài liệu · Sửa & gửi lại · Duyệt nằm sẵn trong quoteItem/contractItem và được bindDocActions
 * nối vào, không cần khai báo lại ở đây. */
function docStepBody(it, docs) {
  const isQuote = it.kind === 'bao_gia';
  // Phương án lập TRƯỚC khi hai bước này chuyển sang chứng từ thật có thể còn nội dung gõ tay và
  // phản hồi của người duyệt trong nv_plan_items. Giữ lại dạng chỉ-đọc thay vì để biến mất —
  // đó là trao đổi thật giữa kinh doanh và TPKD, không phải rác dữ liệu.
  const legacy = it.summary || it.decision_note ? `<div class="note mt">
      <div class="xs mut">Nội dung nhập tay trước đây (đã ngừng dùng, giữ để tham khảo)</div>
      ${it.summary ? `<div class="sm">${esc(it.summary)}${it.value ? ' · ' + money(it.value) : ''}</div>` : ''}
      ${it.decision_note ? `<div class="sm"><b>Phản hồi:</b> ${esc(it.decision_note)}</div>` : ''}
    </div>` : '';
  // Danh sách chứng từ vẽ trần bên trong bước, KHÔNG bọc .card: .card có hiệu ứng nhấc lên khi
  // hover, lồng trong một .card khác thì cả khối bước nhảy theo con trỏ. .item đã tự có đường kẻ
  // phân cách nên vẫn đọc ra danh sách.
  return `${legacy}${docs.length
    ? `<div class="mt">${docs.map(isQuote ? quoteItem : contractItem).join('')}</div>`
    : `<div class="sm mut" style="margin-top:3px">Chưa có ${isQuote ? 'báo giá' : 'hợp đồng'} nào cho phương án này.</div>`}
    <div class="row wrap mt" style="gap:6px">
      <button class="btn sm ${docs.length ? '' : 'primary'}" data-${isQuote ? 'newquote' : 'newcontract'}>+ ${isQuote ? 'Tạo báo giá' : 'Lập hợp đồng'}</button>
      ${isQuote ? `<button class="btn sm" data-aiprop>${icon('bot', 14)} AI soạn proposal</button>` : ''}
    </div>`;
}

/** Thân bước Nghiệm thu / Thanh lý — giữ nguyên hành vi cũ. */
function manualStepBody(it, plan) {
  return `${it.approver_name && it.status !== 'pending' ? `<div class="xs mut" style="margin-top:3px">${esc(it.approver_name)} · ${fmtDT(it.decided_at)}</div>` : ''}
    ${it.summary ? `<div class="sm mut" style="margin-top:3px">${esc(it.summary)}${it.value ? ' · ' + money(it.value) : ''}</div>` : ''}
    ${it.decision_note ? `<div class="note ${it.status === 'revise' ? 'red' : 'blue'}" style="margin-top:7px"><b>Phản hồi:</b> ${esc(it.decision_note)}</div>` : ''}
    <div class="row wrap mt" style="gap:6px">
      ${canSubmit(it, plan) ? `<button class="btn sm ${it.status === 'revise' ? 'amber' : 'primary'}" data-submit="${esc(it.id)}">${it.status === 'revise' ? 'Sửa & trình lại' : 'Trình duyệt'}</button>` : ''}
      ${canDecideItem(it) ? `<button class="btn sm amber" data-ok-item="${esc(it.id)}">Duyệt</button>
        <button class="btn sm" data-revise-item="${esc(it.id)}">Yêu cầu điều chỉnh</button>` : ''}
      ${it.status === 'pending' && !canDecideItem(it) ? `<span class="xs mut">Đã trình ${fmtDT(it.submitted_at)}</span>` : ''}
    </div>`;
}

const approverLabel = (it) => (PLAN_APPROVERS.find(a => a.v === it.approver_role) || {}).n || 'Trưởng phòng KD';

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
  nghiem_thu: 'VD: Biên bản nghiệm thu đợt 1 — 6/12 tập, kèm file gốc.',
  thanh_ly: 'VD: Thanh lý hợp đồng, đã bàn giao đủ 12/12 tập.',
}[kind] || '');

const eventIcon = (k) => k === 'approved' ? 'circleCheck' : k === 'revise' ? 'triangleAlert'
  : k === 'submit' ? 'inbox' : k === 'create' ? 'sparkles' : 'messageSquare';
const eventLabel = (k) => ({ approved: 'Đã duyệt', revise: 'Yêu cầu điều chỉnh', submit: 'Trình duyệt', create: 'Tạo phương án' }[k] || 'Trao đổi');
const eventTone = (k) => ({ approved: 'green', revise: 'red', submit: 'amber', create: 'blue' }[k] || 'grey');
