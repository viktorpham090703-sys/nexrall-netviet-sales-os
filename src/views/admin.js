import { get, post, patch } from '../api.js';
import { state, isAdmin, salesUsers } from '../state.js';
import { esc, mount, chip, empty, fmtDT, toast, modal, stat } from '../ui.js';
import { ROLE_NAME } from '../const.js';
import { providers, testProvider, getProvider, setProvider } from '../aiPref.js';

let tab = 'users';

const CFG_LABELS = {
  quota_daily_contacts: 'Định mức liên hệ mới/ngày',
  quota_calls: 'Định mức cuộc gọi/ngày',
  quota_meetings: 'Định mức gặp/demo/ngày',
  target_revenue: 'Mục tiêu doanh thu/tháng (đ)',
  target_deals: 'Mục tiêu số deal chốt/tháng',
  target_pipeline: 'Mục tiêu pipeline kỳ vọng (đ)',
  discount_threshold: 'Ngưỡng chiết khấu cần TP duyệt (%)',
  report_deadline_hour: 'Giờ hạn nộp báo cáo EOD',
  task_accept_sla_min: 'SLA xác nhận nhận việc (phút)',
  sla_days: 'SLA theo giai đoạn (JSON)',
};

export async function render(el) {
  const load = async () => {
    const [u, c, a, ai] = await Promise.all([get('/users'), get('/config'), get('/audit'), providers(true)]);
    return { users: u.items || [], cfg: c, audit: a.items || [], ai };
  };

  const draw = (d) => `<div class="page-head">
    <div class="grow"><h2>Quản trị & Phân quyền</h2><p>Người dùng · ngưỡng KPI linh hoạt · SLA · audit log · chống chụp màn</p></div>
  </div>

  <div class="grid g3 mb">
    ${stat('Người dùng', d.users.length, d.users.filter(u => u.role === 'sales').length + ' sales', 'blue')}
    ${stat('Cấu hình', d.cfg.rows.length, 'Global + theo từng sales', 'amber')}
    ${stat('Audit log', d.audit.length, d.audit.filter(a => a.action === 'screen_capture_suspect').length + ' cảnh báo chụp màn', 'red')}
  </div>

  <div class="seg mb">
    <button data-tab="users" class="${tab === 'users' ? 'on' : ''}">Người dùng</button>
    <button data-tab="config" class="${tab === 'config' ? 'on' : ''}">Ngưỡng & SLA</button>
    <button data-tab="ai" class="${tab === 'ai' ? 'on' : ''}">Kết nối AI</button>
    <button data-tab="audit" class="${tab === 'audit' ? 'on' : ''}">Audit log</button>
  </div>

  ${tab === 'ai' ? `<div class="card">${(d.ai.providers || []).map(p => `<div class="item">
      <div class="dot-i">${p.icon}</div>
      <div class="grow"><div class="t">${esc(p.label)} ${getProvider() === p.key ? chip('Đang chọn', 'blue') : ''}</div>
        <div class="d">${esc(p.model)}${p.secret ? ' · secret <code>' + esc(p.secret) + '</code>' : ''}</div>
        <div class="d xs">${esc(p.help || '')}</div></div>
      <div class="right">${chip(p.configured ? 'Đã có API key' : 'Chưa có key', p.configured ? 'green' : 'red')}
        <div class="mt"><button class="btn sm" data-aitest="${esc(p.key)}">Test kết nối</button></div>
        <div class="mt"><button class="btn sm ${getProvider() === p.key ? 'primary' : ''}" data-aiuse="${esc(p.key)}">Dùng</button></div>
      </div></div>`).join('')}</div>
    <div class="card mt"><div class="b sm mb">🔌 Cách bật AI thật</div>
      <div class="sm mut">Vào mục <b>Secrets</b> của app và nhập <code>GEMINI_API_KEY</code> (aistudio.google.com/apikey) hoặc <code>ANTHROPIC_API_KEY</code> (console.anthropic.com).
      Chỉ cần nhập key là toàn bộ tính năng AI (Trợ lý, soạn email, proposal, research thầu) chuyển sang dùng AI thật — không phải sửa code.
      Muốn cố định model, thêm <code>GEMINI_MODEL</code> / <code>CLAUDE_MODEL</code>. Nếu gọi API lỗi, app tự dùng nội dung mẫu và báo lý do.</div>
      <div data-aiout class="mt"></div></div>` : ''}

  ${tab === 'users' ? `${isAdmin() ? '<button class="btn block mb" data-adduser>+ Thêm người dùng</button>' : ''}
    <div class="card">${d.users.map(u => `<div class="item">
      <div class="dot-i">${u.role === 'admin' ? '🛡️' : u.role === 'manager' ? '🎖️' : '👤'}</div>
      <div class="grow"><div class="t">${esc(u.name)}</div>
        <div class="d">${esc(ROLE_NAME[u.role] || u.role)} · ${esc(u.email || '')}</div></div>
      <div class="right">${chip(u.active ? 'Hoạt động' : 'Khoá', u.active ? 'green' : 'red')}
        ${isAdmin() ? `<div class="mt row" style="gap:6px">
          <button class="btn sm" data-edituser="${esc(u.id)}">Sửa</button>
          <button class="btn sm" data-resetlink="${esc(u.id)}" data-name="${esc(u.name)}">Tạo liên kết đặt lại mật khẩu</button>
        </div>` : ''}</div>
    </div>`).join('')}</div>` : ''}

  ${tab === 'config' ? `<button class="btn block mb" data-addcfg>+ Đặt ngưỡng (global hoặc theo sales)</button>
    <div class="card scroll-x"><table class="tbl">
      <tr><th>Khoá</th><th>Phạm vi</th><th>Giá trị</th><th></th></tr>
      ${d.cfg.rows.map(r => `<tr><td>${esc(CFG_LABELS[r.ckey] || r.ckey)}<div class="xs mut">${esc(r.ckey)}</div></td>
        <td>${r.user_id ? esc((state.users.find(u => u.id === r.user_id) || {}).name || r.user_id) : 'Toàn hệ thống'}</td>
        <td>${esc(String(r.value).slice(0, 40))}</td>
        <td><button class="btn sm" data-editcfg="${esc(r.ckey)}" data-user="${esc(r.user_id || '')}" data-val="${esc(r.value)}">Sửa</button></td></tr>`).join('')}
    </table></div>
    <div class="card mt"><div class="b sm mb">🔒 Chống chụp màn hình</div>
      <div class="sm mut">Đang BẬT cho các màn nhạy cảm: Bảng giá/Proposal, Dữ liệu khách, KPI, Pipeline, Bài giảng, Console.
      Khi mất focus / chuyển tab / nhấn PrintScreen → nội dung bị che và ghi audit log.
      Giới hạn kỹ thuật: trình duyệt không chặn được chụp màn hình ở tầng hệ điều hành — muốn chặn thật cần đóng gói app native và bật FLAG_SECURE (Android) / cờ bảo vệ màn hình (iOS).</div></div>` : ''}

  ${tab === 'audit' ? (d.audit.length ? `<div class="card">${d.audit.map(a => `<div class="item">
      <div class="dot-i">${a.action === 'screen_capture_suspect' ? '📸' : a.action === 'login' ? '🔑' : '🧾'}</div>
      <div class="grow"><div class="t">${esc(a.action)} ${a.entity ? '· ' + esc(a.entity) : ''}</div>
        <div class="d">${esc(a.user_name || 'ẩn danh')} · ${fmtDT(a.created_at)}</div>
        ${a.meta ? `<div class="d xs">${esc(String(a.meta).slice(0, 120))}</div>` : ''}</div>
    </div>`).join('')}</div>` : empty('🧾', 'Chưa có log nào.')) : ''}`;

  const bind = (d) => {
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(el); });
    el.querySelectorAll('[data-aiuse]').forEach(b => b.onclick = () => {
      const p = (d.ai.providers || []).find(x => x.key === b.dataset.aiuse);
      if (!p.configured) { toast('Chưa nhập ' + p.secret + ' trong Secrets của app', 'err'); return; }
      setProvider(p.key);
      toast('Đã chọn ' + p.label, 'ok');
      render(el);
    });
    el.querySelectorAll('[data-aitest]').forEach(b => b.onclick = async () => {
      const out = el.querySelector('[data-aiout]');
      b.disabled = true;
      out.innerHTML = '<div class="sm mut">⏳ Đang gọi thử API…</div>';
      try {
        const r = await testProvider(b.dataset.aitest);
        out.innerHTML = `<div class="sm" style="color:#22c55e">✅ Kết nối OK · model <b>${esc(r.model)}</b><div class="xs mut mt">${esc(r.text || '')}</div></div>`;
      } catch (e) {
        out.innerHTML = `<div class="sm" style="color:#F59E0B">⚠️ ${esc(e.message)}</div>`;
      } finally { b.disabled = false; }
    });
    const au = el.querySelector('[data-adduser]');
    if (au) au.onclick = () => modal({
      title: 'Thêm người dùng',
      fields: [{ name: 'name', label: 'Họ tên', required: true }, { name: 'email', label: 'Email' },
      { name: 'role', label: 'Vai trò', type: 'select', options: [{ v: 'sales', n: 'Sales' }, { v: 'manager', n: 'Trưởng phòng' }, { v: 'admin', n: 'Admin/BGĐ' }] },
      { name: 'title', label: 'Chức danh' },
      { name: 'password', label: 'Mật khẩu đăng nhập', type: 'password', hint: 'Bỏ trống để tạo liên kết thiết lập mật khẩu — nhân sự tự đặt mật khẩu, bạn sẽ không biết mật khẩu của họ (khuyến nghị).' }],
      onSubmit: async (v) => {
        const noPassword = !v.password;
        if (noPassword) delete v.password;
        const r = await post('/users', v);
        toast('Đã thêm người dùng', 'ok');
        render(el);
        if (!noPassword) return;
        // Modal lồng: giữ modal-root khỏi bị đóng đè bằng cách trả về false, rồi mới mở
        // modal hiển thị liên kết thiết lập mật khẩu vào đúng chỗ modal vừa đóng.
        await createSetupLink(r.id, 'invite', v.name);
        return false;
      },
    });
    el.querySelectorAll('[data-edituser]').forEach(b => b.onclick = () => {
      const u = d.users.find(x => x.id === b.dataset.edituser);
      modal({
        title: 'Sửa người dùng',
        fields: [{ name: 'name', label: 'Họ tên', value: u.name }, { name: 'email', label: 'Email', value: u.email || '' },
        { name: 'role', label: 'Vai trò', type: 'select', value: u.role, options: [{ v: 'sales', n: 'Sales' }, { v: 'manager', n: 'Trưởng phòng' }, { v: 'admin', n: 'Admin/BGĐ' }] },
        { name: 'active', label: 'Trạng thái', type: 'select', value: String(u.active), options: [{ v: '1', n: 'Hoạt động' }, { v: '', n: 'Khoá' }] },
        { name: 'password', label: 'Đặt lại mật khẩu', type: 'password', hint: 'Bỏ trống để giữ nguyên mật khẩu hiện tại.' }],
        onSubmit: async (v) => { if (!v.password) delete v.password; await patch('/users/' + u.id, { ...v, active: !!v.active }); toast('Đã cập nhật', 'ok'); render(el); },
      });
    });
    el.querySelectorAll('[data-resetlink]').forEach(b => b.onclick = () => createSetupLink(b.dataset.resetlink, 'reset', b.dataset.name));
    const ac = el.querySelector('[data-addcfg]');
    if (ac) ac.onclick = () => cfgModal('', '', '', () => render(el));
    el.querySelectorAll('[data-editcfg]').forEach(b => b.onclick = () => cfgModal(b.dataset.editcfg, b.dataset.user, b.dataset.val, () => render(el)));
  };

  await mount(el, load, draw, bind);
}

/** Sinh liên kết thiết lập mật khẩu (mời tài khoản mới / đặt lại mật khẩu) và hiển thị để Admin
 * tự gửi qua Zalo/Slack — app chưa có hạ tầng gửi email, đây là cách Admin không cần biết mật khẩu thật. */
async function createSetupLink(userId, purpose, name) {
  try {
    const r = await post('/users/' + userId + '/setup-link', { purpose });
    const link = `${location.origin}/#/dat-mat-khau/${r.token}`;
    const { root } = modal({
      title: purpose === 'reset' ? 'Liên kết đặt lại mật khẩu' : 'Liên kết thiết lập mật khẩu',
      html: `<p class="sm mut">Gửi liên kết dưới đây cho <b>${esc(name || '')}</b> qua Zalo/Slack. Liên kết chỉ dùng được 1 lần và hết hạn sau 48 giờ.</p>
        <label class="f"><span>LIÊN KẾT</span><input data-setup-link type="text" readonly value="${esc(link)}"></label>
        <button type="button" class="btn block mt" data-copy-link>📋 Copy link</button>`,
      submitText: 'Đóng',
      onSubmit: () => {},
    });
    root.querySelector('[data-copy-link]').onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast('Đã sao chép', 'ok'); }
      catch (e) { toast('Không sao chép được', 'err'); }
    };
  } catch (e) { toast(e.message, 'err'); }
}

function cfgModal(key, userId, value, after) {
  modal({
    title: 'Cấu hình ngưỡng',
    fields: [
      { name: 'key', label: 'Khoá cấu hình', type: 'select', value: key, options: Object.keys(CFG_LABELS).map(k => ({ v: k, n: CFG_LABELS[k] })) },
      { name: 'userId', label: 'Áp dụng cho', type: 'select', value: userId, options: [{ v: '', n: 'Toàn hệ thống' }, ...salesUsers().map(u => ({ v: u.id, n: u.name }))] },
      { name: 'value', label: 'Giá trị', value, required: true },
    ],
    submitText: 'Lưu cấu hình',
    onSubmit: async (v) => { await post('/config', v); toast('Đã cập nhật cấu hình', 'ok'); after(); },
  });
}
