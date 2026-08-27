import { get, post, patch } from '../api.js';
import { state, isAdmin, canManageAccounts, salesUsers } from '../state.js';
import { esc, mount, chip, toast, modal, stat, bindTabs, confirmDialog } from '../ui.js';
import { roleLabel } from '../const.js';
import { providers, testProvider, getProvider, setProvider, providerIconName } from '../aiPref.js';
import { icon } from '../icons.js';

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
    const [u, c, ai] = await Promise.all([get('/users'), get('/config'), providers(true)]);
    // HAUNV là TGĐ kiêm Admin toàn quyền — luôn ghim lên đầu danh sách người dùng.
    const users = (u.items || []).slice().sort((a, b) => (a.id === 'HAUNV' ? -1 : b.id === 'HAUNV' ? 1 : 0));
    return { users, cfg: c, ai };
  };

  const draw = (d) => `<div class="page-head">
    <div class="grow"><h2>Quản trị & Phân quyền</h2><p>Người dùng · ngưỡng KPI linh hoạt · SLA · chống chụp màn</p></div>
  </div>

  <div class="grid g3 mb">
    ${stat('Người dùng', d.users.length, d.users.filter(u => u.role === 'sales').length + ' sales', 'blue')}
    ${stat('Cấu hình', d.cfg.rows.length, 'Global + theo từng sales', 'amber')}
  </div>

  <div class="seg mb">
    <button data-tab="users" class="${tab === 'users' ? 'on' : ''}">Người dùng</button>
    <button data-tab="config" class="${tab === 'config' ? 'on' : ''}">Ngưỡng & SLA</button>
    <button data-tab="ai" class="${tab === 'ai' ? 'on' : ''}">Kết nối AI</button>
  </div>

  ${tab === 'ai' ? `<div class="card">${(d.ai.providers || []).map(p => `<div class="item">
      <div class="dot-i">${icon(providerIconName(p.key))}</div>
      <div class="grow"><div class="t">${esc(p.label)} ${getProvider() === p.key ? chip('Đang chọn', 'blue') : ''}</div>
        <div class="d">${esc(p.model)}${p.secret ? ' · secret <code>' + esc(p.secret) + '</code>' : ''}</div>
        <div class="d xs">${esc(p.help || '')}</div></div>
      <div class="right">${chip(p.configured ? 'Đã có API key' : 'Chưa có key', p.configured ? 'green' : 'red')}
        <div class="mt"><button class="btn sm" data-aitest="${esc(p.key)}">Test kết nối</button></div>
        <div class="mt"><button class="btn sm ${getProvider() === p.key ? 'primary' : ''}" data-aiuse="${esc(p.key)}">Dùng</button></div>
      </div></div>`).join('')}</div>
    <div class="card mt"><div class="b sm mb">${icon('plug', 14)} Cách bật AI thật</div>
      <div class="sm mut">Vào mục <b>Secrets</b> của app và nhập <code>GEMINI_API_KEY</code> (aistudio.google.com/apikey) hoặc <code>ANTHROPIC_API_KEY</code> (console.anthropic.com).
      Chỉ cần nhập key là toàn bộ tính năng AI (Trợ lý, soạn email, proposal, research thầu) chuyển sang dùng AI thật — không phải sửa code.
      Muốn cố định model, thêm <code>GEMINI_MODEL</code> / <code>CLAUDE_MODEL</code>. Nếu gọi API lỗi, app tự dùng nội dung mẫu và báo lý do.</div>
      <div data-aiout class="mt"></div></div>` : ''}

  ${tab === 'users' ? `${canManageAccounts() ? '<button class="btn block mb" data-adduser>+ Thêm người dùng</button>' : ''}
    ${isAdmin() && !canManageAccounts() ? `<div class="card mb"><div class="sm mut">${icon('lock', 14)} Tài khoản Admin của bạn chỉ xem, không được thêm/khoá tài khoản hay đổi mật khẩu nhân sự khác.</div></div>` : ''}
    <div class="card">${d.users.map(u => `<div class="item">
      <div class="dot-i">${icon(u.role === 'admin' ? 'shieldCheck' : u.role === 'manager' ? 'award' : 'user')}</div>
      <div class="grow"><div class="t">${esc(u.name)}</div>
        <div class="d">${esc(roleLabel(u))} · ${esc(u.email || '')}</div></div>
      <div class="right">${chip(u.active ? 'Hoạt động' : 'Khoá', u.active ? 'green' : 'red')}
        ${canManageAccounts() ? `<div class="mt row" style="gap:6px">
          <button class="btn sm" data-viewprofile="${esc(u.id)}">Xem hồ sơ</button>
          <button class="btn sm" data-editrole="${esc(u.id)}">Vai trò & chức danh</button>
          <button class="btn sm" data-togglestatus="${esc(u.id)}" data-active="${u.active ? '1' : ''}" data-name="${esc(u.name)}">${u.active ? 'Khoá' : 'Kích hoạt'}</button>
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
    </table></div>` : ''}`;

  const bind = (d) => {
    bindTabs(el, t => tab = t, render);
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
      out.innerHTML = `<div class="sm mut">${icon('loaderCircle', 14, { class: 'spin' })} Đang gọi thử API…</div>`;
      try {
        const r = await testProvider(b.dataset.aitest);
        out.innerHTML = `<div class="sm" style="color:#16A34A">${icon('circleCheck', 14)} Kết nối OK · model <b>${esc(r.model)}</b><div class="xs mut mt">${esc(r.text || '')}</div></div>`;
      } catch (e) {
        out.innerHTML = `<div class="sm" style="color:#F59E0B">${icon('triangleAlert', 14)} ${esc(e.message)}</div>`;
      } finally { b.disabled = false; }
    });
    const au = el.querySelector('[data-adduser]');
    if (au) au.onclick = () => modal({
      title: 'Thêm người dùng',
      fields: [{ name: 'name', label: 'Họ tên', required: true }, { name: 'email', label: 'Email' },
      { name: 'role', label: 'Vai trò', type: 'select', options: [{ v: 'sales', n: 'Sales' }, { v: 'manager', n: 'Trưởng phòng' }, { v: 'admin', n: 'Admin/BGĐ' }, { v: 'hr', n: 'Hành chính nhân sự' }] },
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
    el.querySelectorAll('[data-viewprofile]').forEach(b => b.onclick = async () => {
      try {
        const { profile: pr } = await get('/users/' + b.dataset.viewprofile + '/profile');
        modal({
          title: 'Hồ sơ nhân sự — ' + pr.name,
          titleIcon: 'user',
          wide: true,
          html: `<div class="grid g3">
            ${profileRow('Mã nhân viên', esc(pr.id))}
            ${profileRow('Họ và tên', esc(pr.name))}
            ${profileRow('Email', esc(pr.email || '—'))}
            ${profileRow('Số điện thoại', esc(pr.phone || '—'))}
            ${profileRow('Ngày sinh', fmtDateStr(pr.birth_date))}
            ${profileRow('Số CCCD', esc(pr.id_number || '—'))}
            ${profileRow('Hạn CCCD', fmtDateStr(pr.id_expiry))}
            ${profileRow('Địa chỉ liên hệ', esc(pr.address || '—'))}
            ${profileRow('Trường học', esc(pr.school || '—'))}
          </div>
          <div class="mt">${profileRow('Liên hệ khẩn cấp', esc(pr.emergency_contact || '—'))}</div>
          <div class="sm mut mt">${icon('lock', 13)} Hồ sơ do chính nhân sự tự khai và tự sửa — Admin chỉ xem, không sửa được ở đây.</div>`,
          submitText: 'Đóng',
          onSubmit: () => {},
        });
      } catch (e) { toast(e.message, 'err'); }
    });
    el.querySelectorAll('[data-editrole]').forEach(b => b.onclick = () => {
      const u = d.users.find(x => x.id === b.dataset.editrole);
      modal({
        title: 'Vai trò & chức danh — ' + u.name,
        fields: [
          { name: 'role', label: 'Vai trò', type: 'select', value: u.role, options: [{ v: 'sales', n: 'Sales' }, { v: 'manager', n: 'Trưởng phòng' }, { v: 'admin', n: 'Admin/BGĐ' }, { v: 'hr', n: 'Hành chính nhân sự' }] },
          { name: 'title', label: 'Chức danh', value: u.title || '' },
        ],
        submitText: 'Lưu',
        onSubmit: async (v) => { await patch('/users/' + u.id, v); toast('Đã cập nhật vai trò & chức danh', 'ok'); render(el); },
      });
    });
    el.querySelectorAll('[data-togglestatus]').forEach(b => b.onclick = () => {
      const activating = !b.dataset.active;
      confirmDialog(
        activating ? 'Kích hoạt tài khoản' : 'Khoá tài khoản',
        `Bạn có chắc muốn ${activating ? 'kích hoạt' : 'khoá'} tài khoản của ${b.dataset.name}?`,
        async () => {
          await patch('/users/' + b.dataset.togglestatus, { active: activating });
          toast(activating ? 'Đã kích hoạt tài khoản' : 'Đã khoá tài khoản', 'ok');
          render(el);
        },
      );
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
        <button type="button" class="btn block mt" data-copy-link>${icon('copy', 14)} Copy link</button>`,
      submitText: 'Đóng',
      onSubmit: () => {},
    });
    root.querySelector('[data-copy-link]').onclick = async () => {
      try { await navigator.clipboard.writeText(link); toast('Đã sao chép', 'ok'); }
      catch (e) { toast('Không sao chép được', 'err'); }
    };
  } catch (e) { toast(e.message, 'err'); }
}

const fmtDateStr = (s) => {
  if (!s) return '—';
  const [y, m, d] = String(s).split('-').map(Number);
  return y && m && d ? `${d}/${m}/${y}` : '—';
};
const profileRow = (label, value) => `<div><div class="xs mut">${esc(label)}</div><div class="b" style="margin-top:2px">${value}</div></div>`;

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
