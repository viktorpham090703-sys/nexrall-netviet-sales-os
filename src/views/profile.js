import { get, patch, post, del } from '../api.js';
import { state, logout } from '../state.js';
import { esc, avatar, mount, modal, toast, confirmDialog, refreshShellAvatars } from '../ui.js';
import { roleDefaultLabel } from '../const.js';
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
          <div class="avatar-edit">
            ${avatar(p, 'data-pick title="Đổi ảnh đại diện" style="width:72px;height:72px;font-size:24px"')}
            <button type="button" class="avatar-cam" data-pick title="Đổi ảnh đại diện">${icon('camera', 14)}</button>
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-file>
          </div>
          <div class="grow">
            <div class="row wrap" style="gap:6px">
              <span class="chip blue">${esc(p.id)}</span>
              <span class="chip">${esc(roleDefaultLabel(p))}</span>
            </div>
            <div class="b" style="font-size:19px;margin-top:6px">${esc(p.name)}</div>
            <div class="sm mut mt">${p.title ? esc(p.title) : '—'}</div>
            <div class="row wrap mt" style="gap:6px">
              <button class="btn sm" data-pick>${icon('camera', 13)}${p.avatar ? 'Đổi ảnh đại diện' : 'Tải ảnh đại diện'}</button>
              ${p.avatar ? `<button class="btn sm" data-rm-avatar>${icon('trash2', 13)}Xoá ảnh</button>` : ''}
            </div>
            <div class="xs mut mt">Ảnh JPG, PNG hoặc WEBP — tối đa 8MB, hệ thống tự cắt vuông và thu nhỏ.</div>
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
    const file = el.querySelector('[data-file]');
    el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => file.click());
    file.onchange = async () => {
      const f = file.files && file.files[0];
      file.value = '';               // chọn lại đúng ảnh vừa huỷ vẫn phải kích hoạt được onchange
      if (!f) return;
      try {
        const dataUrl = await squareThumb(f);
        const r = await post('/account/avatar', { avatar: dataUrl });
        applyAvatar(r.avatar);
        toast('Đã cập nhật ảnh đại diện.', 'ok');
        render(el);
      } catch (e) { toast(e.message || 'Không xử lý được ảnh này.', 'err'); }
    };
    const rm = el.querySelector('[data-rm-avatar]');
    if (rm) rm.onclick = () => confirmDialog('Xoá ảnh đại diện', 'Hồ sơ sẽ quay lại hiển thị chữ viết tắt tên bạn.', async () => {
      await del('/account/avatar');
      applyAvatar(null);
      toast('Đã xoá ảnh đại diện.', 'ok');
      render(el);
    });
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

/** Ghi ảnh mới vào phiên hiện tại để sidebar/topbar đổi theo ngay, không phải tải lại trang. */
function applyAvatar(dataUrl) {
  if (state.me) state.me.avatar = dataUrl || null;
  refreshShellAvatars(state.me);
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;  // trần ảnh GỐC người dùng chọn, trước khi thu nhỏ
const THUMB_SIZE = 320;                    // đủ nét cho avatar 72px ở màn hình Retina

/**
 * Cắt vuông (giữa ảnh) + thu nhỏ về THUMB_SIZE rồi nén JPEG ngay tại trình duyệt. Làm ở client để
 * ảnh máy ảnh 5-10MB không phải đi qua đường truyền và không phải nằm trong CSDL nguyên kích thước.
 */
function squareThumb(f) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return reject(new Error('Chỉ nhận ảnh JPG, PNG hoặc WEBP.'));
    if (f.size > MAX_UPLOAD_BYTES) return reject(new Error('Ảnh vượt quá 8MB. Hãy chọn ảnh nhỏ hơn.'));
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const side = Math.min(img.width, img.height);
        const cv = document.createElement('canvas');
        cv.width = cv.height = THUMB_SIZE;
        const cx = cv.getContext('2d');
        cx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
        resolve(cv.toDataURL('image/jpeg', 0.85));
      } catch (e) { reject(new Error('Không xử lý được ảnh này.')); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Tệp không phải ảnh hợp lệ.')); };
    img.src = url;
  });
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
