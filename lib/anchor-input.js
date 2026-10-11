/**
 * anchor-input.js - the 1:1 mobile "trackpad" input, as a reusable module.
 *
 *   const input = new AnchorInput({ container: stageEl, width: 360, height: 640, trackpadFrac: 0.15 });
 *   // in any game's update():  paddle.x = input.getX();
 *
 * It builds a FLAT overlay (never CSS-transformed) over the game's container. The overlay owns all pointer events
 * (touch + mouse via Pointer Events), so a tilted / scaled / letterboxed canvas underneath can't break the mapping:
 * the finger's X on the glass is converted to the game's LOGICAL x (0..width) using the overlay's own rect.
 *
 *  - X-only by design: touching anywhere on the overlay steers; getX() is the logical x, clamped to [min, max].
 *  - `isDown()` is true while a pointer is held (use it to fire / launch). `onDown/onUp/onMove` callbacks are optional.
 *  - A visible trackpad strip (bottom `trackpadFrac` of the board) is drawn as a DOM element with a hint label.
 *  - Headless / bots: construct without a container (or call `feed(x, down)`) - no DOM is touched.
 */

export class AnchorInput {
  /**
   * @param {object} [o]
   * @param {HTMLElement} [o.container]   element the overlay is appended to (should be position:relative/absolute)
   * @param {number} [o.width=360]        logical board width that screen X maps onto
   * @param {number} [o.height=640]       logical board height (used for the trackpad strip size)
   * @param {number} [o.trackpadFrac=0.15] height of the visible trackpad strip as a fraction of the board (0 = none)
   * @param {number} [o.min=0] @param {number} [o.max=width]  clamp range for getX()
   * @param {number} [o.smoothing=0]      0 = 1:1 (default). >0 eases getX() toward the finger (rate per second, e.g. 18)
   * @param {string} [o.label]            hint text on the strip
   * @param {Document} [o.document]       injectable (tests)
   * @param {{onDown?:Function,onUp?:Function,onMove?:Function}} [o.on]
   */
  constructor(o = {}) {
    this.width = o.width ?? 360; this.height = o.height ?? 640;
    this.min = o.min ?? 0; this.max = o.max ?? this.width;
    this.smoothing = o.smoothing || 0;
    this.trackpadFrac = o.trackpadFrac ?? 0.15;
    this.on = o.on || {};
    this._target = (this.min + this.max) / 2; this._x = this._target;
    this._down = false; this._pid = null; this.el = null; this.strip = null; this._off = [];
    const doc = o.document || (typeof document !== 'undefined' ? document : null);
    if (o.container && doc) this._build(o, doc);
  }

  _build(o, doc) {
    const el = this.el = doc.createElement('div');
    Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', touchAction: 'none', userSelect: 'none', webkitUserSelect: 'none', zIndex: '2' });
    el.setAttribute('data-anchor-input', 'overlay');
    if (this.trackpadFrac > 0) {
      const s = this.strip = doc.createElement('div');
      Object.assign(s.style, { position: 'absolute', left: '0', right: '0', bottom: '0', height: (this.trackpadFrac * 100) + '%', background: 'rgba(13,20,48,0.92)',
        color: 'rgba(255,255,255,0.12)', font: '700 12px system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' });
      s.textContent = o.label || 'TRACKPAD  -  slide to aim, hold to fire';
      s.setAttribute('data-anchor-input', 'trackpad');
      el.appendChild(s);
    }
    const listen = (t, f) => { el.addEventListener(t, f); this._off.push(() => el.removeEventListener(t, f)); };
    listen('pointerdown', (e) => { this._pid = e.pointerId; this._down = true; this._setFromEvent(e); try { el.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); if (this.on.onDown) this.on.onDown(this); });
    listen('pointermove', (e) => { if (this._down || e.pointerType === 'mouse') { this._setFromEvent(e); if (this.on.onMove) this.on.onMove(this); } e.preventDefault(); });
    const up = (e) => { if (!this._down) return; this._down = false; this._pid = null; if (this.on.onUp) this.on.onUp(this); };
    listen('pointerup', up); listen('pointercancel', up); listen('lostpointercapture', up);
    o.container.appendChild(el);
    if (typeof window !== 'undefined' && window.addEventListener) { const b = () => { if (this._down) up(); }; window.addEventListener('blur', b); this._off.push(() => window.removeEventListener('blur', b)); }
  }

  _setFromEvent(e) {
    const r = this.el.getBoundingClientRect();
    this._target = this._clamp((e.clientX - r.left) / (r.width || 1) * this.width);
    if (!this.smoothing) this._x = this._target;
  }
  _clamp(x) { return x < this.min ? this.min : (x > this.max ? this.max : x); }

  /** Logical X (0..width, clamped) the player entity should lock onto. */
  getX() { return this._x; }
  /** Same, normalised to 0..1 across [min, max]. */
  getXNorm() { return this.max > this.min ? (this._x - this.min) / (this.max - this.min) : 0.5; }
  /** True while a finger / mouse button is held. */
  isDown() { return this._down; }
  /** Change the clamp range (e.g. when the active play area narrows). */
  setBounds(min, max) { this.min = min; this.max = max; this._target = this._clamp(this._target); this._x = this._clamp(this._x); }
  /** Call once per frame when `smoothing` > 0. */
  update(dt) { if (this.smoothing) this._x += (this._target - this._x) * Math.min(1, dt * this.smoothing); return this._x; }
  /** Programmatic input (bots, tests, replays). Works with or without a DOM. */
  feed(x, down = this._down) {
    const was = this._down;
    this._target = this._clamp(x); this._x = this._target; this._down = !!down;
    if (down && !was && this.on.onDown) this.on.onDown(this);
    if (!down && was && this.on.onUp) this.on.onUp(this);
  }
  setVisible(v) { if (this.el) this.el.style.display = v ? '' : 'none'; }
  destroy() { this._off.forEach((f) => f()); this._off = []; if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el); this.el = null; }
}
