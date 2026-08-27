import { get, patch, post } from '../api.js';
import { state, logout } from '../state.js';
import { esc, initials, mount, modal, toast } from '../ui.js';
import { roleLabel } from '../const.js';
import { icon } from '../icons.js';

const fmtDateStr = (s) => {
  if (!s) return '—';
  const [y, m, d] = String(s).split('-').map(Number);
  return y && m && d ? `${d}/${m}/${y}` : '—';
};

export async function render(el) {
  const load = () => get('/account/profile');
  const draw = (d) => {
    const p = d.profile;
    return `
      <div class="page-head">
        <div class="grow"><h2>${icon('user', 19, { style: 'margin-right:6px' })}Hồ sơ nhân sự</h2>
        <p>Thông tin cá nhân của bạn — dùng cho hồ sơ nội bộ phòng kinh doanh.</p></div>
      </div>

      <div class="card">
        <div class="row" style="gap:14px;align-items:flex-start">
          <div class="avatar" style="width:56px;height:56px;font-size:19px">${esc(initials(p.name))}</div>
          <div class="grow">
            <div class="row wrap" style="gap:6px">
              <span class="chip blue">${esc(p.id)}</span>
              <span class="chip">${esc(roleLabel(p))}</span>
            </div>
            <div class="b" style="font-size:19px;margin-top:6px">${esc(p.name)}</div>
            <div class="sm mut mt">${p.title ? esc(p.title) : '—'}</div>
          </div>
          <div class="right">
            <div class="row" style="gap:6px;justify-content:flex-end">
              <button class="icon-btn" data-edit title="Chỉnh sửa hồ sơ" style="width:28px;height:28px">${icon('pencil', 14)}</button>
            </div>
            <div class="xs mut">Chỉnh sửa hồ sơ nhân sự</div>
          </div>
        </div>
      </div>

      <div class="sec-title">Thông tin cá nhân</div>
      <div class="card">
        <div class="grid g3">
          ${info('Mã nhân viên', esc(p.id))}
          ${info('Họ và tên', esc(p.name))}
          ${info('Email', esc(p.email || '—'))}
          ${info('Số điện thoại', esc(p.phone || '—'))}
          ${info('Ngày sinh', fmtDateStr(p.birth_date))}
          ${info('Số CCCD', esc(p.id_number || '—'))}
          ${info('Hạn CCCD', fmtDateStr(p.id_expiry))}
          ${info('Địa chỉ liên hệ', esc(p.address || '—'))}
          ${info('Trường học', esc(p.school || '—'))}
        </div>
        <div class="mt">${info('Liên hệ khẩn cấp', esc(p.emergency_contact || '—'))}</div>
      </div>

      <div class="sec-title">Bảo mật tài khoản</div>
      <div class="card">
        <div class="item">
          <div class="dot-i">${icon('lock')}</div>
          <div class="grow"><div class="t">Đổi mật khẩu</div><div class="d">Cập nhật mật khẩu đăng nhập của bạn</div></div>
          <button class="btn sm" data-change-pw>Đổi mật khẩu</button>
        </div>
        <div class="item">
          <div class="dot-i">${icon('logOut')}</div>
          <div class="grow"><div class="t">Đăng xuất</div><div class="d">Thoát khỏi phiên đăng nhập hiện tại</div></div>
          <button class="btn sm" data-logout>Đăng xuất</button>
        </div>
      </div>`;
  };

  const bind = (d) => {
    el.querySelector('[data-edit]').onclick = () => editProfile(d.profile, () => render(el));
    el.querySelector('[data-change-pw]').onclick = changePasswordModal;
    el.querySelector('[data-logout]').onclick = async () => {
      await logout();
      location.hash = '#/login';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
  };
  await mount(el, load, draw, bind);
}

const info = (label, value) => `<div><div class="xs mut">${esc(label)}</div><div class="b" style="margin-top:2px">${value}</div></div>`;

function changePasswordModal() {
  modal({
    title: 'Đổi mật khẩu',
    titleIcon: 'lock',
    fields: [
      { name: 'password', label: 'Mật khẩu mới', type: 'password', required: true, placeholder: '••••••••' },
      { name: 'password2', label: 'Xác nhận mật khẩu', type: 'password', required: true, placeholder: '••••••••' },
    ],
    submitText: 'Đổi mật khẩu',
    onSubmit: async (v) => {
      if (v.password !== v.password2) { toast('Mật khẩu xác nhận không khớp', 'err'); return false; }
      await post('/account/password', { password: v.password });
      toast('Đã đổi mật khẩu.', 'ok');
    },
  });
}

function editProfile(p, after) {
  modal({
    title: 'Chỉnh sửa hồ sơ nhân sự',
    titleIcon: 'user',
    fields: [
      { name: 'name', label: 'Họ và tên', required: true, value: p.name },
      { name: 'email', label: 'Email', type: 'email', required: true, value: p.email || '' },
      { name: 'phone', label: 'Số điện thoại', value: p.phone || '' },
      { name: 'birth_date', label: 'Ngày sinh', type: 'date', value: p.birth_date || '' },
      { name: 'id_number', label: 'Số CCCD', value: p.id_number || '' },
      { name: 'id_expiry', label: 'Hạn CCCD', type: 'date', value: p.id_expiry || '' },
      { name: 'address', label: 'Địa chỉ liên hệ', value: p.address || '' },
      { name: 'school', label: 'Trường học', value: p.school || '' },
      { name: 'emergency_contact', label: 'Liên hệ khẩn cấp', placeholder: 'VD: Nguyễn Văn A - 0901xxxxxx', value: p.emergency_contact || '' },
    ],
    submitText: 'Lưu thay đổi',
    onSubmit: async (v) => {
      await patch('/account/profile', v);
      if (v.name) state.me.name = v.name;
      if (v.email) state.me.email = v.email;
      toast('Đã cập nhật hồ sơ.', 'ok');
      if (after) after();
    },
  });
}
