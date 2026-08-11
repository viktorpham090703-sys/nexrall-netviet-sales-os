import { get, post } from '../api.js';
import { esc, toast } from '../ui.js';
import { state } from '../state.js';

/**
 * Đặt mật khẩu. Phục vụ 3 tình huống:
 *  - Liên kết dùng 1 lần (không cần đăng nhập): cấp tài khoản lần đầu (purpose=invite) hoặc
 *    quên mật khẩu (purpose=reset) — Admin tự gửi link qua Zalo/Slack (app chưa có hạ tầng email).
 *  - Buộc đổi mật khẩu ở lần đăng nhập đầu (đã có phiên, không có token): dành cho tài khoản
 *    admin được production tự khởi tạo từ secret BOOTSTRAP_ADMIN_* — mật khẩu ban đầu không nên
 *    dùng lâu dài.
 */
export async function render(el, { id } = {}) {
  const token = id || '';
  const forced = !token && !!(state.me && state.me.must_change_password);

  el.innerHTML = `<div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">NV</div>
      <h1>NetViet <span class="accent">Sales OS</span></h1>
      <div data-body class="mt"><p class="sm mut">Đang kiểm tra…</p></div>
    </div>
  </div>`;

  const body = el.querySelector('[data-body]');
  if (!token && !forced) { body.innerHTML = errorBlock('Liên kết không hợp lệ hoặc đã hết hạn.'); return; }

  if (forced) {
    body.innerHTML = `<p class="login-sub">Đây là lần đăng nhập đầu tiên. Vui lòng đặt mật khẩu mới cho <b>${esc(state.me.name)}</b> trước khi tiếp tục.</p>`
      + pwForm();
    bindForm(body, async (password) => {
      await post('/account/password', { password });
      state.me.must_change_password = 0;
      toast('Đã đặt mật khẩu mới.', 'ok');
      location.hash = '#/cockpit';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    return;
  }

  let info;
  try {
    info = await get('/setup-token/' + encodeURIComponent(token));
  } catch (e) {
    body.innerHTML = errorBlock(e.message);
    return;
  }

  const title = info.purpose === 'reset' ? 'Đặt lại mật khẩu' : 'Đặt mật khẩu';
  body.innerHTML = `<p class="login-sub">${esc(title)} cho <b>${esc(info.name)}</b></p>` + pwForm();
  bindForm(body, async (password) => {
    await post('/setup-token/' + encodeURIComponent(token), { password });
    toast('Đã đặt mật khẩu. Vui lòng đăng nhập lại.', 'ok');
    location.hash = '#/login';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

function pwForm() {
  return `<form data-setpw-form class="mt">
      <label class="f"><span>MẬT KHẨU MỚI</span>
        <input name="password" type="password" placeholder="••••••••" autocomplete="new-password" required>
      </label>
      <label class="f"><span>XÁC NHẬN MẬT KHẨU</span>
        <input name="password2" type="password" placeholder="••••••••" autocomplete="new-password" required>
      </label>
      <button type="submit" class="btn primary block login-submit mt">Đặt mật khẩu</button>
    </form>`;
}

/** Gắn sự kiện submit cho form đặt mật khẩu — onSuccess thực hiện việc gọi API + điều hướng riêng của từng tình huống. */
function bindForm(body, onSuccess) {
  const form = body.querySelector('[data-setpw-form]');
  const submitBtn = form.querySelector('.login-submit');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const password = form.password.value;
    const password2 = form.password2.value;
    if (password !== password2) { toast('Mật khẩu xác nhận không khớp', 'err'); return; }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Đang lưu…';
    try {
      await onSuccess(password);
    } catch (err) {
      toast(err.message, 'err');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Đặt mật khẩu';
    }
  };
}

function errorBlock(msg) {
  return `<p class="sm mut">⚠️ ${esc(msg)}</p><a class="btn block mt" href="#/login">Quay lại đăng nhập</a>`;
}
