import { boot, state, isLead } from './state.js';
import { get, post, sessionToken } from './api.js';
import { esc, avatar, toast, modal, rel, empty, beginRender } from './ui.js';
import { roleLabel, BRAND_LOGO } from './const.js';
import { icon, dot } from './icons.js';

import * as VLogin from './views/login.js';
import * as VSetPassword from './views/setPassword.js';
import * as VCockpit from './views/cockpit.js';
import * as VCrm from './views/crm.js';
import * as VPipeline from './views/pipeline.js';
import * as VActivity from './views/activity.js';
import * as VTasks from './views/tasks.js';
import * as VReports from './views/reports.js';
import * as VKpi from './views/kpi.js';
import * as VAi from './views/ai.js';
import * as VProspect from './views/prospect.js';
import * as VSaleskit from './views/saleskit.js';
import * as VConsole from './views/console.js';
import * as VTraining from './views/training.js';
import * as VAdmin from './views/admin.js';
import * as VMore from './views/more.js';
import * as VProfile from './views/profile.js';
import * as VPlans from './views/plans.js';

const VIEWS = {
  login: VLogin, cockpit: VCockpit, crm: VCrm, pipeline: VPipeline, activities: VActivity,
  tasks: VTasks, reports: VReports, kpi: VKpi, ai: VAi, prospect: VProspect,
  saleskit: VSaleskit, console: VConsole, training: VTraining, admin: VAdmin, more: VMore, profile: VProfile,
  plans: VPlans,
};

const SALES_NAV = [
  ['cockpit', icon('home'), 'Trang chủ'], ['pipeline', icon('barChart2'), 'Pipeline'], ['prospect', icon('search'), 'Tìm khách'],
  ['tasks', icon('inbox'), 'Việc'], ['more', icon('moreHorizontal'), 'Thêm'],
];
const SALES_SIDE_NAV = [
  { sec: 'Điều hành', items: [['cockpit', icon('home'), 'Trang chủ'], ['pipeline', icon('barChart2'), 'Pipeline'], ['prospect', icon('search'), 'Tìm khách'], ['tasks', icon('inbox'), 'Việc']] },
  { sec: 'Khác', items: [['crm', icon('folderOpen'), 'CRM 360° Khách hàng'], ['plans', icon('clipboardList'), 'Phương án kinh doanh'], ['ai', icon('bot'), 'AI Trợ lý'], ['activities', icon('calendarDays'), 'Lịch & Hoạt động'], ['reports', icon('clipboardList'), 'Báo cáo EOD & Tuần'], ['kpi', icon('trophy'), 'KPI & Hoa hồng'], ['saleskit', icon('fileText'), 'Sales Kit & Báo giá'], ['training', icon('graduationCap'), 'Đào tạo']] },
];
const LEAD_NAV = [
  { sec: 'Điều hành', items: [['console', icon('slidersHorizontal'), 'Console đội'], ['cockpit', icon('home'), 'Trang chủ cá nhân'], ['tasks', icon('inbox'), 'Giao việc & SLA']] },
  { sec: 'Kinh doanh', items: [['pipeline', icon('barChart2'), 'Pipeline đội'], ['crm', icon('folderOpen'), 'CRM 360°'], ['plans', icon('clipboardList'), 'Phương án kinh doanh'], ['prospect', icon('search'), 'Tìm khách & Thầu'], ['saleskit', icon('fileText'), 'Sales Kit & Báo giá']] },
  { sec: 'Đo lường', items: [['reports', icon('clipboardList'), 'Báo cáo'], ['kpi', icon('trophy'), 'KPI · Hoa hồng · PIP'], ['activities', icon('calendarDays'), 'Hoạt động']] },
  { sec: 'Khác', items: [['training', icon('graduationCap'), 'Đào tạo'], ['ai', icon('bot'), 'AI Trợ lý'], ['admin', icon('usersRound'), 'Quản trị']] },
];
/* HCNS chỉ cần xem/xét duyệt — không có nhiệm vụ điều hành đội sales (Pipeline, CRM, Báo cáo,
 * KPI, Đào tạo...), nên menu chỉ còn đúng 5 mục. "console" giữ nguyên route (đã là trang duyệt
 * của HCNS) nhưng đổi nhãn/icon thành "Trang chủ" vì đây là màn hình chính của HCNS. */
const HR_NAV = [
  { sec: 'Điều hành', items: [
    ['console', icon('home'), 'Trang chủ'],
    ['prospect', icon('search'), 'Duyệt Thầu'],
    ['saleskit', icon('fileText'), 'Duyệt Báo giá'],
    ['activities', icon('calendarDays'), 'Duyệt Hợp đồng'],
    ['admin', icon('usersRound'), 'Quản trị'],
  ] },
];

function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [view, id] = h.split('/');
  return { view: view || '', id: id || '' };
}

const homeView = () => isLead() ? 'console' : 'cockpit';
const notiBadge = () => icon('bell', 17) + (state.unread ? `<span class="dot">${state.unread}</span>` : '');

function shell(view) {
  const me = state.me;
  const lead = isLead();
  const navGroups = me.role === 'hr' ? HR_NAV : lead ? LEAD_NAV : SALES_SIDE_NAV;
  const nav = navGroups.map(g => `<div class="sec">${esc(g.sec)}</div>` + g.items
    .filter(i => i[0] !== 'admin' || isLead())
    .map(i => `<a href="#/${i[0]}" class="${view === i[0] ? 'active' : ''}"><span>${i[1]}</span>${esc(i[2])}</a>`).join('')).join('');
  return `<div class="shell with-side">
    <aside class="sidebar" id="sidebar">
      <div class="row mb"><a href="#/${homeView()}" class="brand-logo-link"><img class="brand-logo" src="${BRAND_LOGO}" alt="NetViet Sales"></a></div>
      <a href="#/profile" class="side-profile-btn ${view === 'profile' ? 'active' : ''}">
        ${avatar(me)}
        <div class="side-profile-info">
          <div class="side-profile-name">${esc(me.name)}</div>
          <div class="side-profile-role">${esc(roleLabel(me))}</div>
        </div>
      </a>
      ${nav}
      ${!lead ? `<div class="sec">Hệ thống</div><a href="#/more" class="${view === 'more' ? 'active' : ''}"><span>${icon('settings', 15)}</span>Cài đặt</a>` : ''}
    </aside>
    <div class="grow" style="min-width:0;display:flex;flex-direction:column">
      <header class="topbar">
        <button class="icon-btn menu-btn" data-menu>${icon('menu', 18)}</button>
        <div class="brand">NetViet Sales OS<span class="xs mut" style="font-weight:600"> · ${esc(roleLabel(me))}</span></div>
        <div class="grow"></div>
        <button class="icon-btn" data-noti>${notiBadge()}</button>
        ${avatar(me, 'data-me')}
      </header>
      <main id="main"></main>
      ${!lead ? `<nav class="bottom-nav desktop-hide">${SALES_NAV.map(i => i[0] === 'more'
        ? `<a href="#" data-menu><span class="ic">${i[1]}</span>${esc(i[2])}</a>`
        : `<a href="#/${i[0]}" class="${view === i[0] ? 'active' : ''}"><span class="ic">${i[1]}</span>${esc(i[2])}</a>`).join('')}</nav>` : ''}
    </div>
  </div>`;
}

async function showNotifications() {
  try {
    const d = await get('/notifications');
    modal({
      title: 'Thông báo',
      submitText: 'Đánh dấu đã đọc tất cả',
      html: d.items.length ? `<div>${d.items.slice(0, 30).map(n => `<div class="item">
        <div class="dot-i">${dot(n.level === 'danger' ? '#DC2626' : n.level === 'warn' ? '#F59E0B' : '#2563EB')}</div>
        <div class="grow"><div class="t">${esc(n.title)}</div>
          <div class="d">${esc(n.body || '')}</div><div class="d xs">${rel(n.created_at)}</div></div>
        ${n.link ? `<a class="btn sm" href="${esc(n.link)}">Xem</a>` : ''}</div>`).join('')}</div>` : empty('bell', 'Chưa có thông báo.'),
      onSubmit: async () => { await post('/notifications/read', {}); state.unread = 0; render(); },
    });
  } catch (e) { toast(e.message, 'err'); }
}

let currentShellRole = null;

async function render() {
  const app = document.getElementById('app');
  let { view, id } = parseHash();

  // Đặt mật khẩu qua liên kết dùng 1 lần: route công khai, không cần đăng nhập
  // (khớp với việc /api/setup-token/:token ở backend cũng không yêu cầu session).
  if (view === 'dat-mat-khau') {
    currentShellRole = null;
    return VSetPassword.render(app, { id });
  }

  if (!state.me) {
    if (view !== 'login') { location.hash = '#/login'; }
    currentShellRole = null;
    return VLogin.render(app);
  }

  // Buộc đổi mật khẩu ở lần đăng nhập đầu (vd: admin do production tự khởi tạo từ secret) —
  // chặn mọi màn khác cho tới khi đặt xong mật khẩu mới.
  if (state.me.must_change_password && view !== 'dat-mat-khau') {
    location.hash = '#/dat-mat-khau';
    currentShellRole = null;
    return VSetPassword.render(app, {});
  }

  if (!view || view === 'login') { view = homeView(); location.replace('#/' + view); }
  // Điều hướng minh bạch: không âm thầm rơi về Cockpit nữa
  let block = null;
  if (!VIEWS[view]) block = { icon: 'compass', title: 'Không tìm thấy trang', desc: `Đường dẫn "#/${view}" không tồn tại trong ứng dụng.` };
  else if ((view === 'console' || view === 'admin') && !isLead()) {
    block = { icon: 'lock', title: 'Bạn không có quyền truy cập', desc: 'Màn hình này dành cho Trưởng phòng / Ban Giám đốc. Nếu cần quyền, vui lòng liên hệ quản trị viên.' };
  }

  const shellView = block ? homeView() : view;
  if (currentShellRole !== state.me.role || !document.getElementById('main')) {
    app.innerHTML = shell(shellView);
    currentShellRole = state.me.role;
    bindShell();
  } else {
    // cập nhật trạng thái active của nav
    app.querySelectorAll('.sidebar a, .bottom-nav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === '#/' + shellView);
    });
    const badge = app.querySelector('[data-noti]');
    if (badge) badge.innerHTML = notiBadge();
  }

  const main = document.getElementById('main');
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.remove('open');

  if (block) {
    main.innerHTML = `<div class="page-head"><div class="grow"><h2>${icon(block.icon, 19, { style: 'margin-right:6px' })}${esc(block.title)}</h2>
      <p>${esc(block.desc)}</p></div></div>
      <div class="card" style="text-align:center;padding:28px">
        <div style="margin-bottom:8px">${icon(block.icon, 40)}</div>
        <div class="b">${esc(block.title)}</div>
        <div class="sm mut mt">${esc(block.desc)}</div>
        <div class="mt"><a class="btn primary sm" href="#/${homeView()}">Về trang chính</a></div>
      </div>`;
    return;
  }

  try {
    beginRender(main);
    await VIEWS[view].render(main, { id });
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="err-box">${icon('triangleAlert', 15)} ${esc(e.message || 'Lỗi hiển thị')}</div>`;
  }
}

function bindShell() {
  const app = document.getElementById('app');
  const wire = (sel, fn) => { const el = app.querySelector(sel); if (el) el.onclick = fn; };
  wire('[data-noti]', showNotifications);
  wire('[data-me]', () => { location.hash = '#/profile'; });
  app.querySelectorAll('[data-menu]').forEach(el => el.onclick = (e) => {
    e.preventDefault();
    document.getElementById('sidebar').classList.toggle('open');
  });
}

window.addEventListener('hashchange', render);
window.addEventListener('error', (e) => console.error('Runtime error:', e.message));

(async function start() {
  try {
    await boot();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="boot"><div class="err-box">Không kết nối được máy chủ: ${esc(e.message)}</div></div>`;
    return;
  }
  if (!state.me && sessionToken()) { /* phiên cũ đã hết hạn — sẽ về màn đăng nhập */ }
  if (!location.hash) location.hash = state.me ? '#/cockpit' : '#/login';
  await render();
  if (window.Nexrall && typeof window.Nexrall.ready === 'function') window.Nexrall.ready();
})();
