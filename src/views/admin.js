import { get, post, patch, del } from '../api.js';
import { state, isAdmin, canManageAccounts, salesUsers, applyUserRole } from '../state.js';
import { esc, mount, chip, toast, modal, stat, bindTabs, confirmDialog, fmtDT, refreshShellRole } from '../ui.js';
import { roleLabel, LEADERSHIP_IDS } from '../const.js';
import { providers, testProvider, getProvider, setProvider, providerIconName } from '../aiPref.js';
import { icon } from '../icons.js';
import { t as tr, tf, personName } from '../i18n.js';
import { recordSection } from './profile.js';

let tab = 'users';

/** "Chức vụ & kinh nghiệm" — nhân sự tự khai ở trang Hồ sơ; Quản trị chỉ xem. */
const EXP_FIELDS = [['sales_experience', 'Kinh nghiệm sale'], ['past_positions', 'Chức vụ đã đảm nhiệm']];
const ROLE_OPTIONS = [{ v: 'sales', n: 'Sales' }, { v: 'manager', n: 'Trưởng phòng' }, { v: 'admin', n: 'Admin/BGĐ' }, { v: 'hr', n: 'Hành chính nhân sự' }];

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
    // Ban TGĐ (HUONGNT, HAUNV — ngang cấp) luôn ghim lên đầu danh sách người dùng.
    const rank = (x) => { const i = LEADERSHIP_IDS.indexOf(x.id); return i < 0 ? LEADERSHIP_IDS.length : i; };
    const users = (u.items || []).slice().sort((a, b) => rank(a) - rank(b));
    return {
      users, staff: users.filter(x => !x.deleted_at), left: users.filter(x => x.deleted_at),
      cfg: c, ai, keys: keys.items || [], allowlist: keys.allowlist || [],
    };
  };

  const draw = (d) => `<div class="page-head">
    <div class="grow"><h2>${tr('Quản trị & Phân quyền')}</h2><p>${tr('Người dùng · ngưỡng KPI linh hoạt · SLA · chống chụp màn')}</p></div>
  </div>

  <div class="grid g3 mb">
    ${stat('Người dùng', d.staff.length, d.staff.filter(u => u.role === 'sales').length + ' sales', 'blue')}
    ${stat('Cấu hình', d.cfg.rows.length, tr('Global + theo từng sales'), 'amber')}
  </div>

  <div class="seg mb">
    <button data-tab="users" class="${tab === 'users' ? 'on' : ''}">${tr('Người dùng')}</button>
    <button data-tab="config" class="${tab === 'config' ? 'on' : ''}">${tr('Ngưỡng & SLA')}</button>
    <button data-tab="ai" class="${tab === 'ai' ? 'on' : ''}">${tr('Kết nối AI')}</button>
    ${canManageAccounts() ? `<button data-tab="apikeys" class="${tab === 'apikeys' ? 'on' : ''}">${tr('Cổng API')} (${d.keys.filter(k => k.active).length})</button>` : ''}
  </div>

  ${tab === 'ai' ? `<div class="card">${(d.ai.providers || []).map(p => `<div class="item">
      <div class="dot-i">${icon(providerIconName(p.key))}</div>
      <div class="grow"><div class="t">${esc(p.label)} ${getProvider() === p.key ? chip('Đang chọn', 'blue') : ''}</div>
        <div class="d">${esc(p.model)}${p.secret ? ' · secret <code>' + esc(p.secret) + '</code>' : ''}</div>
        <div class="d xs">${esc(p.help || '')}</div></div>
      <div class="right">${chip(p.configured ? 'Đã có API key' : 'Chưa có key', p.configured ? 'green' : 'red')}
        <div class="mt"><button class="btn sm" data-aitest="${esc(p.key)}">${tr('Test kết nối')}</button></div>
        <div class="mt"><button class="btn sm ${getProvider() === p.key ? 'primary' : ''}" data-aiuse="${esc(p.key)}">${tr('Dùng')}</button></div>
      </div></div>`).join('')}</div>
    <div class="card mt"><div class="b sm mb">${icon('plug', 14)} ${tr('Cách bật AI thật')}</div>
      <div class="sm mut">${tr('Vào mục')} <b>Secrets</b> ${tr('của app và nhập')} <code>GEMINI_API_KEY</code> (aistudio.google.com/apikey) ${tr('hoặc')} <code>ANTHROPIC_API_KEY</code> (console.anthropic.com).
      ${tr('Chỉ cần nhập key là toàn bộ tính năng AI (Trợ lý, soạn email, proposal, research thầu) chuyển sang dùng AI thật — không phải sửa code.')}
      ${tr('Muốn cố định model, thêm')} <code>GEMINI_MODEL</code> / <code>CLAUDE_MODEL</code>. ${tr('Nếu gọi API lỗi, app tự dùng nội dung mẫu và báo lý do.')}</div>
      <div data-aiout class="mt"></div></div>` : ''}

  ${tab === 'users' ? `${canManageAccounts() ? `<button class="btn block mb" data-adduser>+ ${tr('Thêm người dùng')}</button>` : ''}
    ${isAdmin() && !canManageAccounts() ? `<div class="card mb"><div class="sm mut">${icon('lock', 14)} ${tr('Tài khoản Admin của bạn chỉ xem, không được thêm/khoá tài khoản hay đổi mật khẩu nhân sự khác.')}</div></div>` : ''}
    <div class="card">${d.staff.map(u => {
      const self = state.me && state.me.id === u.id;
      return `<div class="item">
      <div class="dot-i">${icon(u.role === 'admin' ? 'shieldCheck' : u.role === 'manager' ? 'award' : 'user')}</div>
      <div class="grow"><div class="t">${esc(personName(u.name))} <span class="xs mut">· ${esc(u.id)}</span></div>
        <div class="d">${esc(roleLabel(u))} · ${esc(u.email || '')}</div>
        ${!u.active && u.status_reason ? `<div class="d xs" style="color:var(--danger)">${icon('lock', 12)} ${tr('Lý do tạm dừng')}: ${esc(u.status_reason)}${u.status_changed_at ? ' · ' + fmtDT(u.status_changed_at) : ''}</div>` : ''}</div>
      <div class="right">${chip(u.active ? 'Hoạt động' : 'Tạm dừng', u.active ? 'green' : 'amber')}
        ${canManageAccounts() ? `<div class="mt row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn sm" data-viewprofile="${esc(u.id)}">${tr('Hồ sơ')}</button>
          ${self ? '' : `<button class="btn sm" data-togglestatus="${esc(u.id)}" data-active="${u.active ? '1' : ''}" data-name="${esc(u.name)}">${u.active ? tr('Tạm dừng công việc') : tr('Cho làm việc lại')}</button>`}
          <button class="btn sm" data-resetlink="${esc(u.id)}" data-name="${esc(u.name)}">${tr('Tạo liên kết đặt lại mật khẩu')}</button>
          ${self ? '' : `<button class="btn sm danger-o" data-offboard="${esc(u.id)}">${icon('trash2', 13)} ${tr('Xoá (nghỉ việc)')}</button>`}
        </div>` : ''}</div>
    </div>`;
    }).join('')}</div>
    ${canManageAccounts() && d.left.length ? `<details class="card mt">
      <summary class="b sm" style="cursor:pointer">${tr('Đã nghỉ việc')} (${d.left.length})</summary>
      ${d.left.map(u => `<div class="item">
        <div class="dot-i">${icon('user')}</div>
        <div class="grow"><div class="t">${esc(personName(u.name))} <span class="xs mut">· ${esc(u.id)}</span></div>
          <div class="d">${esc(roleLabel(u))} · ${tr('Nghỉ từ')} ${fmtDT(u.deleted_at)}</div>
          ${u.status_reason ? `<div class="d xs">${tr('Lý do')}: ${esc(u.status_reason)}</div>` : ''}</div>
        <div class="right">${chip('Đã nghỉ việc', 'grey')}
          <div class="mt row" style="gap:6px;justify-content:flex-end">
            <button class="btn sm" data-viewprofile="${esc(u.id)}">${tr('Xem hồ sơ')}</button>
            <button class="btn sm" data-restore="${esc(u.id)}" data-name="${esc(u.name)}">${tr('Khôi phục')}</button>
          </div></div>
      </div>`).join('')}
    </details>` : ''}` : ''}

  ${tab === 'config' ? `<button class="btn block mb" data-addcfg>+ ${tr('Đặt ngưỡng (global hoặc theo sales)')}</button>
    <div class="card scroll-x"><table class="tbl">
      <tr><th>${tr('Khoá')}</th><th>${tr('Phạm vi')}</th><th>${tr('Giá trị')}</th><th></th></tr>
      ${d.cfg.rows.map(r => `<tr><td>${esc(tr(CFG_LABELS[r.ckey]) || r.ckey)}<div class="xs mut">${esc(r.ckey)}</div></td>
        <td>${r.user_id ? esc((state.users.find(u => u.id === r.user_id) || {}).name || r.user_id) : tr('Toàn hệ thống')}</td>
        <td>${esc(String(r.value).slice(0, 40))}</td>
        <td><button class="btn sm" data-editcfg="${esc(r.ckey)}" data-user="${esc(r.user_id || '')}" data-val="${esc(r.value)}">${tr('Sửa')}</button></td></tr>`).join('')}
    </table></div>` : ''}

  ${tab === 'apikeys' ? apiKeysTab(d) : ''}`;

  const bind = (d) => {
    bindTabs(el, t => tab = t, render);
    el.querySelectorAll('[data-aiuse]').forEach(b => b.onclick = () => {
      const p = (d.ai.providers || []).find(x => x.key === b.dataset.aiuse);
      if (!p.configured) { toast(tf(() => 'Chưa nhập ' + p.secret + ' trong Secrets của app', () => p.secret + ' is not set in the app Secrets'), 'err'); return; }
      setProvider(p.key);
      toast(tf(() => 'Đã chọn ' + p.label, () => 'Selected ' + p.label), 'ok');
      render(el);
    });
    el.querySelectorAll('[data-aitest]').forEach(b => b.onclick = async () => {
      const out = el.querySelector('[data-aiout]');
      b.disabled = true;
      out.innerHTML = `<div class="sm mut">${icon('loaderCircle', 14, { class: 'spin' })} ${tr('Đang gọi thử API…')}</div>`;
      try {
        const r = await testProvider(b.dataset.aitest);
        out.innerHTML = `<div class="sm" style="color:#16A34A">${icon('circleCheck', 14)} ${tr('Kết nối OK')} · model <b>${esc(r.model)}</b><div class="xs mut mt">${esc(r.text || '')}</div></div>`;
      } catch (e) {
        out.innerHTML = `<div class="sm" style="color:#F59E0B">${icon('triangleAlert', 14)} ${esc(e.message)}</div>`;
      } finally { b.disabled = false; }
    });
    const au = el.querySelector('[data-adduser]');
    if (au) au.onclick = () => modal({
      title: 'Thêm người dùng',
      fields: [{ name: 'name', label: 'Họ tên', required: true },
      { name: 'code', label: 'Mã nhân viên', required: true, placeholder: 'VD: THUYDT', hint: 'Dùng để đăng nhập thay cho email. Chỉ gồm chữ không dấu, số, dấu . _ -' },
      { name: 'email', label: 'Email' },
      { name: 'role', label: 'Vai trò', type: 'select', options: ROLE_OPTIONS },
      { name: 'title', label: 'Chức danh' },
      { name: 'password', label: 'Mật khẩu đăng nhập', type: 'password', hint: 'Nếu nhập, nhân sự sẽ phải đổi sang mật khẩu mới ở lần đăng nhập đầu tiên. Bỏ trống để tạo liên kết thiết lập mật khẩu — nhân sự tự đặt mật khẩu, bạn sẽ không biết mật khẩu của họ (khuyến nghị).' }],
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
      const u = d.users.find(x => x.id === b.dataset.viewprofile);
      const editable = !u.deleted_at;
      try {
        const [{ profile: pr }, rec] = await Promise.all([get('/users/' + u.id + '/profile'), get('/users/' + u.id + '/record').catch(() => null)]);
        modal({
          title: tf(() => 'Hồ sơ nhân sự — ' + pr.name, () => 'Profile — ' + personName(pr.name)),
          titleIcon: 'user',
          wide: true,
          html: `<div class="hr-profile"><div class="grid g4">
            ${profileRow(tr('Mã nhân viên'), esc(pr.id))}
            ${profileRow(tr('Họ và tên'), esc(pr.name))}
            ${profileRow('Email', esc(pr.email || '—'))}
            ${profileRow(tr('Số điện thoại'), esc(pr.phone || '—'))}
            ${profileRow(tr('Giới tính'), tr({ nam: 'Nam', nu: 'Nữ', khac: 'Khác' }[pr.gender] || '—'))}
            ${profileRow(tr('Ngày sinh'), fmtDateStr(pr.birth_date))}
            ${profileRow(tr('Số CCCD'), esc(pr.id_number || '—'))}
            ${profileRow(tr('Ngày cấp'), fmtDateStr(pr.id_issue_date))}
            ${profileRow(tr('Nơi cấp'), esc(pr.id_issue_place || '—'))}
            ${profileRow(tr('Hạn CCCD'), fmtDateStr(pr.id_expiry))}
            ${profileRow(tr('Địa chỉ liên hệ'), esc(pr.address || '—'))}
            ${profileRow(tr('Trình độ học vấn'), esc(pr.education_level ? tr(pr.education_level) : '—'))}
            ${profileRow(tr('Trường học'), esc(pr.school || '—'))}
          </div>
          <div class="mt">${profileRow(tr('Liên hệ khẩn cấp'), esc(pr.emergency_contact || '—'))}</div>
          <div class="sm mut mt">${icon('lock', 13)} ${tr('Hồ sơ do chính nhân sự tự khai và tự sửa — Admin chỉ xem, không sửa được ở đây.')}</div>
          ${editable ? `<div class="b sm mt" style="border-top:1px solid var(--line);padding-top:12px">${icon('award', 14)} ${tr('Vai trò & chức danh')}</div>
          <div class="grid g2 mt">
            <label class="f"><span>${tr('Vai trò')}</span><select name="role">${ROLE_OPTIONS.map(o =>
              `<option value="${o.v}" ${o.v === u.role ? 'selected' : ''}>${esc(tr(o.n))}</option>`).join('')}</select></label>
            <label class="f"><span>${tr('Chức danh / Chức vụ')}</span><input name="title" value="${esc(u.title || '')}"></label>
          </div>
          ` : `<div class="sm mt">${tr('Vai trò')}: <b>${esc(roleLabel(u))}</b></div>`}
          <div class="b sm mt" style="border-top:1px solid var(--line);padding-top:12px">${icon('briefcase', 14)} ${tr('Chức vụ & kinh nghiệm')}
            <span class="xs mut" style="font-weight:400">— ${tr('nhân sự tự khai')}</span></div>
          <div class="grid g2 mt">${EXP_FIELDS.map(([k, label]) => profileRow(tr(label), `<span style="white-space:pre-wrap">${esc(pr[k] || '—')}</span>`)).join('')}</div>
          ${rec ? `<div class="b sm mt" style="border-top:1px solid var(--line);padding-top:12px">${icon('medal', 14)} ${tr('Thành tích & Vi phạm')}
            <span class="xs mut" style="font-weight:400">— ${tr('tự động từ dữ liệu Sales OS')}</span></div>
          <div class="mt">${recordSection(rec, { compact: true })}</div>` : ''}</div>`,
          submitText: editable ? 'Lưu' : 'Đóng',
          onSubmit: async (v) => {
            if (!editable || (v.role === u.role && v.title.trim() === (u.title || ''))) return;
            await patch('/users/' + u.id, { role: v.role, title: v.title });
            // Đồng bộ ngay vào state trong bộ nhớ: chức danh mới là nhãn hiển thị (roleLabel) nên
            // sidebar/các bộ chọn phải đổi theo mà không cần tải lại trang — kể cả khi Admin đang
            // tự đổi chức danh của chính mình.
            applyUserRole(u.id, v);
            if (state.me && state.me.id === u.id) refreshShellRole(roleLabel(state.me));
            toast('Đã cập nhật vai trò & chức danh', 'ok');
            render(el);
          },
        });
      } catch (e) { toast(e.message, 'err'); }
    });
    el.querySelectorAll('[data-togglestatus]').forEach(b => b.onclick = () => {
      const id = b.dataset.togglestatus;
      if (!b.dataset.active) {
        confirmDialog(
          'Cho làm việc lại',
          tf(() => `${b.dataset.name} sẽ đăng nhập và làm việc lại bình thường. Tiếp tục?`,
            () => `${personName(b.dataset.name)} will be able to sign in and work again. Continue?`),
          async () => {
            await patch('/users/' + id, { active: true });
            toast('Đã cho nhân sự làm việc lại', 'ok');
            render(el);
          },
        );
        return;
      }
      modal({
        title: tf(() => 'Tạm dừng công việc — ' + b.dataset.name, () => 'Suspend — ' + personName(b.dataset.name)),
        html: `<div class="note mb">${tr('Nhân sự bị đăng xuất ngay và không đăng nhập được cho tới khi được cho làm việc lại. Khách hàng, deal và công việc vẫn giữ nguyên tên người này.')}</div>`,
        fields: [{ name: 'reason', label: 'Lý do tạm dừng', type: 'textarea', required: true, rows: 3, placeholder: 'VD: Không đạt KPI 2 tháng liên tiếp, đang xem xét' }],
        submitText: 'Tạm dừng',
        onSubmit: async (v) => {
          if (!v.reason.trim()) { toast('Vui lòng nhập lý do tạm dừng', 'err'); return false; }
          await patch('/users/' + id, { active: false, reason: v.reason });
          toast('Đã tạm dừng công việc của nhân sự', 'ok');
          render(el);
        },
      });
    });
    el.querySelectorAll('[data-offboard]').forEach(b => b.onclick = async () => {
      const u = d.users.find(x => x.id === b.dataset.offboard);
      let counts;
      try { ({ counts } = await get('/users/' + u.id + '/holdings')); } catch (e) { toast(e.message, 'err'); return; }
      const labels = { customers: 'khách hàng', leads: 'lead', deals: 'deal đang mở', tasks: 'công việc chưa xong', partners: 'partner', tenders: 'gói thầu' };
      const held = Object.entries(counts).filter(([, n]) => n > 0);
      const heirs = d.staff.filter(x => x.active && x.id !== u.id);
      modal({
        title: tf(() => 'Xoá nhân sự nghỉ việc — ' + u.name, () => 'Remove departed staff — ' + personName(u.name)),
        html: `<div class="note red mb">${tr('Tài khoản bị đăng xuất, thu hồi khoá API và ẩn khỏi danh sách. Deal đã chốt, hoa hồng, hợp đồng và nhật ký vẫn giữ tên người này để không sai lịch sử. Có thể khôi phục ở mục "Đã nghỉ việc".')}</div>
          ${held.length ? `<div class="sm mb"><b>${tr('Đang giữ')}:</b> ${held.map(([k, n]) => `${n} ${tr(labels[k])}`).join(' · ')}</div>` : `<div class="sm mut mb">${tr('Không còn khách hàng, deal hay công việc nào cần bàn giao.')}</div>`}`,
        fields: [
          { name: 'reason', label: 'Lý do nghỉ việc', type: 'textarea', required: true, rows: 2, placeholder: 'VD: Nghỉ việc theo nguyện vọng từ 30/09/2026' },
          ...(held.length ? [{ name: 'transferTo', label: 'Bàn giao cho', type: 'select', required: true,
            options: [{ v: '', n: '— Chọn người nhận bàn giao —' }, ...heirs.map(x => ({ v: x.id, n: personName(x.name) + ' — ' + roleLabel(x) }))] }] : []),
        ],
        submitText: 'Xoá nhân sự',
        onSubmit: async (v) => {
          if (!v.reason.trim()) { toast('Vui lòng nhập lý do nghỉ việc', 'err'); return false; }
          if (held.length && !v.transferTo) { toast('Vui lòng chọn người nhận bàn giao', 'err'); return false; }
          await post('/users/' + u.id + '/offboard', v);
          toast('Đã xoá nhân sự khỏi danh sách', 'ok');
          render(el);
        },
      });
    });
    el.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => confirmDialog(
      'Khôi phục nhân sự',
      tf(() => `${b.dataset.name} sẽ quay lại danh sách ở trạng thái Tạm dừng. Bấm "Cho làm việc lại" khi muốn mở đăng nhập. Những gì đã bàn giao không tự chuyển ngược lại.`,
        () => `${personName(b.dataset.name)} returns to the list as Suspended. Use "Resume work" to allow sign-in. Handed-over items are not moved back.`),
      async () => { await post('/users/' + b.dataset.restore + '/restore', {}); toast('Đã khôi phục nhân sự', 'ok'); render(el); },
    ));
    el.querySelectorAll('[data-resetlink]').forEach(b => b.onclick = () => createSetupLink(b.dataset.resetlink, 'reset', b.dataset.name));
    const ak = el.querySelector('[data-addkey]');
    if (ak) ak.onclick = () => newKeyModal(d, () => render(el));
    el.querySelectorAll('[data-revokekey]').forEach(b => b.onclick = () => confirmDialog(
      'Thu hồi khoá API',
      tf(() => `Khoá "${b.dataset.name}" sẽ ngừng hoạt động ngay. App đang dùng khoá này sẽ nhận lỗi 401 cho tới khi được cấp khoá mới.`,
        () => `The key "${b.dataset.name}" will stop working immediately. Apps using it will get 401 errors until a new key is issued.`),
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
      html: `<p class="sm mut">${tr('Gửi liên kết dưới đây cho')} <b>${esc(personName(name || ''))}</b> ${tr('qua Zalo/Slack. Liên kết chỉ dùng được 1 lần và hết hạn sau 48 giờ.')}</p>
        <label class="f"><span>${tr('LIÊN KẾT')}</span><input data-setup-link type="text" readonly value="${esc(link)}"></label>
        <button type="button" class="btn block mt" data-copy-link>${icon('copy', 14)} ${tr('Copy link')}</button>`,
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
const profileRow = (label, value) => `<div class="hr-row"><div class="l">${esc(label)}</div><div class="v">${value}</div></div>`;

function cfgModal(key, userId, value, after) {
  modal({
    title: 'Cấu hình ngưỡng',
    fields: [
      { name: 'key', label: 'Khoá cấu hình', type: 'select', value: key, options: Object.keys(CFG_LABELS).map(k => ({ v: k, n: CFG_LABELS[k] })) },
      { name: 'userId', label: 'Áp dụng cho', type: 'select', value: userId, options: [{ v: '', n: 'Toàn hệ thống' }, ...salesUsers().map(u => ({ v: u.id, n: personName(u.name) }))] },
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
  return `<div class="note mb">${tr('App ngoài gọi tới')} <code>${esc(location.origin)}/api/v1/…</code> ${tr('kèm header')}
    <code>Authorization: Bearer &lt;${tf(() => 'khoá', () => 'key')}&gt;</code>. ${tr('Khoá chỉ chạm được đúng các đường dẫn trong danh sách bên dưới — không đọc được người dùng, KPI, hoa hồng hay báo cáo nhân sự.')}</div>

  <button class="btn block mb" data-addkey>+ ${tr('Cấp khoá cho app mới')}</button>

  <div class="card">
    ${d.keys.length ? d.keys.map(k => `<div class="item">
      <div class="dot-i">${icon('plug')}</div>
      <div class="grow"><div class="t">${esc(k.name)} ${chip(k.active ? 'Đang hoạt động' : 'Đã thu hồi', k.active ? 'green' : 'red')}</div>
        <div class="d"><code>${esc(k.prefix)}…</code> · ${tr('chạy dưới danh nghĩa')} ${esc(k.acts_as_name || k.acts_as)}</div>
        <div class="d xs">${k.call_count} ${tr('lượt gọi')}${k.last_used_at ? ' · ' + tr('gần nhất') + ' ' + fmtDT(k.last_used_at) : ' · ' + tr('chưa dùng lần nào')}${k.last_path ? ' · ' + esc(k.last_path) : ''}</div></div>
      ${k.active ? `<button class="btn sm" data-revokekey="${esc(k.id)}" data-name="${esc(k.name)}">${tr('Thu hồi')}</button>` : ''}
    </div>`).join('') : `<div class="sm mut">${tr('Chưa cấp khoá nào.')}</div>`}
  </div>

  <div class="sec-title">${tr('Đường dẫn khoá API được phép gọi')}</div>
  <div class="tbl-wrap">
    <table>
      <thead><tr><th style="width:74px">Method</th><th>${tr('Đường dẫn')}</th></tr></thead>
      <tbody>${d.allowlist.map(e => `<tr>
        <td>${chip(e.method, e.method === 'GET' ? 'blue' : 'amber')}</td>
        <td><code>${esc(e.path)}</code></td></tr>`).join('')}</tbody>
    </table>
  </div>
  <div class="xs mut mt">${tr('Muốn mở thêm đường dẫn: sửa ALLOWLIST trong')} <code>server/routes/gateway.js</code> —
    ${tr('thêm route mới cho app không tự động mở ra ngoài Internet.')}</div>`;
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
        options: d.users.filter(u => u.active).map(u => ({ v: u.id, n: personName(u.name) + ' — ' + roleLabel(u) })),
        hint: 'Khoá nhìn thấy đúng phạm vi dữ liệu của người này.',
      },
    ],
    submitText: 'Tạo khoá',
    onSubmit: async (v) => {
      const r = await post('/api-keys', v);
      const { root } = modal({
        title: 'Khoá API mới',
        html: `<div class="note red mb">${tr('Sao chép ngay — khoá này không hiển thị lại lần nào nữa.')}</div>
          <label class="f"><span>${tr('KHOÁ')}</span><input data-key type="text" readonly value="${esc(r.key)}"></label>
          <button type="button" class="btn block mt" data-copy-key>${icon('copy', 14)} ${tr('Copy khoá')}</button>`,
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
