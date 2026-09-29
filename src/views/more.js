import { get, post } from '../api.js';
import { state, logout } from '../state.js';
import { esc, avatar, toast, pwRulesHtml, bindPwRules, bindPwToggles } from '../ui.js';
import { roleDefaultLabel } from '../const.js';
import { icon } from '../icons.js';
import { t as tr, tf, getLang, setLang, personName, jobTitle } from '../i18n.js';
import { CHIMES, isSoundOn, setSoundOn, playChime } from '../sound.js';

const TABS = [
  ['thong-bao', 'bell', 'Thông báo & Âm thanh'],
  ['bao-mat', 'shieldCheck', 'Bảo mật & Mật khẩu'],
  ['ca-nhan', 'user', 'Thông tin cá nhân'],
];
let tab = 'thong-bao';

/** #/more, #/more/bao-mat … — đoạn sau dấu / chọn sẵn tab (vd trang Hồ sơ dẫn thẳng tới tab Bảo mật). */
export async function render(el, { id } = {}) {
  if (TABS.some(([k]) => k === id)) tab = id;
  el.innerHTML = `<div class="st-page">
    <div class="page-head"><div class="grow"><h2>${icon('settings', 19, { style: 'margin-right:6px' })}${tr('Cài đặt hệ thống')}</h2>
      <p>${tr('Quản lý thông báo đẩy màn hình khoá, âm thanh, bảo mật tài khoản và thông tin cá nhân')}</p></div></div>
    <div class="st-tabs" role="tablist">${TABS.map(([k, ic, label]) =>
      `<button type="button" role="tab" data-st-tab="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${icon(ic, 16)}${tr(label)}</button>`).join('')}</div>
    <div data-st-body></div>
    <div class="xs mut mt">NetViet Sales OS · ${tr('bản demo dữ liệu mẫu')} · ${tr('AI hỗ trợ')} <b>Google Gemini</b> & <b>Anthropic Claude</b> (${tr('nhập API key trong Secrets là chạy ngay, chưa có key thì dùng AI mẫu offline')}) · ${tr('các tích hợp còn lại (quét thầu, tổng đài, Zalo/email, e-sign, kế toán) đang ở chế độ mock.')}</div>
  </div>`;

  el.querySelectorAll('[data-st-tab]').forEach(b => b.onclick = () => {
    tab = b.dataset.stTab;
    history.replaceState(history.state, '', '#/more/' + tab);
    el.querySelectorAll('[data-st-tab]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    drawTab(el);
  });
  drawTab(el);

  // Chrome/Android chỉ báo "cài được" sau khi trang tải xong một lúc — nếu đang mở tab Thông báo thì vẽ
  // lại để nút cài hiện ra, không bắt người dùng tải lại.
  if (!installableHooked) {
    installableHooked = true;
    window.addEventListener('nv:pwa-installable', () => {
      const body = document.querySelector('[data-st-body]');
      if (body && tab === 'thong-bao') drawTab(body.closest('.st-page').parentElement);
    });
  }
}

let installableHooked = false;

function drawTab(el) {
  const body = el.querySelector('[data-st-body]');
  if (tab === 'bao-mat') return securityTab(body);
  if (tab === 'ca-nhan') return accountTab(body);
  return notifyTab(body);
}

/* ---------------- Tab 1: Thông báo & Âm thanh ---------------- */

const secHead = (ic, title, desc) => `<div class="st-head"><div class="t">${icon(ic, 18)}${tr(title)}</div><div class="d">${tr(desc)}</div></div>`;

function notifyTab(body) {
  body.innerHTML = `${installCard()}
    <div class="card st-card">
      ${secHead('smartphone', 'Thông báo đẩy màn hình khoá (PWA / Web Push)', 'Nhận thông báo nổi trực tiếp trên màn hình khoá điện thoại, sáng màn hình và rung chuông khi được giao việc, có cảnh báo SLA hoặc có việc cần duyệt.')}
      <div data-push-card>${statusBox('neutral', 'bell', tr('Trạng thái:'), tr('ĐANG KIỂM TRA…'), tr('Đang kiểm tra trạng thái thông báo trên thiết bị này.'), '')}</div>
      <div class="st-tip"><b>${tr('Mẹo:')}</b> ${tr('Sau khi bấm "Kích hoạt thông báo" và chọn Cho phép, ứng dụng sẽ được hệ điều hành lưu vào mục Cài đặt → Thông báo để bạn tuỳ chỉnh biểu ngữ, âm thanh và hiển thị trên màn hình khoá.')}</div>
    </div>
    <div class="card st-card" data-devices-card>${devicesCard(null)}</div>
    ${alertsCard()}
    <div class="card st-card">
      ${secHead('volume2', 'Âm thanh & Chuông thông báo', 'Phát âm thanh thông báo tức thì khi bạn đang mở ứng dụng.')}
      <div data-sound-box></div>
      <div class="st-sub"><div class="t">${icon('circleHelp', 16)}${tr('Nghe thử các kiểu chuông hệ thống')}</div>
        <div class="d">${tr('Bấm vào từng mục để kiểm tra âm thanh trực tiếp trên thiết bị của bạn:')}</div></div>
      <div class="st-chimes">${Object.entries(CHIMES).map(([k, c]) => `<div class="st-chime">
        <div class="grow"><div class="t">${icon(c.icon, 15)}${tr(c.label)}</div><div class="d">${tr(c.desc)}</div></div>
        <button type="button" class="btn sm" data-play="${k}">${icon('play', 13)}${tr('Phát')}</button></div>`).join('')}</div>
    </div>`;

  const inst = body.querySelector('[data-install]');
  if (inst) inst.onclick = async () => {
    inst.disabled = true;
    const outcome = await window.nvPWA.prompt();
    if (outcome === 'accepted') toast('Đã cài ứng dụng lên màn hình chính', 'ok');
    notifyTab(body);
  };
  drawSoundBox(body);
  body.querySelectorAll('[data-play]').forEach(b => b.onclick = () => playChime(b.dataset.play, { force: true }));
  bindCopyLink(body);
  // Thẻ thông báo đẩy nạp RIÊNG, sau khi trang đã hiện: kiểm tra Service Worker/trạng thái có thể mất vài
  // giây (hoặc lỗi) — không được làm trắng cả màn Cài đặt trong lúc chờ.
  loadPushCard(body);
}

function drawSoundBox(body) {
  const box = body.querySelector('[data-sound-box]');
  if (!box) return;
  const on = isSoundOn();
  box.innerHTML = statusBox(on ? 'warm' : 'neutral', on ? 'volume2' : 'volumeX', tr('Trạng thái chuông:'), on ? tr('ĐANG BẬT') : tr('ĐANG TẮT'),
    on ? tr('Hệ thống sẽ phát chuông khi có thông báo mới.') : tr('Chuông đang tắt — thông báo vẫn đến nhưng không phát âm thanh trong app.'),
    `<button type="button" class="btn" data-sound-toggle-st>${icon(on ? 'volumeX' : 'volume2', 15)}${on ? tr('Tắt âm thanh') : tr('Bật âm thanh')}</button>`);
  box.querySelector('[data-sound-toggle-st]').onclick = () => {
    setSoundOn(!on);
    if (!on) playChime('message', { force: true });
    drawSoundBox(body);
  };
}

/** Hộp trạng thái có biểu tượng tròn bên trái và nút thao tác bên phải. tone: ok | warm | neutral | bad */
const statusBox = (tone, ic, label, value, desc, actions) => `<div class="st-status ${tone}">
  <div class="st-status-ic">${icon(ic, 18)}</div>
  <div class="grow"><div class="t">${label} <span class="v">${value}</span></div><div class="d">${desc}</div></div>
  ${actions ? `<div class="st-status-act">${actions}</div>` : ''}</div>`;

/* Hướng dẫn / nút cài app lên màn hình chính — lớp PWA (src/pwa.js) cung cấp window.nvPWA. Không có
 * lớp đó (hoặc đã chạy ở chế độ cài đặt) thì không hiện gì: không nhắc cài lặp đi lặp lại. */
function installCard() {
  const pwa = window.nvPWA;
  if (!pwa || pwa.isStandalone()) return '';
  if (pwa.canPrompt()) {
    return `<div class="card st-card">
      ${secHead('smartphone', 'Cài ứng dụng lên màn hình chính', 'Mở nhanh như app, chạy toàn màn hình, không cần Google Play. Đăng nhập và dữ liệu giống hệt bản web.')}
      <button class="btn primary sm" data-install>${tr('Cài ứng dụng')}</button>
    </div>`;
  }
  if (pwa.isIOS()) {
    return `<div class="card st-card">
      ${secHead('smartphone', 'Cài lên màn hình chính iPhone / iPad', 'Cần cài app thì iPhone/iPad mới nhận được thông báo đẩy.')}
      <ol class="sm mut" style="padding-left:18px;margin:0;line-height:1.6">
        <li>${tr('Mở trang này bằng')} <b>Safari</b> (${tr('Chrome/Zalo trên iOS không có mục này')}).</li>
        <li>${tr('Chạm nút')} <b>${tr('Chia sẻ')}</b> (${tr('ô vuông có mũi tên đi lên')}).</li>
        <li>${tr('Chọn')} <b>${tr('Thêm vào MH chính')}</b> → <b>${tr('Thêm')}</b>.</li>
      </ol>
    </div>`;
  }
  return '';
}

async function loadPushCard(body) {
  const slot = body.querySelector('[data-push-card]');
  if (!slot) return;
  const pwa = window.nvPWA;
  let status = null, error = null;
  if (pwa && !pwa.pushUnsupportedReason()) {
    try { status = await pwa.pushStatus(); } catch (e) { error = e; }
  }
  if (!slot.isConnected) return;               // đã rời trang trong lúc chờ
  if (error && error.sessionExpired) return;   // app đang đưa về màn đăng nhập (src/app.js)
  slot.innerHTML = pushCard(status, error);
  bindPushCard(body, slot);
  const dev = body.querySelector('[data-devices-card]');
  if (dev) { dev.innerHTML = devicesCard(status); bindCopyLink(dev); }
}

function bindPushCard(body, slot) {
  const pwa = window.nvPWA;
  const act = (sel, fn) => slot.querySelectorAll(sel).forEach((b) => { b.onclick = async () => {
    b.disabled = true;
    try { await fn(b); } catch (e) { if (!e.sessionExpired) toast(e.message || 'Có lỗi xảy ra', 'err'); }
    if (slot.isConnected) loadPushCard(body);
  }; });

  const ob = slot.querySelector('[data-open-browser]');
  if (ob) ob.onclick = () => window.open(location.origin + '/#/more/thong-bao', '_blank', 'noopener');
  bindCopyLink(slot);
  act('[data-push-retry]', async () => {});
  // Hỏi quyền CHỈ trong sự kiện bấm này — không bao giờ tự hỏi lúc tải trang.
  act('[data-enable-push]', async () => {
    await pwa.enablePush();
    // Gửi ngay 1 thông báo thử để người dùng THẤY là đã nhận được trên thiết bị này.
    try { await pwa.testPush({ title: 'NetViet Sales OS', body: 'Đã bật thông báo trên thiết bị này. Các cảnh báo quan trọng sẽ hiện ở đây.', link: '/#/thong-bao', tag: 'salesos-enabled' }); } catch (e) { /* bật được là đủ */ }
    toast('Đã bật thông báo trên thiết bị này — kiểm tra thông báo thử vừa gửi.', 'ok');
  });
  act('[data-disable-push]', async () => { await pwa.disablePush(); toast('Đã tắt thông báo trên thiết bị này.', 'ok'); });
  act('[data-remove-push]', async (b) => { await pwa.removePushSubscription(b.dataset.removePush); toast('Đã gỡ thiết bị khỏi thông báo.', 'ok'); });
  act('[data-test-push]', async () => {
    const r = await pwa.testPush({ title: 'NetViet Sales OS', body: 'Push Notification đang hoạt động.', link: '/#/cockpit', tag: 'salesos-push-test' });
    const extra = tf(
      () => [r.removed ? `${r.removed} thiết bị hết hạn đã được gỡ` : '', r.failed ? `${r.failed} thiết bị không nhận` : ''].filter(Boolean).join(', '),
      () => [r.removed ? `${r.removed} expired device(s) removed` : '', r.failed ? `${r.failed} device(s) did not receive it` : ''].filter(Boolean).join(', '));
    toast(tf(() => `Đã gửi thông báo thử tới ${r.sent}/${r.total} thiết bị${extra ? ' (' + extra + ')' : ''}.`,
      () => `Sent test notification to ${r.sent}/${r.total} device(s)${extra ? ' (' + extra + ')' : ''}.`), r.failed ? '' : 'ok');
  });
}

/** Hướng dẫn mở lại quyền khi người dùng đã bấm "Chặn" — trình duyệt không cho web tự hỏi lại. */
const deniedHelp = () => `<div class="note red mt">
  <div class="b">${tr('Quyền thông báo đang bị chặn')}</div>
  <ul class="sm" style="margin:6px 0 0;padding-left:18px;line-height:1.55">
    <li><b>${tr('Máy tính (Chrome/Edge):')}</b> ${tr('bấm biểu tượng cài đặt trang cạnh thanh địa chỉ → Thông báo → Cho phép, rồi tải lại trang.')}</li>
    <li><b>Android:</b> ${tr('Cài đặt → Ứng dụng → NetViet Sales (hoặc Chrome) → Thông báo → Bật.')}</li>
    <li><b>iPhone/iPad:</b> ${tr('Cài đặt → Thông báo → NetViet Sales → Cho phép thông báo.')}</li>
  </ul></div>`;

function pushCard(status, error) {
  const pwa = window.nvPWA;
  const label = tr('Trạng thái:');
  if (!pwa) return statusBox('neutral', 'bell', label, tr('KHÔNG HỖ TRỢ'), tr('Trình duyệt này chưa hỗ trợ thông báo đẩy.'), '');
  const embedded = pwa.embeddedBrowser();
  if (embedded) {
    return statusBox('bad', 'triangleAlert', label, tr('KHÔNG DÙNG ĐƯỢC TRONG KHUNG NÀY'),
      tf(() => `Bạn đang mở Sales OS trong ${embedded} — khung này luôn chặn thông báo. Hãy mở bằng Chrome, Edge hoặc Safari rồi bật lại ở đây.`,
        () => `You are viewing Sales OS inside an embedded browser (${embedded}), which always blocks notifications. Open it in Chrome, Edge or Safari and enable it there.`),
      `<button class="btn primary sm" data-open-browser>${icon('send', 14)}${tr('Mở trong trình duyệt')}</button><button class="btn sm st-btn-soft" data-copy-link>${icon('copy', 14)}${tr('Sao chép liên kết')}</button>`);
  }
  const unsupported = pwa.pushUnsupportedReason();
  if (unsupported) return statusBox('neutral', 'bell', label, tr('KHÔNG HỖ TRỢ'), esc(unsupported), '');
  if (error) {
    return statusBox('bad', 'triangleAlert', label, tr('LỖI'), tr('Không kiểm tra được trạng thái thông báo: ') + esc(error.message || tr('lỗi không xác định')),
      `<button class="btn sm" data-push-retry>${tr('Thử lại')}</button>`);
  }
  if (!status.configured) {
    return statusBox('neutral', 'bell', label, tr('CHƯA CẤU HÌNH'), tr('Push chưa được cấu hình trên máy chủ. Liên hệ quản trị viên.'), '');
  }

  const subscriptions = status.subscriptions || [];
  const enabled = !!status.currentDeviceSubscribed;
  const denied = status.permission === 'denied';
  const testBtn = subscriptions.length ? `<button class="btn primary sm" data-test-push>${icon('send', 14)}${tr('Gửi thử thông báo')}</button>` : '';
  const box = enabled
    ? statusBox('ok', 'bell', label, tr('ĐÃ KÍCH HOẠT TRÊN THIẾT BỊ NÀY'), tr('Thiết bị sẵn sàng nhận popup thông báo và rung chuông, kể cả khi bạn đã khoá màn hình.'),
      `${testBtn}<button class="btn sm st-btn-soft" data-disable-push>${tr('Tắt trên máy này')}</button>`)
    : denied
      ? statusBox('bad', 'bell', label, tr('ĐANG BỊ CHẶN'), tr('Trình duyệt đang chặn thông báo của ứng dụng trên thiết bị này.'), testBtn)
      : statusBox('neutral', 'bell', label, tr('CHƯA KÍCH HOẠT TRÊN THIẾT BỊ NÀY'), tr('Bật để nhận nhắc việc và hoạt động quan trọng — kể cả khi app đang đóng.'),
        `<button class="btn primary sm" data-enable-push>${icon('bell', 14)}${tr('Kích hoạt thông báo')}</button>${testBtn}`);

  return `${box}${denied && !enabled ? deniedHelp() : ''}
    ${subscriptions.length ? `<div class="st-devices"><div class="xs mut">${tr('Thiết bị đã đăng ký')} (${subscriptions.length}):</div>${subscriptions.map(s => `<div class="item"><div class="grow"><div class="sm">${esc(deviceLabel(s))}</div><div class="xs mut">${tr('Cập nhật')} ${new Date(Number(s.updated_at) * 1000).toLocaleDateString('vi-VN')}</div></div><button class="btn sm" data-remove-push="${esc(s.id)}">${tr('Gỡ')}</button></div>`).join('')}</div>` : ''}`;
}

function deviceLabel(subscription) {
  const platform = { ios: 'iPhone / iPad', android: 'Android', macos: 'Mac', windows: 'Windows', other: tr('Thiết bị khác') }[subscription.platform] || tr('Thiết bị khác');
  return `${platform} · ${String(subscription.user_agent || tr('Trình duyệt web')).slice(0, 72)}`;
}

const PHONE = ['ios', 'android'];
/** Nhận thông báo trên điện thoại & máy tính: số thiết bị đã bật theo loại + hướng dẫn bật cho từng loại. */
function devicesCard(status) {
  const subs = (status && status.subscriptions) || [];
  const phones = subs.filter(x => PHONE.includes(x.platform)).length;
  const computers = subs.length - phones;
  const col = (ic, title, n, steps) => `<div class="st-dev">
    <div class="st-dev-head">${icon(ic, 20)}<div class="grow"><div class="t">${tr(title)}</div>
      <div class="d">${status ? (n ? `<span class="chip green">${tf(() => `Đã bật trên ${n} thiết bị`, () => `Enabled on ${n} device(s)`)}</span>` : `<span class="chip">${tr('Chưa bật thiết bị nào')}</span>`) : ''}</div></div></div>
    <ol>${steps.map(x => `<li>${x}</li>`).join('')}</ol></div>`;
  return `${secHead('bell', 'Nhận thông báo trên điện thoại & máy tính', 'Bật trên từng thiết bị bạn dùng — mỗi thiết bị bật một lần, sau đó mọi cảnh báo sẽ tự hiện kể cả khi không mở app.')}
    <div class="st-devs">
      ${col('smartphone', 'Điện thoại', phones, [
        `<b>Android:</b> ${tr('mở liên kết bên dưới bằng Chrome → menu ⋮ → Cài đặt ứng dụng → mở app từ màn hình chính → Cài đặt → Kích hoạt thông báo → Cho phép.')}`,
        `<b>iPhone / iPad:</b> ${tr('mở bằng Safari → nút Chia sẻ → Thêm vào MH chính → mở app từ icon → Cài đặt → Kích hoạt thông báo → Cho phép (cần iOS 16.4 trở lên).')}`,
      ])}
      ${col('briefcase', 'Máy tính', computers, [
        `${tr('Mở bằng')} <b>Chrome, Edge ${tr('hoặc')} Safari</b> — ${tr('không dùng khung xem trước của VS Code hay trình duyệt trong Zalo/Facebook.')}`,
        tr('Vào Cài đặt → Kích hoạt thông báo → chọn Cho phép.'),
        `<b>macOS:</b> ${tr('Cài đặt hệ thống → Thông báo → bật cho Chrome/Edge/Safari.')} <b>Windows:</b> ${tr('Settings → System → Notifications → bật cho trình duyệt.')}`,
      ])}
    </div>
    <div class="st-link"><span class="grow">${tr('Liên kết mở Sales OS trên thiết bị khác:')} <b>${esc(location.origin)}</b></span>
      <button class="btn sm" data-copy-link>${icon('copy', 14)}${tr('Sao chép liên kết')}</button></div>`;
}

function bindCopyLink(root) {
  root.querySelectorAll('[data-copy-link]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(location.origin + '/#/more/thong-bao'); toast('Đã sao chép liên kết', 'ok'); }
    catch (e) { toast(location.origin, ''); }
  });
}

/** Các cảnh báo hệ thống tự gửi — theo vai trò của người đang xem. */
function alertsCard() {
  const lead = ['admin', 'manager'].includes(state.me && state.me.role);
  const rows = lead ? [
    ['siren', 'Cần duyệt gấp', 'Báo giá, hợp đồng, hạng mục phương án chờ bạn duyệt quá 4 giờ / 1 ngày làm việc; leo thang khi quá gấp đôi hạn.'],
    ['clipboardList', 'Tóm tắt việc chờ duyệt', 'Lúc 9h và 14h ngày làm việc: tổng số mục đang chờ bạn duyệt.'],
    ['alarmClock', 'Cần xử lý nhanh & sắp quá hạn', 'Việc bạn giao sắp đến hạn hoặc chưa được nhận, deal nguội quá gấp đôi SLA, hạn nộp thầu, mốc PIP.'],
    ['trendingUp', 'Cảnh báo chỉ số sale', '16h ngày làm việc: sales dưới 50% định mức ngày. Thứ Hai & ngày 25: doanh thu tháng chậm tiến độ.'],
  ] : [
    ['barChart2', 'Tiến độ KPI hôm nay', 'Lúc 11h và 15h: bạn đã đạt bao nhiêu % định mức (liên hệ mới, cuộc gọi, gặp/demo, follow-up).'],
    ['alarmClock', 'Công việc sắp quá hạn', 'Còn dưới 24 giờ và dưới 2 giờ trước hạn; việc đã quá hạn; việc mới được giao.'],
    ['calendarDays', 'Lịch làm việc với khách', '8h sáng: lịch gặp khách trong ngày; nhắc lại trước giờ hẹn 2 tiếng.'],
    ['target', 'Deal & báo cáo', 'Deal sắp đến ngày dự kiến chốt, deal quá SLA, nhắc nộp báo cáo cuối ngày.'],
  ];
  return `<div class="card st-card">
    ${secHead('bell', lead ? 'Cảnh báo dành cho Ban Giám đốc / Quản lý' : 'Cảnh báo dành cho bạn', 'Hệ thống tự kiểm tra 30 phút/lần và gửi tới trang Thông báo, điện thoại và máy tính đã bật.')}
    <div class="st-alerts">${rows.map(([ic, t1, d1]) => `<div class="st-alert">${icon(ic, 17)}<div><div class="t">${tr(t1)}</div><div class="d">${tr(d1)}</div></div></div>`).join('')}</div>
    <div class="st-me-foot" style="margin-top:14px"><a class="btn sm" href="#/thong-bao">${icon('bell', 14)}${tr('Xem tất cả thông báo')}</a></div>
  </div>`;
}

/* ---------------- Tab 2: Bảo mật & Mật khẩu ---------------- */

const pwField = (name, label, placeholder, autocomplete) => `<label class="f"><span class="st-label">${tr(label)}</span>
  <div class="pw-wrap"><input name="${name}" type="password" placeholder="${esc(tr(placeholder))}" autocomplete="${autocomplete}" required>
  <button type="button" class="pw-toggle" data-toggle-pw aria-label="${tr('Hiện mật khẩu')}">${icon('eye', 16)}</button></div></label>`;

function securityTab(body) {
  body.innerHTML = `<div class="card st-card">
    ${secHead('shieldCheck', 'Đổi mật khẩu tài khoản', 'Nên sử dụng mật khẩu mạnh gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt để bảo vệ tài khoản.')}
    <form class="st-pw-form" data-pw-form>
      ${pwField('current', 'Mật khẩu hiện tại', 'Nhập mật khẩu hiện tại', 'current-password')}
      ${pwField('password', 'Mật khẩu mới', 'Tạo mật khẩu mới an toàn', 'new-password')}
      ${pwRulesHtml()}
      ${pwField('password2', 'Xác nhận mật khẩu mới', 'Nhập lại mật khẩu mới', 'new-password')}
      <div class="st-pw-foot"><button type="submit" class="btn primary">${tr('Cập nhật mật khẩu')}</button></div>
    </form></div>`;

  const form = body.querySelector('[data-pw-form]');
  bindPwToggles(form);
  const rulesOk = bindPwRules(form.password, form.querySelector('[data-pw-rules]'));
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!rulesOk()) { toast('Mật khẩu mới chưa đạt đủ các điều kiện bên dưới ô nhập', 'err'); return; }
    if (form.password.value !== form.password2.value) { toast('Mật khẩu xác nhận không khớp', 'err'); return; }
    if (form.password.value === form.current.value) { toast('Mật khẩu mới phải khác mật khẩu hiện tại.', 'err'); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await post('/account/password', { currentPassword: form.current.value, password: form.password.value });
      toast('Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.', 'ok');
      securityTab(body);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
  };
}

/* ---------------- Tab 3: Thông tin cá nhân ---------------- */

async function accountTab(body) {
  const me = state.me;
  const draw = (p) => {
    const cell = (label, value) => `<div class="st-info"><div class="l">${tr(label)}</div><div class="v" title="${esc(value || '')}">${esc(value || '—')}</div></div>`;
    const role = roleDefaultLabel(p);
    const title = p.title ? jobTitle(p.title, () => role) : '';
    body.innerHTML = `<div class="card st-card">
      <div class="st-me">
        ${avatar(p, 'style="width:62px;height:62px;font-size:21px"')}
        <div class="grow"><div class="st-me-name">${esc(personName(p.name))}</div>
          <div class="st-me-tags"><span>${esc(role)}</span>${title && title !== role ? `<span>${esc(title)}</span>` : ''}<span>${tr('Mã')}: ${esc(p.id)}</span></div></div>
      </div>
      <div class="st-info-grid">
        ${cell('Họ và tên', personName(p.name))}
        ${cell('Email đăng nhập', p.email)}
        ${cell('Mã nhân viên', p.id)}
        ${cell('Vị trí / Chức danh', title)}
        ${cell('Vai trò', role)}
        ${cell('Số điện thoại', p.phone)}
      </div>
      <div class="st-me-foot"><a class="btn" href="#/profile">${icon('user', 15)}${tr('Xem hồ sơ chi tiết & giấy tờ')}</a></div>
    </div>
    <div class="card st-card">
      ${secHead('messageSquare', 'Ngôn ngữ', 'Chọn ngôn ngữ hiển thị cho toàn bộ ứng dụng.')}
      <div class="seg">
        <button data-lang="vi" class="${getLang() === 'vi' ? 'on' : ''}">Tiếng Việt</button>
        <button data-lang="en" class="${getLang() === 'en' ? 'on' : ''}">English</button>
      </div>
    </div>
    <div class="card st-card">
      <div class="item" style="padding:0;border:0">
        <div class="dot-i">${icon('logOut')}</div>
        <div class="grow"><div class="t">${tr('Đăng xuất')}</div><div class="d">${tr('Thoát khỏi phiên đăng nhập hiện tại')}</div></div>
        <button class="btn sm" data-logout>${tr('Đăng xuất')}</button>
      </div>
    </div>`;
    body.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => setLang(b.dataset.lang));
    body.querySelector('[data-logout]').onclick = async () => {
      await logout();
      location.hash = '#/login';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
  };
  draw(me);
  try {
    const { profile } = await get('/account/profile');
    if (body.isConnected && tab === 'ca-nhan') draw({ ...me, ...profile });
  } catch (e) { /* đã hiện thông tin từ phiên đăng nhập */ }
}
