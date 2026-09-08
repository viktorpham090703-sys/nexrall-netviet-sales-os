import { state, login } from '../state.js';
import { toast } from '../ui.js';
import { icon } from '../icons.js';
import { BRAND_LOGO } from '../const.js';

export async function render(el) {
  const isDemo = state.mode === 'demo';
  // Production vừa deploy, chưa cấu hình BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD →
  // chưa có tài khoản nào để đăng nhập. Báo rõ thay vì để người dùng đoán mật khẩu vô ích.
  const notInitialized = !isDemo && !state.initialized;

  el.innerHTML = `<div class="login-wrap">
    <div class="login-card">
      <img class="login-brand" src="${BRAND_LOGO}" alt="NetViet Sales OS">
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
      `}
    </div>
  </div>`;

  if (notInitialized) return;

  const form = el.querySelector('[data-login-form]');
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
}
