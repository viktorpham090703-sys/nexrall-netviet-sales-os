const TK = 'nv_session_token';

export const sessionToken = () => localStorage.getItem(TK) || '';
export const setToken = (t) => t ? localStorage.setItem(TK, t) : localStorage.removeItem(TK);
/** Dọn khoá cũ của cơ chế X-Actor-Id (đã bỏ) để không còn dấu vết danh tính giả mạo. */
export const clearLegacy = () => localStorage.removeItem('nv_actor_id');

/** Thông điệp thân thiện cho các lỗi hạ tầng thường gặp. */
function friendly(status, raw) {
  if (raw) return raw;
  if (status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng chọn lại tài khoản.';
  if (status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
  if (status === 404) return 'Không tìm thấy dữ liệu.';
  if (status === 409) return 'Dữ liệu bị trùng hoặc trạng thái không cho phép thao tác này.';
  if (status >= 500) return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau ít phút.';
  return 'Có lỗi xảy ra, vui lòng thử lại.'; 
}

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const tok = sessionToken();
  if (tok) headers.Authorization = 'Bearer ' + tok;

  let res;
  try {
    res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    // Lỗi mạng: không hiện nguyên văn kỹ thuật tiếng Anh cho người dùng
    const err = new Error('Không kết nối được máy chủ. Kiểm tra kết nối mạng rồi thử lại.');
    err.status = 0;
    throw err;
  }

  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }

  if (!res.ok) {
    // Token hỏng/hết hạn → dọn phiên để app quay về màn đăng nhập
    if (res.status === 401) setToken('');
    // Đã gửi token mà máy chủ vẫn trả 401 → phiên hết hạn (quá 12 giờ) hoặc bị thu hồi (đăng xuất ở tab
    // khác). Trước đây chỉ xoá token, còn giao diện vẫn như đang đăng nhập — mọi lệnh gọi sau đó (kể cả
    // bật/gửi thử thông báo) đều nhận 401 "Chưa đăng nhập" mà không ai hiểu vì sao. Nay báo cho app
    // (src/app.js) đưa về màn đăng nhập. Trừ POST /session: 401 ở đó là sai mật khẩu, không phải hết phiên.
    if (res.status === 401 && tok && path !== '/session') {
      const err = new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
      err.status = 401;
      err.data = data;
      err.sessionExpired = true;
      window.dispatchEvent(new Event('nv:session-expired'));
      throw err;
    }
    const err = new Error(friendly(res.status, data.error));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
