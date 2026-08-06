import { post } from './api.js';
import { SENSITIVE } from './const.js';

let currentView = '';
let armed = false;
let lastLog = 0;

function overlay(on) {
  const el = document.getElementById('guard-overlay');
  if (el) el.hidden = !on;
}

async function logAttempt(reason) {
  const t = Date.now();
  if (t - lastLog < 4000) return;      // chống spam log
  lastLog = t;
  try { await post('/audit/screen', { view: currentView, reason }); } catch (e) { /* im lặng */ }
}

export function setView(view) {
  currentView = view;
  armed = SENSITIVE.includes(view);
  if (!armed) overlay(false);
}

export function initGuard() {
  document.addEventListener('visibilitychange', () => {
    if (!armed) return;
    if (document.hidden) { overlay(true); logAttempt('visibilitychange'); }
    else setTimeout(() => overlay(false), 250);
  });
  window.addEventListener('blur', () => { if (armed) overlay(true); });
  window.addEventListener('focus', () => overlay(false));
  document.addEventListener('contextmenu', (e) => { if (armed) { e.preventDefault(); logAttempt('contextmenu'); } });
  document.addEventListener('keyup', (e) => {
    if (!armed) return;
    if (e.key === 'PrintScreen') { overlay(true); logAttempt('printscreen'); setTimeout(() => overlay(false), 1500); }
  });
  document.addEventListener('keydown', (e) => {
    if (!armed) return;
    const k = (e.key || '').toLowerCase();
    if ((e.metaKey && e.shiftKey && ['3', '4', '5'].includes(k)) || (e.ctrlKey && k === 'p')) {
      e.preventDefault(); overlay(true); logAttempt('shortcut'); setTimeout(() => overlay(false), 1500);
    }
  });
}
