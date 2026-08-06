import { state, login } from '../state.js';
import { esc, initials, toast } from '../ui.js';
import { ROLE_NAME } from '../const.js';

export async function render(el) {
  el.innerHTML = `<div class="login-wrap">
    <div class="hero">
      <div class="row" style="gap:10px"><div class="logo" style="width:44px;height:44px;border-radius:13px;font-size:18px">NV</div>
      <div><h1>NetViet <span style="color:#F59E0B">Sales OS</span></h1>
      <p>Quản hoạt động dẫn dắt kết quả — TVC/Video AI · Booking Gameshow · Xây kênh triệu view</p></div></div>
    </div>
    <div class="sec-title">Chọn tài khoản demo để đăng nhập</div>
    <div data-accts></div>
    <p class="xs mut mt">Bản demo dùng cơ chế chọn tài khoản. Dữ liệu mẫu đã được nạp sẵn cho mọi màn hình.</p>
  </div>`;

  const wrap = el.querySelector('[data-accts]');
  wrap.innerHTML = state.users.map(u => `<button class="acct" data-id="${esc(u.id)}">
      <div class="avatar" style="background:${u.role === 'admin' ? 'linear-gradient(135deg,#1D4ED8,#4f46e5)' : u.role === 'manager' ? 'linear-gradient(135deg,#B91C1C,#F59E0B)' : 'linear-gradient(135deg,#3f3f46,#52525b)'}">${esc(initials(u.name))}</div>
      <div class="grow"><div class="b">${esc(u.name)}</div>
        <div class="sm mut">${esc(ROLE_NAME[u.role] || u.role)} · ${esc(u.title || '')}</div></div>
      <span class="chip ${u.role === 'sales' ? 'grey' : u.role === 'manager' ? 'amber' : 'blue'}">${esc(u.role)}</span>
    </button>`).join('');

  wrap.querySelectorAll('.acct').forEach(b => b.onclick = async () => {
    try {
      await login(b.dataset.id);
      location.hash = '#/cockpit';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (e) { toast(e.message, 'err'); }
  });
}
