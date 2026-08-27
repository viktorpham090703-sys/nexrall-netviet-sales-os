// Scroll-triggered fade-in + số đếm cho các phần tử [data-counter].
const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

function runCounter(el) {
  const target = Number(el.dataset.counter) || 0;
  const duration = 2000;
  const start = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    el.textContent = Math.round(target * easeOutQuart(p)).toLocaleString('vi-VN');
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

export function initScrollFx(root) {
  if (!root) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      el.classList.add('in-view');
      if (el.dataset.counter) runCounter(el);
      io.unobserve(el);
    });
  }, { threshold: 0.15 });

  root.querySelectorAll('.fade-in, [data-counter]').forEach((el) => io.observe(el));
}
