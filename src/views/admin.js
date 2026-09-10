import { get, post, patch, del } from '../api.js';
import { state, isAdmin, canManageAccounts, salesUsers, applyUserRole } from '../state.js';
import { esc, mount, chip, toast, modal, stat, bindTabs, confirmDialog, fmtDT, refreshShellRole } from '../ui.js';
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
  // Đợt cập nhật quy trình PKD 2026
  dkkh_days: 'Thời hạn ĐKKH (ngày)',
  dkkh_lock_when_signed: 'Khách đã ký HĐ giữ vĩnh viễn (1 = có, 0 = vẫn đếm ngược)',
  partner_pa1_partner_rate: 'PA1 — % hoa hồng Partner',
  partner_pa1_sale_rate: 'PA1 — % hoa hồng Sale',
  partner_pa2_partner_rate: 'PA2 — % hoa hồng Partner',
  partner_pa2_sale_rate: 'PA2 — % hoa hồng Sale',
};

export async function render(el) {
  const load = async () => {
    // Khoá API chỉ Admin quản lý tài khoản mới đọc được — người khác nhận 403, coi như danh sách rỗng.
    const [u, c, ai, keys] = await Promise.all([
      get('/users'), get('/config'), providers(true),
      canManageAccounts() ? get('/api-keys').catch(() => ({ items: [], allowlist: [] })) : Promise.resolve({ items: [], allowlist: [] }),
    ]);
    // HAUNV là TGĐ kiêm Admin toàn quyền — luôn ghim lên đầu danh sách người dùng.
    const users = (u.items || []).slice().sort((a, b) => (a.id === 'HAUNV' ? -1 : b.id === 'HAUNV' ? 1 : 0));
    return { users, cfg: c, ai, keys: keys.items || [], allowlist: keys.allowlist || [] };
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
    ${canManageAccounts() ? `<button data-tab="apikeys" class="${tab === 'apikeys' ? 'on' : ''}">Cổng API (${d.keys.filter(k => k.active).length})</button>` : ''}
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
    </table></div>` : ''}

  ${tab === 'apikeys' ? apiKeysTab(d) : ''}`;

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
        onSubmit: async (v) => {
          await patch('/users/' + u.id, v);
          // Đồng bộ ngay vào state trong bộ nhớ: chức danh mới là nhãn hiển thị (roleLabel) nên
          // sidebar/các bộ chọn phải đổi theo mà không cần tải lại trang — kể cả khi Admin đang
          // tự đổi chức danh của chính mình.
          applyUserRole(u.id, v);
          if (state.me && state.me.id === u.id) refreshShellRole(roleLabel(state.me));
          toast('Đã cập nhật vai trò & chức danh', 'ok');
          render(el);
        },
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
    const ak = el.querySelector('[data-addkey]');
    if (ak) ak.onclick = () => newKeyModal(d, () => render(el));
    el.querySelectorAll('[data-revokekey]').forEach(b => b.onclick = () => confirmDialog(
      'Thu hồi khoá API',
      `Khoá "${b.dataset.name}" sẽ ngừng hoạt động ngay. App đang dùng khoá này sẽ nhận lỗi 401 cho tới khi được cấp khoá mới.`,
      async () => { await del('/api-keys/' + b.dataset.revokekey); toast('Đã thu hồi khoá', 'ok'); render(el); },
    ));
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

/**
 * Cổng API — nơi cấp và thu hồi khoá cho các app ngoài (app làm báo giá, app sản xuất, bảng tính
 * của BGĐ). Khoá chạy DƯỚI DANH NGHĨA một tài khoản nhân sự, nên chỉ Admin có quyền quản lý tài
 * khoản mới thấy tab này — cùng mức quyền với việc tạo/sửa tài khoản.
 */
function apiKeysTab(d) {
  const active = d.keys.filter(k => k.active);
  return `<div class="note mb">App ngoài gọi tới <code>${esc(location.origin)}/api/v1/…</code> kèm header
    <code>Authorization: Bearer &lt;khoá&gt;</code>. Khoá chỉ chạm được đúng các đường dẫn trong danh sách bên dưới —
    không đọc được người dùng, KPI, hoa hồng hay báo cáo nhân sự.</div>

  <button class="btn block mb" data-addkey>+ Cấp khoá cho app mới</button>

  <div class="card">
    ${d.keys.length ? d.keys.map(k => `<div class="item">
      <div class="dot-i">${icon('plug')}</div>
      <div class="grow"><div class="t">${esc(k.name)} ${chip(k.active ? 'Đang hoạt động' : 'Đã thu hồi', k.active ? 'green' : 'red')}</div>
        <div class="d"><code>${esc(k.prefix)}…</code> · chạy dưới danh nghĩa ${esc(k.acts_as_name || k.acts_as)}</div>
        <div class="d xs">${k.call_count} lượt gọi${k.last_used_at ? ' · gần nhất ' + fmtDT(k.last_used_at) : ' · chưa dùng lần nào'}${k.last_path ? ' · ' + esc(k.last_path) : ''}</div></div>
      ${k.active ? `<button class="btn sm" data-revokekey="${esc(k.id)}" data-name="${esc(k.name)}">Thu hồi</button>` : ''}
    </div>`).join('') : '<div class="sm mut">Chưa cấp khoá nào.</div>'}
  </div>

  <div class="sec-title">Đường dẫn khoá API được phép gọi</div>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th style="width:74px">Method</th><th>Đường dẫn</th></tr></thead>
      <tbody>${d.allowlist.map(e => `<tr>
        <td>${chip(e.method, e.method === 'GET' ? 'blue' : 'amber')}</td>
        <td><code>${esc(e.path)}</code></td></tr>`).join('')}</tbody>
    </table>
  </div>
  <div class="xs mut mt">Muốn mở thêm đường dẫn: sửa ALLOWLIST trong <code>server/routes/gateway.js</code> —
    thêm route mới cho app không tự động mở ra ngoài Internet.</div>`;
}

/** Cấp khoá mới. Khoá gốc chỉ hiện ĐÚNG MỘT LẦN ở màn này — server chỉ lưu bản băm. */
function newKeyModal(d, after) {
  modal({
    title: 'Cấp khoá API',
    html: '<div class="sm mut mb">Khoá sẽ hiện đúng một lần sau khi tạo. Sao chép và dán vào app ngay — không xem lại được.</div>',
    fields: [
      { name: 'name', label: 'Tên app', required: true, placeholder: 'VD: App Báo giá NetViet' },
      {
        name: 'actsAs', label: 'Chạy dưới danh nghĩa', type: 'select', value: state.me.id,
        options: d.users.filter(u => u.active).map(u => ({ v: u.id, n: u.name + ' — ' + roleLabel(u) })),
        hint: 'Khoá nhìn thấy đúng phạm vi dữ liệu của người này.',
      },
    ],
    submitText: 'Tạo khoá',
    onSubmit: async (v) => {
      const r = await post('/api-keys', v);
      const { root } = modal({
        title: 'Khoá API mới',
        html: `<div class="note red mb">Sao chép ngay — khoá này không hiển thị lại lần nào nữa.</div>
          <label class="f"><span>KHOÁ</span><input data-key type="text" readonly value="${esc(r.key)}"></label>
          <button type="button" class="btn block mt" data-copy-key>${icon('copy', 14)} Copy khoá</button>`,
        submitText: 'Tôi đã lưu khoá',
        onSubmit: () => { after(); },
      });
      root.querySelector('[data-copy-key]').onclick = async () => {
        try { await navigator.clipboard.writeText(r.key); toast('Đã sao chép', 'ok'); }
        catch (e) { toast('Không sao chép được — hãy bôi đen và copy tay', 'err'); }
      };
    },
  });
}
