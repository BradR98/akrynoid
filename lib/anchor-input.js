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
 *  - STEERING RAIL (opt-in, `steerFrac` > 0): only the bottom `steerFrac` of the board listens. Presses anywhere above it are
 *    ignored completely (no steering, no action).
 *  - RELATIVE STEERING (opt-in, `relative: true`): a touch never teleports the paddle. On touch-start the finger's x and the
 *    current getX() are recorded; every move applies (fingerX - startFingerX) to that starting x. Lift and touch elsewhere on
 *    the rail and you simply begin a new drag from wherever the paddle already is. If the paddle hits an edge, the anchor is
 *    re-based so the drag reverses immediately (no dead zone). Hovering mice do not steer in relative mode (drag instead).
 *  - TAPS: a press that is released within `tapMs` (200) and moved less than `tapPx` (10 screen px) is a tap -> `onAction`.
 *    A cancelled / lost pointer is never a tap. `act()` fires the same callback programmatically (bots / tests).
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
   * @param {number} [o.steerFrac=0]      height of the steering rail as a fraction of the board height (0 = whole screen steers, legacy;
   *                                      0.2 = only the bottom 20% listens, the rest of the screen ignores input). Also the default trackpad strip height.
   * @param {boolean} [o.relative=false]  relative (delta) steering instead of absolute 1:1 finger position, see above
   * @param {number} [o.tapMs=200] @param {number} [o.tapPx=10]  tap detection thresholds (max duration ms, max travel in screen px)
   * @param {()=>number} [o.now]          injectable clock in ms (tests); default performance.now
   * @param {number} [o.trackpadFrac]     height of the visible trackpad strip as a fraction of the board (default steerFrac || 0.15; 0 = none)
   * @param {number} [o.min=0] @param {number} [o.max=width]  clamp range for getX()
   * @param {number} [o.smoothing=0]      0 = 1:1 (default). >0 eases getX() toward the finger (rate per second, e.g. 18)
   * @param {string} [o.label]            hint text on the strip
   * @param {Document} [o.document]       injectable (tests)
   * @param {{onDown?:Function,onUp?:Function,onMove?:Function,onAction?:Function}} [o.on]  onDown/onUp = steering finger, onAction = tap on the rail
   */
  constructor(o = {}) {
    this.width = o.width ?? 360; this.height = o.height ?? 640;
    this.min = o.min ?? 0; this.max = o.max ?? this.width;
    this.smoothing = o.smoothing || 0;
    this.steerFrac = Math.max(0, Math.min(1, o.steerFrac || 0));
    this.trackpadFrac = o.trackpadFrac ?? (this.steerFrac || 0.15);
    this.relative = !!o.relative; this.tapMs = o.tapMs ?? 200; this.tapPx = o.tapPx ?? 10;
    this._now = o.now || (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
    this._aPtr = 0; this._aX = 0; this._lastPtr = 0; this._t0 = 0; this._sx = 0; this._sy = 0; this._travel = 0;
    this._listeners = { down: [], up: [], move: [], action: [] };
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
    const steerable = (e) => this._inRail(e, el);
    listen('pointerdown', (e) => {
      e.preventDefault();
      if (!steerable(e)) return;                                     // outside the rail: no input at all
      if (this._pid !== null && this._pid !== e.pointerId) return;   // one steering finger at a time
      this._pid = e.pointerId; this._down = true;
      this._t0 = this._now(); this._sx = e.clientX; this._sy = e.clientY; this._travel = 0;
      if (this.relative) this._anchor(e); else this._setFromEvent(e);
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      this._emit('down', 'onDown');
    });
    listen('pointermove', (e) => {
      e.preventDefault();
      if (e.pointerId === this._pid) {                               // the steering finger: follows anywhere once it started on the rail
        this._track(e);
        if (this.relative) this._moveRel(e); else this._setFromEvent(e);
        this._emit('move', 'onMove'); return;
      }
      if (this.relative || !steerable(e)) return;                    // absolute mode only: a hovering mouse on the rail steers
      if (this._pid === null && e.pointerType === 'mouse') { this._setFromEvent(e); this._emit('move', 'onMove'); }
    });
    const end = (tapAllowed) => (e) => {
      if (!this._down || (e && e.pointerId !== undefined && e.pointerId !== this._pid)) return;
      if (e) this._track(e);
      const tap = tapAllowed && (this._now() - this._t0) < this.tapMs && this._travel < this.tapPx;
      this._release();
      if (tap) this.act();                                           // quick, short press = Tap
    };
    listen('pointerup', end(true)); listen('pointercancel', end(false)); listen('lostpointercapture', end(false));
    o.container.appendChild(el);
    if (typeof window !== 'undefined' && window.addEventListener) { const b = () => { if (this._down) this._release(); }; window.addEventListener('blur', b); this._off.push(() => window.removeEventListener('blur', b)); }
  }

  _release() { this._down = false; this._pid = null; this._emit('up', 'onUp'); }
  /** True when the event is allowed to steer: always in legacy mode, otherwise only inside the bottom `steerFrac` rail. */
  _inRail(e, el) {
    if (!(this.steerFrac > 0)) return true;
    const r = el.getBoundingClientRect();
    return (e.clientY - r.top) / (r.height || 1) >= 1 - this.steerFrac;
  }
  _emit(name, cb) {
    const ls = this._listeners[name]; for (let i = 0; i < ls.length; i++) ls[i](this);
    if (this.on[cb]) this.on[cb](this);
  }
  /** Subscribe to 'down' | 'up' | 'move' | 'action' (in addition to the `on` options). Returns an unsubscribe function. */
  listen(name, fn) { const a = this._listeners[name]; if (!a) throw new RangeError('AnchorInput.listen: unknown event ' + name); a.push(fn); return () => { const k = a.indexOf(fn); if (k >= 0) a.splice(k, 1); }; }
  /** Fire the action callback (a tap on the rail). Also the programmatic entry point for bots / tests. */
  act() { this._emit('action', 'onAction'); }
  /** Logical y (0..height) where the steering rail begins; everything above it ignores input. */
  get railTop() { return this.height * (1 - this.steerFrac); }

  _logicalX(e) { const r = this.el.getBoundingClientRect(); return (e.clientX - r.left) / (r.width || 1) * this.width; }
  /** Relative steering: remember where the finger and the paddle are right now. */
  _anchor(e) { this._aPtr = this._lastPtr = this._logicalX(e); this._aX = this._target; }
  /** Relative steering: paddle = start x + finger travel; re-base the anchor whenever the edge clamps. */
  _moveRel(e) {
    const cur = this._logicalX(e), want = this._aX + (cur - this._aPtr), got = this._clamp(want);
    if (got !== want) { this._aX = got; this._aPtr = cur; }
    this._lastPtr = cur; this._target = got;
    if (!this.smoothing) this._x = got;
  }
  /** Furthest the finger has strayed from where it landed, in screen px (tap detection). */
  _track(e) {
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      const d = Math.hypot(e.clientX - this._sx, e.clientY - this._sy); if (d > this._travel) this._travel = d;
    }
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
  setBounds(min, max) {
    this.min = min; this.max = max; this._target = this._clamp(this._target); this._x = this._clamp(this._x);
    if (this.relative && this._down) { this._aX = this._target; this._aPtr = this._lastPtr; }   // keep an active drag continuous
  }
  /** Call once per frame when `smoothing` > 0. */
  update(dt) { if (this.smoothing) this._x += (this._target - this._x) * Math.min(1, dt * this.smoothing); return this._x; }
  /** Programmatic input (bots, tests, replays). Works with or without a DOM. */
  feed(x, down = this._down) {
    const was = this._down;
    this._target = this._clamp(x); this._x = this._target; this._down = !!down;
    if (down && !was) this._emit('down', 'onDown');
    if (!down && was) this._emit('up', 'onUp');
  }
  setVisible(v) { if (this.el) this.el.style.display = v ? '' : 'none'; }
  destroy() { this._off.forEach((f) => f()); this._off = []; if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el); this.el = null; }
}
