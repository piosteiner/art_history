// Zoom and pan for the enlarged image (the lightbox): the wheel zooms smoothly towards the pointer, dragging moves the
// enlarged image, two fingers pinch, a double click toggles between fit and 2.5×, + / − / 0 on the keyboard.
// The image stays inside its frame: it can't be dragged off its edges or shrunk below fit.

const MAX = 8;
const EASE = 0.22; // share of the remaining way per frame: smooth without lagging

interface View { s: number; x: number; y: number }

/** Makes `img` zoomable inside `stage` (which clips it). Returns a function that removes the listeners. */
export function zoomable(stage: HTMLElement, img: HTMLImageElement): () => void {
  const now: View = { s: 1, x: 0, y: 0 }; // what is drawn
  const goal: View = { s: 1, x: 0, y: 0 }; // where it is heading
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame = 0;

  const size = () => ({ w: stage.clientWidth, h: stage.clientHeight });
  /** Keeps the frame covered: no empty edge when zoomed in, back to the frame at 1×. */
  function clamp(v: View) {
    const { w, h } = size();
    v.s = Math.min(MAX, Math.max(1, v.s));
    v.x = Math.min(0, Math.max(w - w * v.s, v.x));
    v.y = Math.min(0, Math.max(h - h * v.s, v.y));
  }
  function draw() {
    img.style.transform = `translate(${now.x}px, ${now.y}px) scale(${now.s})`;
    stage.classList.toggle('zoomed', goal.s > 1.001);
  }
  function step() {
    frame = 0;
    // all three together (map, not every: that would stop at the first one still moving)
    const done = (['s', 'x', 'y'] as const).map((k) => {
      const d = goal[k] - now[k];
      now[k] = Math.abs(d) < (k === 's' ? 0.001 : 0.3) ? goal[k] : now[k] + d * EASE;
      return now[k] === goal[k];
    }).every(Boolean);
    draw();
    if (!done) frame = requestAnimationFrame(step);
  }
  const animate = () => {
    if (reduced) { Object.assign(now, goal); draw(); return; }
    if (!frame) frame = requestAnimationFrame(step);
  };
  /** Zoom the goal to `s`, keeping the point (px, py) of the stage where it is. */
  function zoomTo(s: number, px: number, py: number) {
    const k = Math.min(MAX, Math.max(1, s)) / goal.s;
    goal.x = px - (px - goal.x) * k;
    goal.y = py - (py - goal.y) * k;
    goal.s *= k;
    clamp(goal);
    animate();
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines (Firefox) → pixels
    zoomTo(goal.s * Math.exp(-dy * 0.0018), ...local(e));
  };

  // pointers: one drags, two pinch
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; s: number } | null = null;
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pinch = pointers.size === 2 ? { d: distance(), s: goal.s } : null;
    stage.classList.toggle('dragging', pointers.size === 1 && goal.s > 1);
  };
  const onMove = (e: PointerEvent) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoomTo(pinch.s * (distance() / pinch.d), ...local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }));
    } else if (pointers.size === 1 && goal.s > 1) {
      goal.x += dx;
      goal.y += dy;
      clamp(goal);
      Object.assign(now, goal); // the image follows the hand directly
      draw();
    }
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    stage.classList.remove('dragging');
  };
  const onDouble = (e: MouseEvent) => zoomTo(goal.s > 1.001 ? 1 : 2.5, ...local(e));
  const onKey = (e: KeyboardEvent) => {
    const { w, h } = size();
    if (e.key === '+' || e.key === '=') zoomTo(goal.s * 1.5, w / 2, h / 2);
    else if (e.key === '-') zoomTo(goal.s / 1.5, w / 2, h / 2);
    else if (e.key === '0') zoomTo(1, w / 2, h / 2);
    else return;
    e.preventDefault();
  };

  stage.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('dblclick', onDouble);
  document.addEventListener('keydown', onKey);
  draw();
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener('keydown', onKey);
  };
}
