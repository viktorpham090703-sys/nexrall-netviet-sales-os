import { getLang, personName } from './i18n.js';

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
  // X-Lang: server trả lời AI bằng tiếng Anh khi giao diện đang ở EN (server/lib/ai.js askAI).
  const headers = { 'Content-Type': 'application/json', 'X-Lang': getLang() };
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
  return latinNames(data);
}

/* Các trường tên NGƯỜI do server JOIN sẵn chỉ để hiển thị (owner_name, user_name, assigner_name…),
 * không bao giờ được gửi ngược lên server → ở giao diện EN viết không dấu ngay tại đây thay vì sửa
 * từng chỗ hiển thị. Trường `name` của chính đối tượng người dùng thì KHÔNG đổi ở đây, vì biểu mẫu
 * sửa hồ sơ/tài khoản điền sẵn từ nó — lưu lại sẽ ghi đè tên không dấu vào CSDL; xử lý ở chỗ hiển thị. */
const PERSON_KEYS = /^(owner|user|assigner|assignee|approver|sale|acts_as|actor|creator|author|decided_by)(_name|Name)$/;
function latinNames(v) {
  if (Array.isArray(v)) { v.forEach(latinNames); return v; }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (typeof x === 'string' && PERSON_KEYS.test(k)) v[k] = personName(x);
      else if (x && typeof x === 'object') latinNames(x);
    }
  }
  return v;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
export const put = (p, body) => api(p, { method: 'PUT', body });

/**
 * Tải một tệp từ API về máy. Không dùng thẳng <a href="/api/...">: thẻ <a> không gửi được header
 * Authorization nên máy chủ sẽ coi là chưa đăng nhập. Tải bằng fetch có token rồi lưu qua blob.
 */
export async function downloadFile(path, filename) {
  const headers = {};
  const tok = sessionToken();
  if (tok) headers.Authorization = 'Bearer ' + tok;
  const res = await fetch('/api' + path, { headers });
  if (!res.ok) {
    let msg = 'Không tải được tệp';
    try { msg = (await res.json()).error || msg; } catch (e) { /* không phải JSON */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'tai-lieu';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Đọc File thành chuỗi base64 (không kèm tiền tố data:) để gửi qua API JSON. */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^;]*;base64,/, ''));
    r.onerror = () => reject(new Error('Không đọc được tệp'));
    r.readAsDataURL(file);
  });
}

/* Một số hệ điều hành không điền File.type cho tệp Office — suy từ đuôi tệp. */
const EXT_MIME = {
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
};
export const mimeOf = (file) => file.type || EXT_MIME[(file.name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
