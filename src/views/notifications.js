import { get, post } from '../api.js';
import { state } from '../state.js';
import { esc, rel, fmtDT, empty, toast } from '../ui.js';
import { icon } from '../icons.js';
import { t as tr } from '../i18n.js';

/* Trung tâm thông báo — toàn bộ thông báo của tài khoản (không chỉ 30 cái mới nhất), lọc theo mức độ
 * và loại, tải thêm thông báo cũ. #/thong-bao/<id> (mở từ thông báo đẩy trên điện thoại/máy tính) làm
 * nổi bật đúng thông báo đó, tự đánh dấu đã đọc và có nút đi tới màn liên quan. */

const FILTERS = [
  ['all', 'Tất cả'],
  ['unread', 'Chưa đọc'],
  ['urgent', 'Khẩn cấp'],
  ['approval', 'Cần duyệt'],
  ['work', 'Công việc & lịch khách'],
  ['kpi', 'KPI & chỉ số sale'],
];
const GROUP = {
  approval: 'approval', plan: 'approval',
  task: 'work', assignment: 'work', meeting: 'work', report: 'work', handover: 'work', tender: 'work',
  kpi: 'kpi', sales_alert: 'kpi', pip: 'kpi', sla: 'kpi', deal: 'kpi',
};
const TYPE_LABEL = {
  approval: 'Cần duyệt', plan: 'Phương án', task: 'Công việc', assignment: 'Giao việc', meeting: 'Lịch khách',
  report: 'Báo cáo', handover: 'Bàn giao', tender: 'Thầu', kpi: 'KPI', sales_alert: 'Chỉ số sale', pip: 'PIP',
  sla: 'SLA deal', deal: 'Deal', customer: 'Khách hàng', training: 'Đào tạo',
};
const LEVEL_ICON = { danger: 'siren', warn: 'triangleAlert', info: 'bell', ok: 'circleCheck' };

let filter = 'all';
let items = [];
let more = false;

const match = (n) => filter === 'all' ? true
  : filter === 'unread' ? !n.read
  : filter === 'urgent' ? n.level === 'danger'
  : GROUP[n.type] === filter;

export async function render(el, { id } = {}) {
  el.innerHTML = `<div class="nt-page"><div class="page-head">
      <div class="grow"><h2>${icon('bell', 19, { style: 'margin-right:6px' })}${tr('Thông báo')}</h2>
        <p>${tr('Toàn bộ cảnh báo, nhắc việc và phê duyệt của bạn — chạm vào một thông báo để mở màn liên quan.')}</p></div>
      <button class="btn sm" data-read-all>${icon('circleCheck', 14)}${tr('Đánh dấu đã đọc tất cả')}</button>
    </div>
    <div data-push-hint></div>
    <div class="seg mb" data-filters></div>
    <div data-list><div class="card"><div class="sm mut">${tr('Đang tải…')}</div></div></div></div>`;

  pushHint(el.querySelector('[data-push-hint]'));
  el.querySelector('[data-read-all]').onclick = async () => {
    await post('/notifications/read', {});
    items.forEach(n => { n.read = 1; });
    setUnread(0);
    draw(el);
    toast('Đã đánh dấu đã đọc tất cả', 'ok');
  };

  try {
    const d = await get('/notifications?limit=100');
    items = d.items || [];
    more = !!d.more;
    setUnread(d.unread || 0);
  } catch (e) {
    el.querySelector('[data-list]').innerHTML = `<div class="err-box">${icon('triangleAlert', 15)} ${esc(e.message)}</div>`;
    return;
  }

  let focus = null;
  if (id) {
    focus = items.find(n => n.id === id);
    if (focus) { filter = 'all'; if (!focus.read) await markRead(focus); }
  }
  draw(el, focus && focus.id);
}

function draw(el, focusId) {
  const unread = items.filter(n => !n.read).length;
  el.querySelector('[data-filters]').innerHTML = FILTERS.map(([k, label]) => {
    const n = k === 'unread' ? unread : k === 'urgent' ? items.filter(x => x.level === 'danger' && !x.read).length : 0;
    return `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${tr(label)}${n ? ` <span class="nt-count">${n}</span>` : ''}</button>`;
  }).join('');
  el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; draw(el); });

  const list = items.filter(match);
  const box = el.querySelector('[data-list]');
  box.innerHTML = list.length
    ? `<div class="card nt-list">${list.map(n => row(n, n.id === focusId)).join('')}</div>`
      + (more ? `<button class="btn block mt" data-more>${tr('Tải thêm thông báo cũ hơn')}</button>` : '')
    : `<div class="card">${empty('bell', filter === 'all' ? tr('Chưa có thông báo.') : tr('Không có thông báo nào trong mục này.'))}</div>`
      + (more && filter !== 'all' ? `<button class="btn block mt" data-more>${tr('Tải thêm thông báo cũ hơn')}</button>` : '');

  box.querySelectorAll('[data-open]').forEach(r => r.onclick = async (e) => {
    const n = items.find(x => x.id === r.dataset.open);
    if (!n) return;
    if (!n.read) await markRead(n);
    if (n.link && !e.target.closest('[data-mark]')) location.hash = n.link;
    else draw(el);
  });
  const mb = box.querySelector('[data-more]');
  if (mb) mb.onclick = async () => {
    mb.disabled = true;
    try {
      const d = await get('/notifications?limit=100&before=' + items[items.length - 1].created_at);
      items = items.concat(d.items || []);
      more = !!d.more;
      draw(el);
    } catch (e) { toast(e.message, 'err'); mb.disabled = false; }
  };
  if (focusId) {
    const f = box.querySelector('.nt-row.focus');
    if (f) f.scrollIntoView({ block: 'center' });
  }
}

function row(n, focus) {
  const lv = n.level || 'info';
  return `<div class="nt-row ${n.read ? '' : 'unread'} ${focus ? 'focus' : ''}" data-open="${esc(n.id)}" role="button" tabindex="0">
    <div class="nt-ic ${lv}">${icon(LEVEL_ICON[lv] || 'bell', 17)}</div>
    <div class="grow">
      <div class="nt-t">${esc(n.title)}</div>
      ${n.body ? `<div class="nt-d">${esc(n.body)}</div>` : ''}
      <div class="nt-meta">${TYPE_LABEL[n.type] ? `<span class="chip ${lv === 'danger' ? 'red' : lv === 'warn' ? 'amber' : 'blue'}">${esc(tr(TYPE_LABEL[n.type]))}</span>` : ''}
        <span title="${esc(fmtDT(n.created_at))}">${esc(rel(n.created_at))}</span></div>
      ${focus && n.link ? `<a class="btn primary sm mt" href="${esc(n.link)}">${icon('chevronRight', 14)}${tr('Mở màn liên quan')}</a>` : ''}
    </div>
    ${n.read ? '' : `<span class="nt-dot" data-mark title="${esc(tr('Chưa đọc'))}"></span>`}
    ${n.link ? `<span class="nt-go">${icon('chevronRight', 16)}</span>` : ''}
  </div>`;
}

async function markRead(n) {
  try {
    await post('/notifications/read', { id: n.id });
    n.read = 1;
    setUnread(Math.max(0, (state.unread || 0) - 1));
  } catch (e) { /* đọc lại lần sau */ }
}

function setUnread(n) {
  state.unread = n;
  window.dispatchEvent(new Event('nv:unread-changed'));
}

/* Nhắc bật thông báo đẩy nếu máy này chưa bật — để cảnh báo tới được cả khi không mở app. */
async function pushHint(slot) {
  const pwa = window.nvPWA;
  if (!pwa || pwa.pushUnsupportedReason() || pwa.embeddedBrowser()) return;
  try {
    const s = await pwa.pushStatus();
    if (!s.configured || s.currentDeviceSubscribed || !slot.isConnected) return;
    slot.innerHTML = `<div class="note blue mb row" style="gap:10px;align-items:center">
      <div class="grow sm">${icon('smartphone', 14)} ${tr('Thiết bị này chưa bật thông báo đẩy — bạn sẽ không nhận được cảnh báo khi không mở app.')}</div>
      <a class="btn primary sm" href="#/more/thong-bao">${tr('Bật ngay')}</a></div>`;
  } catch (e) { /* bỏ qua gợi ý */ }
}
