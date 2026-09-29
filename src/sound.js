/* Chuông thông báo trong app — tổng hợp bằng Web Audio, không cần tệp âm thanh. Bật/tắt lưu theo
 * từng thiết bị (localStorage). Trình duyệt chỉ cho phát âm thanh sau khi người dùng đã chạm/bấm vào
 * trang ít nhất một lần, nên AudioContext được "mở khoá" ở lần tương tác đầu tiên. */

const KEY = 'nv_sound_on';

export const CHIMES = {
  message: { label: 'Thông báo mới', desc: 'Chuông êm 2 nốt', icon: 'messageSquare', notes: [[659.25, 0], [880, 0.14]] },
  alert: { label: 'Cảnh báo / cần duyệt', desc: 'Chuông 3 nốt cao', icon: 'sparkles', notes: [[987.77, 0], [1318.51, 0.11], [1567.98, 0.22]] },
  task: { label: 'Được giao việc', desc: 'Chuông nhiệm vụ C-G-C', icon: 'bell', notes: [[523.25, 0], [783.99, 0.15], [1046.5, 0.3]] },
};

let ctx = null;
const audio = () => {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => { if (isSoundOn()) audio(); }, { once: true, capture: true }));

export function isSoundOn() {
  try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; }
}

export function setSoundOn(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* chế độ riêng tư: chỉ giữ trong phiên */ }
  window.dispatchEvent(new Event('nv:sound-changed'));
}

/** Phát một kiểu chuông. `force` = nghe thử (phát cả khi đang tắt chuông). */
export function playChime(kind = 'message', { force = false } = {}) {
  if (!force && !isSoundOn()) return;
  const c = audio();
  const chime = CHIMES[kind] || CHIMES.message;
  if (!c) return;
  const t0 = c.currentTime + 0.02;
  for (const [freq, at] of chime.notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
    osc.connect(gain).connect(c.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.5);
  }
}

/** Chọn kiểu chuông theo thông báo vừa tới: giao việc → chuông nhiệm vụ; cảnh báo → 3 nốt cao. */
export function chimeFor(n) {
  if (!n) return 'message';
  if (n.type === 'assignment' || n.type === 'handover') return 'task';
  if (n.level === 'danger' || n.level === 'warn') return 'alert';
  return 'message';
}
