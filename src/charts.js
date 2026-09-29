/* Biểu đồ dùng chung cho Trang chủ cá nhân / Console đội.
 * Vẽ bằng HTML (thanh, cột) + SVG không méo chữ (đường) để co giãn đúng ở máy tính, máy tính bảng
 * và điện thoại. Chữ luôn dùng màu chữ, màu chỉ nằm trên vạch dữ liệu. Rê chuột / chạm → chú thích.
 * Bảng màu phân loại (đã kiểm tra mù màu): xanh dương · cam · xanh ngọc · vàng. */
import { esc } from './ui.js';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
export const STATUS = { ok: '#16A34A', warn: '#D97706', bad: '#DC2626' };

const nice = (max) => {
  if (!(max > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max))), n = max / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
export const shortMoney = (v) => {
  v = Number(v) || 0;
  if (Math.abs(v) >= 1e9) return (Math.round(v / 1e8) / 10).toLocaleString('vi-VN') + ' tỷ';
  if (Math.abs(v) >= 1e6) return Math.round(v / 1e6).toLocaleString('vi-VN') + ' tr';
  if (Math.abs(v) >= 1e3) return Math.round(v / 1e3).toLocaleString('vi-VN') + ' nghìn';
  return v.toLocaleString('vi-VN');
};
export const num = (v) => (Number(v) || 0).toLocaleString('vi-VN');

/** Khung thẻ biểu đồ: tiêu đề · mô tả · (chú giải) · nội dung. */
export function chartCard(title, sub, body, legend = '') {
  return `<div class="card cv-card"><div class="cv-head"><div><div class="cv-title">${esc(title)}</div>${sub ? `<div class="cv-sub">${esc(sub)}</div>` : ''}</div>${legend}</div>${body}</div>`;
}
export function legend(items) {
  return `<div class="cv-legend">${items.map(([label, color, kind]) => `<span class="cv-key"><i class="${kind === 'line' ? 'ln' : kind === 'mark' ? 'mk' : ''}" style="background:${color}"></i>${esc(label)}</span>`).join('')}</div>`;
}
export const emptyChart = (text) => `<div class="cv-empty">${esc(text)}</div>`;

/** Thanh ngang so với mục tiêu (bullet chart).
 * rows: [{label, value, target, fmt, tip, sub}] — pace (0-100) = vạch "đúng tiến độ hôm nay". */
export function bullets(rows, { pace = null, fmt = num } = {}) {
  if (!rows.length) return emptyChart('Chưa có dữ liệu');
  return `<div class="cv-bullets">${rows.map(r => {
    const f = r.fmt || fmt, t = Number(r.target) || 0, v = Number(r.value) || 0;
    const p = t ? Math.round(v / t * 100) : 0;
    const st = pace == null ? null : p >= pace ? 'ok' : p >= pace - 15 ? 'warn' : 'bad';
    const stLabel = { ok: 'Đúng tiến độ', warn: 'Hơi chậm', bad: 'Chậm tiến độ' }[st];
    const tip = r.tip || `${r.label}: ${f(v)} / ${f(t)} (${p}%)${pace != null ? ` · mốc hôm nay ${pace}%` : ''}`;
    return `<div class="cv-bl" data-tip="${esc(tip)}">
      <div class="cv-bl-l"><span class="cv-bl-n">${esc(r.label)}</span>${r.sub ? `<span class="cv-bl-s">${esc(r.sub)}</span>` : ''}</div>
      <div class="cv-bl-track"><i style="width:${Math.min(100, p)}%;background:${st ? STATUS[st] : SERIES[0]}"></i>${pace != null ? `<span class="cv-pace" style="left:${pace}%"></span>` : ''}</div>
      <div class="cv-bl-v"><span class="cv-bl-p">${st ? `<em class="cv-st ${st}">${stLabel}</em>` : ''}<b>${p}%</b></span><span>${esc(f(v))} / ${esc(f(t))}</span></div>
    </div>`;
  }).join('')}${pace != null ? `<div class="cv-pace-key"><span class="cv-pace-i"></span>Mốc đúng tiến độ hôm nay: ${pace}%</div>` : ''}</div>`;
}

/** Thanh ngang đơn giản (xếp hạng, phễu). rows: [{label, value, color?, tip?, right?}] */
export function hbars(rows, { fmt = num, max = null, marks = [] } = {}) {
  if (!rows.length) return emptyChart('Chưa có dữ liệu');
  const M = max || nice(Math.max(...rows.map(r => Number(r.value) || 0)));
  return `<div class="cv-hb">${rows.map(r => {
    const v = Number(r.value) || 0, w = M ? v / M * 100 : 0;
    return `<div class="cv-hb-row" data-tip="${esc(r.tip || `${r.label}: ${fmt(v)}`)}">
      <span class="cv-hb-l">${esc(r.label)}</span>
      <span class="cv-hb-track"><i style="width:${Math.max(v ? 1.5 : 0, w)}%;background:${r.color || SERIES[0]}"></i>
        ${marks.map(m => `<span class="cv-mark" style="left:${m / M * 100}%"></span>`).join('')}</span>
      <span class="cv-hb-v">${esc(r.right != null ? r.right : fmt(v))}</span></div>`;
  }).join('')}</div>`;
}

/** Cột chồng theo ngày. cols: [{label, parts:[number...], tip}] · series: [[tên, màu]] */
export function columns(cols, series, { fmt = num, height = 170 } = {}) {
  const totals = cols.map(c => c.parts.reduce((a, b) => a + (Number(b) || 0), 0));
  const M = nice(Math.max(1, ...totals));
  const ticks = [0, M / 2, M];
  return `<div class="cv-cols" style="--h:${height}px">
    <div class="cv-grid">${ticks.map(t => `<div class="cv-gl" style="bottom:${t / M * 100}%"><span>${esc(fmt(t))}</span></div>`).join('')}</div>
    <div class="cv-colwrap">${cols.map((c, i) => {
      const tip = c.tip || `${c.label}: ${series.map(([n], k) => `${n} ${fmt(c.parts[k] || 0)}`).join(' · ')} · Tổng ${fmt(totals[i])}`;
      return `<div class="cv-col" data-tip="${esc(tip)}"><div class="cv-stack" style="height:${totals[i] / M * 100}%">
        ${c.parts.map((v, k) => v ? `<i style="flex:${v};background:${series[k][1]}"></i>` : '').join('')}</div>
        <span class="cv-xl">${esc(c.label)}</span></div>`;
    }).join('')}</div></div>`;
}

/** Đường lũy kế so với đường mục tiêu. pts: [{label, v|null}] (null = ngày chưa tới) · target = mục tiêu cuối kỳ. */
export function cumLine(pts, target, { fmt = num, height = 180, actualLabel = 'Thực tế', targetLabel = 'Tiến độ cần đạt' } = {}) {
  const n = pts.length;
  const lastIdx = pts.reduce((a, p, i) => p.v != null ? i : a, -1);
  const vals = pts.filter(p => p.v != null).map(p => p.v);
  const M = nice(Math.max(target || 0, ...vals, 1));
  const X = (i) => n > 1 ? i / (n - 1) * 100 : 0, Y = (v) => 100 - v / M * 100;
  const act = pts.slice(0, lastIdx + 1).map((p, i) => `${X(i)},${Y(p.v)}`).join(' ');
  const area = lastIdx >= 0 ? `0,100 ${act} ${X(lastIdx)},100` : '';
  const ticks = [0, M / 2, M];
  const lastV = lastIdx >= 0 ? pts[lastIdx].v : 0;
  const expectNow = target && n > 1 ? target * lastIdx / (n - 1) : 0;
  return `<div class="cv-line" style="--h:${height}px">
    <div class="cv-grid">${ticks.map(t => `<div class="cv-gl" style="bottom:${t / M * 100}%"><span>${esc(fmt(t))}</span></div>`).join('')}</div>
    <div class="cv-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${target ? `<line x1="0" y1="100" x2="100" y2="${Y(target)}" class="cv-tgt" vector-effect="non-scaling-stroke"/>` : ''}
        ${area ? `<polygon points="${area}" fill="${SERIES[0]}" fill-opacity=".1"/>` : ''}
        ${act ? `<polyline points="${act}" fill="none" stroke="${SERIES[0]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : ''}
      </svg>
      ${lastIdx >= 0 ? `<span class="cv-dot" style="left:${X(lastIdx)}%;top:${Y(lastV)}%"></span>
        <span class="cv-endl" style="left:${X(lastIdx)}%;top:${Y(lastV)}%">${esc(fmt(lastV))}</span>` : ''}
      <div class="cv-hit">${pts.map((p, i) => `<span data-tip="${esc(`${p.label}: ${p.v == null ? 'chưa tới' : actualLabel + ' ' + fmt(p.v)}${target ? ' · cần đạt ' + fmt(target * i / Math.max(1, n - 1)) : ''}`)}"></span>`).join('')}</div>
    </div>
    <div class="cv-xaxis"><span>${esc(pts[0] ? pts[0].label : '')}</span><span>${esc(pts[Math.floor((n - 1) / 2)] ? pts[Math.floor((n - 1) / 2)].label : '')}</span><span>${esc(pts[n - 1] ? pts[n - 1].label : '')}</span></div>
    ${target ? `<div class="cv-note">Hôm nay: <b>${esc(fmt(lastV))}</b> · cần đạt <b>${esc(fmt(expectNow))}</b> để theo kịp mục tiêu ${esc(fmt(target))}</div>` : ''}
  </div>`;
}

/* ---------- chú thích nổi (rê chuột / chạm) ---------- */
let tip;
function showTip(el, x, y) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'cv-tip'; tip.setAttribute('role', 'tooltip'); }
  if (tip.parentNode !== document.body) document.body.appendChild(tip);
  tip.textContent = el.getAttribute('data-tip');
  tip.hidden = false;
  const tw = tip.offsetWidth;
  let lx = x + 12;
  const ly = y + 14;
  if (lx + tw > innerWidth - 8) lx = Math.max(8, x - tw - 12);
  tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
}
const hideTip = () => { if (tip) tip.hidden = true; };
document.addEventListener('pointermove', (e) => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el && e.pointerType === 'mouse') showTip(el, e.clientX, e.clientY); else if (e.pointerType === 'mouse') hideTip();
});
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el && e.pointerType !== 'mouse') showTip(el, e.clientX, e.clientY); else if (e.pointerType !== 'mouse') hideTip();
});
document.addEventListener('scroll', hideTip, true);
