/**
 * anchor-loop.js - reusable game loop + strict state machine.
 *
 *   const loop = new AnchorLoop({ update(dt, loop) {...}, draw(alpha, loop) {...} });
 *   loop.start();            // START -> PLAY, begins requestAnimationFrame
 *
 * States: START -> PLAY <-> PAUSE, PLAY -> GAMEOVER, GAMEOVER -> START.
 * Anything else throws, so a game can never wander into an impossible state.
 *
 *  - update() runs ONLY while PLAY. draw() runs in START / PLAY / GAMEOVER (so title and end screens animate)
 *    and once on entering PAUSE (the rAF loop is cancelled while paused: zero battery use).
 *  - Delta time is in seconds, clamped to `maxDt` so a backgrounded tab never produces a physics explosion.
 *  - Optional fixed timestep: pass `fixedStep` (e.g. 1/120); update() then always receives exactly that dt and
 *    draw() receives the interpolation alpha (0..1).
 *  - Everything time/DOM related is injectable (raf / caf / now / visibility target) so the loop runs headless.
 */

export const State = Object.freeze({ START: 'START', PLAY: 'PLAY', PAUSE: 'PAUSE', GAMEOVER: 'GAMEOVER' });

const TRANSITIONS = {
  [State.START]: [State.PLAY],
  [State.PLAY]: [State.PAUSE, State.GAMEOVER],
  [State.PAUSE]: [State.PLAY, State.START],
  [State.GAMEOVER]: [State.START, State.PLAY],
};

export class AnchorLoop {
  /**
   * @param {object} o
   * @param {(dt:number, loop:AnchorLoop)=>void} o.update   advance the simulation (PLAY only)
   * @param {(alpha:number, loop:AnchorLoop)=>void} o.draw  render one frame
   * @param {(next:string, prev:string, loop:AnchorLoop)=>void} [o.onState]  called after every transition
   * @param {number} [o.maxDt=1/20]   clamp for a single frame's delta (seconds)
   * @param {number} [o.fixedStep=0]  fixed simulation step in seconds (0 = variable dt)
   * @param {boolean} [o.autoPause=true] pause when the tab is hidden
   * @param {Function} [o.raf] @param {Function} [o.caf] @param {()=>number} [o.now]  injectable timing (ms)
   * @param {{addEventListener:Function, hidden:boolean}} [o.visibility] defaults to `document`
   */
  constructor(o) {
    if (!o || typeof o.update !== 'function' || typeof o.draw !== 'function') throw new TypeError('AnchorLoop needs update() and draw() callbacks');
    this._update = o.update; this._draw = o.draw; this._onState = o.onState || null;
    this.maxDt = o.maxDt ?? 1 / 20;
    this.fixedStep = o.fixedStep || 0;
    this._raf = 'raf' in o ? o.raf : (typeof requestAnimationFrame === 'function' ? (f) => requestAnimationFrame(f) : null);   // raf: null = fully manual (headless)
    this._caf = o.caf || (typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : () => {});
    this._now = o.now || (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
    this.state = State.START;
    this.time = 0;          // simulated seconds spent in PLAY
    this.frames = 0;        // update() calls
    this._id = 0; this._last = 0; this._acc = 0; this._running = false;
    this._frame = this._frame.bind(this);
    const vis = o.visibility || (typeof document !== 'undefined' ? document : null);
    if (vis && o.autoPause !== false) {
      this._vis = vis;
      vis.addEventListener('visibilitychange', () => { if (vis.hidden) { if (this.state === State.PLAY) this.pause(); } this._last = this._now(); });
    }
  }

  /** Low level: validated transition. Prefer the named helpers below. */
  setState(next) {
    const prev = this.state;
    if (next === prev) return false;
    if (!TRANSITIONS[prev].includes(next)) throw new Error(`AnchorLoop: illegal transition ${prev} -> ${next}`);
    this.state = next;
    if (next === State.PAUSE) { this._stopRaf(); this._draw(0, this); }
    if (prev === State.PAUSE && next === State.PLAY) { this._last = this._now(); this._startRaf(); }
    if (next === State.PLAY && prev !== State.PAUSE) { this.time = 0; this.frames = 0; this._acc = 0; this._last = this._now(); this._startRaf(); }
    if (next === State.START || next === State.GAMEOVER) { this._last = this._now(); this._startRaf(); }
    if (this._onState) this._onState(next, prev, this);
    return true;
  }

  start()    { return this.setState(State.PLAY); }                       // START (or GAMEOVER) -> PLAY
  pause()    { return this.state === State.PLAY && this.setState(State.PAUSE); }
  resume()   { return this.state === State.PAUSE && this.setState(State.PLAY); }
  togglePause() { return this.state === State.PLAY ? this.pause() : this.resume(); }
  gameOver() { return this.state === State.PLAY && this.setState(State.GAMEOVER); }
  reset()    { return (this.state === State.PAUSE || this.state === State.GAMEOVER) && this.setState(State.START); }
  get playing() { return this.state === State.PLAY; }

  /** Begin drawing the START screen (call once after construction, before start()). */
  boot() { this._startRaf(); this._draw(0, this); return this; }

  /**
   * Advance exactly one frame by hand (headless / tests / bots). Honors the state machine: update() only runs in PLAY.
   * Returns the number of update() calls made.
   */
  step(dt) {
    if (dt > this.maxDt) dt = this.maxDt;
    let n = 0;
    if (this.state === State.PLAY) n = this._advance(dt);
    this._draw(this.fixedStep ? this._acc / this.fixedStep : 0, this);
    return n;
  }

  _advance(dt) {
    let n = 0;
    if (this.fixedStep) {
      this._acc += dt;
      while (this._acc >= this.fixedStep - 1e-9 && this.state === State.PLAY) { this._acc = Math.max(0, this._acc - this.fixedStep); this._tick(this.fixedStep); n++; }
    } else if (dt > 0) { this._tick(dt); n = 1; }
    return n;
  }
  _tick(dt) { this.time += dt; this.frames++; this._update(dt, this); }

  _frame(t) {
    this._id = 0;
    if (!this._running) return;
    let dt = (t - this._last) / 1000; this._last = t;
    if (!(dt > 0)) dt = 0;
    this.step(dt);
    if (this._running && this.state !== State.PAUSE) this._id = this._raf(this._frame);
  }
  _startRaf() { if (!this._raf || this._running) return; this._running = true; this._id = this._raf(this._frame); }
  _stopRaf() { this._running = false; if (this._id) this._caf(this._id); this._id = 0; }
  /** Stop everything (page teardown). */
  destroy() { this._stopRaf(); }
}
