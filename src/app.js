import { boot, state, isLead } from './state.js';
import { get, sessionToken } from './api.js';
import { esc, avatar, toast, beginRender, closeOverlay } from './ui.js';
import { openCreateSheet } from './create.js';
import { roleLabel, BRAND_LOGO } from './const.js';
import { icon } from './icons.js';
import { t, tf, isEn, toggleLang, personName } from './i18n.js';
import { initAutoTranslate } from './autoTranslate.js';
import { isSoundOn, setSoundOn, playChime, chimeFor } from './sound.js';

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
import * as VNotifications from './views/notifications.js';
import * as VLoTrinh from './views/lotrinh.js';
import * as VCauTruc from './views/cautruc.js';
import * as VPhanQuyen from './views/phanquyen.js';
import * as VAiSetup from './views/aisetup.js';
import { featAllowed } from './perm.js';
import { startViet } from './viet.js';

const VIEWS = {
  login: VLogin, cockpit: VCockpit, crm: VCrm, pipeline: VPipeline, activities: VActivity,
  tasks: VTasks, reports: VReports, kpi: VKpi, ai: VAi, prospect: VProspect,
  saleskit: VSaleskit, console: VConsole, training: VTraining, admin: VAdmin, more: VMore, profile: VProfile,
  plans: VPlans, 'thong-bao': VNotifications,
  'lo-trinh': VLoTrinh, 'cau-truc': VCauTruc, 'phan-quyen': VPhanQuyen, 'ai-setup': VAiSetup,
};

/* Menu chia 6 phân hệ cố định: TRANG CHỦ › KINH DOANH › CÔNG VIỆC › ĐÀO TẠO › BÁO CÁO › HỆ THỐNG —
 * mọi vai trò cùng một thứ tự, chỉ khác mục bên trong. Thanh dưới (điện thoại) theo đúng 6 phân hệ:
 * Trang chủ · Kinh doanh · Tạo mới · Công việc · Báo cáo · Thêm (mở menu đầy đủ: Đào tạo, Hệ thống). */
const SALES_NAV = () => [
  ['cockpit', icon('home', 20), t('Trang chủ')], ['pipeline', icon('briefcase', 20), t('Kinh doanh')],
  ['create', icon('plus', 24), t('Tạo mới')],
  ['tasks', icon('listChecks', 20), t('Công việc')], ['reports', icon('clipboardList', 20), t('Báo cáo')],
  ['more', icon('moreHorizontal', 20), t('Thêm')],
];
const LEAD_NAV_BOTTOM = () => [
  ['console', icon('home', 20), t('Trang chủ')], ['pipeline', icon('briefcase', 20), t('Kinh doanh')],
  ['create', icon('plus', 24), t('Tạo mới')],
  ['tasks', icon('listChecks', 20), t('Công việc')], ['reports', icon('clipboardList', 20), t('Báo cáo')],
  ['more', icon('moreHorizontal', 20), t('Thêm')],
];
/* HCNS chỉ xem / xét duyệt, không giữ khách hay cơ hội nào — không có "Tạo mới". */
const HR_NAV_BOTTOM = () => [
  ['console', icon('home', 20), t('Trang chủ')], ['prospect', icon('search', 20), t('Duyệt Thầu')],
  ['admin', icon('usersRound', 20), t('Quản trị')], ['more', icon('moreHorizontal', 20), t('Thêm')],
];
const SALES_SIDE_NAV = () => [
  { sec: '1 · ' + t('Trang chủ'), items: [['cockpit', icon('home'), t('Tổng quan & KPI')], ['thong-bao', icon('bell'), t('Thông báo')]] },
  { sec: '2 · ' + t('Kinh doanh'), items: [['pipeline', icon('barChart2'), t('Pipeline')], ['crm', icon('folderOpen'), t('CRM 360° Khách hàng')], ['prospect', icon('search'), t('Tìm khách')], ['plans', icon('clipboardList'), t('Phương án kinh doanh')], ['saleskit', icon('fileText'), t('Sales Kit')], ['activities', icon('calendarDays'), t('Lịch & Hoạt động')], ['ai', icon('bot'), t('AI Trợ lý')]] },
  { sec: '3 · ' + t('Công việc'), items: [['tasks', icon('inbox'), t('Công việc của tôi')]] },
  { sec: '4 · ' + t('Đào tạo'), items: [['lo-trinh', icon('route'), t('Lộ trình & Bài test')], ['training', icon('graduationCap'), t('Thư viện bài giảng')]] },
  { sec: '5 · ' + t('Báo cáo'), items: [['reports', icon('clipboardList'), t('Báo cáo EOD & Tuần')], ['kpi', icon('trophy'), t('KPI & Hoa hồng')]] },
  { sec: '6 · ' + t('Hệ thống'), items: [['phan-quyen', icon('shieldCheck'), t('Quyền của tôi')], ['profile', icon('idCard'), t('Hồ sơ nhân sự')], ['more', icon('settings'), t('Cài đặt tài khoản')]] },
];
const LEAD_NAV = () => [
  { sec: '1 · ' + t('Trang chủ'), items: [['console', icon('slidersHorizontal'), t('Console đội')], ['cockpit', icon('home'), t('Trang chủ cá nhân')], ['thong-bao', icon('bell'), t('Thông báo')]] },
  { sec: '2 · ' + t('Kinh doanh'), items: [['pipeline', icon('barChart2'), t('Pipeline đội')], ['crm', icon('folderOpen'), t('CRM 360°')], ['prospect', icon('search'), t('Tìm khách & Thầu')], ['plans', icon('clipboardList'), t('Phương án kinh doanh')], ['saleskit', icon('fileText'), t('Sales Kit')], ['activities', icon('calendarDays'), t('Lịch & Hoạt động')], ['ai', icon('bot'), t('AI Trợ lý')]] },
  { sec: '3 · ' + t('Công việc'), items: [['tasks', icon('inbox'), t('Giao việc & SLA')]] },
  { sec: '4 · ' + t('Đào tạo'), items: [['lo-trinh', icon('route'), t('Lộ trình & Kết quả đội')], ['training', icon('graduationCap'), t('Thư viện bài giảng')]] },
  { sec: '5 · ' + t('Báo cáo'), items: [['reports', icon('clipboardList'), t('Báo cáo')], ['kpi', icon('trophy'), t('KPI · Hoa hồng · PIP')]] },
  { sec: '6 · ' + t('Hệ thống'), items: [['cau-truc', icon('building2'), t('Cấu trúc hệ thống')], ['phan-quyen', icon('shieldCheck'), t('Phân quyền & Ngưỡng duyệt')], ['admin', icon('usersRound'), t('Quản trị người dùng')], ['ai-setup', icon('bot'), t('Thiết lập AI trợ lý')], ['profile', icon('idCard'), t('Hồ sơ nhân sự')], ['more', icon('settings'), t('Cài đặt tài khoản')]] },
];
const HR_NAV = () => [
  { sec: '1 · ' + t('Trang chủ'), items: [['console', icon('home'), t('Trang chủ')], ['thong-bao', icon('bell'), t('Thông báo')]] },
  { sec: '2 · ' + t('Kinh doanh'), items: [['prospect', icon('search'), t('Duyệt Thầu')]] },
  { sec: '4 · ' + t('Đào tạo'), items: [['lo-trinh', icon('route'), t('Lộ trình đào tạo')], ['training', icon('graduationCap'), t('Thư viện bài giảng')]] },
  { sec: '6 · ' + t('Hệ thống'), items: [['phan-quyen', icon('shieldCheck'), t('Phân quyền')], ['admin', icon('usersRound'), t('Quản trị người dùng')], ['profile', icon('idCard'), t('Hồ sơ nhân sự')], ['more', icon('settings'), t('Cài đặt tài khoản')]] },
];
/* Mục chỉ Admin/BGĐ thấy (máy chủ cũng chỉ cho Admin ghi các thiết lập này). */
const ADMIN_ONLY = ['cau-truc', 'ai-setup'];

function parseHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  const [view, id] = h.split('/');
  return { view: view || '', id: id || '' };
}

const homeView = () => isLead() ? 'console' : 'cockpit';
const soundIcon = () => icon(isSoundOn() ? 'volume2' : 'volumeX', 17);
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
  const navGroups = me.role === 'hr' ? HR_NAV() : lead ? LEAD_NAV() : SALES_SIDE_NAV();
  const bottomNav = me.role === 'hr' ? HR_NAV_BOTTOM() : lead ? LEAD_NAV_BOTTOM() : SALES_NAV();
  const nav = navGroups.map(g => {
    const items = g.items.filter(i => (i[0] !== 'admin' || isLead()) && (!ADMIN_ONLY.includes(i[0]) || me.role === 'admin') && featAllowed(i[0]));
    // Phân hệ bị thu hồi hết tính năng thì ẩn luôn tiêu đề, không để lại nhóm trống.
    return items.length ? `<div class="sec">${esc(g.sec)}</div>` + items.map(i => sideLink(i[0], i[1], i[2], view)).join('') : '';
  }).join('');
  return `<div class="shell with-side${sideCollapsed() ? ' side-collapsed' : ''}">
    <aside class="sidebar" id="sidebar">
      <div class="row mb side-brand"><a href="#/${homeView()}" class="brand-logo-link"><img class="brand-logo" src="${esc(state.settings.brand?.logo || BRAND_LOGO)}" alt="NetViet Sales"></a></div>
      <a href="#/profile" class="side-profile-btn ${view === 'profile' ? 'active' : ''}">
        ${avatar(me)}
        <div class="side-profile-info">
          <div class="side-profile-name">${esc(personName(me.name))}</div>
          <div class="side-profile-role">${esc(roleLabel(me))}</div>
        </div>
      </a>
      ${nav}
    </aside>
    <button class="side-toggle" data-side-toggle type="button"
      aria-label="${t('Thu gọn / mở rộng menu')}">${icon('chevronRight', 15)}</button>
    <div class="grow" style="min-width:0;display:flex;flex-direction:column">
      <header class="topbar">
        <button class="icon-btn menu-btn" data-menu>${icon('menu', 18)}</button>
        <div class="brand topbar-clock">
          <span class="clock-date" data-clock-date>${clockDate(new Date())}</span>
          <span class="clock-time"><span data-clock-time>${clockTime(new Date())}</span><span class="clock-zone" data-clock-zone>${clockZone(new Date())}</span></span>
        </div>
        <div class="grow"></div>
        <button class="icon-btn lang-toggle" data-lang-toggle type="button" title="${esc(t('Ngôn ngữ'))}">${isEn() ? 'EN' : 'VI'}</button>
        <button class="icon-btn" data-sound-toggle type="button">${soundIcon()}</button>
        <button class="icon-btn" data-noti>${notiBadge()}</button>
        ${avatar(me, 'data-me')}
      </header>
      <main id="main"></main>
      <nav class="bottom-nav desktop-hide" aria-label="${t('Điều hướng chính')}">${bottomNav.map(i => i[0] === 'more'
        ? `<a href="#" data-menu><span class="ic">${i[1]}</span>${esc(i[2])}</a>`
        : i[0] === 'create'
          ? `<button type="button" class="nav-create" data-create><span class="ic">${i[1]}</span>${esc(i[2])}</button>`
          : `<a href="#/${i[0]}" class="${view === i[0] ? 'active' : ''}"><span class="ic">${i[1]}</span>${esc(i[2])}</a>`).join('')}</nav>
    </div>
    <div class="side-scrim" data-scrim hidden></div>
  </div>`;
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
  if (!VIEWS[view]) block = { icon: 'compass', title: t('Không tìm thấy trang'), desc: tf(() => `Đường dẫn "#/${view}" không tồn tại trong ứng dụng.`, () => `The path "#/${view}" does not exist in this app.`) };
  else if ((view === 'console' || view === 'admin') && !isLead()) {
    block = { icon: 'lock', title: t('Bạn không có quyền truy cập'), desc: t('Màn hình này dành cho Trưởng phòng / Ban Giám đốc. Nếu cần quyền, vui lòng liên hệ quản trị viên.') };
  } else if ((ADMIN_ONLY.includes(view) && state.me.role !== 'admin') || !featAllowed(view)) {
    block = { icon: 'lock', title: t('Tính năng chưa được cấp'), desc: t('Tài khoản của bạn chưa được cấp tính năng này. Liên hệ Admin / Ban Giám đốc để được cấp quyền.') };
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
        <div class="mt"><a class="btn primary sm" href="#/${homeView()}">${t('Về trang chính')}</a></div>
      </div>`;
    return;
  }

  try {
    beginRender(main);
    await VIEWS[view].render(main, { id });
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="err-box">${icon('triangleAlert', 15)} ${esc(e.message || t('Lỗi hiển thị'))}</div>`;
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

/* Nút loa ở topbar — đồng bộ khi bật/tắt chuông ở đây hoặc ở Cài đặt → Âm thanh. */
function syncSoundBtn() {
  const snd = document.querySelector('#app [data-sound-toggle]');
  if (!snd) return;
  snd.innerHTML = soundIcon();
  snd.title = isSoundOn() ? t('Tắt âm thanh thông báo') : t('Bật âm thanh thông báo');
  snd.setAttribute('aria-label', snd.title);
}
window.addEventListener('nv:sound-changed', syncSoundBtn);

function bindShell() {
  const app = document.getElementById('app');
  const wire = (sel, fn) => { const el = app.querySelector(sel); if (el) el.onclick = fn; };
  wire('[data-noti]', () => { location.hash = '#/thong-bao'; });
  wire('[data-me]', () => { location.hash = '#/profile'; });
  wire('[data-create]', openCreateSheet);
  wire('[data-scrim]', () => setDrawer(false));
  wire('[data-lang-toggle]', () => toggleLang());
  syncSoundBtn();
  wire('[data-sound-toggle]', () => {
    setSoundOn(!isSoundOn());
    if (isSoundOn()) playChime('message');
    toast(isSoundOn() ? t('Đã bật âm thanh thông báo') : t('Đã tắt âm thanh thông báo'), 'ok');
  });
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

/* Đổi ngôn ngữ (nút VI/EN ở topbar, hoặc mục Ngôn ngữ ở Cài đặt) phải vẽ lại TOÀN BỘ khung app —
 * nav sidebar/bottom-nav và view hiện tại đều có chuỗi tiếng Việt cứng trong HTML đã render, đổi
 * ngôn ngữ xong mà không dựng lại thì các chuỗi đó vẫn kẹt nguyên ngôn ngữ cũ. */
window.addEventListener('nv:lang-changed', () => {
  currentShellRole = null;
  render();
});

/* Phiên hết hạn / bị thu hồi khi app VẪN ĐANG MỞ (bản cài trên điện thoại có thể nằm nền nhiều ngày) —
 * src/api.js phát sự kiện này khi đã gửi token mà vẫn bị 401. Dọn trạng thái đăng nhập trong bộ nhớ và
 * về màn đăng nhập, thay vì để giao diện trông như còn đăng nhập trong khi mọi API đều bị từ chối. */
let sessionExpiring = false;
window.addEventListener('nv:session-expired', async () => {
  if (!state.me || sessionExpiring) return;
  sessionExpiring = true;
  state.me = null;
  state.unread = 0;
  closeOverlay();
  toast(t('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'), 'err');
  // Nạp lại bootstrap ở trạng thái chưa đăng nhập, giống state.logout().
  try { await boot(); } catch (e) { /* mất mạng: vẫn về màn đăng nhập */ }
  sessionExpiring = false;
  if (location.hash !== '#/login') location.hash = '#/login';
  else render();
});

/* Push tới khi app đang mở: notification của hệ điều hành đã do Service Worker hiện (static/sw.js);
 * ở đây chỉ cập nhật số trên chuông cho khớp, không vẽ lại màn đang xem (tránh mất dữ liệu đang nhập). */
/* Số chưa đọc trên chuông: cập nhật khi có thông báo đẩy tới, và kiểm tra lại mỗi 60 giây khi app đang
 * mở — máy chưa bật thông báo đẩy vẫn thấy chuông tăng và nghe chuông báo. Tăng lên thì phát chuông
 * theo loại thông báo mới nhất (giao việc / cảnh báo / thông báo thường). */
function paintBadge() {
  const badge = document.querySelector('#app [data-noti]');
  if (badge) badge.innerHTML = notiBadge();
}
async function refreshUnread() {
  if (!state.me) return;
  try {
    const d = await get('/notifications?limit=1');
    if (!state.me) return;
    const grew = (d.unread || 0) > (state.unread || 0);
    state.unread = d.unread || 0;
    paintBadge();
    if (grew && document.visibilityState === 'visible') playChime(chimeFor((d.items || [])[0]));
  } catch (e) { /* chuông cập nhật lần sau */ }
}
window.addEventListener('nv:push-received', refreshUnread);
window.addEventListener('nv:unread-changed', paintBadge);
setInterval(() => { if (document.visibilityState === 'visible') refreshUnread(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshUnread(); });
window.addEventListener('error', (e) => console.error('Runtime error:', e.message));

(async function start() {
  initAutoTranslate();
  startViet();
  try {
    await boot();
  } catch (e) {
    // Mất mạng (vd. app cài trên điện thoại mở khi không có sóng): vỏ app vẫn lên từ cache nhưng
    // không có dữ liệu — báo rõ và cho thử lại, tuyệt đối không hiện số liệu cũ như số liệu thật.
    const app = document.getElementById('app');
    app.innerHTML = `<div class="boot"><div class="err-box" style="max-width:340px;text-align:center">${esc(e.message)}
      <div class="mt"><button class="btn primary sm" data-retry>${t('Thử lại')}</button></div></div></div>`;
    app.querySelector('[data-retry]').onclick = () => location.reload();
    return;
  }
  if (!state.me && sessionToken()) { /* phiên cũ đã hết hạn — sẽ về màn đăng nhập */ }
  if (!location.hash) location.hash = state.me ? '#/cockpit' : '#/login';
  await render();
  if (window.Nexrall && typeof window.Nexrall.ready === 'function') window.Nexrall.ready();
})();
