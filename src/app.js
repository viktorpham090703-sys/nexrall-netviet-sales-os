import { boot, state, isLead, isAdmin, logout } from './state.js';
import { get, post, sessionToken } from './api.js';
import { esc, initials, toast, modal, rel, empty } from './ui.js';
import { initGuard, setView } from './guard.js';
import { ROLE_NAME } from './const.js';

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

const VIEWS = {
  login: VLogin, cockpit: VCockpit, crm: VCrm, pipeline: VPipeline, activities: VActivity,
  tasks: VTasks, reports: VReports, kpi: VKpi, ai: VAi, prospect: VProspect,
  saleskit: VSaleskit, console: VConsole, training: VTraining, admin: VAdmin, more: VMore,
};

const SALES_NAV = [
  ['cockpit', '🏠', 'Cockpit'], ['pipeline', '📊', 'Pipeline'], ['prospect', '🔎', 'Tìm khách'],
  ['tasks', '📥', 'Việc'], ['more', '⋯', 'Thêm'],
];
const LEAD_NAV = [
  { sec: 'Điều hành', items: [['console', '🎛️', 'Console đội'], ['cockpit', '🏠', 'Cockpit cá nhân'], ['tasks', '📥', 'Giao việc & SLA']] },
  { sec: 'Kinh doanh', items: [['pipeline', '📊', 'Pipeline đội'], ['crm', '🗂️', 'CRM 360°'], ['prospect', '🔎', 'Tìm khách & Thầu'], ['saleskit', '📄', 'Sales Kit & Báo giá']] },
  { sec: 'Đo lường', items: [['reports', '📝', 'Báo cáo'], ['kpi', '🏆', 'KPI · Hoa hồng · PIP'], ['activities', '🗓️', 'Hoạt động']] },
  { sec: 'Khác', items: [['training', '🎓', 'Đào tạo'], ['ai', '🤖', 'AI Trợ lý'], ['admin', '⚙️', 'Quản trị']] },
];

function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [view, id] = h.split('/');
  return { view: view || '', id: id || '' };
}

function shell(view) {
  const me = state.me;
  const lead = isLead();
  const nav = lead
    ? LEAD_NAV.map(g => `<div class="sec">${esc(g.sec)}</div>` + g.items
      .filter(i => i[0] !== 'admin' || isAdmin() || me.role === 'manager')
      .map(i => `<a href="#/${i[0]}" class="${view === i[0] ? 'active' : ''}"><span>${i[1]}</span>${esc(i[2])}</a>`).join('')).join('')
    : '';
  return `<div class="shell ${lead ? 'with-side' : ''}">
    ${lead ? `<aside class="sidebar" id="sidebar">
      <div class="row mb" style="gap:8px"><div class="logo">NV</div><b>Sales OS</b></div>${nav}
      <div class="sec">Tài khoản</div>
      <a href="#" data-logout><span>🚪</span>Đổi tài khoản</a>
    </aside>` : ''}
    <div class="grow" style="min-width:0;display:flex;flex-direction:column">
      <header class="topbar">
        ${lead ? `<button class="icon-btn menu-btn" data-menu>☰</button>` : `<div class="logo">NV</div>`}
        <div class="brand">${lead ? 'NetViet Sales OS' : 'NetViet'}<span class="xs mut" style="font-weight:600"> · ${esc(ROLE_NAME[me.role] || '')}</span></div>
        <div class="grow"></div>
        <button class="icon-btn" data-noti>🔔${state.unread ? `<span class="dot">${state.unread}</span>` : ''}</button>
        <div class="avatar" data-me>${esc(initials(me.name))}</div>
      </header>
      <main id="main"></main>
      ${!lead ? `<nav class="bottom-nav">${SALES_NAV.map(i =>
        `<a href="#/${i[0]}" class="${view === i[0] ? 'active' : ''}"><span class="ic">${i[1]}</span>${esc(i[2])}</a>`).join('')}</nav>` : ''}
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
        <div class="dot-i">${n.level === 'danger' ? '🔴' : n.level === 'warn' ? '🟠' : '🔵'}</div>
        <div class="grow"><div class="t">${esc(n.title)}</div>
          <div class="d">${esc(n.body || '')}</div><div class="d xs">${rel(n.created_at)}</div></div>
        ${n.link ? `<a class="btn sm" href="${esc(n.link)}">Xem</a>` : ''}</div>`).join('')}</div>` : empty('🔔', 'Chưa có thông báo.'),
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
    setView('');
    return VSetPassword.render(app, { id });
  }

  if (!state.me) {
    if (view !== 'login') { location.hash = '#/login'; }
    currentShellRole = null;
    setView('login');
    return VLogin.render(app);
  }

  // Buộc đổi mật khẩu ở lần đăng nhập đầu (vd: admin do production tự khởi tạo từ secret) —
  // chặn mọi màn khác cho tới khi đặt xong mật khẩu mới.
  if (state.me.must_change_password && view !== 'dat-mat-khau') {
    location.hash = '#/dat-mat-khau';
    currentShellRole = null;
    setView('');
    return VSetPassword.render(app, {});
  }

  if (!view || view === 'login') { view = isLead() ? 'console' : 'cockpit'; location.replace('#/' + view); }
  // Điều hướng minh bạch: không âm thầm rơi về Cockpit nữa
  let block = null;
  if (!VIEWS[view]) block = { icon: '🧭', title: 'Không tìm thấy trang', desc: `Đường dẫn "#/${view}" không tồn tại trong ứng dụng.` };
  else if ((view === 'console' || view === 'admin') && !isLead()) {
    block = { icon: '🔒', title: 'Bạn không có quyền truy cập', desc: 'Màn hình này dành cho Trưởng phòng / Ban Giám đốc. Nếu cần quyền, vui lòng liên hệ quản trị viên.' };
  }

  const shellView = block ? (isLead() ? 'console' : 'cockpit') : view;
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
    if (badge) badge.innerHTML = '🔔' + (state.unread ? `<span class="dot">${state.unread}</span>` : '');
  }

  setView(block ? '' : view);
  const main = document.getElementById('main');
  main.scrollTop = 0;
  window.scrollTo(0, 0);
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.remove('open');

  if (block) {
    main.innerHTML = `<div class="page-head"><div class="grow"><h2>${block.icon} ${esc(block.title)}</h2>
      <p>${esc(block.desc)}</p></div></div>
      <div class="card" style="text-align:center;padding:28px">
        <div style="font-size:40px;margin-bottom:8px">${block.icon}</div>
        <div class="b">${esc(block.title)}</div>
        <div class="sm mut mt">${esc(block.desc)}</div>
        <div class="mt"><a class="btn primary sm" href="#/${isLead() ? 'console' : 'cockpit'}">Về trang chính</a></div>
      </div>`;
    return;
  }

  try {
    await VIEWS[view].render(main, { id });
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="err-box">⚠️ ${esc(e.message || 'Lỗi hiển thị')}</div>`;
  }
}

function bindShell() {
  const app = document.getElementById('app');
  const noti = app.querySelector('[data-noti]');
  if (noti) noti.onclick = showNotifications;
  const meBtn = app.querySelector('[data-me]');
  if (meBtn) meBtn.onclick = () => { location.hash = isLead() ? '#/admin' : '#/more'; };
  const menu = app.querySelector('[data-menu]');
  if (menu) menu.onclick = () => document.getElementById('sidebar').classList.toggle('open');
  const lo = app.querySelector('[data-logout]');
  if (lo) lo.onclick = async (e) => { e.preventDefault(); await logout(); location.hash = '#/login'; render(); };
}

window.addEventListener('hashchange', render);
window.addEventListener('error', (e) => console.error('Runtime error:', e.message));

(async function start() {
  initGuard();
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
