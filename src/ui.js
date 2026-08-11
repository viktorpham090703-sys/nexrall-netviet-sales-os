export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const vnd = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0)) + ' đ';
export function money(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e15) return (n / 1e12).toFixed(0) + ' nghìn tỷ';
  if (a >= 1e12) return (n / 1e12).toFixed(n % 1e12 === 0 ? 0 : 1) + ' nghìn tỷ';
  if (a >= 1e9) return (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2) + ' tỷ';
  if (a >= 1e6) return Math.round(n / 1e6) + ' tr';
  return new Intl.NumberFormat('vi-VN').format(Math.round(n));
}
export const pct = (a, b) => b ? Math.min(999, Math.round(a / b * 100)) : 0;

const D = (ts) => new Date((Number(ts) || 0) * 1000);
export const fmtDate = (ts) => ts ? D(ts).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
export const fmtDT = (ts) => ts ? D(ts).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export function rel(ts) {
  if (!ts) return '—';
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return Math.floor(s / 60) + ' phút trước';
  if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' ngày trước';
  return fmtDate(ts);
}
export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(-2).map(x => x[0]).join('').toUpperCase();

export const chip = (text, tone = '') => `<span class="chip ${tone}">${esc(text)}</span>`;
export const bar = (val, max, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.min(100, pct(val, max))}%"></i></div>`;

export function stat(label, value, sub = '', tone = '') {
  return `<div class="stat ${tone}"><div class="l">${esc(label)}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
}

export function ring(value, max, label) {
  const r = 32, c = 2 * Math.PI * r, p = Math.min(1, max ? value / max : 0);
  return `<div class="ring" style="width:84px;height:84px">
    <svg width="84" height="84"><circle cx="42" cy="42" r="${r}" stroke="#3f3f46" stroke-width="8" fill="none"></circle>
    <circle cx="42" cy="42" r="${r}" stroke="url(#g1)" stroke-width="8" fill="none" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}"></circle>
    <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B91C1C"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs></svg>
    <div class="lbl"><b>${value}${max === 100 ? '' : '/' + max}</b><small>${esc(label)}</small></div></div>`;
}

export const empty = (icon, text, action = '') =>
  `<div class="empty"><span class="e">${icon}</span>${esc(text)}${action ? `<div class="mt">${action}</div>` : ''}</div>`;
export const loading = () => `<div class="boot" style="height:200px"><div class="spinner"></div></div>`;
export const errBox = (msg) => `<div class="err-box">⚠️ ${esc(msg)} <button class="btn sm mt" data-retry>Thử lại</button></div>`;

export function toast(msg, tone = '') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast ' + tone;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/**
 * Modal form. fields: [{name,label,type,value,options,placeholder,required,rows,hint}]
 * onSubmit(values) — trả về false để giữ modal mở.
 */
export function modal({ title, fields = [], html = '', submitText = 'Lưu', onSubmit, wide }) {
  const root = document.getElementById('modal-root');
  const body = fields.map(f => {
    const v = f.value == null ? '' : f.value;
    let input;
    if (f.type === 'select') {
      input = `<select name="${f.name}">${(f.options || []).map(o => {
        const val = typeof o === 'string' ? o : o.v, lab = typeof o === 'string' ? o : o.n;
        return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea name="${f.name}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
    } else {
      input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}">`;
    }
    return `<label class="f"><span>${esc(f.label)}${f.required ? ' *' : ''}</span>${input}${f.hint ? `<div class="xs mut mt">${esc(f.hint)}</div>` : ''}</label>`;
  }).join('');

  root.innerHTML = `<div class="modal-scrim"><div class="modal" ${wide ? 'style="max-width:680px"' : ''}>
    <h3>${esc(title)}</h3>
    <form data-form>${body}${html}
      <div class="row mt" style="gap:8px">
        <button type="button" class="btn grow" data-cancel>Huỷ</button>
        <button type="submit" class="btn primary grow">${esc(submitText)}</button>
      </div>
    </form></div></div>`;

  const close = () => { root.innerHTML = ''; };
  root.querySelector('[data-cancel]').onclick = close;
  root.querySelector('.modal-scrim').addEventListener('click', (e) => { if (e.target.classList.contains('modal-scrim')) close(); });
  const form = root.querySelector('[data-form]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await onSubmit(values, root);
      if (r !== false) close();
    } catch (err) {
      toast(err.message || 'Có lỗi xảy ra', 'err');
    } finally { btn.disabled = false; }
  });
  return { close, root };
}

export function confirmDialog(title, text, onOk) {
  modal({ title, html: `<p class="sm mut">${esc(text)}</p>`, submitText: 'Xác nhận', onSubmit: onOk });
}

/** Bọc 1 view async: hiện loading → render → bắt lỗi + nút thử lại */
export async function mount(el, loader, renderer, after) {
  el.innerHTML = loading();
  try {
    const data = await loader();
    el.innerHTML = renderer(data);
    if (after) after(data);
    return data;
  } catch (e) {
    el.innerHTML = errBox(e.message || 'Không tải được dữ liệu');
    const b = el.querySelector('[data-retry]');
    if (b) b.onclick = () => mount(el, loader, renderer, after);
    return null;
  }
}
