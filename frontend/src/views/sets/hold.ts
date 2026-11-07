// Study sets — see index.ts for the whole picture. This file: hold.
import { html } from '../../html';


export const HOLD_MS = 3000;
export const HOLD_RING = html`<svg class="hold-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" pathLength="100"></circle></svg>`;
/** Press and hold (pointer, Enter or Space) for `ms` to confirm: the button's ring fills meanwhile; let go early and it
 *  empties again and `early` says how it works. */
export function holdToConfirm(btn: HTMLElement, ms: number, done: () => void, early: () => void) {
  btn.style.setProperty('--hold-ms', `${String(ms)}ms`);
  let timer = 0;
  let started = 0;
  const start = () => {
    if (timer) return;
    started = Date.now();
    btn.classList.add('holding');
    timer = window.setTimeout(() => { timer = 0; btn.classList.remove('holding'); btn.classList.add('held'); done(); }, ms);
  };
  const stop = () => {
    if (!timer) return;
    clearTimeout(timer); timer = 0;
    btn.classList.remove('holding');
    if (Date.now() - started < ms) early();
  };
  btn.addEventListener('pointerdown', (e) => { if (e.button === 0) { btn.setPointerCapture(e.pointerId); start(); } });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) btn.addEventListener(ev, stop);
  btn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } });
  btn.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') stop(); });
  btn.addEventListener('blur', stop);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());   // a long touch opens no menu
  btn.addEventListener('click', (e) => e.preventDefault());
}
