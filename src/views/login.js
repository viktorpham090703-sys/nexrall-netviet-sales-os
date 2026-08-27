import { state, login } from '../state.js';
import { esc, initials, toast } from '../ui.js';
import { ROLE_NAME } from '../const.js';
import { icon } from '../icons.js';

export async function render(el) {
  const isDemo = state.mode === 'demo';
  // Production vừa deploy, chưa cấu hình BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD →
  // chưa có tài khoản nào để đăng nhập. Báo rõ thay vì để người dùng đoán mật khẩu vô ích.
  const notInitialized = !isDemo && !state.initialized;

  el.innerHTML = `<div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">NV</div>
      <h1>NetViet <span class="accent">Sales OS</span></h1>
      <p class="login-sub">Quản trị kinh doanh — TVC/Video AI · Booking Gameshow · Xây kênh triệu view</p>

      ${notInitialized ? `
        <div class="err-box mt">${icon('triangleAlert', 15)} Hệ thống chưa được khởi tạo, liên hệ quản trị viên.</div>
      ` : `
        <form data-login-form class="mt">
          <label class="f"><span>EMAIL / MÃ NHÂN VIÊN</span>
            <input name="identifier" type="text" placeholder="ten@congty.vn" autocomplete="username" required autofocus>
          </label>
          <label class="f"><span>MẬT KHẨU</span>
            <div class="pw-wrap">
              <input name="password" type="password" placeholder="••••••••" autocomplete="current-password" required>
              <button type="button" class="pw-toggle" data-toggle-pw aria-label="Hiện mật khẩu">${icon('eye', 16)}</button>
            </div>
          </label>
          <button type="submit" class="btn primary block login-submit mt">Đăng nhập</button>
        </form>
        <p class="xs mut mt" style="text-align:center">Quên mật khẩu? Liên hệ Admin/Trưởng phòng để được cấp liên kết đặt lại mật khẩu.</p>

        ${isDemo ? `
          <div class="sec-title mt">Tài khoản demo${state.demoHint ? ` · mật khẩu chung "${esc(state.demoHint)}"` : ''}</div>
          <div data-demo-accts></div>
          <p class="xs mut login-hint">Dùng thử đủ 3 vai trò: Admin/BGĐ, Trưởng phòng KD, Nhân viên KD. Tài khoản nhân sự chính thức sẽ do Admin cấp riêng tại mục Quản trị khi có danh sách nhân sự.</p>
        ` : ''}
      `}
    </div>
  </div>`;

  if (notInitialized) return;

  const form = el.querySelector('[data-login-form]');
  const idInput = form.querySelector('input[name=identifier]');
  const pwInput = form.querySelector('input[name=password]');
  const toggle = form.querySelector('[data-toggle-pw]');
  const submitBtn = form.querySelector('.login-submit');

  toggle.onclick = () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    toggle.innerHTML = show ? icon('eyeOff', 16) : icon('eye', 16);
    toggle.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const identifier = form.identifier.value.trim();
    const password = form.password.value;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang đăng nhập…';
    try {
      await login(identifier, password);
      location.hash = '#/cockpit';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Đăng nhập';
    }
  };

  if (!isDemo) return;

  const demoWrap = el.querySelector('[data-demo-accts]');
  demoWrap.innerHTML = state.users.map(u => `<button type="button" class="acct sm" data-id="${esc(u.id)}">
      <div class="avatar" style="background:${u.role === 'admin' ? 'linear-gradient(135deg,#2563EB,#3B82F6)' : u.role === 'manager' ? 'linear-gradient(135deg,#EF3B24,#F59E0B)' : u.role === 'hr' ? 'linear-gradient(135deg,#0D9488,#2DD4BF)' : 'linear-gradient(135deg,#6B7280,#9CA3AF)'}">${esc(initials(u.name))}</div>
      <div class="grow"><div class="b">${esc(u.name)}</div>
        <div class="sm mut">${esc(ROLE_NAME[u.role] || u.role)} · mã: ${esc(u.id)}</div></div>
      <span class="chip ${u.role === 'sales' ? 'grey' : u.role === 'manager' ? 'amber' : u.role === 'hr' ? 'green' : 'blue'}">${esc(u.role)}</span>
    </button>`).join('');

  demoWrap.querySelectorAll('.acct').forEach(b => b.onclick = () => {
    idInput.value = b.dataset.id;
    if (state.demoHint) pwInput.value = state.demoHint;
    submitBtn.focus();
  });
}
