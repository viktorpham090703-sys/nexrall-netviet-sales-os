import { boot, state, isLead } from './state.js';
import { get, post, sessionToken } from './api.js';
import { esc, initials, toast, modal, rel, empty, beginRender } from './ui.js';
import { roleLabel } from './const.js';
import { icon, dot } from './icons.js';

const BRAND_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAbYAAADMCAMAAAAoGXZRAAAAkFBMVEX927Lzo5z4nmznYV79xH798Nz9/f3YERz5jg7ZDhv6kBL66uraGCL6mC3cJivjRUj92rP3xsfkVVj52dnwlpbhNDb1uLjrdnf96tTtiYzoZmjzp6jgKy77p0/dNDb7t238x4/iExveRUjiPUHlXmHhGyP7oDr7nEHcPUL73uDe3d3eUlT2vsDhDhnufoD8sV3bhaB9AAAAMHRSTlP////////+///////////////////////////////////////////////////////unrsbAAAT1ElEQVR42u2diXbiOhJA83pmEPIGtrGNzRaSkHTe6+X//24sayttxiyZac6p6oXuYIzQVUm1STzNUB5QnrALEBsKYkNBbIgNBbGhIDbEhoLYUBAbCmJDbCiIDQWxITYUxIaC2BAbCmJDQWwoiA2xoSA2FMSG2FAQGwpiQ2woiA0FsaEgNsSGgthQEBtiQ0FsKIgNsaEgNhTEhoLYEBsKYkNBbIgNBbGhIDbEhoLYUBAbCmJDbCiIDQWxITYUxIaC2BAbCmJDQWwoN2CLB5l42ZQrL36j+JJ7u9fe2Kw73OB/jq38VSxevn//vmjy0evybjFc9/31taiva8um+OflpSi6VWzfum/Cyz8Fk6Y808GbruDyT9HxdtTdS9+0l5dzLw1L0zesf/umfhhsm4pI2bZj3fXaX0Epu46S4rohnRDK32lhjJBYN4E9Nzro4y4hvCH9rZKCXbvJ1Euv5LYSH4wkXfwY2OoMdlkzgld8sqHTvl/16XKi7pHBDs4zcG9CN6N6kfCL6ACuY7PFVrzuLPLgUCjoxEHzx2DLCOwx8iN4Yau7ll754XLwXo2BjT+RcB7d2ChLQGMJqYeGsRfxnyX5Vdj+oaplSf0I2OrEGOj0NQ5jG3SF/7kdG3yjeK9HRC/VyM07iO247a+MF7rP6bimBqUQndD//bN7BGwrExtJVqPYqOjZ27EZs2STgImaZmGViTMwxOigsj02xo0vunR1EzY2FKr44bCx7szHtY19tOuxBd6HLU+JHjthldnAptJkuHBBgLpdh+2Nqlsct+UjYiPdCDbVYVdiowFscQHtHVLEE+ZIdo/PAdvxZmwFpVSOyQfBRmx123wdtqBWN1CJzAnUkBfY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';

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

const VIEWS = {
  login: VLogin, cockpit: VCockpit, crm: VCrm, pipeline: VPipeline, activities: VActivity,
  tasks: VTasks, reports: VReports, kpi: VKpi, ai: VAi, prospect: VProspect,
  saleskit: VSaleskit, console: VConsole, training: VTraining, admin: VAdmin, more: VMore, profile: VProfile,
};

const SALES_NAV = [
  ['cockpit', icon('home'), 'Trang chủ'], ['pipeline', icon('barChart2'), 'Pipeline'], ['prospect', icon('search'), 'Tìm khách'],
  ['tasks', icon('inbox'), 'Việc'], ['more', icon('moreHorizontal'), 'Thêm'],
];
const SALES_SIDE_NAV = [
  { sec: 'Điều hành', items: [['cockpit', icon('home'), 'Trang chủ'], ['pipeline', icon('barChart2'), 'Pipeline'], ['prospect', icon('search'), 'Tìm khách'], ['tasks', icon('inbox'), 'Việc']] },
  { sec: 'Khác', items: [['crm', icon('folderOpen'), 'CRM 360° Khách hàng'], ['ai', icon('bot'), 'AI Trợ lý'], ['activities', icon('calendarDays'), 'Lịch & Hoạt động'], ['reports', icon('clipboardList'), 'Báo cáo EOD & Tuần'], ['kpi', icon('trophy'), 'KPI & Hoa hồng'], ['saleskit', icon('fileText'), 'Sales Kit & Báo giá'], ['training', icon('graduationCap'), 'Đào tạo']] },
];
const LEAD_NAV = [
  { sec: 'Điều hành', items: [['console', icon('slidersHorizontal'), 'Console đội'], ['cockpit', icon('home'), 'Trang chủ cá nhân'], ['tasks', icon('inbox'), 'Giao việc & SLA']] },
  { sec: 'Kinh doanh', items: [['pipeline', icon('barChart2'), 'Pipeline đội'], ['crm', icon('folderOpen'), 'CRM 360°'], ['prospect', icon('search'), 'Tìm khách & Thầu'], ['saleskit', icon('fileText'), 'Sales Kit & Báo giá']] },
  { sec: 'Đo lường', items: [['reports', icon('clipboardList'), 'Báo cáo'], ['kpi', icon('trophy'), 'KPI · Hoa hồng · PIP'], ['activities', icon('calendarDays'), 'Hoạt động']] },
  { sec: 'Khác', items: [['training', icon('graduationCap'), 'Đào tạo'], ['ai', icon('bot'), 'AI Trợ lý'], ['admin', icon('usersRound'), 'Quản trị']] },
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
  const navGroups = lead ? LEAD_NAV : SALES_SIDE_NAV;
  const nav = navGroups.map(g => `<div class="sec">${esc(g.sec)}</div>` + g.items
    .filter(i => i[0] !== 'admin' || isLead())
    .map(i => `<a href="#/${i[0]}" class="${view === i[0] ? 'active' : ''}"><span>${i[1]}</span>${esc(i[2])}</a>`).join('')).join('');
  return `<div class="shell with-side">
    <aside class="sidebar" id="sidebar">
      <div class="row mb"><a href="#/${homeView()}" class="brand-logo-link"><img class="brand-logo" src="${BRAND_LOGO}" alt="NetViet Sales"></a></div>
      <a href="#/profile" class="side-profile-btn ${view === 'profile' ? 'active' : ''}">
        <div class="avatar">${esc(initials(me.name))}</div>
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
        <div class="avatar" data-me>${esc(initials(me.name))}</div>
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
