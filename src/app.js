import { boot, state, isLead } from './state.js';
import { get, post, sessionToken } from './api.js';
import { esc, avatar, toast, modal, rel, empty, beginRender, closeOverlay } from './ui.js';
import { openCreateSheet } from './create.js';
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

/* Thanh điều hướng dưới (điện thoại, vai trò sales): ưu tiên việc sale làm nhiều nhất trong ngày —
 * Trang chủ · Khách hàng · Tạo mới (nút nổi, mở sheet chọn loại) · Công việc · Báo cáo · Thêm (mở
 * ngăn kéo menu đầy đủ: Pipeline, Tìm khách, KPI, Sales Kit…). Menu desktop giữ nguyên. */
const SALES_NAV = [
  ['cockpit', icon('home', 20), 'Trang chủ'], ['crm', icon('users', 20), 'Khách hàng'],
  ['create', icon('plus', 24), 'Tạo mới'],
  ['tasks', icon('listChecks', 20), 'Công việc'], ['reports', icon('clipboardList', 20), 'Báo cáo'],
  ['more', icon('moreHorizontal', 20), 'Thêm'],
];
const SALES_SIDE_NAV = [
  { sec: 'Điều hành', items: [['cockpit', icon('home'), 'Trang chủ'], ['pipeline', icon('barChart2'), 'Pipeline'], ['prospect', icon('search'), 'Tìm khách'], ['tasks', icon('inbox'), 'Việc']] },
  { sec: 'Khác', items: [['crm', icon('folderOpen'), 'CRM 360° Khách hàng'], ['plans', icon('clipboardList'), 'Phương án kinh doanh'], ['ai', icon('bot'), 'AI Trợ lý'], ['activities', icon('calendarDays'), 'Lịch & Hoạt động'], ['reports', icon('clipboardList'), 'Báo cáo EOD & Tuần'], ['kpi', icon('trophy'), 'KPI & Hoa hồng'], ['saleskit', icon('fileText'), 'Sales Kit'], ['training', icon('graduationCap'), 'Đào tạo']] },
];
const LEAD_NAV = [
  { sec: 'Điều hành', items: [['console', icon('slidersHorizontal'), 'Console đội'], ['cockpit', icon('home'), 'Trang chủ cá nhân'], ['tasks', icon('inbox'), 'Giao việc & SLA']] },
  { sec: 'Kinh doanh', items: [['pipeline', icon('barChart2'), 'Pipeline đội'], ['crm', icon('folderOpen'), 'CRM 360°'], ['plans', icon('clipboardList'), 'Phương án kinh doanh'], ['prospect', icon('search'), 'Tìm khách & Thầu'], ['saleskit', icon('fileText'), 'Sales Kit']] },
  { sec: 'Đo lường', items: [['reports', icon('clipboardList'), 'Báo cáo'], ['kpi', icon('trophy'), 'KPI · Hoa hồng · PIP'], ['activities', icon('calendarDays'), 'Hoạt động']] },
  { sec: 'Khác', items: [['training', icon('graduationCap'), 'Đào tạo'], ['ai', icon('bot'), 'AI Trợ lý'], ['admin', icon('usersRound'), 'Quản trị']] },
];
/* HCNS chỉ cần xem/xét duyệt — không có nhiệm vụ điều hành đội sales (Pipeline, CRM, Báo cáo,
 * KPI, Đào tạo...), nên menu chỉ còn đúng 3 mục. "console" giữ nguyên route (đã là trang duyệt
 * của HCNS) nhưng đổi nhãn/icon thành "Trang chủ" vì đây là màn hình chính của HCNS.
 * Từng có thêm "Duyệt Báo giá" và "Duyệt Hợp đồng" trỏ vào route saleskit/activities của phòng
 * kinh doanh — bỏ đi vì Console HCNS đã gộp sẵn báo giá + hợp đồng + hồ sơ thầu vào một danh
 * sách duy nhất (mergedApproval ở views/console.js), hai mục kia chỉ là cùng dữ liệu tách đôi. */
const HR_NAV = [
  { sec: 'Điều hành', items: [
    ['console', icon('home'), 'Trang chủ'],
    ['prospect', icon('search'), 'Duyệt Thầu'],
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

/* Sidebar thu gọn được (chỉ trên desktop) — nhớ lựa chọn giữa các lần điều hướng và lần mở sau,
 * vì mỗi lần đổi vai trò `shell()` dựng lại toàn bộ khung và sẽ quên trạng thái nếu không lưu.
 * localStorage có thể ném lỗi (chế độ ẩn danh, trình duyệt chặn lưu trữ) nên luôn bọc try/catch;
 * đọc lỗi thì coi như đang mở, tức là về đúng giao diện cũ. */
const SIDE_KEY = 'nv.sideCollapsed';
const sideCollapsed = () => { try { return localStorage.getItem(SIDE_KEY) === '1'; } catch (e) { return false; } };

/* 1 mục trong sidebar. Nhãn phải nằm trong thẻ riêng (không để làm text trần) thì lúc thu gọn mới
 * ẩn được bằng CSS; `title` để khi chỉ còn icon, rê chuột vẫn biết đó là mục gì. */
const sideLink = (key, ic, label, view) =>
  `<a href="#/${key}" class="${view === key ? 'active' : ''}" title="${esc(label)}">
     <span class="side-ic">${ic}</span><span class="side-label">${esc(label)}</span></a>`;

function shell(view) {
  const me = state.me;
  const lead = isLead();
  const navGroups = me.role === 'hr' ? HR_NAV : lead ? LEAD_NAV : SALES_SIDE_NAV;
  const nav = navGroups.map(g => `<div class="sec">${esc(g.sec)}</div>` + g.items
    .filter(i => i[0] !== 'admin' || isLead())
    .map(i => sideLink(i[0], i[1], i[2], view)).join('')).join('');
  return `<div class="shell with-side${sideCollapsed() ? ' side-collapsed' : ''}">
    <aside class="sidebar" id="sidebar">
      <div class="row mb side-brand"><a href="#/${homeView()}" class="brand-logo-link"><img class="brand-logo" src="${BRAND_LOGO}" alt="NetViet Sales"></a></div>
      <a href="#/profile" class="side-profile-btn ${view === 'profile' ? 'active' : ''}">
        ${avatar(me)}
        <div class="side-profile-info">
          <div class="side-profile-name">${esc(me.name)}</div>
          <div class="side-profile-role">${esc(roleLabel(me))}</div>
        </div>
      </a>
      ${nav}
      ${!lead ? `<div class="sec">Hệ thống</div>${sideLink('more', icon('settings', 15), 'Cài đặt', view)}` : ''}
    </aside>
    <button class="side-toggle" data-side-toggle type="button"
      aria-label="Thu gọn / mở rộng menu">${icon('chevronRight', 15)}</button>
    <div class="grow" style="min-width:0;display:flex;flex-direction:column">
      <header class="topbar">
        <button class="icon-btn menu-btn" data-menu>${icon('menu', 18)}</button>
        <div class="brand topbar-clock">
          <span class="clock-date" data-clock-date>${clockDate(new Date())}</span>
          <span class="clock-time"><span data-clock-time>${clockTime(new Date())}</span><span class="clock-zone" data-clock-zone>${clockZone(new Date())}</span></span>
        </div>
        <div class="grow"></div>
        <button class="icon-btn" data-noti>${notiBadge()}</button>
        ${avatar(me, 'data-me')}
      </header>
      <main id="main"></main>
      ${!lead ? `<nav class="bottom-nav desktop-hide" aria-label="Điều hướng chính">${SALES_NAV.map(i => i[0] === 'more'
        ? `<a href="#" data-menu><span class="ic">${i[1]}</span>${esc(i[2])}</a>`
        : i[0] === 'create'
          ? `<button type="button" class="nav-create" data-create><span class="ic">${i[1]}</span>${esc(i[2])}</button>`
          : `<a href="#/${i[0]}" class="${view === i[0] ? 'active' : ''}"><span class="ic">${i[1]}</span>${esc(i[2])}</a>`).join('')}</nav>` : ''}
    </div>
    <div class="side-scrim" data-scrim hidden></div>
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

/* Đồng hồ trên thanh trên cùng — thay cho nhãn "NetViet Sales OS · <vai trò>" cũ (thương hiệu đã có
 * logo ở sidebar, vai trò đã hiện ngay dưới tên ở thẻ hồ sơ nên nhắc lại là thừa).
 *
 * Hiển thị theo múi giờ CỦA CHÍNH THIẾT BỊ đang truy cập — không truyền `timeZone` thì trình duyệt
 * tự lấy múi giờ của hệ điều hành, máy ở khu vực nào ra giờ khu vực đó. Nhãn GMT đi kèm để người
 * dùng biết đang xem theo múi giờ nào: các mốc hạn nghiệp vụ (17h30 nộp báo cáo, cắt ngày định mức,
 * kỳ KPI/hoa hồng) vẫn được máy chủ chốt theo giờ VN — UTC+7, xem TZ_OFFSET ở server/lib/util.js —
 * nên thiết bị ở múi giờ khác sẽ thấy đồng hồ lệch so với các mốc đó, và nhãn GMT là chỗ nhận ra. */
const clockDate = (d) => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const clockTime = (d) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
/** Nhãn múi giờ thiết bị: GMT+7, GMT-5, GMT+5:30… Suy từ độ lệch thật của Date nên tự đúng cả với
 * múi lẻ 30/45 phút và tự đổi theo giờ mùa hè (DST), không hard-code bảng múi giờ. */
const clockZone = (d) => {
  const off = -d.getTimezoneOffset();          // phút; dương = phía đông GMT
  const h = Math.floor(Math.abs(off) / 60), m = Math.abs(off) % 60;
  return `GMT${off < 0 ? '-' : '+'}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
};

let clockTimer = null;
/** Chạy đồng hồ theo từng giây. Gọi lại mỗi lần dựng lại shell — phải huỷ bộ đếm cũ, nếu không mỗi
 * lần dựng lại sẽ chồng thêm 1 bộ đếm nữa ghi vào các node đã bị gỡ khỏi DOM. */
function startClock() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  const app = document.getElementById('app');
  const dEl = app.querySelector('[data-clock-date]');
  const tEl = app.querySelector('[data-clock-time]');
  const zEl = app.querySelector('[data-clock-zone]');
  if (!dEl || !tEl) return;
  const tick = () => {
    // Shell đã bị thay (đăng xuất, đổi vai trò) → dừng hẳn thay vì ghi vào node mồ côi.
    if (!tEl.isConnected) { clearInterval(clockTimer); clockTimer = null; return; }
    const now = new Date();
    const day = clockDate(now);
    if (dEl.textContent !== day) dEl.textContent = day;   // chỉ đổi khi sang ngày mới
    tEl.textContent = clockTime(now);
    // Múi giờ đổi được ngay giữa phiên: vào/ra giờ mùa hè, hoặc người dùng chỉnh lại đồng hồ máy.
    if (zEl) { const z = clockZone(now); if (zEl.textContent !== z) zEl.textContent = z; }
  };
  tick();
  clockTimer = setInterval(tick, 1000);
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
  setDrawer(false);
  closeOverlay();   // đổi trang thì modal/sheet đang mở (nếu có) phải đóng theo

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

/* Ngăn kéo menu trên điện thoại: mở/đóng kèm lớp mờ phía sau — chạm ra ngoài hoặc Esc là đóng. */
function setDrawer(open) {
  const sb = document.getElementById('sidebar');
  const scrim = document.querySelector('[data-scrim]');
  if (sb) sb.classList.toggle('open', open);
  if (scrim) scrim.hidden = !open;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('sidebar')?.classList.contains('open')) setDrawer(false);
});

function bindShell() {
  const app = document.getElementById('app');
  const wire = (sel, fn) => { const el = app.querySelector(sel); if (el) el.onclick = fn; };
  wire('[data-noti]', showNotifications);
  wire('[data-me]', () => { location.hash = '#/profile'; });
  wire('[data-create]', openCreateSheet);
  wire('[data-scrim]', () => setDrawer(false));
  app.querySelectorAll('[data-menu]').forEach(el => el.onclick = (e) => {
    e.preventDefault();
    setDrawer(!document.getElementById('sidebar').classList.contains('open'));
  });
  wire('[data-side-toggle]', () => {
    const shellEl = app.querySelector('.shell');
    const on = shellEl.classList.toggle('side-collapsed');
    try { localStorage.setItem(SIDE_KEY, on ? '1' : '0'); } catch (e) { /* không lưu được thì thôi */ }
  });
  startClock();
}

window.addEventListener('hashchange', render);
window.addEventListener('error', (e) => console.error('Runtime error:', e.message));

(async function start() {
  try {
    await boot();
  } catch (e) {
    // Mất mạng (vd. app cài trên điện thoại mở khi không có sóng): vỏ app vẫn lên từ cache nhưng
    // không có dữ liệu — báo rõ và cho thử lại, tuyệt đối không hiện số liệu cũ như số liệu thật.
    const app = document.getElementById('app');
    app.innerHTML = `<div class="boot"><div class="err-box" style="max-width:340px;text-align:center">${esc(e.message)}
      <div class="mt"><button class="btn primary sm" data-retry>Thử lại</button></div></div></div>`;
    app.querySelector('[data-retry]').onclick = () => location.reload();
    return;
  }
  if (!state.me && sessionToken()) { /* phiên cũ đã hết hạn — sẽ về màn đăng nhập */ }
  if (!location.hash) location.hash = state.me ? '#/cockpit' : '#/login';
  await render();
  if (window.Nexrall && typeof window.Nexrall.ready === 'function') window.Nexrall.ready();
})();
